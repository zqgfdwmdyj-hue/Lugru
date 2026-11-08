import "server-only";
import { readFile } from "node:fs/promises";
import { bqoolBerichtAdressen, bqoolExportAdressen } from "./bqool-logic";
import { anmelden, AutomatikAbbruch, cookiesWeg, debugFesthalten, mitBrowser, type Schritt } from "./runner";
import { bqoolZeit, processingReportZeilen, versatzMinuten, type UploadFehler } from "@/lib/bqool/kreislauf-logic";

// B31.2/B33.6: BQool-Ist holen – anmelden und je Land die Listen-Seite (…/repricing/amazonde) öffnen, „Download“ →
// „Download listings“ klicken (BQool hat keine Export-URL und keinen Zeitplan; früher „Full Template“). Dazu die
// „Processing Reports“ der letzten Uploads lesen. Nur lesen: in BQool wird nichts geändert. Gemeinsame Sperre der
// Browser-Automatik, Bildschirmfoto je Schritt, Zwei-Faktor → Abbruch mit Aufgabe.

type Page = import("playwright").Page;
type Locator = import("playwright").Locator;
type Cfg = Record<string, string | undefined>;

const SCHRITT_MS = Number(process.env.BQOOL_SCHRITT_MS) || 180_000;
/** B33.6: Menüpunkt „Download listings“ (Listings → Active Listings → Download), sonst „Full Template“. */
const LISTE = /download listings|listings herunterladen|listings exportieren/i;
const VOLL = /download listings|listings herunterladen|full template|vollständige vorlage/i;
const KNOPF = /download file|datei herunterladen|herunterladen|download|export/i;
const BESTAETIGEN = /download|herunterladen|export|bestätigen|confirm|\bok\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type IstDatei = { land: string; name: string; bytes: Uint8Array };
export type BerichtDatei = IstDatei & { art: "listing_performance" | "daily_sales" };
export type IstBrowserErgebnis = { ok: boolean; belegt?: boolean; zweiFaktor?: boolean; fehler: string | null; dateien: IstDatei[]; jeLand: { land: string; ok: boolean; text: string; bild?: string }[]; berichte: BerichtDatei[]; berichtFehler: string[]; protokoll: Schritt[]; /** B33.6: Uploads mit Fehlern laut „Processing Report“. */ uploadFehler?: UploadFehler[]; verlaufFehler?: string[] };

const SIEBEN = /last\s*7\s*days|letzte[n]?\s*7\s*tage|^\s*7\s*(days|tage)\s*$|past\s*7\s*days/i;
const BERICHT_KNOPF = /download|herunterladen|export/i;

/**
 * B31.5: Bericht „Listing Performance“ bzw. „Daily Sales“ herunterladen – Zeitraum „letzte 7 Tage“ wählen (Auswahlliste
 * oder Knopf, soweit vorhanden), dann „Download“. Nur lesen.
 */
async function berichtHerunterladen(page: Page, url: string, land: string, titel: string): Promise<{ name: string; bytes: Uint8Array }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await cookiesWeg(page);
  const listen = page.locator("select");
  let zeitraum = false;
  for (let i = 0; i < (await listen.count()) && !zeitraum; i++) {
    const optionen = await listen.nth(i).locator("option").evaluateAll((os) => os.map((x) => ({ value: (x as HTMLOptionElement).value, text: (x.textContent ?? "").trim() })));
    const t = optionen.find((x) => SIEBEN.test(x.text));
    if (t) {
      await listen.nth(i).selectOption(t.value);
      zeitraum = true;
    }
  }
  if (!zeitraum) {
    const k = await erstesSichtbares([page.getByRole("button", { name: SIEBEN }), page.getByRole("link", { name: SIEBEN }), page.getByRole("radio", { name: SIEBEN }), page.getByRole("option", { name: SIEBEN })]);
    if (k) await k.click({ timeout: 10_000 }).catch(() => undefined);
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  const knopf = await erstesSichtbares([page.getByRole("button", { name: BERICHT_KNOPF }), page.getByRole("link", { name: BERICHT_KNOPF })]);
  if (!knopf) throw new AutomatikAbbruch(`${titel} ${land}: kein Download-Knopf – Adresse unter Anbindungen prüfen`);
  const warten = page.waitForEvent("download", { timeout: SCHRITT_MS });
  await knopf.click({ timeout: 15_000 });
  const d = await warten.catch(() => null);
  if (!d) throw new AutomatikAbbruch(`${titel} ${land}: keine Datei nach ${Math.round(SCHRITT_MS / 1000)} s`);
  const pfad = await d.path();
  if (!pfad) throw new AutomatikAbbruch(`${titel} ${land}: Download fehlgeschlagen`);
  return { name: d.suggestedFilename() || `${titel.replace(/\s+/g, "_")}_${land}.txt`, bytes: new Uint8Array(await readFile(pfad)) };
}

