import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db, schema } from "@/db";

// Alle fertigen Labels (Status „Label erstellt“) als ein PDF – zum Drucken in einem Rutsch.

/** PDFs zu einem zusammenfügen (Reihenfolge wie übergeben). */
export async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const src = await PDFDocument.load(p);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

export type OpenLabels = { fileIds: string[]; orders: number; withoutPdf: number };

/**
 * Label-Dateien der Aufträge mit Status „Label erstellt“ (optional nur bestimmte Aufträge), in der Reihenfolge
 * der Versandfrist. Eine Datei für mehrere Aufträge (Warensendungen aus einem Kauf) nur einmal. Aufträge ohne
 * PDF (Warensendung per CSV im Internetmarke-Shop) werden gezählt.
 */
export async function openLabels(tenantId: string, ids?: string[], shipper?: "self" | "prep"): Promise<OpenLabels> {
  const O = schema.orders;
  const P = schema.parcels;
  const where: SQL[] = [eq(O.tenantId, tenantId), eq(O.status, "label_created")];
  if (ids?.length) where.push(inArray(O.id, ids));
  // „meine“ = alles, was nicht ausdrücklich das Prep Center verschickt.
  if (shipper === "prep") where.push(eq(O.shippedBy, "prep"));
  if (shipper === "self") where.push(or(isNull(O.shippedBy), eq(O.shippedBy, "self"))!);
  const orders = await db.select({ id: O.id }).from(O).where(and(...where)).orderBy(asc(O.shipBy), asc(O.orderDate));
  if (!orders.length) return { fileIds: [], orders: 0, withoutPdf: 0 };
  const parcels = await db
    .select({ orderId: P.orderId, fileId: P.labelFileId })
    .from(P)
    .where(and(eq(P.tenantId, tenantId), eq(P.status, "created"), isNotNull(P.labelFileId), inArray(P.orderId, orders.map((o) => o.id))))
    .orderBy(asc(P.createdAt));
  const byOrder = new Map<string, string[]>();
  for (const p of parcels) if (p.orderId && p.fileId) byOrder.set(p.orderId, [...(byOrder.get(p.orderId) ?? []), p.fileId]);
  const seen = new Set<string>();
  const fileIds: string[] = [];
  let withoutPdf = 0;
  for (const o of orders) {
    const files = byOrder.get(o.id) ?? [];
    if (!files.length) withoutPdf++;
    for (const f of files) if (!seen.has(f)) (seen.add(f), fileIds.push(f));
  }
  return { fileIds, orders: orders.length, withoutPdf };
}

/** Die Dateien laden und zu einem PDF zusammenfügen. */
export async function openLabelsPdf(tenantId: string, fileIds: string[]): Promise<Buffer | null> {
  if (!fileIds.length) return null;
  const F = schema.files;
  const rows = await db.select({ id: F.id, data: F.data, mime: F.mimeType }).from(F).where(and(eq(F.tenantId, tenantId), inArray(F.id, fileIds)));
  const byId = new Map<string, Buffer>(rows.filter((r) => r.mime === "application/pdf").map((r) => [r.id, Buffer.from(r.data)]));
  const parts: Buffer[] = [];
  for (const id of fileIds) {
    const b = byId.get(id);
    if (b) parts.push(b);
  }
  return parts.length ? mergePdfs(parts) : null;
}
