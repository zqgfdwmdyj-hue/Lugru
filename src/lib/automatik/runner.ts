import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { storeFile } from "@/lib/orders/service";
import { upsertSystemTask } from "@/lib/tasks/system";

// Browser-Automatik (sellerboard-Kostenimport, BQool-Upload): nur auf Knopfdruck, höchstens ein Lauf gleichzeitig
// (auch über Prozesse: Datenbank-Sperre), jeder Schritt mit Bildschirmfoto, bei Zwei-Faktor-Anmeldung oder Fehler
// sofort abbrechen und eine Aufgabe anlegen – kein Wiederholen.

export type Schritt = { zeit: string; text: string; bildId?: string };
type Page = import("playwright").Page;

export class AutomatikAbbruch extends Error {
  constructor(
    message: string,
    readonly zweiFaktor = false,
  ) {
    super(message);
  }
}

const SPERRE = 734_201;
let laeuft = false;

/** Ist ein Browser auf dem Server verfügbar? null = ja, sonst der Grund. */
export async function browserFehlt(): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const pfad = process.env.PLAYWRIGHT_CHROMIUM_PATH || chromium.executablePath();
    const { existsSync } = await import("node:fs");
    return existsSync(pfad) ? null : "Auf dem Server ist kein Browser installiert (Docker-Build mit MIT_BROWSER=1). Bis dahin die Datei herunterladen und selbst hochladen.";
  } catch {
    return "Browser-Automatik ist auf dem Server nicht verfügbar. Bis dahin die Datei herunterladen und selbst hochladen.";
  }
}

const ZWEI_FAKTOR = /zwei-faktor|two-factor|2-step|2fa|verification code|bestätigungscode|sicherheitscode|authenticator|one-time code|einmalcode/i;

/** Anmelden: E-Mail + Passwort, Absenden; Zwei-Faktor oder weiter sichtbares Passwortfeld → Abbruch. */
export async function anmelden(page: Page, o: { loginUrl: string; email: string; password: string }, log: (t: string) => Promise<void>) {
  await page.goto(o.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('input[type="email"], input[name="email"], input[name="username"], input#email').first().fill(o.email);
  await page.locator('input[type="password"]').first().fill(o.password);
  await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => undefined), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
  await page.waitForTimeout(1500);
  const text = await page.locator("body").innerText().catch(() => "");
  if (ZWEI_FAKTOR.test(text) || (await page.locator('input[autocomplete="one-time-code"]').count()) > 0) throw new AutomatikAbbruch("Zwei-Faktor-Anmeldung verlangt – Automatik abgebrochen.", true);
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) throw new AutomatikAbbruch("Anmeldung fehlgeschlagen (Anmeldeseite erscheint weiter) – Zugangsdaten prüfen.");
  await log("Angemeldet");
}

/** Datei auf einer Upload-Seite hochladen und auf eine Erfolgsmeldung warten. */
export async function dateiHochladen(page: Page, o: { url: string; datei: { name: string; mimeType: string; buffer: Buffer }; erfolg: RegExp; fehler?: RegExp }, log: (t: string) => Promise<void>) {
  // Jede Datei auf frisch geladener Upload-Seite (nach dem Hochladen zeigt die Seite oft nur die Erfolgsmeldung).
  await page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('input[type="file"]').first().setInputFiles(o.datei, { timeout: 20_000 });
  const knopf = page.locator('button[type="submit"], input[type="submit"], button:has-text("Import"), button:has-text("Upload"), button:has-text("Hochladen")').first();
  if (await knopf.count()) await knopf.click();
  const ende = Date.now() + 60_000;
  while (Date.now() < ende) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (o.fehler?.test(text)) throw new AutomatikAbbruch(`Upload abgelehnt: ${(o.fehler.exec(text)?.[0] ?? "Fehler").slice(0, 160)}`);
    if (o.erfolg.test(text)) {
      await log(`${o.datei.name} hochgeladen`);
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new AutomatikAbbruch(`Keine Erfolgsmeldung nach dem Hochladen von ${o.datei.name}.`);
}

/**
 * Lauf mit Browser: Sperre, Protokoll mit Bildschirmfotos (Tabelle files), Aufgabe bei Abbruch. Gibt das Protokoll
 * zurück; wirft nie – das Ergebnis sagt, ob es geklappt hat.
 */
export async function mitBrowser(tenantId: string, o: { titel: string; aufgabeKey: string; link: string }, fn: (page: Page, log: (t: string) => Promise<void>) => Promise<void>): Promise<{ ok: boolean; protokoll: Schritt[]; fehler: string | null }> {
  const protokoll: Schritt[] = [];
  const fehlt = await browserFehlt();
  if (fehlt) return { ok: false, protokoll: [{ zeit: new Date().toISOString(), text: fehlt }], fehler: fehlt };
  if (laeuft) return { ok: false, protokoll: [], fehler: "Es läuft schon eine Browser-Automatik – bitte kurz warten." };
  const [{ ok: gesperrt }] = (await db.execute<{ ok: boolean }>(sql`select pg_try_advisory_lock(${SPERRE}) as ok`)).rows;
  if (!gesperrt) return { ok: false, protokoll: [], fehler: "Es läuft schon eine Browser-Automatik – bitte kurz warten." };
  laeuft = true;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  let n = 0;
  try {
    const page = await (await browser.newContext({ locale: "de-DE", viewport: { width: 1280, height: 900 } })).newPage();
    const log = async (text: string) => {
      const bild = await page.screenshot({ fullPage: false }).catch(() => null);
      const bildId = bild ? await storeFile(tenantId, `automatik-${o.aufgabeKey}-${++n}.png`, "image/png", bild) : undefined;
      protokoll.push({ zeit: new Date().toISOString(), text, bildId });
    };
    try {
      await fn(page, log);
      return { ok: true, protokoll, fehler: null };
    } catch (e) {
      const grund = e instanceof Error ? e.message.slice(0, 300) : String(e);
      await log(`Abgebrochen: ${grund}`).catch(() => undefined);
      await upsertSystemTask(db, tenantId, o.aufgabeKey, { title: `${o.titel}: abgebrochen`, notes: `${grund}\nNicht automatisch wiederholt – Datei bitte herunterladen und selbst hochladen oder Zugang prüfen.`, priority: "critical", category: "system", link: o.link });
      return { ok: false, protokoll, fehler: grund };
    }
  } finally {
    await browser.close().catch(() => undefined);
    laeuft = false;
    await db.execute(sql`select pg_advisory_unlock(${SPERRE})`).catch(() => undefined);
  }
}
