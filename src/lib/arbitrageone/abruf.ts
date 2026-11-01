import "server-only";
import { readFile } from "node:fs/promises";
import { and, asc, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { anmelden, AutomatikAbbruch, cookiesWeg, mitBrowser } from "@/lib/automatik/runner";
import { aoImportAnlegen } from "@/lib/datei-import/service";
import type { ImportArt } from "@/lib/datei-import/logic";
import { getIntegration } from "@/lib/integrations/store";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { taeglichFaellig } from "@/lib/today/abruf-plan";
import { AO_EXPORTE, AO_UHRZEIT, faelligeExporte, laufText, type AoExport, type AoExportErgebnis, type AoExportKey } from "./logic";

// ArbitrageOne-Anbindung: anmelden, auf der Export-Seite je fälligem Export den Download-Knopf drücken, die Datei über
// den Datei-Import verarbeiten (gleicher Weg wie import_link). Nur lesen: Exportvorlagen werden nie verändert, in
// ArbitrageOne wird nichts gespeichert. Ein Lauf gleichzeitig (gemeinsame Sperre der Browser-Automatik), jeder Schritt
// mit Bildschirmfoto, Zwei-Faktor → Abbruch mit Aufgabe. Fehler je Export → Aufgabe, nie stilles Scheitern.

const PROVIDER = "arbitrageone_web";
const LINK = "/anbindungen?p=arbitrageone_web#arbitrageone_web";
const STANDARD_LOGIN = "https://app.arbitrageone.de/login";
const STANDARD_EXPORT = "https://app.arbitrageone.de/export";
const L = schema.aoLaeufe;
const D = schema.dateiImporte;

type Page = import("playwright").Page;
type Cfg = Record<string, string | undefined>;

/** Name der Karte je Export: aus der Anbindung (Feld „titel…“), sonst Standard. */
const titelFeld = (k: AoExportKey) => `titel${k[0].toUpperCase()}${k.slice(1)}`;
export const kartenTitel = (cfg: Cfg, e: AoExport) => (cfg[titelFeld(e.key)] ?? "").trim() || e.titel;

const KNOPF = /download|herunterladen|exportieren|export|csv|xlsx/i;
const BESTAETIGEN = /download|herunterladen|exportieren|export|erstellen|bestätigen|starten/i;

/** Karte eines Exports auf der Export-Seite: Überschrift mit dem Titel (Hauptbereich), dann der nächste Container mit Knopf. */
async function karteFinden(page: Page, titel: string) {
  const bereich = (await page.locator("main").count()) ? page.locator("main").first() : page.locator("body");
  const ueberschrift = bereich.locator("h1, h2, h3, h4, h5, h6, [role=heading], .card-title, strong, b").filter({ hasText: titel });
  const kandidat = (await ueberschrift.count()) ? ueberschrift.first() : bereich.getByText(titel, { exact: false }).first();
  if (!(await kandidat.count())) return null;
  return kandidat.locator("xpath=ancestor-or-self::*[.//button or .//a[@href]][1]");
}

/** Export herunterladen: Knopf in der Karte; öffnet sich ein Dialog (Zeitraum/Format), dessen Bestätigen-Knopf. */
async function herunterladen(page: Page, url: string, titel: string): Promise<{ name: string; bytes: Uint8Array }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await cookiesWeg(page);
  const karte = await karteFinden(page, titel);
  if (!karte) throw new AutomatikAbbruch(`Export „${titel}“ auf der Export-Seite nicht gefunden – Name der Karte unter Anbindungen prüfen.`);
  const knoepfe = karte.locator("button, a[href]");
  const knopf = (await knoepfe.filter({ hasText: KNOPF }).count()) ? knoepfe.filter({ hasText: KNOPF }).first() : knoepfe.first();
  // Was zuerst kommt: Datei oder Dialog (Zeitraum/Format) – kein festes Warten.
  const DIALOG = '[role="dialog"], dialog[open], .modal.show, .modal[open]';
  const alsDatei = page.waitForEvent("download", { timeout: 20_000 }).then((d) => d).catch(() => null);
  const alsDialog = page.locator(DIALOG).first().waitFor({ state: "visible", timeout: 20_000 }).then(() => "dialog" as const).catch(() => null);
  await knopf.click();
  const erst = await Promise.race([alsDatei, alsDialog]);
  let download = erst && erst !== "dialog" ? erst : null;
  if (!download) {
    const dialog = page.locator(DIALOG).last();
    const ort = (await dialog.count()) ? dialog : page.locator("body");
    const ok = ort.locator("button, a[href]").filter({ hasText: BESTAETIGEN }).last();
    if (!(await ok.count())) throw new AutomatikAbbruch(`Export „${titel}“: nach dem Klick kam weder eine Datei noch ein Dialog.`);
    const zweit = page.waitForEvent("download", { timeout: 120_000 });
    await ok.click();
    download = await zweit;
  }
  const pfad = await download.path();
  if (!pfad) throw new AutomatikAbbruch(`Export „${titel}“: Download fehlgeschlagen (${(await download.failure()) ?? "unbekannt"}).`);
  return { name: download.suggestedFilename() || `${titel}.csv`, bytes: new Uint8Array(await readFile(pfad)) };
}

