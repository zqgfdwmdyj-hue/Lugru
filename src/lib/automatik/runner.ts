import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loeschen, neuerSchluessel, speichern } from "@/lib/medien/ablage";
import { storeFile } from "@/lib/orders/service";
import { upsertSystemTask } from "@/lib/tasks/system";
import { ANMELDE_KNOPF, anmeldeWarten, CAPTCHA_DOM, CAPTCHA_TITEL, COOKIE_KNOPF, DEBUG_TAGE, debugName, mitBildschirmfoto, seiteOhneQuery } from "./login-logic";

// Browser-Automatik (sellerboard-Kostenimport, BQool-Upload): nur auf Knopfdruck, höchstens ein Lauf gleichzeitig
// (auch über Prozesse: Datenbank-Sperre), jeder Schritt mit Bildschirmfoto, bei Zwei-Faktor-Anmeldung oder Fehler
// sofort abbrechen und eine Aufgabe anlegen – kein Wiederholen.

export type Schritt = { zeit: string; text: string; bildId?: string };
type Page = import("playwright").Page;
type Locator = import("playwright").Locator;

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
    return existsSync(pfad) ? null : "Auf dem Server ist noch kein Browser installiert. Er wird beim nächsten Update (deploy/update.sh) automatisch mitgebaut – steht in der .env „MIT_BROWSER=0“, die Zeile löschen. Bis dahin die Datei herunterladen und selbst hochladen.";
  } catch {
    return "Browser-Automatik ist auf dem Server nicht verfügbar. Bis dahin die Datei herunterladen und selbst hochladen.";
  }
}

const ZWEI_FAKTOR = /zwei-faktor|two-factor|2-step|2fa|verification code|bestätigungscode|sicherheitscode|authenticator|one-time code|einmalcode/i;

/** Eigene Feldnamen aus der Anbindung (CSS-Selektor aus „Rechtsklick → Untersuchen“) – werden zuerst probiert. */
export type Selektoren = { email?: string | null; passwort?: string | null; knopf?: string | null };

/** B24: Cloudflare/Captcha → klare Meldung, keine Wiederholungsschleife. */
async function browserPruefung(page: Page, dienst: string) {
  const titel = await page.title().catch(() => "");
  if (CAPTCHA_TITEL.test(titel) || (await page.locator(CAPTCHA_DOM).count().catch(() => 0)) > 0)
    throw new AutomatikAbbruch(`${dienst} verlangt eine Browser-Prüfung (Cloudflare/Captcha) – Automatik hier nicht möglich, Datei-Weg nutzen (ZIP bzw. selbst herunterladen/hochladen).`);
}

/**
 * B24: Cookie-Banner wegklicken („Akzeptieren“, „Accept all“ …), falls einer da ist. Nach dem Laden einer Seite kurz
 * warten (Banner kommen oft verzögert); bei späteren Aufrufen auf derselben Seite nur nachsehen (`ms` = 0).
 */
export async function cookiesWeg(page: Page, ms = 2500) {
  const knopf = page.getByRole("button", { name: COOKIE_KNOPF }).or(page.getByRole("link", { name: COOKIE_KNOPF })).or(page.locator("#onetrust-accept-btn-handler, #accept-cookies, button[id*='accept' i], [data-testid*='cookie-accept' i]"));
  try {
    if (ms <= 0 && !(await knopf.first().isVisible().catch(() => false))) return;
    await knopf.first().waitFor({ state: "visible", timeout: Math.max(ms, 500) });
    await knopf.first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
  } catch {
    // kein Banner
  }
}

/** Erstes sichtbares Element aus mehreren Kandidaten (wartet bis `ms`). */
async function erstesSichtbares(page: Page, kandidaten: Locator[], ms: number): Promise<Locator | null> {
  const ende = Date.now() + ms;
  do {
    for (const k of kandidaten) {
      const l = k.first();
      if (await l.isVisible().catch(() => false)) return l;
    }
    await page.waitForTimeout(400);
  } while (Date.now() < ende);
  return null;
}

