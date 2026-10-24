// Produkte als zentraler Einstieg: SKUs aus Chargen, Lager, Angeboten, eBay-Tool und Artikelstamm
// zu Produkten bündeln (über die ASIN bzw. das Produkt), EK-Quellen abgleichen und eine Arbeitsliste
// für fehlende oder unklare Zuordnungen bilden. Reine Logik – Abfragen in service.ts.

import type { CostInfo } from "@/lib/money/profit-logic";

/** Ein Treffer aus einer der Quellen (Charge, Lager, Angebot …) für eine SKU. */
export type Candidate = {
  sku: string;
  productId: string | null;
  title: string | null;
  asin: string | null;
  ean: string | null;
  image: string | null;
  /** Quelle – bestimmt die Reihenfolge für Name und Bild. */
  source: "produkt" | "artikel" | "angebot" | "ebay" | "fba" | "lager" | "charge";
  active?: boolean;
};

export type ProductGroup = {
  key: string;
  href: string;
  productId: string | null;
  title: string | null;
  asin: string | null;
  ean: string | null;
  image: string | null;
  skus: string[];
};

const TITLE_ORDER: Candidate["source"][] = ["produkt", "artikel", "angebot", "ebay", "fba", "charge", "lager"];

export const productHref = (g: { productId: string | null; sku?: string; skus?: string[] }) =>
  g.productId ? `/produkte/${g.productId}` : `/produkte/sku/${encodeURIComponent(g.sku ?? g.skus?.[0] ?? "")}`;

/**
 * SKUs zu Produkten bündeln: Gehört eine SKU irgendwo zu einem Produkt (Charge, Lager, Angebot,
 * Artikel), zählt sie zu diesem Produkt; sonst ist sie ein eigenes Produkt. Name und Bild kommen aus der
 * verlässlichsten Quelle (Produkt → Artikelstamm → aktives Angebot → eBay-Tool → FBA-Bericht).
 */
export function groupCandidates(cands: Candidate[]): ProductGroup[] {
  const pidBySku = new Map<string, string>();
  for (const c of cands) if (c.productId && !pidBySku.has(c.sku)) pidBySku.set(c.sku, c.productId);
  const groups = new Map<string, { productId: string | null; cands: Candidate[]; skus: Set<string> }>();
  for (const c of cands) {
    const pid = c.productId ?? pidBySku.get(c.sku) ?? null;
    const key = pid ? `p:${pid}` : `s:${c.sku}`;
    const g = groups.get(key) ?? { productId: pid, cands: [], skus: new Set<string>() };
    g.cands.push(c);
    g.skus.add(c.sku);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    const sorted = [...g.cands].sort((a, b) => TITLE_ORDER.indexOf(a.source) - TITLE_ORDER.indexOf(b.source) || Number(Boolean(b.active)) - Number(Boolean(a.active)));
    const first = <K extends "title" | "asin" | "ean" | "image">(k: K) => sorted.find((c) => c[k])?.[k] ?? null;
    const skus = [...g.skus].sort();
    return { key, href: productHref({ productId: g.productId, skus }), productId: g.productId, title: first("title"), asin: first("asin"), ean: first("ean"), image: first("image"), skus };
  });
}

export type RankedGroup = ProductGroup & { exact: boolean; matched: string[] };

/**
 * Suchtreffer sortieren: exakte SKU zuerst, dann exakte ASIN/EAN, dann SKU beginnt mit dem Begriff,
 * dann Name. Groß/Klein und Leerzeichen am Rand egal. `matched` = SKUs der Gruppe, die passen.
 */
export function rankProductGroups(groups: ProductGroup[], q: string): RankedGroup[] {
  const n = q.trim().toLowerCase();
  const low = (s: string | null) => (s ?? "").toLowerCase();
  const score = (g: ProductGroup) => {
    if (g.skus.some((s) => low(s) === n)) return 0;
    if (low(g.asin) === n || low(g.ean) === n) return 1;
    if (g.skus.some((s) => low(s).startsWith(n))) return 2;
    if (g.skus.some((s) => low(s).includes(n))) return 3;
    return 4;
  };
  return groups
    .map((g) => ({ g, s: score(g) }))
    .sort((a, b) => a.s - b.s || (a.g.title ?? a.g.skus[0] ?? "").localeCompare(b.g.title ?? b.g.skus[0] ?? "", "de"))
    .map(({ g, s }) => ({ ...g, exact: s <= 1, matched: g.skus.filter((x) => low(x).includes(n)) }));
}

