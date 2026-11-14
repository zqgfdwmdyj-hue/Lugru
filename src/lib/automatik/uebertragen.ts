import "server-only";
import { sellerboardImportDatei, sellerboardProtokoll } from "@/lib/ek-import/service";
import { getIntegration } from "@/lib/integrations/store";
import { anmelden, AutomatikAbbruch, dateiHochladen, mitBrowser } from "./runner";
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