/** Inhaber-Konto, unter dem die Importe laufen (Datei-Import ist nur für Inhaber). */
async function inhaberId(tenantId: string): Promise<string | null> {
  const M = schema.memberships;
  const [r] = await db.select({ id: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"), eq(M.readOnly, false), isNull(M.deaktiviertAm))).orderBy(asc(M.createdAt)).limit(1);
  return r?.id ?? null;
}

/** Wann wurde jeder Export zuletzt heruntergeladen? (Grundlage für „fällig“.) */
export async function letzteDownloads(tenantId: string): Promise<Partial<Record<AoExportKey, Date | null>>> {
  const rows = await db
    .select({ key: D.quelleExport, am: max(D.hochgeladenAm) })
    .from(D)
    .where(and(eq(D.tenantId, tenantId), eq(D.herkunft, "arbitrageone"), isNotNull(D.hochgeladenAm)))
    .groupBy(D.quelleExport);
  return Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key as AoExportKey, r.am ?? null]));
}

export type AoLauf = { ok: boolean; status: "ok" | "teilweise" | "fehler"; text: string; ergebnis: AoExportErgebnis[]; laufId: string | null };

/**
 * Exporte abholen und verarbeiten. `zeitplan`: nur fällige (täglich/wöchentlich/monatlich), `knopf`: alle bzw. `nur`.
 * Wirft nie – das Ergebnis sagt, was geklappt hat; Fehler legen eine Aufgabe an.
 */
