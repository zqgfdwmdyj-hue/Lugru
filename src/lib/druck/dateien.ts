import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { zipErstellen } from "@/lib/zip";
import { mediumFuer, type Medium } from "./brother";
import { VORLAGEN } from "./logic";
import { bogenAlsEtiketten, pdfErkennen, seitenAlsEtiketten } from "./pdf";
import { auftragAnlegen, type Agent } from "./service";

// Dateien rund um den Druckagenten: Seller-Central-PDFs (Erkennen, Zuschneiden, FBA-Sendung zuordnen, drucken),
// überwachter Ordner (Upload → zentrale Erkennung), Programmdatei und Installationspaket.

const D = schema.druckDateien;
const ORDNER = path.join(process.cwd(), "druckagent");
const PAKET = ["lugru-druckagent.mjs", "config.beispiel.json", "windows/installieren.ps1", "windows/lugru-druckagent.xml", "linux/installieren.sh", "linux/lugru-druckagent.service", "linux/Dockerfile"];

export async function agentDatei(name: string): Promise<Buffer> {
  if (!PAKET.includes(name)) throw new Error("unbekannte Datei");
  return readFile(path.join(ORDNER, name));
}

export async function agentPaket(): Promise<Uint8Array> {
  const eintraege = await Promise.all(PAKET.map(async (n) => ({ name: `lugru-druckagent/${n}`, daten: new Uint8Array(await readFile(path.join(ORDNER, n))) })));
  return zipErstellen(eintraege);
}

/** PDF aus dem überwachten Ordner → zentrale Upload-Erkennung (Rechnungen, Belege …) im Namen der Person, die den Agenten angelegt hat. */
export async function ordnerUpload(a: Agent, name: string, bytes: Uint8Array): Promise<{ ok: boolean; text: string }> {
  if (!a.angelegtVon) return { ok: false, text: "Agent ohne zuständige Person – bitte neu anlegen." };
  const { sitzungFuer } = await import("@/lib/mobil/token");
  const s = await sitzungFuer(a.tenantId, a.angelegtVon, `druckagent:${a.id}`);
  if (!s) return { ok: false, text: "Zuständige Person deaktiviert." };
  const { dateiHochladen } = await import("@/lib/uploads/service");
  const r = await dateiHochladen(s, name, bytes, { firma: null, saldo: null });
  return { ok: r.some((x) => x.ok), text: r.map((x) => `${x.datei}: ${x.text}`).join(" · ").slice(0, 500) };
}

export type PdfErgebnis = { dateiId: string; art: string; seiten: number; etiketten: number; raster: string | null; sendungsnummer: string | null; sendung: { id: string; name: string } | null; auftragId: string | null; text: string };

/**
 * Seller-Central-PDF: Kartonlabels (102 × 152) → QL-1100, FNSKU-Bogen (A4, 27/40) → einzelne 62-mm-Etiketten → QL-800,
 * sonstige Label-PDFs (DHL/Internetmarke) → auf 102 mm eingepasst. Datei wird gespeichert und der FBA-Sendung zugeordnet.
 */
export async function pdfHochladen(session: Session, name: string, bytes: Uint8Array, o: { drucken: boolean; anzahl?: number; raster?: "27" | "40" | null; seite?: string }): Promise<PdfErgebnis> {
  const e = await pdfErkennen(bytes);
  if (!e.seiten) throw new Error("Die Datei enthält keine Seiten.");
  const raster = e.art === "fnsku_bogen" ? (o.raster ? (await import("./logic")).RASTER[o.raster] : e.raster) : null;
  // Sendung über die Sendungsnummer (FBA…) zuordnen
  let sendung: { id: string; name: string } | null = null;
  if (e.sendungsnummer) {
    const [s] = await db.select({ id: schema.inboundShipments.id, name: schema.inboundShipments.name }).from(schema.inboundShipments).where(and(eq(schema.inboundShipments.tenantId, session.tenantId), sql`upper(${schema.inboundShipments.amazonShipmentId}) = ${e.sendungsnummer}`)).limit(1);
    sendung = s ?? null;
  }
  const vorlage = e.art === "fnsku_bogen" ? VORLAGEN.fnsku_pdf : e.art === "kartonlabel" ? VORLAGEN.kartonlabel : VORLAGEN.dhl;
  const medium = mediumFuer(vorlage.medium) as Medium;
  const bilder = e.art === "fnsku_bogen" && raster ? await bogenAlsEtiketten(bytes, raster, medium) : await seitenAlsEtiketten(bytes, medium);
  const art = e.art === "unbekannt" ? "label_102" : e.art;
  const [d] = await db
    .insert(D)
    .values({ tenantId: session.tenantId, name: name.slice(0, 200), art, seiten: e.seiten, etiketten: bilder.length, raster: raster?.id ?? null, sendungsnummer: e.sendungsnummer, inboundShipmentId: sendung?.id ?? null, inhalt: Buffer.from(bytes), hochgeladenVon: session.userId })
    .returning({ id: D.id });
  let auftragId: string | null = null;
  if (o.drucken && bilder.length) {
    const j = await auftragAnlegen(session, { vorlage: vorlage.id, bilder, anzahl: o.anzahl ?? 1, seite: o.seite ?? "/drucken/datei", titel: `${vorlage.text}: ${name.slice(0, 80)}${e.sendungsnummer ? ` (${e.sendungsnummer})` : ""}`, dateiId: d.id });
    auftragId = j.id;
  }
  const artText = art === "kartonlabel" ? "FBA-Kartonlabels" : art === "fnsku_bogen" ? `FNSKU-Bogen (${raster?.id}er)` : "Label 102 mm";
  return { dateiId: d.id, art, seiten: e.seiten, etiketten: bilder.length, raster: raster?.id ?? null, sendungsnummer: e.sendungsnummer, sendung, auftragId, text: `${artText}: ${e.seiten} Seite${e.seiten === 1 ? "" : "n"}, ${bilder.length} Etikett${bilder.length === 1 ? "" : "en"}${e.sendungsnummer ? `, Sendung ${e.sendungsnummer}${sendung ? ` → ${sendung.name}` : " (nicht im System)"}` : ""}${auftragId ? ` – an ${vorlage.drucker} gesendet` : ""}` };
}

export async function druckDateien(tenantId: string, limit = 30) {
  return db.select({ id: D.id, name: D.name, art: D.art, seiten: D.seiten, etiketten: D.etiketten, raster: D.raster, sendungsnummer: D.sendungsnummer, inboundShipmentId: D.inboundShipmentId, createdAt: D.createdAt }).from(D).where(eq(D.tenantId, tenantId)).orderBy(desc(D.createdAt)).limit(limit);
}

export async function druckDatei(tenantId: string, id: string) {
  const [d] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return d ?? null;
}