async function erstesSichtbares(kandidaten: Locator[]): Promise<Locator | null> {
  for (const k of kandidaten) {
    const l = k.first();
    if (await l.isVisible().catch(() => false)) return l;
  }
  return null;
}

/** Eine Export-Datei herunterladen: Knopf („Full Template“, sonst „Download File“), ggf. Auswahl im Menü/Dialog. */
async function herunterladen(page: Page, url: string, land: string, cfg: Cfg): Promise<{ name: string; bytes: Uint8Array }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await cookiesWeg(page);
  const eigen = (cfg.exportKnopf ?? "").trim();
  const knopfRe = eigen ? new RegExp(esc(eigen), "i") : KNOPF;
  const knopf = await erstesSichtbares([
    ...(eigen ? [] : [page.getByRole("button", { name: LISTE }), page.getByRole("link", { name: LISTE }), page.getByRole("button", { name: VOLL }), page.getByRole("link", { name: VOLL })]),
    page.getByRole("button", { name: knopfRe }),
    page.getByRole("link", { name: knopfRe }),
  ]);
  if (!knopf) throw new AutomatikAbbruch(`kein Download-Knopf auf der Export-Seite ${land} – Adresse bzw. „Knopf-Text Export“ unter Anbindungen prüfen`);
  // Datei kommt direkt – oder es öffnet sich ein Menü/Dialog mit „Full Template“ (dann nicht unnötig warten).
  let d: import("playwright").Download | null = null;
  const sofort = page.waitForEvent("download", { timeout: 8_000 }).then((x) => (d = x)).catch(() => null);
  await knopf.click({ timeout: 15_000 });
  const ende = Date.now() + 8_000;
  while (!d && Date.now() < ende) {
    const menue = (await page.getByText(VOLL).first().isVisible().catch(() => false)) || (await page.locator('[role="dialog"]:visible, dialog[open], .modal.show').count().catch(() => 0)) > 0;
    if (menue) break;
    await page.waitForTimeout(250);
  }
  if (!d) await Promise.race([sofort, page.waitForTimeout(300)]);
  if (!d) {
    // Menü oder Dialog: „Full Template“ wählen (Auswahlliste, Radio oder Menüpunkt), dann bestätigen.
    const warten = page.waitForEvent("download", { timeout: SCHRITT_MS }).catch(() => null);
    let gewaehlt = false;
    const listen = page.locator("select");
    for (let i = 0; i < (await listen.count()) && !gewaehlt; i++) {
      const optionen = await listen.nth(i).locator("option").evaluateAll((os) => os.map((x) => ({ value: (x as HTMLOptionElement).value, text: (x.textContent ?? "").trim() })));
      const t = optionen.find((x) => VOLL.test(x.text));
      if (t) {
        await listen.nth(i).selectOption(t.value);
        gewaehlt = true;
      }
    }
    if (!gewaehlt) {
      const radio = page.getByLabel(VOLL).first();
      if (await radio.isVisible().catch(() => false)) {
        await radio.check({ timeout: 5000 }).catch(() => radio.click({ timeout: 5000 }));
        gewaehlt = true;
      }
    }
    let geklickt = false;
    if (!gewaehlt) {
      const punkt = await erstesSichtbares([page.getByRole("menuitem", { name: LISTE }), page.getByRole("button", { name: LISTE }), page.getByRole("link", { name: LISTE }), page.getByText(LISTE), page.getByRole("menuitem", { name: VOLL }), page.getByRole("button", { name: VOLL }), page.getByRole("link", { name: VOLL }), page.getByText(VOLL)]);
      if (punkt) {
        await punkt.click({ timeout: 10_000 });
        geklickt = true;
      }
    }
    if (!geklickt) {
      const dialog = page.locator('[role="dialog"]:visible, dialog[open], .modal.show, [aria-modal="true"]:visible').last();
      const ok = (await dialog.count()) ? dialog.locator("button, a[href], input[type=submit]").filter({ hasText: BESTAETIGEN }).last() : null;
      if (ok && (await ok.isVisible().catch(() => false))) await ok.click({ timeout: 10_000 });
    }
    d = await warten;
  }
  if (!d) throw new AutomatikAbbruch(`Export ${land}: keine Datei nach ${Math.round(SCHRITT_MS / 1000)} s`);
  const pfad = await d.path();
  if (!pfad) throw new AutomatikAbbruch(`Export ${land}: Download fehlgeschlagen (${(await d.failure()) ?? "unbekannt"})`);
  return { name: d.suggestedFilename() || `BQool_${land}.txt`, bytes: new Uint8Array(await readFile(pfad)) };
}