const eigen = (page: Page, sel?: string | null) => (sel?.trim() ? [page.locator(sel.trim())] : []);
const emailFelder = (page: Page, sel?: string | null) => [
  ...eigen(page, sel),
  page.locator('input[type="email"]'),
  page.locator('input[name="email" i], input[name="username" i], input[name="login" i], input#email, input#username, input#login'),
  page.locator('input[autocomplete="username"], input[autocomplete="email"]'),
  page.locator('input[placeholder*="mail" i], input[placeholder*="benutzer" i], input[placeholder*="user" i]'),
  page.getByLabel(/e-?mail|benutzername|username|anmeldename/i),
  page.locator('form input[type="text"]'),
];
const passwortFelder = (page: Page, sel?: string | null) => [...eigen(page, sel), page.locator('input[type="password"]'), page.getByLabel(/passwort|kennwort|password/i)];
const anmeldeKnoepfe = (page: Page, sel?: string | null) => [...eigen(page, sel), page.getByRole("button", { name: ANMELDE_KNOPF }), page.locator('button[type="submit"], input[type="submit"]')];

const seite = (page: Page) => seiteOhneQuery(page.url());

/**
 * Anmelden (B24 gehärtet): Seite laden + Netzwerk-Ruhe, Browser-Prüfung erkennen, Cookie-Banner weg, E-Mail-Feld breit
 * suchen (eigene Feldnamen zuerst, bis 60 s), Passwort (auch zweistufig: erst E-Mail → „Weiter“), Knopf per Text oder
 * Submit. Zwei-Faktor, Captcha oder weiter sichtbares Passwortfeld → Abbruch ohne Wiederholung.
 */
export async function anmelden(page: Page, o: { loginUrl: string; email: string; password: string; dienst?: string; selektoren?: Selektoren }, log: (t: string) => Promise<void>) {
  const dienst = o.dienst ?? "Der Dienst";
  const warten = anmeldeWarten();
  await page.goto(o.loginUrl, { waitUntil: "domcontentloaded", timeout: warten });
  await page.waitForLoadState("networkidle", { timeout: Math.min(15_000, warten) }).catch(() => undefined);
  await browserPruefung(page, dienst);
  await cookiesWeg(page);
  const email = await erstesSichtbares(page, emailFelder(page, o.selektoren?.email), warten);
  if (!email) {
    await browserPruefung(page, dienst);
    throw new AutomatikAbbruch(`Anmeldeformular nicht gefunden – kein E-Mail-Feld auf ${seite(page)} nach ${Math.round(warten / 1000)} s. Bildschirmfoto ansehen; falls das Feld anders heißt, unter Anbindungen „Feld E-Mail“ eintragen.`);
  }
  await email.fill(o.email);
  let passwort = await erstesSichtbares(page, passwortFelder(page, o.selektoren?.passwort), 1500);
  if (!passwort) {
    // Zweistufig: erst E-Mail, dann „Weiter“, dann Passwort
    const weiter = await erstesSichtbares(page, anmeldeKnoepfe(page, o.selektoren?.knopf), 3000);
    if (weiter) {
      await cookiesWeg(page, 0);
      await weiter.click({ timeout: 10_000 });
    }
    passwort = await erstesSichtbares(page, passwortFelder(page, o.selektoren?.passwort), warten);
    if (!passwort) throw new AutomatikAbbruch(`Passwortfeld nicht gefunden auf ${seite(page)} – Bildschirmfoto ansehen; ggf. unter Anbindungen „Feld Passwort“ eintragen.`);
  }
  await passwort.fill(o.password);
  await cookiesWeg(page, 0);
  const knopf = await erstesSichtbares(page, anmeldeKnoepfe(page, o.selektoren?.knopf), 5000);
  if (knopf) await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => undefined), knopf.click({ timeout: 15_000 })]);
  else await passwort.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: Math.min(15_000, warten) }).catch(() => undefined);
  await page.waitForTimeout(800);
  await browserPruefung(page, dienst);
  const text = await page.locator("body").innerText().catch(() => "");
  if (ZWEI_FAKTOR.test(text) || (await page.locator('input[autocomplete="one-time-code"]').count()) > 0) throw new AutomatikAbbruch("Zwei-Faktor-Anmeldung verlangt – Automatik abgebrochen.", true);
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) throw new AutomatikAbbruch("Anmeldung fehlgeschlagen (Anmeldeseite erscheint weiter) – Zugangsdaten prüfen.");
  await log("Angemeldet");
}

