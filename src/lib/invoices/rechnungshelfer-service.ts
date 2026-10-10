import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { TenantSettings } from "@/db/schema";
import { ebayDb } from "@/lib/ebay/db/pg";
import { checkB2bInput } from "@/lib/ebay/invoices/b2b";
import { getInvoiceSettings } from "@/lib/ebay/invoices/store";
import type { InvoiceRecord } from "@/lib/ebay/invoices/types";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { createB2bInvoice, mailB2bInvoice } from "./outgoing";
import { convertDraft, RechnungshelferDraft, ticketPrefix, type BuyerForDraft, type DraftConversion } from "./rechnungshelfer";

// Rechnungshelfer-Webhook: Entwürfe annehmen, Kunden zuordnen, Rechnung erstellen (von Hand
// nach Prüfung oder automatisch, wenn nichts zu prüfen ist).

const D = schema.invoiceDrafts;
const C = schema.customers;
const TASK_KEY = "rechnungshelfer-entwuerfe";
export type RhConfig = NonNullable<TenantSettings["rechnungshelfer"]>;
export type DraftRow = typeof D.$inferSelect;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
/** „Bearer rh_…“ oder nur der Schlüssel. */
export const tokenFromHeader = (h: string | null) => (h ?? "").trim().replace(/^bearer\s+/i, "").trim();

export async function rhConfig(tenantId: string): Promise<RhConfig> {
  const [t] = await db.select({ s: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return t?.s.rechnungshelfer ?? {};
}

export async function saveRhConfig(tenantId: string, patch: Partial<RhConfig>) {
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('rechnungshelfer', coalesce(${schema.tenants.settings}->'rechnungshelfer', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(schema.tenants.id, tenantId));
}

/** Neuen Schlüssel erzeugen – wird nur einmal angezeigt, gespeichert ist nur der Hash. */
export async function newRhToken(tenantId: string): Promise<string> {
  const token = `rh_${randomBytes(24).toString("base64url")}`;
  await saveRhConfig(tenantId, { tokenHash: hash(token), tokenHint: token.slice(-4), tokenCreatedAt: new Date().toISOString() });
  return token;
}

export async function tenantForRhToken(token: string): Promise<string | null> {
  if (!/^rh_[\w-]{20,}$/.test(token)) return null;
  const [t] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(sql`${schema.tenants.settings}->'rechnungshelfer'->>'tokenHash' = ${hash(token)}`);
  return t?.id ?? null;
}

async function customerFor(tenantId: string, cfg: RhConfig, ticket: string) {
  const id = cfg.prefixes?.[ticketPrefix(ticket)] ?? cfg.defaultCustomerId ?? null;
  if (!id) return null;
  const [c] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, id)));
  return c ?? null;
}

const asBuyer = (c: typeof C.$inferSelect): BuyerForDraft => ({
  name: c.name,
  contact: c.contact ?? undefined,
  street: c.street,
  zip: c.zip,
  city: c.city,
  country: c.country,
  vatId: c.vatId ?? undefined,
  email: c.email ?? undefined,
  customerNumber: c.customerNumber ?? undefined,
});

/** Entwurf → Rechnungseingabe mit dem zugeordneten (oder gewählten) Kunden. */
export async function draftConversion(tenantId: string, row: DraftRow, customerId?: string | null): Promise<DraftConversion & { customerId: string | null }> {
  const s = await getInvoiceSettings(ebayDb(tenantId));
  const cfg = await rhConfig(tenantId);
  const d = RechnungshelferDraft.parse(row.payload);
  const c = customerId
    ? ((await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, customerId))))[0] ?? null)
    : row.customerId
      ? ((await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, row.customerId))))[0] ?? null)
      : await customerFor(tenantId, cfg, row.ticket);
  const conv = convertDraft(d, c ? asBuyer(c) : null, { defaultPaymentDays: s.paymentDays ?? 14, kleinunternehmer: Boolean(s.kleinunternehmer), today: new Date().toISOString().slice(0, 10) });
  return { ...conv, customerId: c?.id ?? null };
}

async function refreshTask(tenantId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(D).where(and(eq(D.tenantId, tenantId), eq(D.status, "offen")));
  if (n > 0) await upsertSystemTask(db, tenantId, TASK_KEY, { title: `Rechnungshelfer: ${n} ${n === 1 ? "Rechnung" : "Rechnungen"} prüfen und erstellen`, category: "system", link: "/rechnungen/ausgang/rechnungshelfer" });
  else await resolveSystemTask(db, tenantId, TASK_KEY);
}

export type ReceiveResult = { status: "entwurf" | "erstellt" | "ignoriert"; draftId: string | null; number?: string; message: string };

/**
 * Webhook-Eingang. Gleiches Ticket nochmal (z. B. Knopf zweimal gedrückt): offener Entwurf wird
 * ersetzt; gibt es schon eine Rechnung, wird nichts doppelt erstellt.
 */
