// Shop-Analyse: eigene Amazon-Produkte (Keepa), TikTok-Shop-Daten (Helium-10-Export) und
// Hinweise, was sich am Angebot verbessern lässt. Ohne Server-Abhängigkeiten.

import type { OwnProductData, TikTokMarketItem } from "@/db/tables/brands";
import { parseKeepaProduct } from "./market";

const K_RATING = 16;

/** ASIN aus Eingabe: ASIN selbst oder Amazon-Link (…/dp/ASIN, …/gp/product/ASIN). */
export function asinFrom(input: string): string | null {
  const s = input.trim();
  const m = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(s) ?? /^([A-Z0-9]{10})$/i.exec(s);
  return m ? m[1].toUpperCase() : null;
}

export function parseKeepaOwn(p: Record<string, unknown>): OwnProductData | null {
  const base = parseKeepaProduct(p);
  if (!base) return null;
  const stats = (p.stats ?? {}) as { current?: number[]; buyBoxPrice?: number; buyBoxSellerId?: string | null; buyBoxIsAmazon?: boolean; buyBoxIsFBA?: boolean };
  const cur = stats.current ?? [];
  const rating = typeof cur[K_RATING] === "number" && cur[K_RATING] > 0 ? cur[K_RATING] / 10 : null;
  const images = Array.isArray(p.images) ? (p.images as { l?: string; m?: string }[]) : [];
  const img = images[0]?.l ?? images[0]?.m ?? (typeof p.imagesCSV === "string" ? p.imagesCSV.split(",")[0] : null);
  // Buy Box: mit buybox=1 liefert Keepa buyBoxPrice (−1 = keine Buy Box, −2 = unterdrückt) und den Verkäufer.
  const hasBuyBox = typeof stats.buyBoxPrice === "number" ? stats.buyBoxPrice > 0 : typeof cur[18] === "number" && cur[18] > 0 ? true : null;
  return {
    ...base,
    price: typeof stats.buyBoxPrice === "number" && stats.buyBoxPrice > 0 ? Math.round(stats.buyBoxPrice) / 100 : base.price,
    rating,
    hasBuyBox,
    buyBoxSellerId: typeof stats.buyBoxSellerId === "string" && stats.buyBoxSellerId ? stats.buyBoxSellerId : null,
    buyBoxIsAmazon: stats.buyBoxIsAmazon === true,
    buyBoxIsFBA: stats.buyBoxIsFBA === true,
    features: Array.isArray(p.features) ? (p.features as unknown[]).map(String).slice(0, 10) : [],
    imageUrl: img ? (img.startsWith("http") ? img : `https://m.media-amazon.com/images/I/${img}`) : null,
  };
}

/** Wer hat die Buy Box – ihr, Amazon oder jemand anderes? */
export function buyBoxHolder(d: OwnProductData, own: { sellerId: string | null; sellerName: string | null }): { level: "ok" | "warn" | "info"; text: string } | null {
  if (d.hasBuyBox === null) return null;
  if (d.hasBuyBox === false) return { level: "warn", text: "Keine Buy Box – Angebot prüfen (Bestand, Preis, Sperre?)." };
  if (d.buyBoxIsAmazon) return { level: "warn", text: "Die Buy Box hält Amazon selbst." };
  const name = d.buyBoxSellerName ?? d.buyBoxSellerId ?? "unbekannt";
  if (!d.buyBoxSellerId) return { level: "ok", text: "Buy Box vorhanden." };
  const norm = (x: string) => x.toLowerCase().replace(/gmbh|ug|&|und|\s|[.,-]/g, "");
  const byName = !own.sellerId && own.sellerName && d.buyBoxSellerName ? norm(own.sellerName) === norm(d.buyBoxSellerName) : null;
  if (own.sellerId || byName !== null) {
    return (own.sellerId ? own.sellerId === d.buyBoxSellerId : byName)
      ? { level: "ok", text: `Buy Box bei euch (${own.sellerName ?? name}${d.buyBoxIsFBA ? ", FBA" : ""}).` }
      : { level: "warn", text: `Die Buy Box hält ein anderer Verkäufer: ${name}${d.buyBoxIsFBA ? " (FBA)" : ""}.` };
  }
  return { level: "info", text: `Buy Box hält: ${name}${d.buyBoxIsFBA ? " (FBA)" : ""}.` };
}