/** Datei auf einer Upload-Seite hochladen und auf eine Erfolgsmeldung warten. */
export async function dateiHochladen(page: Page, o: { url: string; datei: { name: string; mimeType: string; buffer: Buffer }; erfolg: RegExp; fehler?: RegExp }, log: (t: string) => Promise<void>) {
  // Jede Datei auf frisch geladener Upload-Seite (nach dem Hochladen zeigt die Seite oft nur die Erfolgsmeldung).
  await page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await cookiesWeg(page);
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
export async function mitBrowser(tenantId: string, o: { titel: string; aufgabeKey: string; link: string; /** Verbindungstest: bei Abbruch keine Aufgabe anlegen. */ ohneAufgabe?: boolean }, fn: (page: Page, log: (t: string) => Promise<void>) => Promise<void>): Promise<{ ok: boolean; protokoll: Schritt[]; fehler: string | null }> {
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
      const roh = e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : String(e);
      const bild = await debugFesthalten(tenantId, page, o.titel, roh).catch(() => null);
      const grund = mitBildschirmfoto(roh, bild);
      await log(`Abgebrochen: ${grund}`).catch(() => undefined);
      if (!o.ohneAufgabe) await upsertSystemTask(db, tenantId, o.aufgabeKey, { title: `${o.titel}: abgebrochen`, notes: `${grund}\nNicht automatisch wiederholt – Datei bitte herunterladen und selbst hochladen oder Zugang prüfen.`, priority: "critical", category: "system", link: o.link });
      return { ok: false, protokoll, fehler: grund };
    }
  } finally {
    await browser.close().catch(() => undefined);
    laeuft = false;
    await db.execute(sql`select pg_advisory_unlock(${SPERRE})`).catch(() => undefined);
  }
}

/**
 * B24: Bildschirmfoto (ganze Seite), Seitentitel und Adresse (ohne Abfrageteil) eines Fehlschlags festhalten –
 * verschlüsselt in der Ablage, nur für Inhaber unter /import/debug/<name>.png, nach 7 Tagen gelöscht.
 */
export async function debugFesthalten(tenantId: string, page: Page, dienst: string, fehler: string): Promise<{ pfad: string; titel: string; url: string } | null> {
  const bild = await page.screenshot({ fullPage: true, timeout: 15_000 }).catch(() => page.screenshot({ timeout: 10_000 }).catch(() => null));
  const titel = (await page.title().catch(() => "")).slice(0, 200);
  const url = seiteOhneQuery(page.url()).slice(0, 300);
  const jetzt = new Date();
  const name = debugName(jetzt, dienst.split(/\s+[–-]\s+/)[0], randomBytes(4).toString("hex"));
  let ablage: string | null = null;
  if (bild) {
    ablage = neuerSchluessel(tenantId, jetzt);
    await speichern(ablage, new Uint8Array(bild));
  }
  await db.insert(schema.automatikDebug).values({ tenantId, name, dienst: dienst.slice(0, 120), titel, url, fehler: fehler.slice(0, 500), ablage });
  return { pfad: `/import/debug/${name}.png`, titel, url };
}

/** Täglich: Fehler-Bildschirmfotos älter als 7 Tage löschen (Bild und Eintrag). */
export async function debugAufraeumen(jetzt = new Date()): Promise<number> {
  const A = schema.automatikDebug;
  const alt = await db.select({ id: A.id, ablage: A.ablage }).from(A).where(lt(A.createdAt, new Date(jetzt.getTime() - DEBUG_TAGE * 86_400_000)));
  for (const a of alt) {
    if (a.ablage) await loeschen(a.ablage).catch(() => null);
    await db.delete(A).where(eq(A.id, a.id));
  }
  return alt.length;
}

/** Bild eines Fehlschlags (nur Inhaber – prüft die Route). */
export async function debugBild(tenantId: string, name: string): Promise<Buffer | null> {
  const A = schema.automatikDebug;
  const [a] = await db.select({ ablage: A.ablage }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.name, name)));
  if (!a?.ablage) return null;
  const { lesen } = await import("@/lib/medien/ablage");
  return lesen(a.ablage);
}
