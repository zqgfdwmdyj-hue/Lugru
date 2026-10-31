import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { orderMatches } from "./search-logic";

// Aufträge der letzten 18 Monate durchsuchen (Name, Bestellnummer, Ort/PLZ, Artikel/SKU) – Treffer-IDs, neueste zuerst.
export async function searchOrderIds(tenantId: string, q: string, limit = 100): Promise<string[]> {
  const query = q.trim().slice(0, 100);
  if (query.length < 2) return [];
  const O = schema.orders;
  const since = new Date(Date.now() - 548 * 86400_000);
  const rows = await db
    .select({ id: O.id, externalId: O.externalId, shipTo: O.shipTo, buyerName: O.buyerName })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), gte(O.orderDate, since)))
    .orderBy(desc(O.orderDate))
    .limit(5000);
  if (!rows.length) return [];
  const I = schema.orderItems;
  const items = await db.select({ orderId: I.orderId, sku: I.sku, title: I.title }).from(I).where(and(eq(I.tenantId, tenantId), inArray(I.orderId, rows.map((r) => r.id))));
  const byOrder = new Map<string, string>();
  for (const it of items) byOrder.set(it.orderId, `${byOrder.get(it.orderId) ?? ""} ${it.sku ?? ""} ${it.title ?? ""}`);
  const out: string[] = [];
  for (const r of rows) {
    const a = r.shipTo ?? {};
    if (orderMatches({ externalId: r.externalId, name1: a.name1, name2: a.name2, buyerName: r.buyerName, street: a.street, zip: a.zip, city: a.city, items: byOrder.get(r.id) }, query)) out.push(r.id);
    if (out.length >= limit) break;
  }
  return out;
}
