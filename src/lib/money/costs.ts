import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { mergeCosts, type CostInfo } from "./profit-logic";

// EK je SKU – eine Stelle für Gewinn, Lagerwert und Produktansicht. Reihenfolge: Charge (lots) → von Hand
// nachgetragener EK je SKU (sku_costs) → Einkaufspreis aus dem eBay-Tool (auch je Variante).

type Variants = { items?: { sku?: string; purchasePrice?: number }[] } | null;

export async function skuCostMap(tenantId: string): Promise<Map<string, CostInfo>> {
  const [lots, manual, ebay] = await Promise.all([
    db.select({ sku: schema.lots.sku, cost: schema.lots.unitCostNet }).from(schema.lots).where(and(eq(schema.lots.tenantId, tenantId), isNotNull(schema.lots.unitCostNet))),
    db.select({ sku: schema.skuCosts.sku, cost: schema.skuCosts.unitCostNet }).from(schema.skuCosts).where(eq(schema.skuCosts.tenantId, tenantId)),
    db
      .select({ sku: schema.ebayListings.sku, cost: schema.ebayListings.purchasePrice, variants: schema.ebayListings.variants })
      .from(schema.ebayListings)
      .where(eq(schema.ebayListings.tenantId, tenantId))
      // Neueste zuerst: gibt es mehrere Angebote mit derselben SKU, gilt der jüngste EK.
      .orderBy(desc(schema.ebayListings.id)),
  ]);
  const ebayPairs: [string, number | null][] = [];
  for (const e of ebay) {
    const v = e.variants as Variants;
    if (v?.items?.length) for (const i of v.items) ebayPairs.push([i.sku ?? "", i.purchasePrice ?? e.cost ?? null]);
    else if (e.sku) ebayPairs.push([e.sku, e.cost]);
  }
  return mergeCosts(
    ["charge", lots.map((l) => [l.sku, l.cost === null ? null : Number(l.cost)] as [string, number | null])],
    ["manuell", manual.map((m) => [m.sku, m.cost] as [string, number])],
    ["ebay", ebayPairs],
  );
}
