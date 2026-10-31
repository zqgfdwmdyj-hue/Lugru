import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { qcol } from "@/db/qcol";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";
import { itemNameSql } from "@/lib/orders/service";
import type { PrepRow } from "./prep";

// Was hat das Prep Center in einem Monat verschickt? Tag = versendet, sonst Label erstellt (Berliner Zeit).

const PRODUCT: Record<string, string> = { V01PAK: "DHL Paket", V62KP: "DHL Kleinpaket", V62WP: "DHL Warenpost" };
const productName = (product: string | null, carrier: string | null) =>
  product ? (product.startsWith("Warensendung") ? "Warensendung" : PRODUCT[product] ?? product) : carrier ?? "ohne Label";

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
};

async function monthOrders(tenantId: string, month: string, who: "prep" | "unassigned"): Promise<PrepRow[]> {
  const O = schema.orders;
  const { start, end } = monthRange(month);
  const shipDay = sql<string>`(coalesce(${O.shippedAt}, (select min(p.created_at) from parcels p where p.order_id = ${qcol(O.id)} and p.tenant_id = ${tenantId} and p.status = 'created'), ${O.updatedAt}) at time zone 'Europe/Berlin')::date::text`;
  const rows = await db
    .select({
      id: O.id,
      externalId: O.externalId,
      channel: O.channel,
      status: O.status,
      carrier: O.carrier,
      tracking: O.trackingNumber,
      shipTo: O.shipTo,
      buyerName: O.buyerName,
      day: shipDay,
      product: sql<string | null>`(select p.product from parcels p where p.order_id = ${qcol(O.id)} and p.tenant_id = ${tenantId} and p.status = 'created' order by p.created_at desc limit 1)`,
      units: sql<number>`coalesce((select sum(i.quantity) from order_items i where i.order_id = ${qcol(O.id)} and i.tenant_id = ${tenantId}), 0)::int`,
      items: sql<string | null>`(select string_agg(i.quantity || '× ' || coalesce(${itemNameSql}, i.sku, '?'), ' · ') from order_items i where i.order_id = ${qcol(O.id)} and i.tenant_id = ${tenantId})`,
    })
    .from(O)
    .where(
      and(
        eq(O.tenantId, tenantId),
        eq(O.fulfillment, "FBM"),
        sql`${O.status} in ('label_created', 'shipped', 'delivered', 'returned')`,
        who === "prep" ? eq(O.shippedBy, "prep") : sql`${O.shippedBy} is null`,
        sql`${shipDay} between ${start} and ${end}`,
      ),
    )
    .orderBy(O.orderDate, O.externalId)
    .limit(3000);
  return rows
    .map((r) => ({
      orderId: r.id,
      externalId: r.externalId,
      channel: CHANNEL_LABEL[r.channel] ?? r.channel,
      day: r.day,
      name: r.shipTo?.name1 ?? r.buyerName ?? "–",
      place: [r.shipTo?.zip, r.shipTo?.city].filter(Boolean).join(" "),
      units: Number(r.units) || 0,
      items: r.items ?? "",
      product: productName(r.product, r.carrier),
      tracking: r.tracking,
      status: ORDER_STATUS_LABEL[r.status] ?? r.status,
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.externalId.localeCompare(b.externalId));
}

/** Sendungen des Prep Centers im Monat. */
export function prepMonthRows(tenantId: string, month: string) {
  return monthOrders(tenantId, month, "prep");
}

/** Sendungen im Monat ohne Festlegung, wer verschickt hat – vor dem Abgleich zuordnen. */
export function unassignedMonthRows(tenantId: string, month: string) {
  return monthOrders(tenantId, month, "unassigned");
}
