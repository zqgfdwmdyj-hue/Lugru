import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { bqoolExportDateien } from "@/lib/bqool/export-service";
import { sellerboardImportDatei, sellerboardProtokoll } from "@/lib/ek-import/service";
import { getIntegration } from "@/lib/integrations/store";
import { upsertSystemTask } from "@/lib/tasks/system";
import { bqoolErgebnisText, bqoolExportAdressen, bqoolSkus, bqoolUploadAdressen, bqoolZeilen, zeilenText, type BqoolLandErgebnis } from "./bqool-logic";
import { EXPORT_LAENDER } from "@/lib/bqool/export-logic";
import { rueckmeldungLesen } from "@/lib/bqool/kreislauf-logic";
import { anmelden, AutomatikAbbruch, cookiesWeg, dateiHochladen, mitBrowser } from "./runner";
import { UPLOAD_ERFOLG as ERFOLG, UPLOAD_FEHLER as FEHLER } from "./upload-logic";

// Übertragungen per Browser-Automatik – nur auf Knopfdruck aus der Oberfläche.

/** sellerboard: ohne erkannte Bestätigung lieber abbrechen (die Gegenprüfung am Folgetag findet den Rest). */
const sellerboardBestaetigt = (h: { wie: string; grund: string }, name: string) => {
  if (h.wie === "unklar") throw new AutomatikAbbruch(`Keine Bestätigung erkannt nach dem Hochladen von ${name} (${h.grund}) – bitte in sellerboard prüfen.`);
};

export async function anSellerboardUebertragen(tenantId: string, ekImportId: string): Promise<{ ok: boolean; text: string }> {
  const z = await getIntegration(tenantId, "sellerboard_web");
  if (!z?.email || !z.password || !z.importUrl) return { ok: false, text: "sellerboard-Anmeldung für die Automatik fehlt (Anbindungen → sellerboard – Anmeldung). Bis dahin die Importdatei herunterladen." };
  const datei = await sellerboardImportDatei(tenantId, ekImportId);
  if (!datei) return { ok: false, text: "Import nicht gefunden." };
  const r = await mitBrowser(tenantId, { titel: "sellerboard-Kostenimport", aufgabeKey: `automatik-sellerboard-${ekImportId}`, link: `/einkauf/ek-import?id=${ekImportId}` }, async (page, log) => {
    await anmelden(page, { loginUrl: z.loginUrl || "https://app.sellerboard.com/de/auth/login", email: z.email!, password: z.password!, dienst: "sellerboard", selektoren: { email: z.feldEmail, passwort: z.feldPasswort, knopf: z.feldKnopf } }, log);
    sellerboardBestaetigt(await dateiHochladen(page, { url: z.importUrl!, datei: { name: datei.name, mimeType: "application/vnd.ms-excel", buffer: Buffer.from(datei.bytes) }, erfolg: ERFOLG, fehler: FEHLER }, log), datei.name);
  });
  const text = r.ok ? `Automatisch zu sellerboard übertragen (${r.protokoll.length} Schritte mit Bildschirmfoto).` : `Automatische Übertragung abgebrochen: ${r.fehler}`;
  await sellerboardProtokoll(tenantId, ekImportId, r.ok ? "automatik_ok" : "automatik_fehler", text);
  return { ok: r.ok, text };
}

/**
 * ArbitrageOne-Nachtlauf: die sellerboard-Datei von ArbitrageOne unverändert an sellerboard weiterreichen (nicht neu
 * bauen). Nur wenn in der ArbitrageOne-Anbindung „an sellerboard weiterreichen: ja“ steht.
 */