const BERICHT_LINK = /view processing report|processing report|verarbeitungsbericht/i;

/**
 * B33.6: Upload-Verlauf einer Upload-Seite lesen – Zeilen mit „View Processing Report“ (höchstens `max`, neueste zuerst),
 * Bericht öffnen (Link per Abruf mit den Browser-Cookies, sonst Klick und Dialog lesen) und Fehlerzeilen auslesen. Nur lesen.
 */
export async function verlaufLesen(page: Page, url: string, land: string, o: { versatz?: number; max?: number; skus?: string[]; nurSeite?: boolean } = {}): Promise<UploadFehler[]> {
  if (!o.nurSeite) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await cookiesWeg(page);
  }
  const links = page.getByRole("link", { name: BERICHT_LINK }).or(page.getByRole("button", { name: BERICHT_LINK }));
  const n = Math.min(await links.count(), o.max ?? 5);
  const out: UploadFehler[] = [];
  for (let i = 0; i < n; i++) {
    const l = links.nth(i);
    const zeile = l.locator("xpath=ancestor::tr[1]");
    const zt = ((await zeile.count()) ? await zeile.innerText().catch(() => "") : "").replace(/\s+/g, " ");
    const zeitRoh = /\d{1,2}\/\d{1,2}\/\d{4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?|\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}|\d{1,2}\.\d{1,2}\.\d{4}[ ,]+\d{1,2}:\d{2}/i.exec(zt)?.[0] ?? "";
    const datei = /[\w.\-]+\.(?:txt|csv|xlsx?)/i.exec(zt)?.[0] ?? null;
    const anzahl = /(\d+)\s*(?:errors?|fehler)/i.exec(zt);
    let inhalt = "";
    const href = await l.getAttribute("href").catch(() => null);
    if (href && !/^(#|javascript:)/i.test(href)) {
      const r = await page.request.get(new URL(href, page.url()).toString(), { timeout: 30_000 }).catch(() => null);
      inhalt = r && r.ok() ? await r.text() : "";
    } else {
      await l.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const dialog = page.locator('[role="dialog"]:visible, dialog[open], .modal.show').last();
      inhalt = (await dialog.count()) ? await dialog.innerText().catch(() => "") : await page.locator("body").innerText().catch(() => "");
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    const z = bqoolZeit(zeitRoh, o.versatz ?? 120);
    out.push({ land, zeitBqool: zeitRoh || "?", zeitDe: z?.berlin ?? null, iso: z?.iso ?? null, datei, fehlerAnzahl: anzahl ? Number(anzahl[1]) : null, zeilen: processingReportZeilen(inhalt, o.skus ?? []) });
  }
  return out.filter((f) => (f.fehlerAnzahl ?? f.zeilen.length) > 0);
}

/**
 * Je Land die Export-Datei holen. Ein Fehler in einem Land stoppt die anderen nicht; Anmeldung fehlgeschlagen bzw.
 * Zwei-Faktor stoppt alles (Aufgabe mit Bildschirmfoto). Verarbeitet wird erst nach dem Browser (Aufrufer).
 */
export async function bqoolIstHerunterladen(tenantId: string, laender: string[], cfg: Cfg, o: { titel: string; aufgabeKey: string; link: string; /** B31.5: auch „Listing Performance“ und „Daily Sales“ für diese Länder. */ berichte?: string[]; /** B33.6: Upload-Verlauf (Processing Reports) dieser Seiten lesen. */ verlauf?: { land: string; url: string }[] }): Promise<IstBrowserErgebnis> {
  const adressen = new Map(bqoolExportAdressen(cfg).map((a) => [a.land as string, a.url]));
  const dateien: IstDatei[] = [];
  const jeLand: IstBrowserErgebnis["jeLand"] = [];
  const berichte: BerichtDatei[] = [];
  const berichtFehler: string[] = [];
  const uploadFehler: UploadFehler[] = [];
  const verlaufFehler: string[] = [];
  const berichtSeiten = o.berichte?.length
    ? [
        ...bqoolBerichtAdressen(cfg, "leistungUrl", o.berichte).map((a) => ({ ...a, art: "listing_performance" as const, titel: "Listing Performance" })),
        ...bqoolBerichtAdressen(cfg, "tagesUrl", o.berichte).map((a) => ({ ...a, art: "daily_sales" as const, titel: "Daily Sales" })),
      ]
    : [];
  const r = await mitBrowser(tenantId, o, async (page, log) => {
    await anmelden(page, { loginUrl: cfg.loginUrl || "https://www.bqool.com/login", email: cfg.email!, password: cfg.password!, dienst: "BQool", selektoren: { email: cfg.feldEmail, passwort: cfg.feldPasswort, knopf: cfg.feldKnopf } }, log);
    for (const land of laender) {
      const url = adressen.get(land) ?? null;
      if (!url) {
        jeLand.push({ land, ok: false, text: "keine Export-Seite eingetragen" });
        continue;
      }
      try {
        const d = await herunterladen(page, url, land, cfg);
        dateien.push({ land, ...d });
        jeLand.push({ land, ok: true, text: d.name });
        await log(`${land}: ${d.name} heruntergeladen (${Math.max(1, Math.round(d.bytes.length / 1024))} KB)`);
      } catch (e) {
        const grund = (e instanceof Error ? e.message.split("\n")[0] : String(e)).slice(0, 200);
        const bild = await debugFesthalten(tenantId, page, `BQool – Ist ${land}`, grund).catch(() => null);
        jeLand.push({ land, ok: false, text: grund, ...(bild ? { bild: bild.pfad } : {}) });
        await log(`${land}: ${grund}`).catch(() => undefined);
      }
    }
    // B31.5: Berichte je Land – ein Fehler stoppt weder die anderen noch den Lauf.
    for (const b of berichtSeiten) {
      try {
        const d = await berichtHerunterladen(page, b.url, b.land, b.titel);
        berichte.push({ land: b.land, art: b.art, ...d });
        await log(`${b.titel} ${b.land}: ${d.name} heruntergeladen`);
      } catch (e) {
        const grund = (e instanceof Error ? e.message.split("\n")[0] : String(e)).slice(0, 200);
        await debugFesthalten(tenantId, page, `BQool – ${b.titel} ${b.land}`, grund).catch(() => null);
        berichtFehler.push(`${b.titel} ${b.land}: ${grund}`);
        await log(grund).catch(() => undefined);
      }
    }
    // B33.6: Processing Reports der letzten Uploads je Land (nur lesen)
    for (const v of o.verlauf ?? []) {
      try {
        const f = await verlaufLesen(page, v.url, v.land, { versatz: versatzMinuten(cfg.zeitzone) });
        uploadFehler.push(...f);
        await log(`Upload-Verlauf ${v.land}: ${f.length ? `${f.length} Upload${f.length === 1 ? "" : "s"} mit Fehlern` : "keine Fehler"}`);
      } catch (e) {
        const grund = (e instanceof Error ? e.message.split("\n")[0] : String(e)).slice(0, 200);
        verlaufFehler.push(`${v.land}: ${grund}`);
        await log(`Upload-Verlauf ${v.land}: ${grund}`).catch(() => undefined);
      }
    }
  });
  return { ok: r.ok, belegt: r.belegt, zweiFaktor: r.zweiFaktor, fehler: r.fehler, dateien, jeLand, berichte, berichtFehler, protokoll: r.protokoll, uploadFehler, verlaufFehler };
}
