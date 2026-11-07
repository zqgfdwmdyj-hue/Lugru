import "server-only";
import { readFile } from "node:fs/promises";
import { bqoolExportAdressen } from "./bqool-logic";
import { anmelden, AutomatikAbbruch, cookiesWeg, debugFesthalten, mitBrowser, type Schritt } from "./runner";

// B31.2: BQool-Ist holen – anmelden und je Land den Export „Repricing Central File – Full Template“ (bzw. „Manage
// Listings“) herunterladen. Nur lesen: in BQool wird nichts geändert. Gemeinsame Sperre der Browser-Automatik,
// Bildschirmfoto je Schritt, Zwei-Faktor → Abbruch mit Aufgabe.

type Page = import("playwright").Page;
type Locator = import("playwright").Locator;
type Cfg = Record<string, string | undefined>;

const SCHRITT_MS = Number(process.env.BQOOL_SCHRITT_MS) || 180_000;
const VOLL = /full template|vollständige vorlage/i;
const KNOPF = /download file|datei herunterladen|herunterladen|download|export/i;
const BESTAETIGEN = /download|herunterladen|export|bestätigen|confirm|\bok\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type IstDatei = { land: string; name: string; bytes: Uint8Array };
export type IstBrowserErgebnis = { ok: boolean; belegt?: boolean; zweiFaktor?: boolean; fehler: string | null; dateien: IstDatei[]; jeLand: { land: string; ok: boolean; text: string; bild?: string }[]; protokoll: Schritt[] };

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
    ...(eigen ? [] : [page.getByRole("button", { name: VOLL }), page.getByRole("link", { name: VOLL })]),
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
      const punkt = await erstesSichtbares([page.getByRole("menuitem", { name: VOLL }), page.getByRole("button", { name: VOLL }), page.getByRole("link", { name: VOLL }), page.getByText(VOLL)]);
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

/**
 * Je Land die Export-Datei holen. Ein Fehler in einem Land stoppt die anderen nicht; Anmeldung fehlgeschlagen bzw.
 * Zwei-Faktor stoppt alles (Aufgabe mit Bildschirmfoto). Verarbeitet wird erst nach dem Browser (Aufrufer).
 */
export async function bqoolIstHerunterladen(tenantId: string, laender: string[], cfg: Cfg, o: { titel: string; aufgabeKey: string; link: string }): Promise<IstBrowserErgebnis> {
  const adressen = new Map(bqoolExportAdressen(cfg).map((a) => [a.land as string, a.url]));
  const dateien: IstDatei[] = [];
  const jeLand: IstBrowserErgebnis["jeLand"] = [];
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
  });
  return { ok: r.ok, belegt: r.belegt, zweiFaktor: r.zweiFaktor, fehler: r.fehler, dateien, jeLand, protokoll: r.protokoll };
}
