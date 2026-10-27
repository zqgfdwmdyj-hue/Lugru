import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadSets } from "@/lib/stock/sets";
import { isPlaceholderCost } from "./ek-logic";
import { mergeCosts, setCostPairs, type CostInfo, type CostPair } from "./profit-logic";

// EK je SKU – eine Stelle für Gewinn, Lagerwert und Produktansicht. Reihenfolge: Charge (lots) → von Hand
// nachgetragener EK je SKU (sku_costs) → Einkaufspreis aus dem eBay-Tool (Variante/Einzelangebot) → Summe der
// Set-Bestandteile → EK aus sellerboard → vom Mehrfachangebot geerbter EK. Jeder Wert trägt seine Herkunft.

type Variants = { items?: { sku?: string; value?: string; purchasePrice?: number; set?: boolean }[] } | null;

export type CostPairs = {
  charge: CostPair[];
  manuell: CostPair[];
  ebayOwn: CostPair[];
  ebayInherited: CostPair[];
  set: CostPair[];
  sellerboard?: CostPair[];
  /** EK-Platzhalter aus sellerboard (z. B. 0,01 €) – werden angezeigt, gelten aber nie. */
  sellerboardPlaceholder?: CostPair[];
};

/**
 * Alle EK-Werte mit Herkunft, noch nicht zusammengeführt. eBay-Tool: EK der Variante bzw. des Einzelangebots
 * („eigen“); hat eine Variante keinen eigenen EK, gilt der EK des Mehrfachangebots – das ist „geerbt“ und wird
 * so angezeigt (für Sets nie: dort zählt die Summe der Bestandteile).
 */
export async function loadCostPairs(tenantId: string): Promise<CostPairs> {
  const [lots, manual, ebay, links, sets, sb] = await Promise.all([
    db.select({ sku: schema.lots.sku, cost: schema.lots.unitCostNet, date: schema.lots.purchaseDate, src: schema.lots.unitCostSource }).from(schema.lots).where(and(eq(schema.lots.tenantId, tenantId), isNotNull(schema.lots.unitCostNet))).orderBy(desc(schema.lots.purchaseDate)),
    db.select({ sku: schema.skuCosts.sku, cost: schema.skuCosts.unitCostNet }).from(schema.skuCosts).where(eq(schema.skuCosts.tenantId, tenantId)),
    db
      .select({ sku: schema.ebayListings.sku, cost: schema.ebayListings.purchasePrice, variants: schema.ebayListings.variants, listingId: schema.ebayListings.listingId })
      .from(schema.ebayListings)
      .where(eq(schema.ebayListings.tenantId, tenantId))
      // Neueste zuerst: gibt es mehrere Angebote mit derselben SKU, gilt der jüngste EK.
      .orderBy(desc(schema.ebayListings.id)),
    // eBay-Angebote mit eigener Lager-SKU (z. B. „LG-…“): der EK gilt auch für die Lager-SKU.
    db
      .select({ sku: schema.listings.sku, stockSku: schema.listings.stockSku })
      .from(schema.listings)
      .where(and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.channel, "ebay"), isNotNull(schema.listings.stockSku))),
    loadSets(tenantId),
    // EK laut sellerboard (netto je Stück) – nur wo im Seller-System nichts Eigenes hinterlegt ist.
    db.select({ sku: schema.sellerboardProducts.sku, cost: schema.sellerboardProducts.cost, at: schema.sellerboardProducts.syncedAt }).from(schema.sellerboardProducts).where(and(eq(schema.sellerboardProducts.tenantId, tenantId), isNotNull(schema.sellerboardProducts.cost))),
  ]);
  const setSkus = new Set(sets.map((s) => s.sku));
  const ebayOwn: CostPair[] = [];
  const ebayInherited: CostPair[] = [];
  for (const e of ebay) {
    const v = e.variants as Variants;
    const ref = e.listingId ? `Angebot ${e.listingId}` : `SKU ${e.sku ?? "?"}`;
    if (v?.items?.length) {
      for (const i of v.items) {
        if (!i.sku) continue;
        if (i.purchasePrice !== undefined && i.purchasePrice !== null) ebayOwn.push([i.sku, i.purchasePrice, `${ref}, Variante ${i.value ?? i.sku}`]);
        else if (e.cost !== null && !i.set && !setSkus.has(i.sku)) ebayInherited.push([i.sku, e.cost, `EK des Mehrfachangebots (${ref}) – Variante ohne eigenen EK`, true]);
      }
    } else if (e.sku) ebayOwn.push([e.sku, e.cost, ref]);
  }
  const stockOf = new Map(links.filter((l) => l.stockSku?.trim()).map((l) => [l.sku, l.stockSku!.trim()]));
  for (const list of [ebayOwn, ebayInherited]) {
    for (const [sku, cost, detail, inherited] of [...list]) {
      const stock = stockOf.get(sku);
      if (stock && stock !== sku) list.push([stock, cost, `${detail} · über eBay-SKU ${sku}`, inherited]);
    }
  }
  const charge: CostPair[] = lots.map((l) => [l.sku, l.cost === null ? null : Number(l.cost), [l.date ? `Einkauf ${l.date.split("-").reverse().join(".")}` : "Charge", l.src === "inherited" ? "EK von Vorgänger-Charge" : null].filter(Boolean).join(" · "), l.src === "inherited"]);
  const manuell: CostPair[] = manual.map((m) => [m.sku, m.cost, "EK je SKU von Hand eingetragen"]);
  const base = mergeCosts(["charge", charge], ["manuell", manuell], ["ebay", ebayOwn]);
  const stand = (at: Date) => `laut sellerboard (Stand ${at.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })})`;
  const sellerboard: CostPair[] = sb.filter((r) => !isPlaceholderCost(r.cost)).map((r) => [r.sku, r.cost, stand(r.at)]);
  const sellerboardPlaceholder: CostPair[] = sb.filter((r) => isPlaceholderCost(r.cost)).map((r) => [r.sku, r.cost, `${stand(r.at)} – Platzhalter, zählt nicht als EK`]);
  return { charge, manuell, ebayOwn, ebayInherited, set: setCostPairs(sets, base), sellerboard, sellerboardPlaceholder };
}

/**
 * Gültiger EK je SKU: Charge → von Hand → eBay-Tool (eigen) → Set-Summe → sellerboard → eBay-Tool (geerbt).
 * Die eine Stelle für Produkt, Gewinn, Lagerwert, Nachbestellung, Repricer, Hebel und SAS-Deals.
 */
export function mergeCostPairs(p: CostPairs): Map<string, CostInfo> {
  return mergeCosts(["charge", p.charge], ["manuell", p.manuell], ["ebay", p.ebayOwn], ["set", p.set], ["sellerboard", p.sellerboard ?? []], ["ebay", p.ebayInherited]);
}

export async function skuCostMap(tenantId: string): Promise<Map<string, CostInfo>> {
  return mergeCostPairs(await loadCostPairs(tenantId));
}

/** EK laut sellerboard je SKU (auch Platzhalter) – nur zum Vergleich mit dem gültigen EK. */
export async function sellerboardCostMap(tenantId: string): Promise<Map<string, number>> {
  const P = schema.sellerboardProducts;
  const rows = await db.select({ sku: P.sku, cost: P.cost }).from(P).where(and(eq(P.tenantId, tenantId), isNotNull(P.cost)));
  return new Map(rows.filter((r) => r.cost !== null).map((r) => [r.sku, r.cost!]));
}
