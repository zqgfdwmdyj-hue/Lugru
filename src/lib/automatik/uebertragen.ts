import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { bqoolExportDateien } from "@/lib/bqool/export-service";
import { sellerboardImportDatei, sellerboardProtokoll } from "@/lib/ek-import/service";
import { getIntegration } from "@/lib/integrations/store";
import { anmelden, dateiHochladen, mitBrowser } from "./runner";

// Übertragungen per Browser-Automatik – nur auf Knopfdruck aus der Oberfläche.

const ERFOLG = /erfolgreich|successfully|success|importiert|imported|uploaded|hochgeladen|abgeschlossen|completed/i;
const FEHLER = /fehlgeschlagen|failed|ungültig|invalid format|error:/i;

export async function anSellerboardUebertragen(tenantId: string, ekImportId: string): Promise<{ ok: boolean; text: string }> {
  const z = await getIntegration(tenantId, "sellerboard_web");
  if (!z?.email || !z.password || !z.importUrl) return { ok: false, text: "sellerboard-Anmeldung für die Automatik fehlt (Anbindungen → sellerboard – Anmeldung). Bis dahin die Importdatei herunterladen." };
  const datei = await sellerboardImportDatei(tenantId, ekImportId);
  if (!datei) return { ok: false, text: "Import nicht gefunden." };
  const r = await mitBrowser(tenantId, { titel: "sellerboard-Kostenimport", aufgabeKey: `automatik-sellerboard-${ekImportId}`, link: `/einkauf/ek-import?id=${ekImportId}` }, async (page, log) => {
    await anmelden(page, { loginUrl: z.loginUrl || "https://app.sellerboard.com/de/auth/login", email: z.email!, password: z.password! }, log);
    await dateiHochladen(page, { url: z.importUrl!, datei: { name: datei.name, mimeType: "application/vnd.ms-excel", buffer: Buffer.from(datei.bytes) }, erfolg: ERFOLG, fehler: FEHLER }, log);
  });
  const text = r.ok ? `Automatisch zu sellerboard übertragen (${r.protokoll.length} Schritte mit Bildschirmfoto).` : `Automatische Übertragung abgebrochen: ${r.fehler}`;
  await sellerboardProtokoll(tenantId, ekImportId, r.ok ? "automatik_ok" : "automatik_fehler", text);
  return { ok: r.ok, text };
}

export async function anBqoolUebertragen(tenantId: string, exportId: string): Promise<{ ok: boolean; text: string }> {
  const z = await getIntegration(tenantId, "bqool_web");
  if (!z?.email || !z.password || !z.uploadUrl) return { ok: false, text: "BQool-Anmeldung für die Automatik fehlt (Anbindungen → BQool – Anmeldung). Bis dahin das ZIP herunterladen." };
  const dateien = await bqoolExportDateien(tenantId, exportId);
  if (!dateien) return { ok: false, text: "Export nicht gefunden." };
  const E = schema.bqoolExporte;
  await db.update(E).set({ uebertragung: "laeuft" }).where(and(eq(E.tenantId, tenantId), eq(E.id, exportId)));
  const r = await mitBrowser(tenantId, { titel: "BQool-Upload", aufgabeKey: `automatik-bqool-${exportId}`, link: `/repricer/bqool?export=${exportId}` }, async (page, log) => {
    await anmelden(page, { loginUrl: z.loginUrl || "https://www.bqool.com/login", email: z.email!, password: z.password! }, log);
    for (const d of dateien) await dateiHochladen(page, { url: z.uploadUrl!, datei: { name: d.name, mimeType: "text/plain", buffer: Buffer.from(d.text, "utf8") }, erfolg: ERFOLG, fehler: FEHLER }, log);
  });
  const [e] = await db.select({ protokoll: E.protokoll }).from(E).where(eq(E.id, exportId));
  await db
    .update(E)
    .set({ uebertragung: r.ok ? "fertig" : "fehler", protokoll: [...(e?.protokoll ?? []), ...r.protokoll.map((p) => ({ zeit: p.zeit, text: p.text })), { zeit: new Date().toISOString(), text: r.ok ? `${dateien.length} Dateien bei BQool hochgeladen` : `Abgebrochen: ${r.fehler}` }] })
    .where(and(eq(E.tenantId, tenantId), eq(E.id, exportId)));
  return { ok: r.ok, text: r.ok ? `${dateien.length} Dateien bei BQool hochgeladen.` : `Abgebrochen: ${r.fehler}` };
}
