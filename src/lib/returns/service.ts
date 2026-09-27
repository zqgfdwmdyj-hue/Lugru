import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { reconcileFba, reconcileFbm, returnClaims, type Mode, type PaymentRow, type ReturnRow, type TxRow } from "./reconcile";

const REVERSAL = /reversal|rückbuch|ruckbuch|storn/i;

/**
 * Verkäufe und Erstattungen: aus dem Transaktionsbericht, ergänzt um Abrechnungen (Settlement)
 * für Bestellungen, die im Transaktionsbericht fehlen.
 */
async function loadTx(tenantId: string): Promise<TxRow[]> {
  const T = schema.amazonTransactions;
  const [tx, settle] = await Promise.all([
    db
      .select({ orderId: T.orderId, sku: T.sku, date: T.date, kind: T.kind, quantity: T.quantity, productSales: T.productSales, shippingCredits: T.shippingCredits, total: T.total, channel: T.channel, description: T.description })
      .from(T)
      .where(and(eq(T.tenantId, tenantId), inArray(T.kind, ["sale", "refund", "reimb", "safet"]), isNotNull(T.orderId))),
    db.execute<{ order_id: string; sku: string | null; date: string | null; kind: "sale" | "refund"; quantity: number; product: number | null; ship: number | null; total: number; channel: "fba" | "fbm" | "" }>(sql`
      select order_id, sku, min(posted_date)::text as date,
             case when lower(transaction_type) like 'refund%' then 'refund' else 'sale' end as kind,
             coalesce(nullif(sum(quantity) filter (where amount_description = 'Principal'), 0),
                      count(distinct coalesce(adjustment_id, row_hash)) filter (where amount_description = 'Principal'))::int as quantity,
             sum(amount) filter (where amount_type = 'ItemPrice' and amount_description = 'Principal')::float as product,
             sum(amount) filter (where amount_type = 'ItemPrice' and amount_description ilike 'shipping%')::float as ship,
             sum(amount)::float as total,
             case fulfillment_id when 'AFN' then 'fba' when 'MFN' then 'fbm' else '' end as channel
        from amazon_settlement_lines
       where tenant_id = ${tenantId} and order_id is not null
         and (lower(transaction_type) like 'refund%' or lower(transaction_type) = 'order')
       group by order_id, sku, 4, fulfillment_id`),
  ]);
  const rows: TxRow[] = tx.map((r) => ({
    orderId: r.orderId!,
    sku: r.sku,
    date: r.date,
    kind: r.kind as TxRow["kind"],
    quantity: r.quantity,
    productSales: r.productSales ?? 0,
    shippingCredits: r.shippingCredits ?? 0,
    total: r.total ?? 0,
    channel: r.channel as TxRow["channel"],
    description: r.description,
  }));
  const known = new Set(rows.map((r) => `${r.kind}|${r.orderId}`));
  for (const r of settle.rows) {
    if (known.has(`${r.kind}|${r.order_id}`)) continue;
    rows.push({
      orderId: r.order_id,
      sku: r.sku,
      date: r.date,
      kind: r.kind,
      quantity: Math.abs(r.quantity),
      productSales: r.product ?? 0,
      shippingCredits: r.ship ?? 0,
      total: r.total,
      channel: r.channel,
      description: null,
    });
  }
  return rows;
}

export type ClaimRef = { id: string; key: string; status: string; amazonCaseId: string | null; type: string };
const CLOSED = ["reimbursed", "rejected", "dismissed"];

export type ReturnView = {
  rows: (ReturnRow & { claims: ClaimRef[]; resolved: boolean })[];
  paymentsKnown: boolean;
  tx: TxRow[];
  reasons: { sku: string | null; reason: string | null; quantity: number }[];
};

