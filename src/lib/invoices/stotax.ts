import "server-only";
import { and, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { getInvoiceSettings } from "@/lib/ebay/invoices/store";
import { renderInvoicePdf } from "@/lib/ebay/invoices/pdf";
import type { InvoiceData } from "@/lib/ebay/invoices/types";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getIntegration } from "@/lib/integrations/store";
import { sendMail } from "@/lib/mail/accounts";

// Stotax Select hat keine Schnittstelle zum Anlegen von Rechnungen – aber Mail2Select: Belege,
// die per E-Mail an die eigene Adresse …@mail2select.de gehen, landen in der Belegablage des
// Steuerberaters. Jede Rechnung (eBay und B2B, auch Stornos) geht dort als PDF hin.

const I = schema.ebayInvoices;
export const MAIL2SELECT = /^[^@\s]+@mail2select\.de$/i;
const RETRY_MS = 60 * 60 * 1000;

export type StotaxConfig = { address: string; auto: boolean; since: Date };

export async function stotaxConfig(tenantId: string): Promise<StotaxConfig | null> {
  const v = await getIntegration(tenantId, "stotax");
  const address = v?.address?.trim();
  if (!address) return null;
  const [row] = await db
    .select({ createdAt: schema.integrations.createdAt })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.provider, "stotax")));
  return { address, auto: v?.auto !== "nein", since: row?.createdAt ?? new Date() };
}

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const invoiceFileName = (d: Pick<InvoiceData, "kind" | "number">, ext: "pdf" | "xml") =>
  `${d.kind === "storno" ? "Stornorechnung" : "Rechnung"}_${d.number}.${ext}`.replace(/[^\w.-]+/g, "_");

/** Betreff und Text für Mail2Select – der Steuerberater sieht so schon in der Übersicht, worum es geht. */
export function stotaxMail(d: InvoiceData) {
  const kind = d.kind === "storno" ? "Stornorechnung" : "Rechnung";
  const source = d.b2b ? "B2B" : "eBay";
  return {
    subject: `${kind} ${d.number} – ${d.buyer.name} – ${euro(d.totalGross)}`,
    text: [
      `${kind} ${d.number} vom ${new Date(d.date).toLocaleDateString("de-DE")} (${source})`,
      d.cancels ? `Storno zu Rechnung ${d.cancels}` : "",
      `Kunde: ${d.buyer.name}`,
      `Netto: ${euro(d.totalNet)} · USt: ${euro(d.totalVat)} · Brutto: ${euro(d.totalGross)}`,
      d.b2b ? "" : `eBay-Bestellung: ${d.orderId}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Eine Rechnung an Stotax senden (PDF an Mail2Select) und den Stand an der Rechnung merken. */
export async function sendToStotax(tenantId: string, invoiceId: number): Promise<void> {
  const cfg = await stotaxConfig(tenantId);
  if (!cfg) throw new Error("Stotax Select ist nicht eingerichtet (Anbindungen → Stotax Select).");
  const [row] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, invoiceId)));
  if (!row) throw new Error("Rechnung nicht gefunden.");
  const data = row.data as InvoiceData;
  try {
    const s = await getInvoiceSettings(ebayDb(tenantId));
    const pdf = await renderInvoicePdf(data);
    await sendMail(
      tenantId,
      { to: cfg.address, ...stotaxMail(data), attachments: [{ filename: invoiceFileName(data, "pdf"), content: Buffer.from(pdf), contentType: "application/pdf" }] },
      { mailboxId: s.senderMailboxId, fromName: s.companyName || undefined },
    );
    await db.update(I).set({ stotaxSentAt: new Date(), stotaxTriedAt: new Date(), stotaxError: null }).where(eq(I.id, row.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(I).set({ stotaxTriedAt: new Date(), stotaxError: msg }).where(eq(I.id, row.id));
    throw e;
  }
}

/** Im Hintergrund nach dem Erstellen – Fehler stehen an der Rechnung, der Takt versucht es wieder. */
export function sendToStotaxSoon(tenantId: string, invoiceId: number) {
  void stotaxConfig(tenantId).then((cfg) => (cfg?.auto ? sendToStotax(tenantId, invoiceId) : undefined)).catch(() => undefined);
}

/**
 * Takt (alle 15 Minuten): neue Rechnungen seit dem Einrichten, die noch nicht bei Stotax sind.
 * Fehlgeschlagene frühestens nach einer Stunde erneut. `all`: auch ältere (Knopf „Nachsenden“).
 */
export async function sendPendingToStotax(tenantId: string, opts: { from?: Date; limit?: number; force?: boolean } = {}): Promise<{ sent: number; failed: number; error?: string }> {
  const cfg = await stotaxConfig(tenantId);
  const out: { sent: number; failed: number; error?: string } = { sent: 0, failed: 0 };
  if (!cfg || (!cfg.auto && !opts.force)) return out;
  const from = opts.from ?? cfg.since;
  const rows = await db
    .select({ id: I.id })
    .from(I)
    .where(
      and(
        eq(I.tenantId, tenantId),
        eq(I.env, "production"),
        isNull(I.stotaxSentAt),
        gte(I.createdAt, from.toISOString()),
        opts.force ? undefined : or(isNull(I.stotaxTriedAt), lt(I.stotaxTriedAt, new Date(Date.now() - RETRY_MS))),
      ),
    )
    .orderBy(I.id)
    .limit(opts.limit ?? 25);
  for (const r of rows) {
    try {
      await sendToStotax(tenantId, r.id);
      out.sent++;
    } catch (e) {
      out.failed++;
      out.error ??= e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}

/** Für die Übersicht: wie viele Rechnungen noch nicht bei Stotax sind. */
export async function stotaxBacklog(tenantId: string) {
  const rows = await db
    .select({ id: I.id, createdAt: I.createdAt, error: I.stotaxError })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.env, "production"), isNull(I.stotaxSentAt)))
    .orderBy(desc(I.id));
  return rows;
}