export async function aoAbholen(tenantId: string, o: { ausloeser: "zeitplan" | "knopf"; nur?: AoExportKey[]; jetzt?: Date }): Promise<AoLauf> {
  const jetzt = o.jetzt ?? new Date();
  const cfg = await getIntegration(tenantId, PROVIDER);
  if (!cfg?.email || !cfg.password) return { ok: false, status: "fehler", text: "ArbitrageOne-Anmeldung fehlt (Anbindungen → ArbitrageOne).", ergebnis: [], laufId: null };
  const faellig = faelligeExporte(await letzteDownloads(tenantId), jetzt, { alle: o.ausloeser === "knopf" && !o.nur, nur: o.nur });
  const [lauf] = await db.insert(L).values({ tenantId, ausloeser: o.ausloeser }).returning({ id: L.id });
  if (!faellig.length) {
    await db.update(L).set({ status: "ok", ergebnis: [], endeAm: new Date(), fehler: null }).where(eq(L.id, lauf.id));
    return { ok: true, status: "ok", text: "Nichts fällig – alle Exporte sind aktuell.", ergebnis: [], laufId: lauf.id };
  }
  const user = await inhaberId(tenantId);
  if (!user) {
    await db.update(L).set({ status: "fehler", fehler: "Kein aktives Inhaber-Konto", endeAm: new Date() }).where(eq(L.id, lauf.id));
    return { ok: false, status: "fehler", text: "Kein aktives Inhaber-Konto – Importe laufen nur unter einem Inhaber.", ergebnis: [], laufId: lauf.id };
  }
  const url = cfg.exportUrl || STANDARD_EXPORT;
  const dateien: { e: AoExport; name: string; bytes: Uint8Array }[] = [];
  const ergebnis: AoExportErgebnis[] = [];
  const r = await mitBrowser(tenantId, { titel: "ArbitrageOne-Abruf", aufgabeKey: "automatik-arbitrageone", link: LINK }, async (page, log) => {
    await anmelden(page, { loginUrl: cfg.loginUrl || STANDARD_LOGIN, email: cfg.email!, password: cfg.password!, dienst: "ArbitrageOne", selektoren: { email: cfg.feldEmail, passwort: cfg.feldPasswort, knopf: cfg.feldKnopf } }, log);
    for (const e of faellig) {
      const titel = kartenTitel(cfg, e);
      try {
        const d = await herunterladen(page, url, titel);
        dateien.push({ e, ...d });
        await log(`${titel}: ${d.name} heruntergeladen (${Math.max(1, Math.round(d.bytes.length / 1024))} KB)`);
      } catch (err) {
        const grund = (err instanceof Error ? err.message : String(err)).slice(0, 240);
        ergebnis.push({ key: e.key, titel: e.titel, ok: false, text: grund });
        await log(`${titel}: ${grund}`).catch(() => undefined);
      }
    }
  });
  // Verarbeiten erst nach dem Browser (die Weitergabe an sellerboard braucht die Sperre der Browser-Automatik selbst).
  for (const d of dateien) {
    try {
      const x = await aoImportAnlegen(tenantId, user, { art: d.e.art as ImportArt, quelleExport: d.e.key, dateiname: d.name, hinweis: `ArbitrageOne – ${d.e.titel} (${o.ausloeser === "zeitplan" ? "Nachtlauf" : "Jetzt abholen"})` }, d.bytes);
      const ok = x.status === "fertig";
      let text = x.bereits ? "Datei unverändert – bereits importiert, nichts doppelt" : x.text;
      // sellerboard-COG: auf Wunsch die Datei von ArbitrageOne unverändert an sellerboard weiterreichen (nicht neu bauen).
      if (ok && !x.bereits && d.e.key === "sellerboard" && cfg.sellerboardWeiterreichen === "ja") {
        const { anSellerboardDateiUebertragen } = await import("@/lib/automatik/uebertragen");
        const s = await anSellerboardDateiUebertragen(tenantId, { name: d.name, bytes: d.bytes });
        text += ` · sellerboard: ${s.text}`;
      }
      ergebnis.push({ key: d.e.key, titel: d.e.titel, ok, datei: d.name, importId: x.importId, text });
    } catch (err) {
      ergebnis.push({ key: d.e.key, titel: d.e.titel, ok: false, datei: d.name, text: (err instanceof Error ? err.message : String(err)).slice(0, 240) });
    }
  }
  // Einkäufe neu → Lugru „gekauft“ gleich abgleichen (sonst erst im 6-Std.-Takt).
  if (ergebnis.some((x) => x.key === "einkaeufe" && x.ok)) {
    const { lugruKaufAbgleich } = await import("@/lib/lugru-deals/discord");
    await lugruKaufAbgleich(tenantId, jetzt).catch(() => undefined);
  }
  // Reihenfolge wie im Katalog
  ergebnis.sort((a, b) => AO_EXPORTE.findIndex((e) => e.key === a.key) - AO_EXPORTE.findIndex((e) => e.key === b.key));
  const fehler = ergebnis.filter((x) => !x.ok);
  const status: AoLauf["status"] = !r.ok ? "fehler" : fehler.length ? (fehler.length === ergebnis.length ? "fehler" : "teilweise") : "ok";
  const text = !r.ok ? `Abgebrochen: ${r.fehler}` : laufText(ergebnis);
  await db.update(L).set({ status, ergebnis, protokoll: r.protokoll.map((p) => ({ zeit: p.zeit, text: p.text, bildId: p.bildId })), fehler: r.ok ? null : r.fehler, endeAm: new Date() }).where(eq(L.id, lauf.id));
  if (r.ok && fehler.length)
    await upsertSystemTask(db, tenantId, "automatik-arbitrageone-exporte", { title: `ArbitrageOne-Abruf: ${fehler.map((x) => x.titel).join(", ")} fehlgeschlagen`, notes: `${fehler.map((x) => `${x.titel}: ${x.text}`).join("\n")}\nDie übrigen Exporte sind verarbeitet. Name der Karte bzw. Format prüfen (Anbindungen → ArbitrageOne) oder die Datei selbst hochladen.`, priority: "critical", category: "system", link: LINK });
  else if (r.ok) {
    await resolveSystemTask(db, tenantId, "automatik-arbitrageone-exporte");
    await resolveSystemTask(db, tenantId, "automatik-arbitrageone");
  }
  return { ok: status === "ok", status, text, ergebnis, laufId: lauf.id };
}

