import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { compareCost } from "@/lib/money/ek-logic";
import { sellerboardCostMap, skuCostMap } from "@/lib/money/costs";
import type { CostSource } from "@/lib/money/profit-logic";
import { minMaxPrice } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { fbaBreakdown, type StockBreakdown } from "@/lib/stock/breakdown";

export type RepricerRow = {
  sku: string;
  asin: string | null;
  title: string | null;
  /** Verkaufbar + reserviert + unterwegs (Nicht verkaufbares zählt nicht). */
  stock: number;
  breakdown: StockBreakdown;
  unitCost: number | null;
  costSource: CostSource | null;
  /** EK laut sellerboard, wenn er vom gültigen abweicht oder nur ein Platzhalter ist. */
  sbCostNote: { value: number; placeholder: boolean } | null;
  fbaFee: number;
  referralRate: number;
  price: number | null;
  target: number | null;
  min: number | null;
  max: number | null;
  feeEstimated: boolean;
};

/** Alle SKUs mit Bestand – mit Mindest- und Maximalpreis aus dem gültigen EK (gleicher Rechenweg wie überall). */
export async function repricerRows(tenantId: string): Promise<RepricerRow[]> {
  const [s, costs, sbCosts] = await Promise.all([getSettings(tenantId), skuCostMap(tenantId), sellerboardCostMap(tenantId)]);
  const res = await db.execute<{
    sku: string; asin: string | null; title: string | null; fulfillable: number; reserved: number; inbound: number; unsellable: number;
    fee: number | null; ref: number | null; price: number | null; target: number | null;
  }>(sql`
    select i.sku, i.asin, coalesce(p.title, i.title) as title,
           i.fulfillable::int as fulfillable, i.reserved::int as reserved,
           (i.inbound_working + i.inbound_shipped + i.inbound_receiving)::int as inbound, i.unsellable::int as unsellable,
           p.fba_fee::float as fee, p.referral_rate::float as ref,
           i.price::float as price, l.sku_target_price::float as target
      from amazon_inventory i
      left join lots l on l.tenant_id = i.tenant_id and l.sku = i.sku
      left join lateral (
        select pr.title, pr.fba_fee, pr.referral_rate from products pr
         where pr.tenant_id = i.tenant_id and (pr.id = l.product_id or (l.product_id is null and pr.asin = i.asin))
         order by (pr.id = l.product_id) desc nulls last limit 1
      ) p on true
     where i.tenant_id = ${tenantId}
       and (i.fulfillable + i.reserved + i.inbound_working + i.inbound_shipped + i.inbound_receiving) > 0
     order by i.sku`);
  return res.rows.map((r) => {
    const fbaFee = r.fee ?? s.pricing.defaultFbaFee;
    const referralRate = r.ref ?? s.pricing.referralRate;
    const valid = costs.get(r.sku) ?? null;
    const cost = valid?.cost ?? null;
    const sb = compareCost(valid, sbCosts.get(r.sku));
    const breakdown = fbaBreakdown([{ fulfillable: r.fulfillable, reserved: r.reserved, inboundShipped: r.inbound, unsellable: r.unsellable }]);
    const mm = cost !== null ? minMaxPrice({ unitCost: cost, fbaFee, referralRate, vatRate: s.vatRate, minProfit: s.pricing.minProfit, maxFactor: s.pricing.maxPriceFactor, targetPrice: r.target }) : null;
    return {
      sku: r.sku,
      asin: r.asin,
      title: r.title,
      stock: breakdown.verkaufbar + breakdown.reserviert + breakdown.unterwegs,
      breakdown,
      unitCost: cost,
      costSource: valid?.source ?? null,
      sbCostNote: sb && (sb.deviates || (sb.placeholder && !valid)) ? { value: sb.value, placeholder: sb.placeholder } : null,
      fbaFee,
      referralRate,
      price: r.price,
      target: r.target,
      min: mm?.min ?? null,
      max: mm?.max ?? null,
      feeEstimated: r.fee === null,
    };
  });
}