// ---- EK-Abgleich ---------------------------------------------------------------------------------

export type EkSource = { source: "charge" | "manuell" | "ebay"; label: string; cost: number };
export type EkCheck = { sku: string; effective: CostInfo | null; sources: EkSource[]; conflict: boolean; spread: number };

/** Weichen die EK-Quellen einer SKU voneinander ab (mehr als 2 % bzw. 1 Cent)? Gilt: Charge → von Hand → eBay-Tool. */
export function ekCheck(sku: string, sources: EkSource[], effective: CostInfo | null): EkCheck {
  const values = sources.map((s) => s.cost);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const spread = Math.round((max - min) * 10000) / 10000;
  const conflict = values.length > 1 && spread > Math.max(0.01, max * 0.02);
  return { sku, effective, sources, conflict, spread };
}

// ---- Arbeitsliste „Zuordnung prüfen“ ---------------------------------------------------------------

export type IssueKind = "verkauft-unbekannt" | "angebot-ohne-lager" | "ebay-nicht-in-wawi" | "ek-fehlt" | "ek-abweichung" | "ean-mehrdeutig" | "bestand-ohne-angebot";

export const ISSUE_LABEL: Record<IssueKind, { label: string; hint: string; level: "danger" | "warn" | "info" }> = {
  "verkauft-unbekannt": { label: "Verkaufte SKU ohne Zuordnung", hint: "Taucht in Aufträgen auf, ist aber weder Charge, Lager-SKU, Set noch Angebot – Bestand und EK fehlen.", level: "danger" },
  "angebot-ohne-lager": { label: "Angebot ohne Lager-SKU", hint: "Die Wawi-SKU des Angebots gibt es im Lager nicht – Menge kann nicht abgeglichen werden.", level: "danger" },
  "ebay-nicht-in-wawi": { label: "eBay-Angebot nicht in der Wawi", hint: "Im eBay-Tool veröffentlicht, aber nicht als Angebot mit Lager verknüpft.", level: "warn" },
  "ek-fehlt": { label: "EK fehlt", hint: "Bestand oder Verkäufe ohne Einkaufspreis – Gewinn und Lagerwert bleiben unvollständig.", level: "warn" },
  "ek-abweichung": { label: "EK widersprüchlich", hint: "Charge, EK von Hand und eBay-Tool nennen unterschiedliche Preise.", level: "warn" },
  "ean-mehrdeutig": { label: "EAN mehreren Produkten zugeordnet", hint: "Eine EAN zeigt auf mehrere ASINs – bitte prüfen, welche stimmt (nichts wird automatisch zusammengeführt).", level: "info" },
  "bestand-ohne-angebot": { label: "Lagerware ohne Angebot", hint: "Bestand im eigenen Lager, aber in keinem Kanal angeboten.", level: "info" },
};

export type Issue = { kind: IssueKind; sku: string; title: string | null; detail: string; href: string };

export type MappingInput = {
  /** Eigenes Lager je SKU (Menge). */
  ownStock: Map<string, number>;
  /** FBA-Bestand je SKU (verkaufbar + unterwegs). */
  fbaStock: Map<string, number>;
  lotSkus: Set<string>;
  setSkus: Set<string>;
  setComponents: Set<string>;
  listings: { channel: string; sku: string; stockSku: string | null; status: string; title: string | null }[];
  ebayTool: { sku: string | null; title: string | null; listingId: string | null; status: string }[];
  /** Verkaufte Kanal-SKUs (Aufträge der letzten Zeit). */
  sold: { sku: string; channel: string; units: number; title: string | null }[];
  costs: Map<string, CostInfo>;
  ekChecks: EkCheck[];
  eanAsins: { ean: string; asins: string[] }[];
  titles: Map<string, string>;
};

const stockSkuOf = (l: { sku: string; stockSku: string | null }) => l.stockSku?.trim() || l.sku;