/** Nachtlauf (Hintergrund): ab 05:30 einmal am Tag, wenn die Anbindung eingerichtet und die Automatik an ist. */
export async function aoNachtlauf(tenantId: string, jetzt = new Date()): Promise<AoLauf | null> {
  const cfg = await getIntegration(tenantId, PROVIDER);
  if (!cfg?.email || !cfg.password || cfg.automatik === "aus") return null;
  const [letzter] = await db.select({ am: L.createdAt }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.ausloeser, "zeitplan"))).orderBy(desc(L.createdAt)).limit(1);
  if (!taeglichFaellig(AO_UHRZEIT, letzter?.am ?? null, jetzt)) return null;
  return aoAbholen(tenantId, { ausloeser: "zeitplan", jetzt });
}

/** Verbindung testen: anmelden und auf der Export-Seite jede Karte suchen (nichts herunterladen). Wirft bei Fehlern. */
export async function aoVerbindungTesten(tenantId: string, cfg: Cfg): Promise<string> {
  if (!cfg.email || !cfg.password) throw new Error("Anmelde-E-Mail und Passwort fehlen.");
  const teile: string[] = [];
  let fehlt = 0;
  const r = await mitBrowser(tenantId, { titel: "ArbitrageOne – Verbindung testen", aufgabeKey: "automatik-arbitrageone-test", link: LINK, ohneAufgabe: true }, async (page, log) => {
    await anmelden(page, { loginUrl: cfg.loginUrl || STANDARD_LOGIN, email: cfg.email!, password: cfg.password!, dienst: "ArbitrageOne", selektoren: { email: cfg.feldEmail, passwort: cfg.feldPasswort, knopf: cfg.feldKnopf } }, log);
    teile.push("Anmeldung ok");
    await page.goto(cfg.exportUrl || STANDARD_EXPORT, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await cookiesWeg(page);
    for (const e of AO_EXPORTE) {
      const titel = kartenTitel(cfg, e);
      const karte = await karteFinden(page, titel);
      const ok = !!karte && (await karte.locator("button, a[href]").count()) > 0;
      if (!ok) fehlt++;
      teile.push(`${titel}: ${ok ? "gefunden" : "nicht gefunden"}`);
    }
    await log(teile.join(" · "));
  });
  if (!r.ok) throw new Error(/zwei-faktor/i.test(r.fehler ?? "") ? "Zwei-Faktor-Anmeldung verlangt – die Automatik kann sich so nicht anmelden. Für dieses Konto Zwei-Faktor ausschalten oder ein eigenes Konto nur fürs System anlegen." : (r.fehler ?? "Test fehlgeschlagen"));
  if (fehlt) throw new Error(teile.join(" · "));
  return teile.join(" · ");
}

/** Letzte Läufe für Anbindungen und das Werkzeug anbindungen_status. */
export async function aoLaeufe(tenantId: string, limit = 10) {
  return db.select().from(L).where(eq(L.tenantId, tenantId)).orderBy(desc(L.createdAt)).limit(limit);
}

/** Letzte ArbitrageOne-Dateien (Anbindungen → Importe). */
export async function aoImporte(tenantId: string, limit = 20) {
  return db
    .select({ id: D.id, art: D.art, quelle: D.quelleExport, dateiname: D.dateiname, status: D.status, am: D.createdAt, fertigAm: D.fertigAm, fehler: D.fehlerText, ergebnis: D.ergebnis, bereits: sql<boolean>`${D.bereitsImportId} is not null` })
    .from(D)
    .where(and(eq(D.tenantId, tenantId), eq(D.herkunft, "arbitrageone")))
    .orderBy(desc(D.createdAt))
    .limit(limit);
}
