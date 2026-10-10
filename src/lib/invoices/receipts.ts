import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getInvoiceSettings } from "@/lib/ebay/invoices/store";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getIntegration } from "@/lib/integrations/store";
import { sendMail } from "@/lib/mail/accounts";
import { storeFile } from "@/lib/orders/service";
import { buildReceiptPdf, parseReceiptAi, RECEIPT_PROMPT, receiptFileName, receiptMail, type ReceiptFacts, type ReceiptImage } from "./receipt-logic";
import { stotaxConfig } from "./stotax";

// Belege scannen: Fotos → PDF (gespeichert, verschlüsselt) → KI liest Händler/Datum/Betrag →
// per Mail2Select an Stotax. Auch andere Eingangsrechnungen lassen sich so an Stotax schicken.

const I = schema.invoices;
const RETRY_MS = 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

export class ReceiptError extends Error {}

/** Fotos (oder ein fertiges PDF) eines Belegs aufnehmen; KI und Stotax laufen danach im Hintergrund. */
export async function createReceipt(tenantId: string, input: { images: ReceiptImage[]; pdf?: Uint8Array | null; note?: string | null }): Promise<{ id: string; duplicate: boolean }> {
  const images = input.images.filter((i) => i.bytes.length > 0);
  if (!images.length && !input.pdf?.length) throw new ReceiptError("Bitte den Beleg fotografieren oder ein Foto/PDF wählen.");
  if (images.length > 10) throw new ReceiptError("Höchstens 10 Fotos je Beleg.");
  if (images.some((i) => !/^image\/(jpe?g|png)$/.test(i.type))) throw new ReceiptError("Fotos bitte als JPG oder PNG.");
  let pdf: Uint8Array;
  try {
    pdf = input.pdf?.length ? input.pdf : await buildReceiptPdf(images, { title: `Beleg ${today()}` });
  } catch {
    throw new ReceiptError("Das Foto ließ sich nicht lesen – bitte erneut aufnehmen.");
  }
  // Doppelt hochgeladen? Über die Fotos selbst (das PDF trägt einen Zeitstempel).
  const h = createHash("sha256");
  if (images.length) for (const i of images) h.update(i.bytes);
  else h.update(pdf);
  const hash = h.digest("hex");
  const [dup] = await db.select({ id: I.id }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.source, "scan"), eq(I.externalId, hash)));
  if (dup) return { id: dup.id, duplicate: true };
  const name = receiptFileName({ vendor: null, date: null, totalGross: null }, today());
  const fileId = await storeFile(tenantId, name, "application/pdf", Buffer.from(pdf));
  const note = input.note?.trim().slice(0, 300) || null;
  const [row] = await db
    .insert(I)
    .values({ tenantId, source: "scan", externalId: hash, fileName: name, fileId, kind: "expense", status: "matched", invoiceDate: today(), textExcerpt: note ? `Notiz: ${note}` : null })
    .returning({ id: I.id });
  processReceiptSoon(tenantId, row.id, images, note);
  return { id: row.id, duplicate: false };
}

/** KI liest den Beleg; danach (oder ohne KI gleich) an Stotax. Fehler stehen am Beleg. */
export function processReceiptSoon(tenantId: string, id: string, images: ReceiptImage[], note: string | null) {
  void (async () => {
    const facts = await readReceipt(tenantId, images).catch(() => null);
    if (facts) {
      await db
        .update(I)
        .set({
          vendor: facts.vendor,
          invoiceDate: facts.date ?? today(),
          totalGross: facts.totalGross,
          totalNet: facts.totalNet,
          fileName: receiptFileName(facts, today()),
          textExcerpt: [facts.category, facts.payment ? `bezahlt: ${facts.payment}` : null, note ? `Notiz: ${note}` : null].filter(Boolean).join(" · ") || null,
          updatedAt: new Date(),
        })
        .where(eq(I.id, id));
      const [row] = await db.select({ fileId: I.fileId }).from(I).where(eq(I.id, id));
      if (row?.fileId) await db.update(schema.files).set({ name: receiptFileName(facts, today()) }).where(eq(schema.files.id, row.fileId));
    }
    const cfg = await stotaxConfig(tenantId);
    if (cfg?.auto) await sendInvoiceToStotax(tenantId, id).catch(() => undefined);
  })().catch(() => undefined);
}

