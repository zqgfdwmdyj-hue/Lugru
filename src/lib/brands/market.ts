// Marktdaten für Ideen: ähnliche Produkte aus Keepa oder einem Helium-10-Export (Xray),
// daraus typischer Preis, FBA-Gebühr, Provision und Nachfrage – und die Kalkulation.
// Ohne Server-Abhängigkeiten.

import type { MarketProduct } from "@/db/tables/brands";

// Keepa-Kennzahlen im Feld stats.current (Index = Keepa „csv type“).
const K_NEW = 1;
const K_SALES_RANK = 3;
const K_REVIEWS = 17;
const K_BUY_BOX = 18;

const cents = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) / 100 : null);
const posInt = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) : null);

export function parseKeepaProduct(p: Record<string, unknown>): MarketProduct | null {
  const asin = typeof p.asin === "string" ? p.asin : null;
  if (!asin) return null;
  const stats = (p.stats ?? {}) as { current?: number[]; avg90?: number[] };
  const cur = stats.current ?? [];
  const avg = stats.avg90 ?? [];
  const fba = (p.fbaFees ?? {}) as { pickAndPackFee?: number };
  const ref = typeof p.referralFeePercentage === "number" ? p.referralFeePercentage : typeof p.referralFeePercent === "number" ? p.referralFeePercent : null;
  return {
    asin,
    title: typeof p.title === "string" ? p.title.slice(0, 200) : asin,
    price: cents(cur[K_BUY_BOX]) ?? cents(cur[K_NEW]) ?? cents(avg[K_BUY_BOX]) ?? cents(avg[K_NEW]),
    fbaFee: cents(fba.pickAndPackFee),
    referralPct: ref !== null && ref > 0 && ref < 100 ? ref : null,
    monthlySold: posInt(p.monthlySold),
    salesRank: posInt(cur[K_SALES_RANK]) ?? posInt(avg[K_SALES_RANK]),
    reviews: posInt(cur[K_REVIEWS]),
  };
}

// ---- Helium 10 (Xray-Export als CSV) --------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const pick = (headers: string[], ...names: string[]) => {
  const n = headers.map(norm);
  for (const name of names) {
    const i = n.findIndex((h) => h === norm(name));
    if (i >= 0) return i;
  }
  for (const name of names) {
    const i = n.findIndex((h) => h.includes(norm(name)));
    if (i >= 0) return i;
  }
  return -1;
};
const numOf = (v: string | undefined) => {
  if (!v) return null;
  let s = v.replace(/[€$%\s]/g, "");
  // Deutsch „1.250“ bzw. „1.234,56“, Englisch „1,250.50“, Dezimalkomma „4,12“.
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Zeilen eines Helium-10-Xray-Exports (erste Zeile = Überschriften). Spalten werden am Namen erkannt. */
export function parseHelium10(rows: string[][]): MarketProduct[] {
  const head = rows[0] ?? [];
  const col = {
    asin: pick(head, "ASIN"),
    title: pick(head, "Product Details", "Title", "Produktdetails", "Titel"),
    price: pick(head, "Price", "Preis"),
    fba: pick(head, "FBA Fees", "Fees", "FBA-Gebühren", "Gebühren"),
    sales: pick(head, "ASIN Sales", "Sales", "Verkäufe", "Monthly Sales"),
    rank: pick(head, "BSR", "Sales Rank", "Rang"),
    reviews: pick(head, "Review Count", "Reviews", "Bewertungen"),
  };
  if (col.asin < 0) throw new Error("In der Datei fehlt die Spalte „ASIN“ – bitte den Xray-Export von Helium 10 verwenden.");
  const out: MarketProduct[] = [];
  for (const r of rows.slice(1)) {
    const asin = (r[col.asin] ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const get = (i: number) => (i >= 0 ? r[i] : undefined);
    out.push({
      asin,
      title: (get(col.title) ?? asin).trim().slice(0, 200),
      price: numOf(get(col.price)),
      fbaFee: numOf(get(col.fba)),
      referralPct: null,
      monthlySold: numOf(get(col.sales)) === null ? null : Math.round(numOf(get(col.sales))!),
      salesRank: numOf(get(col.rank)) === null ? null : Math.round(numOf(get(col.rank))!),
      reviews: numOf(get(col.reviews)) === null ? null : Math.round(numOf(get(col.reviews))!),
    });
  }
  return out.slice(0, 100);
}

// ---- Auswertung und Kalkulation ------------------------------------------------------------

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 100) / 100;
}

export type MarketSummary = { count: number; price: number | null; priceLow: number | null; priceHigh: number | null; fbaFee: number | null; referralPct: number | null; monthlySold: number | null };

export function summarizeMarket(products: MarketProduct[]): MarketSummary {
  const prices = products.map((p) => p.price).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (f: number) => (prices.length ? prices[Math.min(prices.length - 1, Math.floor(f * (prices.length - 1)))] : null);
  const sold = products.map((p) => p.monthlySold).filter((x): x is number => x !== null);
  return {
    count: products.length,
    price: median(products.map((p) => p.price)),
    priceLow: q(0.25),
    priceHigh: q(0.75),
    fbaFee: median(products.map((p) => p.fbaFee)),
    referralPct: median(products.map((p) => p.referralPct)),
    monthlySold: sold.length ? sold.reduce((a, b) => a + b, 0) : null,
  };
}

export type Calc = {
  netPrice: number;
  referral: number;
  fulfilment: number;
  storage: number;
  profit: number;
  margin: number;
  roi: number | null;
  /** VK, bei dem der Gewinn 0 ist. */
  breakEven: number;
  /** Höchster EK, bei dem noch der Mindest-ROI erreicht wird. */
  maxCost: number;
};

/**
 * Gewinn je Stück. FBA: Provision + FBA-Gebühr (aus Vergleichsprodukten, sonst Schätzung).
 * FBM: Provision + eigener Versand/Verpackung.
 */
export function calcProfit(
  input: { price: number; cost: number | null; vatRate: number; referralPct?: number | null; fbaFee?: number | null; fbmShipping?: number; storageFee?: number; minRoi?: number },
  mode: "fba" | "fbm",
): Calc {
  const vatFactor = 1 / (1 + input.vatRate / 100);
  const refRate = (input.referralPct ?? 15) / 100;
  const net = input.price * vatFactor;
  // Amazon berechnet die Provision vom Bruttopreis; ohne Vergleichswert 15 %.
  const referral = input.price * refRate;
  const fulfilment = mode === "fba" ? (input.fbaFee ?? 4.5) : (input.fbmShipping ?? 4.5);
  // Lagerkosten fallen nur bei FBA an (bei FBM im eigenen Lager).
  const storage = mode === "fba" ? (input.storageFee ?? 0) : 0;
  const cost = input.cost ?? 0;
  const profit = net - cost - referral - fulfilment - storage;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const perEuro = vatFactor - refRate;
  const beforeCost = net - referral - fulfilment - storage;
  return {
    netPrice: r2(net),
    referral: r2(referral),
    fulfilment: r2(fulfilment),
    storage: r2(storage),
    profit: r2(profit),
    margin: r2((profit / input.price) * 100),
    roi: input.cost ? r2((profit / input.cost) * 100) : null,
    breakEven: perEuro > 0 ? r2((fulfilment + storage + cost) / perEuro) : 0,
    maxCost: r2(Math.max(0, beforeCost / (1 + (input.minRoi ?? 0.2)))),
  };
}