export async function receiveRechnungshelfer(tenantId: string, body: unknown): Promise<ReceiveResult> {
  const type = typeof (body as { type?: unknown })?.type === "string" ? String((body as { type: string }).type) : "";
  if (type !== "invoice_draft") {
    return { status: "ignoriert", draftId: null, message: type ? `Typ „${type}“ wird nicht verarbeitet (nur invoice_draft).` : "Kein Rechnungsentwurf (Feld „type“ fehlt)." };
  }
  const parsed = RechnungshelferDraft.safeParse(body);
  if (!parsed.success) throw new RhInputError(`Rechnungsentwurf unvollständig: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "JSON"} – ${i.message}`).join("; ")}`);
  const d = parsed.data;
  const ticket = d.ticket.trim();
  await saveRhConfig(tenantId, { lastReceivedAt: new Date().toISOString() });

  // Je Ticket nacheinander, damit zwei schnelle Klicks keine zwei Rechnungen erzeugen.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:rechnungshelfer:${ticket}`}))`);
    const earlier = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.ticket, ticket), inArray(D.status, ["offen", "erstellt"]))).orderBy(desc(D.receivedAt));
    const created = earlier.find((r) => r.status === "erstellt");
    const open = earlier.find((r) => r.status === "offen");
    // Gleicher Inhalt wie die schon erstellte Rechnung (Knopf nochmal gedrückt) → nichts Neues.
    if (created && !open && sameContent(created.payload, body)) {
      return { status: "erstellt", draftId: created.id, number: created.invoiceNumber ?? undefined, message: `Rechnung ${created.invoiceNumber} wurde für dieses Ticket schon erstellt.` };
    }
    const cfg = await rhConfig(tenantId);
    const customer = await customerFor(tenantId, cfg, ticket);
    const values = { payload: body as Record<string, unknown>, customerId: customer?.id ?? null, error: null, updatedAt: new Date() };
    let row: DraftRow;
    if (open) [row] = await db.update(D).set(values).where(eq(D.id, open.id)).returning();
    else [row] = await db.insert(D).values({ tenantId, ticket, ...values }).returning();

    const conv = await draftConversion(tenantId, row);
    const warnings = [...(created ? [`Für Ticket ${ticket} gibt es schon die Rechnung ${created.invoiceNumber} – nicht doppelt erstellen.`] : []), ...conv.warnings];
    await db.update(D).set({ warnings }).where(eq(D.id, row.id));

    if (cfg.auto && !warnings.length && conv.customerId) {
      const problems = checkB2bInput(conv.input, await getInvoiceSettings(ebayDb(tenantId)));
      if (!problems.length) {
        const inv = await createFromDraft(tenantId, row.id, conv.input, { mail: cfg.mailCustomer });
        return { status: "erstellt", draftId: row.id, number: inv.number, message: `Rechnung ${inv.number} erstellt.` };
      }
      await db.update(D).set({ error: problems.join(" ") }).where(eq(D.id, row.id));
    }
    await refreshTask(tenantId);
    return { status: "entwurf", draftId: row.id, message: warnings.length ? `Entwurf gespeichert – bitte prüfen: ${warnings[0]}` : "Entwurf gespeichert – im Seller-System prüfen und erstellen." };
  });
}

export class RhInputError extends Error {}

/** JSON mit sortierten Schlüsseln (jsonb in Postgres speichert die Schlüssel in eigener Reihenfolge). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Inhaltlich gleich (Positionen, Summen, Lieferung, RC, Zahlungsziel) – Zeitstempel zählen nicht. */
function sameContent(a: unknown, b: unknown): boolean {
  const pick = (x: unknown) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return canonical([o.positions, o.totals, o.delivery, o.is_reverse_charge, o.payment_term_days, o.payment_term]);
  };
  return pick(a) === pick(b);
}

/** Rechnung aus dem Entwurf (Eingabe ggf. im Formular geändert) und Entwurf abhaken. */
export async function createFromDraft(tenantId: string, draftId: string, input: Parameters<typeof createB2bInvoice>[1], opts: { mail?: boolean; saveCustomer?: boolean } = {}): Promise<InvoiceRecord> {
  const [row] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, draftId)));
  if (!row) throw new Error("Entwurf nicht gefunden.");
  if (row.status === "erstellt") throw new Error(`Aus diesem Entwurf wurde schon die Rechnung ${row.invoiceNumber} erstellt.`);
  const inv = await createB2bInvoice(tenantId, input, { saveCustomer: opts.saveCustomer ?? false });
  let error: string | null = null;
  if (opts.mail && input.buyer.email) {
    try {
      await mailB2bInvoice(tenantId, inv.id);
    } catch (e) {
      error = `Mail an den Kunden ging nicht: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  // Kunde für diesen Server merken, damit die nächsten Tickets ihn gleich haben.
  const [c] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.name, input.buyer.name.trim())));
  const cfg = await rhConfig(tenantId);
  const prefix = ticketPrefix(row.ticket);
  if (c && !cfg.prefixes?.[prefix]) await saveRhConfig(tenantId, { prefixes: { ...(cfg.prefixes ?? {}), [prefix]: c.id } });
  await db.update(D).set({ status: "erstellt", invoiceId: inv.id, invoiceNumber: inv.number, customerId: c?.id ?? row.customerId, error, updatedAt: new Date() }).where(eq(D.id, draftId));
  await refreshTask(tenantId);
  return inv;
}

export async function discardDraft(tenantId: string, id: string) {
  await db.update(D).set({ status: "verworfen", updatedAt: new Date() }).where(and(eq(D.tenantId, tenantId), eq(D.id, id), eq(D.status, "offen")));
  await refreshTask(tenantId);
}

export async function getDraft(tenantId: string, id: string): Promise<DraftRow | null> {
  const [r] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return r ?? null;
}

export async function listDrafts(tenantId: string, limit = 100) {
  return db.select().from(D).where(eq(D.tenantId, tenantId)).orderBy(desc(D.receivedAt)).limit(limit);
}

export async function openDraftCount(tenantId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(D).where(and(eq(D.tenantId, tenantId), eq(D.status, "offen")));
  return n;
}
