import type { OfferMarket } from "@/db/schema";
import { matchIssue } from "./match";
import { packInfo, sizeIssue, unitsPerSale } from "./scan";
import { isImplausible, offerCalc } from "./prices";

type Settings = { vatRate: number; pricing: { defaultFbaFee: number; referralRate: number } };

/** Gewinn/ROI eines Lieferantenangebots gegen den Amazon-Preis – wie in der Feed-Ansicht. */
export function econOf(
  o: {
    price: number | null;
    title: string | null;
    url: string | null;
    market: OfferMarket | null;
    pricesGross: boolean;
    costPct: number;
    vatPct: number | null;
    amazonQty?: number | null;
    matchReview?: { asin: string; ok: boolean } | null;
  },
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
  // Titel-Treffer (ohne EAN): passt das Amazon-Angebot? Eine Prüfung von Hand gilt für genau diese ASIN.
  const review = o.matchReview && m?.asin && o.matchReview.asin === m.asin ? o.matchReview : null;
  const issues: string[] = [];
  if (m?.byTitle && m.asin && !review?.ok) {
    const mi = matchIssue(o.title, m.title);
    if (mi) issues.push(mi.text);
    const si = sizeIssue({ amazonTitle: m.title, supplierTitle: o.title, supplierUrl: o.url, source: per.source });
    if (si) issues.push(si);
  }
  const implausible = per.source !== "hand" && isImplausible(c.roi);
  return {
    ...c,
    caseQty: pack.caseQty,
    sale: m?.price ?? null,
    unitsPerSale: per.units,
    unitsAuto: per.auto,
    unitsSource: per.source,
    costPerSale: c.costPerSale ?? c.unitNet,
    // ROI über 500 % zum Prüfen – eine von Hand gesetzte Stückzahl gilt als geprüft.
    implausible,
    /** Gründe, warum der Titel-Treffer wohl nicht passt (andere Marke/Sorte/Packungsgröße …). */
    issues,
    /** Von Hand als „falsches Produkt“ markiert – zählt nicht. */
    rejected: review?.ok === false,
    /** Von Hand als „passt“ bestätigt. */
    confirmed: review?.ok === true,
    /** Gehört unter „Prüfen“ statt „profitabel“. */
    needsReview: implausible || issues.length > 0,
  };
}