export function mappingIssues(i: MappingInput): Issue[] {
  const out: Issue[] = [];
  const known = new Set([...i.ownStock.keys(), ...i.fbaStock.keys(), ...i.lotSkus, ...i.setSkus]);
  const listingSkus = new Set(i.listings.map((l) => l.sku));
  const listedStock = new Set(i.listings.map(stockSkuOf));
  const title = (sku: string, fallback?: string | null) => i.titles.get(sku) ?? fallback ?? null;
  const prod = (sku: string, tab?: string) => `/produkte/sku/${encodeURIComponent(sku)}${tab ? `?tab=${tab}` : ""}`;

  const soldBySku = new Map<string, { units: number; channels: Set<string>; title: string | null }>();
  for (const s of i.sold) {
    const e = soldBySku.get(s.sku) ?? { units: 0, channels: new Set<string>(), title: s.title };
    e.units += s.units;
    e.channels.add(s.channel);
    soldBySku.set(s.sku, e);
  }
  for (const [sku, s] of soldBySku) {
    if (known.has(sku) || listingSkus.has(sku)) continue;
    out.push({ kind: "verkauft-unbekannt", sku, title: title(sku, s.title), detail: `${s.units} verkauft (${[...s.channels].join(", ")})`, href: prod(sku) });
  }
  for (const l of i.listings) {
    if (l.status !== "active") continue;
    const s = stockSkuOf(l);
    if (known.has(s)) continue;
    out.push({ kind: "angebot-ohne-lager", sku: l.sku, title: title(s, l.title), detail: `${l.channel}${s !== l.sku ? ` · Lager-SKU ${s}` : ""}`, href: prod(s, "angebote") });
  }
  const ebayListed = new Set(i.listings.filter((l) => l.channel === "ebay").map((l) => l.sku));
  for (const e of i.ebayTool) {
    if (!e.sku || !e.listingId || !/^(published|active|veröffentlicht)$/i.test(e.status)) continue;
    if (ebayListed.has(e.sku) || known.has(e.sku)) continue;
    out.push({ kind: "ebay-nicht-in-wawi", sku: e.sku, title: e.title, detail: `eBay-Nr. ${e.listingId}`, href: "/listings/temu" });
  }
  const relevant = new Set<string>();
  for (const [sku, q] of i.ownStock) if (q > 0) relevant.add(sku);
  for (const [sku, q] of i.fbaStock) if (q > 0) relevant.add(sku);
  for (const sku of soldBySku.keys()) if (known.has(sku) || listingSkus.has(sku)) relevant.add(sku);
  for (const sku of relevant) {
    if (i.setSkus.has(sku) || i.costs.has(sku)) continue;
    const parts = [i.ownStock.get(sku) ? `${i.ownStock.get(sku)} im Lager` : null, i.fbaStock.get(sku) ? `${i.fbaStock.get(sku)} bei Amazon` : null, soldBySku.get(sku) ? `${soldBySku.get(sku)!.units} verkauft` : null].filter(Boolean);
    out.push({ kind: "ek-fehlt", sku, title: title(sku), detail: parts.join(" · "), href: prod(sku, "einkauf") });
  }
  for (const c of i.ekChecks) {
    if (!c.conflict) continue;
    out.push({ kind: "ek-abweichung", sku: c.sku, title: title(c.sku), detail: c.sources.map((s) => `${s.label} ${s.cost.toFixed(2).replace(".", ",")} €`).join(" · "), href: prod(c.sku, "einkauf") });
  }
  for (const e of i.eanAsins) {
    if (e.asins.length < 2) continue;
    out.push({ kind: "ean-mehrdeutig", sku: e.ean, title: null, detail: `ASINs: ${e.asins.join(", ")}`, href: `/produkte?q=${encodeURIComponent(e.ean)}` });
  }
  for (const [sku, q] of i.ownStock) {
    if (q <= 0 || listedStock.has(sku) || i.setComponents.has(sku)) continue;
    out.push({ kind: "bestand-ohne-angebot", sku, title: title(sku), detail: `${q} im Lager`, href: prod(sku) });
  }
  const order: IssueKind[] = ["verkauft-unbekannt", "angebot-ohne-lager", "ebay-nicht-in-wawi", "ek-fehlt", "ek-abweichung", "ean-mehrdeutig", "bestand-ohne-angebot"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.sku.localeCompare(b.sku));
}