async function readReceipt(tenantId: string, images: ReceiptImage[]): Promise<ReceiptFacts | null> {
  if (!images.length) return null;
  const cfg = await getIntegration(tenantId, "anthropic");
  if (!cfg?.apiKey) return null;
  const blocks = images.slice(0, 4).map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.type.replace("jpg", "jpeg"), data: Buffer.from(i.bytes).toString("base64") } }));
  const r = await askClaude(cfg.apiKey, [...blocks, { type: "text", text: RECEIPT_PROMPT }], { model: modelFor(cfg, "simple"), task: "simple", maxTokens: 800, timeoutMs: 90_000 });
  return parseReceiptAi(r.text);
}

/** Beleg oder Eingangsrechnung (PDF) an Stotax senden und den Stand merken. */
export async function sendInvoiceToStotax(tenantId: string, id: string): Promise<void> {
  const cfg = await stotaxConfig(tenantId);
  if (!cfg) throw new ReceiptError("Stotax Select ist nicht eingerichtet (Anbindungen → Stotax Select).");
  const [row] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id)));
  if (!row) throw new ReceiptError("Beleg nicht gefunden.");
  try {
    if (!row.fileId) throw new ReceiptError("Zu diesem Beleg ist keine Datei gespeichert.");
    const [file] = await db.select({ data: schema.files.data, mimeType: schema.files.mimeType }).from(schema.files).where(and(eq(schema.files.tenantId, tenantId), eq(schema.files.id, row.fileId)));
    if (!file) throw new ReceiptError("Datei nicht gefunden.");
    const facts: ReceiptFacts = { vendor: row.vendor, date: row.invoiceDate, totalGross: row.totalGross, totalNet: row.totalNet, vat: [], payment: null, category: null };
    const mail = row.source === "scan" ? receiptMail(facts, today(), row.textExcerpt) : { subject: `Eingangsrechnung ${row.invoiceNumber ?? row.fileName}`, text: `Eingangsrechnung ${row.fileName}${row.invoiceDate ? ` vom ${row.invoiceDate.split("-").reverse().join(".")}` : ""}` };
    const s = await getInvoiceSettings(ebayDb(tenantId));
    await sendMail(
      tenantId,
      { to: cfg.address, ...mail, attachments: [{ filename: row.fileName.replace(/[^\wäöüÄÖÜß,.-]+/g, "_"), content: Buffer.from(file.data), contentType: file.mimeType || "application/pdf" }] },
      { mailboxId: s.senderMailboxId, fromName: s.companyName || undefined },
    );
    await db.update(I).set({ stotaxSentAt: new Date(), stotaxTriedAt: new Date(), stotaxError: null }).where(eq(I.id, id));
  } catch (e) {
    await db.update(I).set({ stotaxTriedAt: new Date(), stotaxError: e instanceof Error ? e.message : String(e) }).where(eq(I.id, id));
    throw e;
  }
}

/** Takt: Belege, die noch nicht bei Stotax sind (fehlgeschlagene frühestens nach einer Stunde erneut). */
export async function sendPendingReceipts(tenantId: string): Promise<{ sent: number; failed: number }> {
  const cfg = await stotaxConfig(tenantId);
  const out = { sent: 0, failed: 0 };
  if (!cfg?.auto) return out;
  const rows = await db
    .select({ id: I.id })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.source, "scan"), isNull(I.stotaxSentAt), isNotNull(I.fileId), gte(I.createdAt, cfg.since), or(isNull(I.stotaxTriedAt), lt(I.stotaxTriedAt, new Date(Date.now() - RETRY_MS)))))
    .limit(25);
  for (const r of rows) {
    try {
      await sendInvoiceToStotax(tenantId, r.id);
      out.sent++;
    } catch {
      out.failed++;
    }
  }
  return out;
}

export async function listReceipts(tenantId: string, limit = 100) {
  return db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.source, "scan"))).orderBy(desc(I.createdAt)).limit(limit);
}

export async function deleteReceipt(tenantId: string, id: string) {
  const [row] = await db.select({ fileId: I.fileId, sent: I.stotaxSentAt }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id), eq(I.source, "scan")));
  if (!row) return;
  if (row.sent) throw new ReceiptError("Schon an Stotax übertragen – dort löschen bzw. dem Steuerberater Bescheid geben.");
  await db.delete(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id)));
  if (row.fileId) await db.delete(schema.files).where(and(eq(schema.files.tenantId, tenantId), eq(schema.files.id, row.fileId)));
}
