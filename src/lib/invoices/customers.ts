import "server-only";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeCustomer, suggestCustomerNumber, type CustomerInput } from "./customer-logic";

// Kundenstamm für B2B-Rechnungen: anlegen, ändern, löschen; beim Rechnungschreiben auswählbar.

const C = schema.customers;
const I = schema.ebayInvoices;

export type CustomerRow = typeof C.$inferSelect & { invoices: number; total: number; lastInvoice: string | null };

/** Nicht stornierte B2B-Rechnungen; Käuferdaten sind verschlüsselt, daher wird nach dem Lesen gefiltert. */
async function b2bInvoices(tenantId: string) {
  return db
    .select({ id: I.id, number: I.number, kind: I.kind, cancelledById: I.cancelledById, data: I.data })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.env, "production"), sql`${I.data} ? 'b2b'`))
    .orderBy(desc(I.id));
}

const buyerName = (data: unknown) => (data as { buyer?: { name?: string } }).buyer?.name ?? "";

/** Kunden mit Anzahl und Summe ihrer (nicht stornierten) B2B-Rechnungen. */
export async function listCustomers(tenantId: string, q?: string): Promise<CustomerRow[]> {
  const term = q?.trim().toLowerCase();
  const [all, invoices] = await Promise.all([db.select().from(C).where(eq(C.tenantId, tenantId)).orderBy(asc(C.name)), b2bInvoices(tenantId)]);
  // E-Mail und Anschrift sind verschlüsselt gespeichert – Suche nach dem Entschlüsseln.
  const rows = term ? all.filter((c) => [c.name, c.city, c.customerNumber, c.email].some((v) => v?.toLowerCase().includes(term))) : all;
  const byName = new Map<string, { n: number; total: number; last: string | null }>();
  for (const inv of invoices) {
    if (inv.kind !== "invoice" || inv.cancelledById !== null) continue;
    const d = inv.data as { totalGross?: number; date?: string };
    const s = byName.get(buyerName(inv.data)) ?? { n: 0, total: 0, last: null };
    s.n++;
    s.total = Math.round((s.total + Number(d.totalGross ?? 0)) * 100) / 100;
    if (d.date && (!s.last || d.date > s.last)) s.last = d.date;
    byName.set(buyerName(inv.data), s);
  }
  return rows.map((r) => {
    const s = byName.get(r.name);
    return { ...r, invoices: s?.n ?? 0, total: s?.total ?? 0, lastInvoice: s?.last ?? null };
  });
}

export async function getCustomer(tenantId: string, id: string) {
  const [r] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, id)));
  return r ?? null;
}

/** Rechnungen eines Kunden (über den Namen auf der Rechnung). */
export async function customerInvoices(tenantId: string, name: string) {
  return (await b2bInvoices(tenantId)).filter((r) => buyerName(r.data) === name).slice(0, 100);
}

export class CustomerError extends Error {}

const toColumns = (v: CustomerInput) => ({
  name: v.name,
  contact: v.contact ?? null,
  street: v.street,
  zip: v.zip,
  city: v.city,
  country: v.country,
  vatId: v.vatId ?? null,
  email: v.email ?? null,
  customerNumber: v.customerNumber ?? null,
});

/** Neu anlegen (`id` = null) oder ändern. Namen sind je Mandant eindeutig. */
export async function saveCustomer(tenantId: string, id: string | null, input: CustomerInput): Promise<string> {
  const { value, problems } = normalizeCustomer(input);
  if (problems.length) throw new CustomerError(problems.join(" "));
  const [clash] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.name, value.name), id ? ne(C.id, id) : undefined));
  if (clash) throw new CustomerError(`Einen Kunden „${value.name}“ gibt es schon.`);
  if (id) {
    const [r] = await db.update(C).set({ ...toColumns(value), updatedAt: new Date() }).where(and(eq(C.tenantId, tenantId), eq(C.id, id))).returning({ id: C.id });
    if (!r) throw new CustomerError("Kunde nicht gefunden.");
    return r.id;
  }
  const [r] = await db.insert(C).values({ tenantId, ...toColumns(value) }).returning({ id: C.id });
  return r.id;
}

/** Beim Rechnungschreiben: gleicher Name → Angaben aktualisieren, sonst neu anlegen. */
export async function upsertCustomerByName(tenantId: string, input: CustomerInput) {
  const { value, problems } = normalizeCustomer(input);
  if (problems.length) return;
  await db
    .insert(C)
    .values({ tenantId, ...toColumns(value) })
    .onConflictDoUpdate({ target: [C.tenantId, C.name], set: { ...toColumns(value), updatedAt: new Date() } });
}

export async function deleteCustomer(tenantId: string, id: string) {
  // Rechnungen bleiben unverändert – sie enthalten die Anschrift selbst.
  await db.delete(C).where(and(eq(C.tenantId, tenantId), eq(C.id, id)));
}

/** Vorschlag für die nächste Kundennummer nach dem Muster der zuletzt angelegten. */
export async function nextCustomerNumber(tenantId: string): Promise<string | null> {
  const rows = await db
    .select({ n: C.customerNumber })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), sql`${C.customerNumber} is not null`))
    .orderBy(desc(C.createdAt))
    .limit(5);
  return suggestCustomerNumber(rows.map((r) => r.n!));
}
