import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { B2B_EMAIL_SUBJECT, B2B_EMAIL_TEXT, buildB2bInvoiceData, checkB2bInput, type B2bInput } from "@/lib/ebay/invoices/b2b";
import { buildCiiXml } from "@/lib/ebay/invoices/einvoice";
import { renderInvoicePdf } from "@/lib/ebay/invoices/pdf";
import { cancelInvoice } from "@/lib/ebay/invoices/service";
import { getInvoice, getInvoiceSettings, insertInvoice, markEmailError, markEmailed } from "@/lib/ebay/invoices/store";
import type { InvoiceData, InvoiceRecord } from "@/lib/ebay/invoices/types";
import { sendMail } from "@/lib/mail/accounts";
import { invoiceFileName, sendToStotaxSoon } from "./stotax";

// Ausgangsrechnungen: eBay-Rechnungen (Automatik im eBay-Tool) und frei geschriebene
// B2B-Rechnungen – ein Nummernkreis, eine Tabelle, beides geht an Stotax Select.

const I = schema.ebayInvoices;

/** B2B-Rechnung erstellen: Nummer vergeben, Inhalt einfrieren, Kunde merken, an Stotax. */
export async function createB2bInvoice(tenantId: string, input: B2bInput, opts: { saveCustomer?: boolean; now?: Date } = {}): Promise<InvoiceRecord> {
  const edb = ebayDb(tenantId);
  const s = await getInvoiceSettings(edb);
  const problems = checkB2bInput(input, s);
  if (problems.length) throw new Error(problems.join(" "));
  const now = opts.now ?? new Date();
  const orderId = `B2B-${randomUUID().slice(0, 8)}`;
  const inv = await insertInvoice(edb, {
    env: "production",
    settings: s,
    date: now,
    orderId,
    build: (number) => buildB2bInvoiceData(input, s, { number, date: now.toISOString(), orderId }),
  });
  if (opts.saveCustomer !== false) await saveCustomer(tenantId, input.buyer);
  sendToStotaxSoon(tenantId, inv.id);
  return inv;
}

/** Storno (eBay oder B2B) – geht ebenfalls an Stotax. */
export async function cancelOutgoing(tenantId: string, id: number): Promise<InvoiceRecord> {
  const storno = await cancelInvoice(ebayDb(tenantId), id);
  sendToStotaxSoon(tenantId, storno.id);
  return storno;
}

export async function outgoingInvoice(tenantId: string, id: number): Promise<InvoiceRecord | null> {
  return getInvoice(ebayDb(tenantId), id);
}

export async function invoicePdf(tenantId: string, id: number) {
  const inv = await outgoingInvoice(tenantId, id);
  return inv ? { name: invoiceFileName(inv.data, "pdf"), bytes: await renderInvoicePdf(inv.data) } : null;
}

export async function invoiceXml(tenantId: string, id: number) {
  const inv = await outgoingInvoice(tenantId, id);
  return inv?.data.b2b ? { name: invoiceFileName(inv.data, "xml"), xml: buildCiiXml(inv.data) } : null;
}

const fill = (t: string, d: InvoiceData) => t.replaceAll("{nummer}", d.number).replaceAll("{firma}", d.seller.companyName).replaceAll("{name}", d.buyer.name);

/** B2B-Rechnung an den Kunden mailen: PDF + E-Rechnung (XML). */
export async function mailB2bInvoice(tenantId: string, id: number, to?: string): Promise<string> {
  const edb = ebayDb(tenantId);
  const inv = await getInvoice(edb, id);
  if (!inv?.data.b2b) throw new Error("Rechnung nicht gefunden.");
  const address = (to ?? inv.data.buyerEmail ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error("Keine gültige E-Mail-Adresse des Kunden.");
  const s = await getInvoiceSettings(edb);
  try {
    await sendMail(
      tenantId,
      {
        to: address,
        subject: fill(B2B_EMAIL_SUBJECT, inv.data),
        text: fill(B2B_EMAIL_TEXT, inv.data),
        replyTo: s.email || undefined,
        attachments: [
          { filename: invoiceFileName(inv.data, "pdf"), content: Buffer.from(await renderInvoicePdf(inv.data)), contentType: "application/pdf" },
          { filename: invoiceFileName(inv.data, "xml"), content: Buffer.from(buildCiiXml(inv.data)), contentType: "application/xml" },
        ],
      },
      { mailboxId: s.senderMailboxId, fromName: s.companyName || undefined },
    );
  } catch (e) {
    await markEmailError(edb, id, e instanceof Error ? e.message : String(e));
    throw e;
  }
  await markEmailed(edb, id, address);
  return address;
}

export type OutgoingRow = {
  id: number;
  number: string;
  kind: "invoice" | "storno";
  source: "ebay" | "b2b";
  date: string;
  buyer: string;
  totalGross: number;
  cancelledById: number | null;
  cancels?: string;
  emailedAt: string | null;
  stotaxSentAt: Date | null;
  stotaxError: string | null;
};

export async function listOutgoing(tenantId: string, opts: { q?: string; limit?: number } = {}): Promise<OutgoingRow[]> {
  const q = opts.q?.trim();
  const rows = await db
    .select()
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.env, "production"), q ? sql`(${I.number} ilike ${`%${q}%`} or ${I.data}->'buyer'->>'name' ilike ${`%${q}%`} or ${I.orderId} ilike ${`%${q}%`})` : undefined))
    .orderBy(desc(I.id))
    .limit(opts.limit ?? 200);
  return rows.map((r) => {
    const d = r.data as InvoiceData;
    return {
      id: r.id,
      number: r.number,
      kind: r.kind === "storno" ? "storno" : "invoice",
      source: d.b2b ? "b2b" : "ebay",
      date: d.date,
      buyer: d.buyer.name,
      totalGross: d.totalGross,
      cancelledById: r.cancelledById,
      cancels: d.cancels,
      emailedAt: r.emailedAt,
      stotaxSentAt: r.stotaxSentAt,
      stotaxError: r.stotaxError,
    };
  });
}

type CustomerInput = B2bInput["buyer"];

async function saveCustomer(tenantId: string, b: CustomerInput) {
  const C = schema.customers;
  const values = {
    tenantId,
    name: b.name.trim(),
    contact: b.contact?.trim() || null,
    street: b.street.trim(),
    zip: b.zip.trim(),
    city: b.city.trim(),
    country: b.country.trim().toUpperCase(),
    vatId: b.vatId?.replace(/\s+/g, "").toUpperCase() || null,
    email: b.email?.trim() || null,
    customerNumber: b.customerNumber?.trim() || null,
  };
  await db
    .insert(C)
    .values(values)
    .onConflictDoUpdate({ target: [C.tenantId, C.name], set: { ...values, updatedAt: new Date() } });
}

export async function listCustomers(tenantId: string) {
  return db.select().from(schema.customers).where(eq(schema.customers.tenantId, tenantId)).orderBy(schema.customers.name);
}
