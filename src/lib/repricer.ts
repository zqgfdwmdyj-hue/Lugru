import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { minMaxPrice } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";

export type RepricerRow = {
  sku: string;
  asin: string | null;
  title: string | null;
  stock: number;
  unitCost: number | null;
  fbaFee: number;
  referralRate: number;
  price: number | null;
  target: number | null;
  min: number | null;
  max: number | null;
  feeEstimated: boolean;
};

/** Alle SKUs mit Bestand – mit Mindest- und Maximalpreis aus dem echten EK. */
export async function repricerRows(tenantId: string): Promise<RepricerRow[]> {
  const s = await getSettings(tenantId);
  const res = await db.execute<{ sku: string; asin: string | null; title: string | null; stock: number; cost: number | null; fee: number | null; ref: number | null; price: number | null; target: number | null }>(sql`
    select i.sku, i.asin, coalesce(p.title, i.title) as title,
           (i.fulfillable + i.reserved + i.inbound_working + i.inbound_shipped + i.inbound_receiving)::int as stock,
           l.unit_cost_net::float as cost, p.fba_fee::float as fee, p.referral_rate::float as ref,
           i.price::float as price, l.sku_target_price::float as target
      from amazon_inventory i
      left join lots l on l.tenant_id = i.tenant_id and l.sku = i.sku
      left join products p on p.id = l.product_id
     where i.tenant_id = ${tenantId}
       and (i.fulfillable + i.reserved + i.inbound_working + i.inbound_shipped + i.inbound_receiving) > 0
     order by i.sku`);
  return res.rows.map((r) => {
    const fbaFee = r.fee ?? s.pricing.defaultFbaFee;
    const referralRate = r.ref ?? s.pricing.referralRate;
    const mm = r.cost !== null ? minMaxPrice({ unitCost: r.cost, fbaFee, referralRate, vatRate: s.vatRate, minProfit: s.pricing.minProfit, maxFactor: s.pricing.maxPriceFactor, targetPrice: r.target }) : null;
    return { sku: r.sku, asin: r.asin, title: r.title, stock: r.stock, unitCost: r.cost, fbaFee, referralRate, price: r.price, target: r.target, min: mm?.min ?? null, max: mm?.max ?? null, feeEstimated: r.fee === null };
  });
}
