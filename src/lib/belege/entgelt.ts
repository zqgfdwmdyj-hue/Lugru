import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { entgeltAusText, entgeltSeite } from "./ablage-logic";

// B34.2: Entgeltabschluss der Bank (eigene Seite im Kontoauszug, z. B. Seite 11) als eigener Beleg – die Seite
// wird herausgelöst und unter Rechnungen abgelegt; der Abgleich ordnet die Entgelt-Buchung diesem Beleg zu.

export async function entgeltBelegAusAuszug(tenantId: string, firma: string | null, datei: { name: string; bytes: Uint8Array }): Promise<{ id: string; betrag: number; datum: string | null; seite: number; neu: boolean } | null> {
  const b = datei.bytes;
  if (!(b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)) return null;
  const { extractText, getDocumentProxy } = await import("unpdf");
  const r = await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: false });
  const seiten = (Array.isArray(r.text) ? r.text : [r.text]).map(String);
  const i = entgeltSeite(seiten);
  if (i === null) return null;
  const e = entgeltAusText(seiten[i]);
  if (!e) return null;
  const I = schema.invoices;
  const externalId = `entgelt:${createHash("sha256").update(b).digest("hex")}:${i + 1}`;
  const [schon] = await db.select({ id: I.id }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.externalId, externalId)));
  if (schon) return { id: schon.id, betrag: e.betrag, datum: e.datum, seite: i + 1, neu: false };
  const { PDFDocument } = await import("pdf-lib");
  const quelle = await PDFDocument.load(b, { ignoreEncryption: true });
  const ziel = await PDFDocument.create();
  const [seite] = await ziel.copyPages(quelle, [i]);
  ziel.addPage(seite);
  const bytes = Buffer.from(await ziel.save());
  const name = `${e.datum ?? "ohne-Datum"}_${(e.bank ?? "Bank").replace(/\s+/g, "-")}_${e.betrag.toFixed(2).replace(".", ",")}_Entgeltabschluss.pdf`;
  const { storeFile } = await import("@/lib/orders/service");
  const fileId = await storeFile(tenantId, name, "application/pdf", bytes);
  const [row] = await db
    .insert(I)
    .values({
      tenantId,
      source: "upload",
      externalId,
      fileName: name,
      fileId,
      kind: "expense",
      status: "matched",
      docType: "rechnung",
      vendor: e.bank ?? "Bank",
      invoiceDate: e.datum,
      invoiceNumber: `Entgelt ${e.zeitraum ?? e.datum ?? ""}`.trim().slice(0, 60),
      totalGross: e.betrag,
      firma,
      textExcerpt: seiten[i].slice(0, 8000),
    })
    .returning({ id: I.id });
  return { id: row.id, betrag: e.betrag, datum: e.datum, seite: i + 1, neu: true };
}
