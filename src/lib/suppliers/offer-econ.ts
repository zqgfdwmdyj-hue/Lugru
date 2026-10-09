import type { OfferMarket } from "@/db/schema";
import { packInfo } from "./scan";
import { offerCalc } from "./prices";

type Settings = { vatRate: number; pricing: { defaultFbaFee: number; referralRate: number } };

/** Gewinn/ROI eines Lieferantenangebots gegen den Amazon-Preis – wie in der Feed-Ansicht. */
export function econOf(
  o: { price: number | null; title: string | null; url: string | null; market: OfferMarket | null; pricesGross: boolean; costPct: number; vatPct: number | null },
  s: Settings,
) {
  const vatRate = o.vatPct !== null ? o.vatPct / 100 : s.vatRate;
  const pack = packInfo(o.title ?? "", o.url);
  const m = o.market;
  const c = offerCalc({
    price: o.price,
    gross: o.pricesGross,
    vatRate,
    costPct: o.costPct,
    caseQty: pack.caseQty,
    sale: m?.price ?? null,
    fbaFee: m?.fbaFee ?? s.pricing.defaultFbaFee,
    referralRate: m?.referralPct ? m.referralPct / 100 : s.pricing.referralRate,
  });
  return { ...c, caseQty: pack.caseQty, sale: m?.price ?? null };
}
