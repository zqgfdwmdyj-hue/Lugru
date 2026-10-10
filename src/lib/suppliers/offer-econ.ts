import type { OfferMarket } from "@/db/schema";
import { packInfo, unitsPerSale } from "./scan";
import { isImplausible, offerCalc } from "./prices";

type Settings = { vatRate: number; pricing: { defaultFbaFee: number; referralRate: number } };

/** Gewinn/ROI eines Lieferantenangebots gegen den Amazon-Preis – wie in der Feed-Ansicht. */
export function econOf(
  o: { price: number | null; title: string | null; url: string | null; market: OfferMarket | null; pricesGross: boolean; costPct: number; vatPct: number | null; amazonQty?: number | null },
  s: Settings,
) {
  const vatRate = o.vatPct !== null ? o.vatPct / 100 : s.vatRate;
  const pack = packInfo(o.title ?? "", o.url);
  const m = o.market;
  const per = unitsPerSale({ amazonTitle: m?.title, supplierTitle: o.title, supplierUrl: o.url, override: o.amazonQty, keepaItems: m?.items, keepaNetG: m?.netG });
  const c = offerCalc({
    price: o.price,
    gross: o.pricesGross,
    vatRate,
    costPct: o.costPct,
    caseQty: pack.caseQty,
    sale: m?.price ?? null,
    fbaFee: m?.fbaFee ?? s.pricing.defaultFbaFee,
    referralRate: m?.referralPct ? m.referralPct / 100 : s.pricing.referralRate,
    unitsPerSale: per.units,
  });
  return {
    ...c,
    caseQty: pack.caseQty,
    sale: m?.price ?? null,
    unitsPerSale: per.units,
    unitsAuto: per.auto,
    unitsSource: per.source,
    costPerSale: c.costPerSale ?? c.unitNet,
    // ROI über 500 % zum Prüfen – eine von Hand gesetzte Stückzahl gilt als geprüft.
    implausible: per.source !== "hand" && isImplausible(c.roi),
  };
}
