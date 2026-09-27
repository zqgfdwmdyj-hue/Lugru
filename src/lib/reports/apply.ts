import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Table } from "@/lib/tabular";
import { todayIso } from "@/lib/dates";
import {
  parseCustomerReturns,
  parseFees,
  parseFeedback,
  parseInventory,
  parseLedger,
  parseOrdersReport,
  parseReimbursements,
  parseRemovalOrders,
  parseRemovalShipments,
  parseSettlement,
  REPORT_KINDS,
  type ReportKind,
} from "./amazon";

export type ReportResult = { kind: ReportKind; label: string; rows: number; inserted: number; message?: string };

const CHUNK = 400;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

async function insertIgnore<T extends Record<string, unknown>>(table: Parameters<typeof db.insert>[0], rows: T[]) {
  let inserted = 0;
  for (const part of chunks(rows)) {
    const res = await db.insert(table).values(part as never).onConflictDoNothing().returning({ id: sql`1` });
    inserted += res.length;
  }
  return inserted;
}

export async function applyReport(opts: {
  tenantId: string;
  userId?: string | null;
  fileName?: string | null;
  kind: ReportKind;
  table: Table;
  via?: "upload" | "api";
}): Promise<ReportResult> {
  const { tenantId, kind, table } = opts;
  const withTenant = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, tenantId }));
  let rows = 0;
  let inserted = 0;
  let message: string | undefined;

  switch (kind) {
    case "ledger": {
      const parsed = parseLedger(table);
      rows = parsed.length;
      inserted = await insertIgnore(schema.amazonLedgerEvents, withTenant(parsed));
      break;
    }
    case "reimbursements": {
      const parsed = parseReimbursements(table);
      rows = parsed.length;
      inserted = await insertIgnore(schema.amazonReimbursements, withTenant(parsed));
      break;
    }
    case "customerReturns": {
      const parsed = parseCustomerReturns(table);
      rows = parsed.length;
      inserted = await insertIgnore(schema.amazonCustomerReturns, withTenant(parsed));
      break;
    }
    case "removalShipments": {
      const parsed = parseRemovalShipments(table);
      rows = parsed.length;
      inserted = await insertIgnore(schema.amazonRemovalShipments, withTenant(parsed));
      break;
    }
    case "removalOrders": {
      const parsed = parseRemovalOrders(table);
      rows = parsed.length;
      const R = schema.amazonRemovalOrders;
      for (const part of chunks(withTenant(parsed))) {
        const res = await db
          .insert(R)
          .values(part)
          .onConflictDoUpdate({
            target: [R.tenantId, R.orderId, R.sku, R.disposition],
            set: {
              orderStatus: sql`excluded.order_status`,
              lastUpdated: sql`excluded.last_updated`,
              requestedQuantity: sql`excluded.requested_quantity`,
              cancelledQuantity: sql`excluded.cancelled_quantity`,
              disposedQuantity: sql`excluded.disposed_quantity`,
              shippedQuantity: sql`excluded.shipped_quantity`,
              inProcessQuantity: sql`excluded.in_process_quantity`,
              removalFee: sql`excluded.removal_fee`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        inserted += res.filter((r) => r.inserted).length;
      }
      break;
    }
    case "inventory": {
      const parsed = parseInventory(table);
      rows = parsed.length;
      const I = schema.amazonInventory;
      const today = todayIso();
      for (const part of chunks(parsed.map((p) => ({ ...p, tenantId, snapshotDate: today, unsellableSince: p.unsellable > 0 ? today : null })))) {
        const res = await db
          .insert(I)
          .values(part)
          .onConflictDoUpdate({
            target: [I.tenantId, I.sku],
            set: {
              fnsku: sql`excluded.fnsku`,
              asin: sql`excluded.asin`,
              title: sql`excluded.title`,
              condition: sql`excluded.condition`,
              price: sql`excluded.price`,
              fulfillable: sql`excluded.fulfillable`,
              unsellable: sql`excluded.unsellable`,
              reserved: sql`excluded.reserved`,
              inboundWorking: sql`excluded.inbound_working`,
              inboundShipped: sql`excluded.inbound_shipped`,
              inboundReceiving: sql`excluded.inbound_receiving`,
              researching: sql`excluded.researching`,
              total: sql`excluded.total`,
              mfnFulfillable: sql`excluded.mfn_fulfillable`,
              // Seit wann unverkäuflich: bleibt stehen, solange weiter unverkäuflicher Bestand da ist.
              unsellableSince: sql`case when excluded.unsellable > 0 then coalesce(${I.unsellableSince}, excluded.snapshot_date) else null end`,
              snapshotDate: sql`excluded.snapshot_date`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        inserted += res.filter((r) => r.inserted).length;
      }
      // FNSKU in die Chargen übernehmen, wo sie noch fehlt.
      await db.execute(sql`
        update lots l set fnsku = i.fnsku, updated_at = now()
          from amazon_inventory i
         where i.tenant_id = ${tenantId} and l.tenant_id = ${tenantId}
           and l.sku = i.sku and l.fnsku is null and i.fnsku is not null`);
      break;
    }
    case "settlement": {
      const { headers, lines } = parseSettlement(table);
      rows = lines.length;
      for (const h of headers) {
        await db
          .insert(schema.amazonSettlements)
          .values({ ...h, tenantId })
          .onConflictDoUpdate({
            target: [schema.amazonSettlements.tenantId, schema.amazonSettlements.settlementId],
            set: {
              startDate: sql`coalesce(excluded.start_date, ${schema.amazonSettlements.startDate})`,
              endDate: sql`coalesce(excluded.end_date, ${schema.amazonSettlements.endDate})`,
              depositDate: sql`coalesce(excluded.deposit_date, ${schema.amazonSettlements.depositDate})`,
              totalAmount: sql`coalesce(excluded.total_amount, ${schema.amazonSettlements.totalAmount})`,
            },
          });
      }
      inserted = await insertIgnore(schema.amazonSettlementLines, withTenant(lines));
      message = `${headers.length} Abrechnung(en)`;
      break;
    }
    case "orders": {
      const parsed = parseOrdersReport(table);
      rows = parsed.length;
      const O = schema.orders;
      for (const o of parsed) {
        const status = mapAmazonStatus(o.externalStatus, o.fulfillment);
        const [row] = await db
          .insert(O)
          .values({
            tenantId,
            channel: "amazon",
            externalId: o.externalId,
            orderDate: o.orderDate,
            fulfillment: o.fulfillment,
            status,
            externalStatus: o.externalStatus,
            total: Math.round(o.total * 100) / 100,
            currency: o.currency,
          })
          .onConflictDoUpdate({
            target: [O.tenantId, O.channel, O.externalId],
            set: {
              externalStatus: sql`excluded.external_status`,
              total: sql`excluded.total`,
              status: sql`case when ${O.status} = 'open' then excluded.status else ${O.status} end`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: O.id, inserted: sql<boolean>`(xmax = 0)` });
        if (row.inserted) inserted++;
        await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, row.id));
        if (o.items.length) {
          await db.insert(schema.orderItems).values(o.items.map((it) => ({ ...it, tenantId, orderId: row.id })));
        }
      }
      break;
    }
    case "feedback": {
      const parsed = parseFeedback(table);
      rows = parsed.length;
      inserted = await insertIgnore(
        schema.feedback,
        parsed.map((f) => ({ ...f, tenantId, channel: "amazon" as const, status: f.rating <= 3 ? ("new" as const) : ("ok" as const) })),
      );
      break;
    }
    case "fees": {
      const parsed = parseFees(table);
      rows = parsed.length;
      const P = schema.products;
      for (const f of parsed) {
        if (f.fbaFee === null && f.referralRate === null) continue;
        const res = await db
          .update(P)
          .set({
            ...(f.fbaFee !== null ? { fbaFee: String(f.fbaFee) } : {}),
            ...(f.referralRate !== null ? { referralRate: String(f.referralRate) } : {}),
          })
          .where(and(eq(P.tenantId, tenantId), eq(P.asin, f.asin)))
          .returning({ id: P.id });
        inserted += res.length;
      }
      message = "Gebühren bei vorhandenen Artikeln aktualisiert";
      break;
    }
  }

  await db.insert(schema.reportImports).values({
    tenantId,
    userId: opts.userId ?? null,
    reportType: kind,
    fileName: opts.fileName ?? null,
    via: opts.via ?? "upload",
    rows,
    inserted,
    message: message ?? null,
  });

  return { kind, label: REPORT_KINDS[kind], rows, inserted, message };
}

export function mapAmazonStatus(external: string | null, fulfillment: "FBA" | "FBM") {
  const s = (external ?? "").toLowerCase();
  if (s.includes("cancel")) return "cancelled" as const;
  if (s.includes("shipped") && !s.includes("unshipped")) return "shipped" as const;
  if (fulfillment === "FBA") return s.includes("pending") ? ("open" as const) : ("shipped" as const);
  return "open" as const;
}

/** Wird von der Ansprüche-Erkennung genutzt, um Artikel zuzuordnen. */
export async function lotIdsBySku(tenantId: string, skus: string[]) {
  if (skus.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.lots.id, sku: schema.lots.sku })
    .from(schema.lots)
    .where(and(eq(schema.lots.tenantId, tenantId), inArray(schema.lots.sku, skus)));
  return new Map(rows.map((r) => [r.sku, r.id]));
}
