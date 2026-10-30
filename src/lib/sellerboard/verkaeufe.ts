// Verkaufte Stück je ASIN an einem Tag – aus den sellerboard-Tageswerten je SKU (sellerboard_sku_tage).
// Mehrere SKUs derselben ASIN (z. B. FBA und FBM, Amazon und eBay) werden zusammengezählt. Reine Logik, testbar.

export type SkuTag = { channel: string; sku: string; asin: string | null; name: string | null; units: number; sales: number | null; netProfit: number | null; refunds: number };

export type AsinVerkauf = {
  asin: string | null;
  name: string | null;
  stueck: number;
  umsatz: number | null;
  nettogewinn: number | null;
  erstattungen: number;
  kanaele: string[];
  skus: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const plus = (a: number | null, b: number | null) => (a === null && b === null ? null : r2((a ?? 0) + (b ?? 0)));

/** Je ASIN zusammenfassen (ohne ASIN je SKU), nach Stück absteigend, dann Umsatz. */
export function verkaeufeJeAsin(rows: SkuTag[]): AsinVerkauf[] {
  const m = new Map<string, AsinVerkauf>();
  for (const r of rows) {
    const key = r.asin ? `a:${r.asin.toUpperCase()}` : `s:${r.sku}`;
    const cur = m.get(key);
    if (!cur) {
      m.set(key, { asin: r.asin ? r.asin.toUpperCase() : null, name: r.name, stueck: r.units, umsatz: r.sales === null ? null : r2(r.sales), nettogewinn: r.netProfit === null ? null : r2(r.netProfit), erstattungen: r.refunds, kanaele: [r.channel], skus: [r.sku] });
      continue;
    }
    cur.stueck += r.units;
    cur.umsatz = plus(cur.umsatz, r.sales);
    cur.nettogewinn = plus(cur.nettogewinn, r.netProfit);
    cur.erstattungen += r.refunds;
    cur.name ??= r.name;
    if (!cur.kanaele.includes(r.channel)) cur.kanaele.push(r.channel);
    if (!cur.skus.includes(r.sku)) cur.skus.push(r.sku);
  }
  return [...m.values()].sort((a, b) => b.stueck - a.stueck || (b.umsatz ?? 0) - (a.umsatz ?? 0));
}