// ---- Helium 10 TikTok-Erweiterung (CSV-Export) ---------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöü]/g, "");
function col(head: string[], ...names: string[]) {
  const n = head.map(norm);
  for (const name of names) {
    const i = n.findIndex((h) => h === norm(name));
    if (i >= 0) return i;
  }
  for (const name of names) {
    const i = n.findIndex((h) => h.includes(norm(name)));
    if (i >= 0) return i;
  }
  return -1;
}
function num(v: string | undefined): number | null {
  if (!v) return null;
  let s = v.replace(/[€$%\s]/g, "");
  const k = /^([\d.,]+)\s*([kKmM])$/.exec(s);
  if (k) {
    const n = Number(k[1].replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * (/k/i.test(k[2]) ? 1000 : 1_000_000)) : null;
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Spalten werden am Namen erkannt (englisch oder deutsch). */
export function parseTikTokExport(rows: string[][]): TikTokMarketItem[] {
  const head = rows[0] ?? [];
  const c = {
    title: col(head, "Product Name", "Product Title", "Title", "Product", "Produktname", "Produkt"),
    shop: col(head, "Shop Name", "Shop", "Seller", "Store", "Verkäufer"),
    price: col(head, "Price", "Preis"),
    sales: col(head, "Units Sold", "Sales", "Sold", "Verkäufe", "Verkauft"),
    revenue: col(head, "Revenue", "GMV", "Umsatz"),
    rating: col(head, "Rating", "Bewertung"),
    reviews: col(head, "Review Count", "Reviews", "Rezensionen"),
    videos: col(head, "Videos", "Video Count"),
    creators: col(head, "Creators", "Influencers", "Affiliates"),
    url: col(head, "URL", "Link", "Product URL"),
  };
  if (c.title < 0) throw new Error("In der Datei fehlt eine Spalte mit dem Produktnamen – bitte den TikTok-Export aus Helium 10 verwenden.");
  const get = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);
  return rows
    .slice(1)
    .map((r) => ({
      title: (get(r, c.title) ?? "").trim().slice(0, 200),
      shop: get(r, c.shop)?.trim() || null,
      price: num(get(r, c.price)),
      sales: num(get(r, c.sales)),
      revenue: num(get(r, c.revenue)),
      rating: num(get(r, c.rating)),
      reviews: num(get(r, c.reviews)),
      videos: num(get(r, c.videos)),
      creators: num(get(r, c.creators)),
      url: get(r, c.url)?.trim() || null,
    }))
    .filter((i) => i.title)
    .slice(0, 500);
}

// ---- Hinweise zur Optimierung ---------------------------------------------------------------

export type Snapshot = { day: string; price: number | null; salesRank: number | null; reviews: number | null; rating: number | null };
export type Hint = { level: "warn" | "info" | "ok"; text: string };

export function productHints(d: OwnProductData, history: Snapshot[], competitorPrice: number | null, own: { sellerId: string | null; sellerName: string | null } = { sellerId: null, sellerName: null }): Hint[] {
  const out: Hint[] = [];
  const bb = buyBoxHolder(d, own);
  if (bb && bb.level !== "ok") out.push(bb);
  if (d.rating !== null && d.rating < 4.2) out.push({ level: "warn", text: `Bewertung nur ${d.rating.toLocaleString("de-DE")} Sterne – Kritik in den Rezensionen lesen und Produkt/Beschreibung anpassen.` });
  if (d.reviews !== null && d.reviews < 20) out.push({ level: "info", text: `Erst ${d.reviews ?? 0} Bewertungen – Amazon Vine oder Einleger mit Bitte um Bewertung (ohne Anreiz) nutzen.` });
  if (d.title.length < 80) out.push({ level: "info", text: "Titel ist kurz – wichtige Suchbegriffe (Anlass, Menge, Sorten, „Geschenk“) ergänzen." });
  if (d.title.length > 180) out.push({ level: "info", text: "Titel ist sehr lang – Amazon kürzt auf dem Handy; das Wichtigste nach vorn." });
  if (d.features.length < 5) out.push({ level: "info", text: `Nur ${d.features.length} Stichpunkte – fünf aussagekräftige Stichpunkte nutzen.` });
  if (competitorPrice && d.price && d.price > competitorPrice * 1.25) out.push({ level: "info", text: `Preis liegt deutlich über vergleichbaren Produkten (Median ${competitorPrice.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}).` });
  const old = history.find((h) => Date.parse(h.day) <= Date.now() - 28 * 86400_000 && h.salesRank);
  if (old?.salesRank && d.salesRank) {
    const change = d.salesRank / old.salesRank;
    if (change > 1.5) out.push({ level: "warn", text: `Verkaufsrang hat sich in 4 Wochen deutlich verschlechtert (${old.salesRank.toLocaleString("de-DE")} → ${d.salesRank.toLocaleString("de-DE")}).` });
    else if (change < 0.67) out.push({ level: "ok", text: `Verkaufsrang hat sich in 4 Wochen deutlich verbessert (${old.salesRank.toLocaleString("de-DE")} → ${d.salesRank.toLocaleString("de-DE")}).` });
  }
  if (bb?.level === "ok") out.unshift(bb);
  if (!out.some((h) => h.level === "warn")) out.push({ level: "ok", text: "Keine Auffälligkeiten." });
  return out;
}

export function listingPrompt(input: { brand: string; tone: string | null; d: OwnProductData; tiktokTop: string[] }): string {
  return [
    "Du optimierst Amazon-Angebote (amazon.de) für einen kleinen Markenhändler.",
    `Marke: ${input.brand}${input.tone ? ` · Tonalität: ${input.tone}` : ""}`,
    `Aktueller Titel: ${input.d.title}`,
    input.d.features.length ? `Aktuelle Stichpunkte:\n${input.d.features.map((f) => `- ${f}`).join("\n")}` : "Keine Stichpunkte.",
    `Kennzahlen: Preis ${input.d.price ?? "?"} €, Rang ${input.d.salesRank ?? "?"}, ${input.d.reviews ?? 0} Bewertungen, ${input.d.rating ?? "?"} Sterne.`,
    input.tiktokTop.length ? `Gerade gefragt auf TikTok Shop (Anregung für Suchbegriffe):\n${input.tiktokTop.slice(0, 10).map((t) => `- ${t}`).join("\n")}` : "",
    "",
    "Schreib auf Deutsch: 1) einen neuen Titel (max. 180 Zeichen, wichtigste Suchbegriffe vorn, Marke am Anfang), 2) fünf Stichpunkte (je max. 250 Zeichen, Nutzen zuerst, GROSS geschriebener Einstieg), 3) 10 Backend-Suchbegriffe (ohne Wiederholungen aus dem Titel), 4) drei kurze Tipps für Bilder/A+.",
    "Keine Gesundheitsversprechen, keine Superlative wie „das beste“, keine Wettbewerber-Marken. Nur Klartext mit Überschriften, kein Markdown außer „- “.",
  ]
    .filter(Boolean)
    .join("\n");
}