export async function anSellerboardDateiUebertragen(tenantId: string, datei: { name: string; bytes: Uint8Array }): Promise<{ ok: boolean; text: string; uebersprungen?: boolean }> {
  const z = await getIntegration(tenantId, "sellerboard_web");
  // B27.3: nicht eingerichtet ist kein Fehler – „übersprungen“, die Datei liegt unter Einstellungen → Hintergrund & Importe.
  if (!z?.email || !z.password || !z.importUrl) return { ok: false, uebersprungen: true, text: "übersprungen (nicht eingerichtet) – Importdatei liegt unter Einstellungen → Hintergrund & Importe" };
  const typ = /\.xlsx$/i.test(datei.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.csv$/i.test(datei.name) ? "text/csv" : "application/vnd.ms-excel";
  const r = await mitBrowser(tenantId, { titel: "sellerboard-Kostenimport (ArbitrageOne-Datei)", aufgabeKey: "automatik-sellerboard-arbitrageone", link: "/anbindungen?p=arbitrageone_web#arbitrageone_web" }, async (page, log) => {
    await anmelden(page, { loginUrl: z.loginUrl || "https://app.sellerboard.com/de/auth/login", email: z.email!, password: z.password!, dienst: "sellerboard", selektoren: { email: z.feldEmail, passwort: z.feldPasswort, knopf: z.feldKnopf } }, log);
    sellerboardBestaetigt(await dateiHochladen(page, { url: z.importUrl!, datei: { name: datei.name, mimeType: typ, buffer: Buffer.from(datei.bytes) }, erfolg: ERFOLG, fehler: FEHLER }, log), datei.name);
  });
  return r.ok ? { ok: true, text: "unverändert an sellerboard weitergereicht" } : { ok: false, text: `Weitergabe an sellerboard abgebrochen: ${r.fehler}` };
}

/**
 * B23: je freigegebenem Land die passende Datei auf die passende BQool-Upload-Seite – nacheinander, mit Ergebnis je
 * Land. Ein Fehler in einem Land stoppt die anderen nicht (nur eine fehlgeschlagene Anmeldung bzw. Zwei-Faktor stoppt
 * alles). Protokoll je Upload (Land, Datei, Zeilen, Zeitpunkt, Ergebnis) am Export und unter Anbindungen.
 */
export async function anBqoolUebertragen(tenantId: string, exportId: string): Promise<{ ok: boolean; text: string; ergebnis?: BqoolLandErgebnis[]; belegt?: boolean; zweiFaktor?: boolean }> {
  const z = await getIntegration(tenantId, "bqool_web");
  if (!z?.email || !z.password || !z.uploadUrl) return { ok: false, text: "BQool-Anmeldung für die Automatik fehlt (Anbindungen → BQool – Anmeldung). Bis dahin das ZIP herunterladen." };
  const dateien = await bqoolExportDateien(tenantId, exportId);
  if (!dateien) return { ok: false, text: "Export nicht gefunden." };
  const adressen = new Map(bqoolUploadAdressen(z).map((a) => [a.land as string, a]));
  const E = schema.bqoolExporte;
  await db.update(E).set({ uebertragung: "laeuft" }).where(and(eq(E.tenantId, tenantId), eq(E.id, exportId)));
  const ergebnis: BqoolLandErgebnis[] = [];
  const zeiten = new Map<string, string>();
  // B31.2: Dateityp auf der Upload-Seite (BQool „Upload File“ → „Repricing Central File“), in der Anbindung änderbar.
  const typ = new RegExp(((z.uploadTyp ?? "").trim() || "Repricing Central").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const r = await mitBrowser(tenantId, { titel: "BQool-Upload", aufgabeKey: `automatik-bqool-${exportId}`, link: `/repricer/bqool?export=${exportId}` }, async (page, log) => {
    await anmelden(page, { loginUrl: z.loginUrl || "https://www.bqool.com/login", email: z.email!, password: z.password!, dienst: "BQool", selektoren: { email: z.feldEmail, passwort: z.feldPasswort, knopf: z.feldKnopf } }, log);
    for (const d of dateien) {
      const zeilen = bqoolZeilen(d.text);
      const url = adressen.get(d.land)?.url ?? null;
      zeiten.set(d.land, new Date().toISOString());
      if (!url) {
        ergebnis.push({ land: d.land, datei: d.name, zeilen, ok: false, fehler: "keine Upload-Seite eingetragen" });
        await log(`${d.land}: keine Upload-Seite eingetragen – übersprungen`);
        continue;
      }
      try {
        const h = await dateiHochladen(page, { url, datei: { name: d.name, mimeType: "text/plain", buffer: Buffer.from(d.text, "utf8") }, erfolg: ERFOLG, fehler: FEHLER, typ }, log);
        // B31.2: Rückmeldung von BQool lesen – Anzahl übernommen/Fehler und Fehlerzeilen mit SKU.
        const rm = rueckmeldungLesen(h.text, bqoolSkus(d.text));
        const rueck = { uebernommen: rm.uebernommen, fehlerAnzahl: rm.fehler, fehlerZeilen: rm.fehlerZeilen };
        // Nichts erkannt, aber auch kein Fehler → „bitte in BQool prüfen“ (gelb), nicht „Fehler“.
        ergebnis.push(h.wie === "unklar" ? { land: d.land, datei: d.name, zeilen, ok: false, unklar: true, fehler: h.grund, ...rueck } : { land: d.land, datei: d.name, zeilen, ok: true, wie: h.wie, ...rueck });
      } catch (e) {
        const grund = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        ergebnis.push({ land: d.land, datei: d.name, zeilen, ok: false, fehler: grund });
        await log(`${d.land}: ${grund}`).catch(() => undefined);
      }
    }
  });
  const okLaender = ergebnis.filter((x) => x.ok);
  const fehlerLaender = ergebnis.filter((x) => !x.ok && !x.unklar);
  const unklarLaender = ergebnis.filter((x) => x.unklar);
  const [e] = await db.select({ protokoll: E.protokoll }).from(E).where(eq(E.id, exportId));
  const jeLand = ergebnis.map((x) => ({ zeit: zeiten.get(x.land) ?? new Date().toISOString(), text: bqoolErgebnisText([x]).replace(/^([A-Z]{2}): /, `$1: ${x.datei} – `), land: x.land, datei: x.datei, zeilen: x.zeilen, ok: x.ok, ...(x.unklar ? { unklar: true } : {}) }));
  const status = !r.ok ? "fehler" : fehlerLaender.length ? (okLaender.length || unklarLaender.length ? "teilweise" : "fehler") : unklarLaender.length ? "pruefen" : "fertig";
  await db
    .update(E)
    .set({ uebertragung: status, protokoll: [...(e?.protokoll ?? []), ...r.protokoll.map((p) => ({ zeit: p.zeit, text: p.text })), ...jeLand, { zeit: new Date().toISOString(), text: r.ok ? `Ergebnis: ${bqoolErgebnisText(ergebnis)}` : `Abgebrochen: ${r.fehler}` }] })
    .where(and(eq(E.tenantId, tenantId), eq(E.id, exportId)));
  // B31.2: Fehlerzeilen von BQool als Aufgabe mit SKU und Fehlertext (die übrigen Zeilen sind übernommen).
  const fz = ergebnis.flatMap((x) => (x.fehlerZeilen ?? []).map((f) => `${x.land} ${f.sku}: ${f.text}`));
  if (fz.length) await upsertSystemTask(db, tenantId, `bqool-fehlerzeilen-${exportId}`, { title: `BQool-Upload: ${fz.length} Fehlerzeile${fz.length === 1 ? "" : "n"}`, notes: `${fz.slice(0, 40).join("\n")}${fz.length > 40 ? `\n… und ${fz.length - 40} weitere` : ""}\nDiese SKUs hat BQool nicht übernommen – Wert prüfen (Min/Max/Regel) und mit dem nächsten Upload erneut senden.`, priority: "normal", category: "amazon", link: `/repricer/bqool?export=${exportId}` });
  if (r.ok && fehlerLaender.length) {
    await upsertSystemTask(db, tenantId, `automatik-bqool-${exportId}`, { title: `BQool-Upload: ${fehlerLaender.map((x) => x.land).join(", ")} nicht hochgeladen`, notes: `${bqoolErgebnisText(ergebnis)}\nDie übrigen Länder sind hochgeladen. Für die fehlenden Länder die Upload-Seite unter Anbindungen → BQool prüfen und erneut übertragen oder die Datei selbst hochladen. Hat es doch geklappt: unter Einstellungen → Hintergrund & Importe → BQool-Uploads „hat geklappt“ drücken.`, priority: "critical", category: "system", link: `/repricer/bqool?export=${exportId}` });
  } else if (r.ok && unklarLaender.length) {
    // Kein Fehler, nur keine Bestätigung erkannt → normale Aufgabe zum kurzen Nachsehen.
    await upsertSystemTask(db, tenantId, `automatik-bqool-${exportId}`, { title: `BQool-Upload: ${unklarLaender.map((x) => x.land).join(", ")} bitte kurz in BQool prüfen`, notes: `${bqoolErgebnisText(ergebnis)}\nDie Dateien wurden hochgeladen, eine Bestätigung von BQool war aber nicht zu erkennen. In BQool nachsehen; hat es geklappt, unter Einstellungen → Hintergrund & Importe → BQool-Uploads „hat geklappt“ drücken.`, priority: "normal", category: "system", link: "/einstellungen/hintergrund#importe-exporte" });
  }
  if (!r.ok) return { ok: false, text: `Abgebrochen: ${r.fehler}`, ergebnis, belegt: r.belegt, zweiFaktor: r.zweiFaktor };
  const text = fehlerLaender.length
    ? `${okLaender.length} von ${ergebnis.length} Ländern bei BQool hochgeladen – ${bqoolErgebnisText(ergebnis)}.`
    : unklarLaender.length
      ? `${okLaender.length + unklarLaender.length} Dateien bei BQool hochgeladen, ${unklarLaender.length} ohne erkannte Bestätigung – bitte in BQool prüfen: ${bqoolErgebnisText(ergebnis)}.`
      : `${okLaender.length} Dateien bei BQool hochgeladen – ${bqoolErgebnisText(ergebnis)}.`;
  return { ok: fehlerLaender.length === 0, text, ergebnis };
}

/** B23: Verbindung testen – anmelden und je Land die Upload-Seite aufrufen (nichts hochladen). Wirft bei Fehlern. */
export async function bqoolVerbindungTesten(tenantId: string, z: Record<string, string | undefined>): Promise<string> {
  if (!z.email || !z.password) throw new Error("Anmelde-E-Mail und Passwort fehlen.");
  if (!z.uploadUrl) throw new Error("Upload-Seite DE fehlt.");
  const adressen = bqoolUploadAdressen(z).filter((a) => a.url);
  const teile: string[] = [];
  let fehler = 0;
  const r = await mitBrowser(tenantId, { titel: "BQool – Verbindung testen", aufgabeKey: "automatik-bqool-test", link: "/anbindungen?p=bqool_web#bqool_web", ohneAufgabe: true }, async (page, log) => {
    await anmelden(page, { loginUrl: z.loginUrl || "https://www.bqool.com/login", email: z.email!, password: z.password!, dienst: "BQool", selektoren: { email: z.feldEmail, passwort: z.feldPasswort, knopf: z.feldKnopf } }, log);
    teile.push("Anmeldung ok");
    for (const a of adressen) {
      try {
        await page.goto(a.url!, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await cookiesWeg(page);
        const hatUpload = (await page.locator('input[type="file"]').count()) > 0 || (await page.getByRole("button", { name: /upload file|datei hochladen/i }).count()) > 0;
        if (!hatUpload) throw new Error("kein Datei-Feld auf der Seite (Adresse prüfen)");
        teile.push(`${a.land}: Upload-Seite erreichbar${a.abgeleitet ? " (aus DE abgeleitet)" : ""}`);
      } catch (e) {
        fehler++;
        teile.push(`${a.land}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      }
    }
    // B31.2: Export-Seiten (Ist holen) – Download-Knopf vorhanden? Ohne Export-Seite nur Hinweis, kein Fehler.
    const exporte = bqoolExportAdressen(z).filter((a) => a.url && (EXPORT_LAENDER as readonly string[]).includes(a.land));
    if (!exporte.length) teile.push("Export-Seite nicht eingetragen – Ist bleibt vom letzten Datei-Upload");
    for (const a of exporte) {
      try {
        await page.goto(a.url!, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await cookiesWeg(page);
        const knopf = page.getByRole("button", { name: /full template|download|herunterladen|export/i }).or(page.getByRole("link", { name: /full template|download|herunterladen|export/i }));
        if (!(await knopf.count())) throw new Error("kein Download-Knopf auf der Export-Seite (Adresse prüfen)");
        teile.push(`${a.land}: Export-Seite erreichbar${a.abgeleitet ? " (aus DE abgeleitet)" : ""}`);
      } catch (e) {
        fehler++;
        teile.push(`${a.land} Export: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      }
    }
    await log(teile.join(" · "));
  });
  if (!r.ok) throw new Error(/zwei-faktor/i.test(r.fehler ?? "") ? "Zwei-Faktor-Anmeldung verlangt – die Automatik kann sich so nicht anmelden. Einen BQool-Benutzer ohne Zwei-Faktor anlegen oder die Dateien selbst hochladen." : (r.fehler ?? "Test fehlgeschlagen"));
  if (fehler) throw new Error(teile.join(" · "));
  return teile.join(" · ");
}