export async function loadReturnRows(tenantId: string, mode: Mode, opts: { withClaims?: boolean } = {}): Promise<ReturnView> {
  const settings = (await getSettings(tenantId)).returns;
  const today = todayIso();
  const tx = await loadTx(tenantId);
  let rows: ReturnRow[];
  let paymentsKnown = true;
  let reasons: ReturnView["reasons"];
  if (mode === "fba") {
    const R = schema.amazonCustomerReturns;
    const B = schema.amazonReimbursements;
    const [returns, reimb] = await Promise.all([
      db.select({ orderId: R.orderId, sku: R.sku, date: R.returnDate, quantity: R.quantity, disposition: R.disposition, reason: R.reason, title: R.title }).from(R).where(and(eq(R.tenantId, tenantId), isNotNull(R.orderId))),
      db.select({ orderId: B.orderId, sku: B.sku, amount: B.amountTotal, quantity: B.quantityTotal, date: B.approvalDate, reason: B.reason }).from(B).where(and(eq(B.tenantId, tenantId), isNotNull(B.orderId))),
    ]);
    const payments: PaymentRow[] = [
      ...reimb.map((r) => {
        const rev = REVERSAL.test(r.reason ?? "");
        return { orderId: r.orderId!, sku: r.sku, amount: rev ? -Math.abs(r.amount ?? 0) : (r.amount ?? 0), quantity: rev ? -Math.abs(r.quantity) : r.quantity, date: r.date, reason: r.reason, source: "Erstattungsbericht" as const };
      }),
      ...tx.filter((t) => t.kind === "reimb").map((t) => ({ orderId: t.orderId, sku: t.sku, amount: t.total, quantity: t.quantity || null, date: t.date, reason: t.description, source: "Transaktionsbericht" as const })),
    ];
    const res = reconcileFba({ tx, returns: returns.map((r) => ({ ...r, orderId: r.orderId! })), payments }, settings, today);
    rows = res.rows;
    paymentsKnown = res.paymentsKnown;
    reasons = returns;
  } else {
    const F = schema.amazonFbmReturns;
    const returns = await db.select().from(F).where(eq(F.tenantId, tenantId));
    rows = reconcileFbm(
      {
        tx,
        returns: returns.map((r) => ({ orderId: r.orderId, sku: r.sku, title: r.title, requestDate: r.requestDate, tracking: r.tracking, deliveryDate: r.deliveryDate, refundedAmount: r.refundedAmount ?? 0, quantity: r.quantity, reason: r.reason, safetClaimId: r.safetClaimId })),
      },
      settings,
      today,
    );
    reasons = returns;
  }

  const byRow = new Map<string, ClaimRef[]>();
  if (opts.withClaims !== false) {
    const wanted = returnClaims(rows, today);
    const keys = wanted.map((c) => c.key);
    const C = schema.claims;
    const found = keys.length
      ? await db.select({ id: C.id, key: C.detectionKey, status: C.status, amazonCaseId: C.amazonCaseId, type: C.type }).from(C).where(and(eq(C.tenantId, tenantId), inArray(C.detectionKey, keys)))
      : [];
    const byKey = new Map(found.map((c) => [c.key!, { ...c, key: c.key! }]));
    for (const w of wanted) {
      const c = byKey.get(w.key);
      if (!c) continue;
      const k = `${w.reference}|${w.sku ?? ""}`;
      byRow.set(k, [...(byRow.get(k) ?? []), c]);
    }
  }
  return {
    rows: rows.map((r) => {
      const claims = byRow.get(`${r.orderId}|${r.sku || ""}`) ?? [];
      return { ...r, claims, resolved: claims.length > 0 && claims.every((c) => CLOSED.includes(c.status)) };
    }),
    paymentsKnown,
    tx,
    reasons,
  };
}

/** Ansprüche aus dem Retouren-Abgleich (FBA und Händlerversand) für die Anspruchs-Erkennung. */
export async function loadReturnClaims(tenantId: string) {
  const today = todayIso();
  const [fba, fbm] = await Promise.all([loadReturnRows(tenantId, "fba", { withClaims: false }), loadReturnRows(tenantId, "fbm", { withClaims: false })]);
  return returnClaims([...fba.rows, ...fbm.rows], today);
}
