// EK-/VK-Verlauf und Kalkulation je Lieferantenangebot – reine Logik, testbar ohne Datenbank.

import type { FeedMapping } from "@/db/schema";

// ---- Spalten einer Preisliste automatisch erkennen ----------------------------------------

const norm = (h: string) =>
  h
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[€$£]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Mögliche Spaltennamen je Feld (Großhandelslisten, Qogita-Export, B2B-Shops). Reihenfolge = Vorrang. */
const ALIASES: Record<keyof Pick<FeedMapping, "ean" | "asin" | "supplierSku" | "title" | "price" | "stock" | "moq" | "url">, RegExp[]> = {
  ean: [/^(ean|gtin|ean13|ean 13|gtin13|barcode|upc|ean code|ean nummer|ean nr|gtin ean)$/, /\b(ean|gtin|barcode)\b/],
  asin: [/^asin$/],
  supplierSku: [/^(sku|artikelnummer|art nr|artnr|art no|item no|item number|article number|artikel nr|product code|productcode|referenz|ref|mpn|vendor sku|supplier sku)$/, /\b(artikelnummer|item no|sku)\b/],
  title: [/^(name|titel|title|bezeichnung|artikelbezeichnung|produktname|product name|product|description|beschreibung|artikel)$/, /\b(name|bezeichnung|title|product)\b/],
  price: [
    /^(preis|price|ek|einkaufspreis|netto|net price|nettopreis|unit price|stuckpreis|hap|haendlerpreis|wholesale price|your price)$/,
    /lowest price/,
    /\b(ek|einkauf|net|netto|wholesale|unit price|stuckpreis|preis|price)\b/,
  ],
  stock: [/^(bestand|stock|lager|lagerbestand|verfugbar|verfuegbar|available|availability|qty|quantity|menge|inventory|stock qty)$/, /inventory|bestand|stock|verfug/],
  moq: [/^(moq|mindestabnahme|mindestmenge|min order|min order qty|minimum order quantity|min qty|vpe|verpackungseinheit|pack size|case qty|karton)$/, /\b(moq|mindest|minimum order)\b/],
  url: [/^(url|link|produktlink|product url|product link)$/, /\b(url|link)\b/],
};

/** Spaltenzuordnung raten – eine schon gespeicherte Zuordnung hat Vorrang. */
export function autoMapping(headers: string[], saved: FeedMapping = {}): FeedMapping {
  const normalized = headers.map(norm);
  const used = new Set<number>();
  const out: FeedMapping = { ...saved };
  for (const [field, patterns] of Object.entries(ALIASES) as [keyof typeof ALIASES, RegExp[]][]) {
    if (saved[field] && headers.includes(saved[field]!)) {
      used.add(headers.indexOf(saved[field]!));
      continue;
    }
    let hit = -1;
    for (const re of patterns) {
      hit = normalized.findIndex((h, i) => !used.has(i) && re.test(h));
      if (hit >= 0) break;
    }
    if (hit >= 0) {
      out[field] = headers[hit];
      used.add(hit);
    }
  }
  // Ohne eigene Artikelnummer dient die EAN als Schlüssel.
  if (!out.supplierSku && out.ean) out.supplierSku = out.ean;
  return out;
}

// ---- EAN und Zugang -------------------------------------------------------------------------

/** EAN vereinheitlichen: UPC (12) bekommt die führende 0 wie bei Keepa, GTIN-14 mit führender 0 wird zur EAN-13. */
export const normEan = (v: string | undefined | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length < 8 || d.length > 14) return null;
  return d.length === 12 ? `0${d}` : d.length === 14 && d.startsWith("0") ? d.slice(1) : d;
};

/** Suchtext ist eine EAN (nur Ziffern, Leer- und Bindestriche) – nicht „Parfum 50ml 2024 …“. */
export const looksLikeEan = (term: string) => /^[\d\s-]+$/.test(term.trim()) && normEan(term) !== null;

/** Zugang aus dem Feld: „Bearer xyz“, „Basic …“, „Benutzer:Passwort“ oder eine Kopfzeile „Name: Wert“. */
export function authHeaders(raw: string | null): Record<string, string> {
  const a = (raw ?? "").trim();
  if (!a) return {};
  if (/^(bearer|basic|token)\s/i.test(a)) return { Authorization: a };
  const header = /^([A-Za-z0-9-]+):\s+(.+)$/.exec(a);
  if (header) return { [header[1]]: header[2] };
  if (/^[^:\s]+:[^\s]+$/.test(a)) return { Authorization: `Basic ${Buffer.from(a).toString("base64")}` };
  return { Authorization: `Bearer ${a}` };
}


// ---- Verlauf ---------------------------------------------------------------------------------

export type PricePoint = { day: string; price: number | null };

export type PriceStats = {
  low: number | null;
  lowDay: string | null;
  /** Aktueller Preis ist der günstigste seit so vielen Tagen (null = kein Verlauf). */
  cheapestForDays: number | null;
  /** So viel Prozent über dem bisherigen Tief. */
  aboveLowPct: number | null;
  /** Veränderung gegenüber dem Stand vor ~30 Tagen (in %). */
  change30Pct: number | null;
  /** Tage mit Verlauf. */
  days: number;
};

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function priceStats(history: PricePoint[], current: number | null, today: string): PriceStats {
  const pts = history.filter((p): p is { day: string; price: number } => p.price !== null).sort((a, b) => a.day.localeCompare(b.day));
  if (!pts.length || current === null) return { low: null, lowDay: null, cheapestForDays: null, aboveLowPct: null, change30Pct: null, days: pts.length };
  let low = pts[0];
  for (const p of pts) if (p.price < low.price || (p.price === low.price && p.day > low.day)) low = p;
  // Wie lange war der Preis nie günstiger als jetzt?
  const cheaperBefore = [...pts].reverse().find((p) => p.price < current - 0.005 && p.day < today);
  const first = pts[0].day;
  const cheapestForDays = cheaperBefore ? dayDiff(cheaperBefore.day, today) : dayDiff(first, today);
  const before30 = [...pts].reverse().find((p) => dayDiff(p.day, today) >= 28);
  return {
    low: Math.min(low.price, current),
    lowDay: current <= low.price ? today : low.day,
    cheapestForDays,
    aboveLowPct: low.price > 0 && current > low.price + 0.005 ? r1(((current - low.price) / low.price) * 100) : 0,
    change30Pct: before30 && before30.price > 0 ? r1(((current - before30.price) / before30.price) * 100) : null,
    days: pts.length,
  };
}

/** Kurzer Hinweis wie im Screenshot: „günstigster Stand seit 26 Tagen“ oder „27 % über deinem Tief (13,76 €)“. */
export function priceHint(s: PriceStats): { text: string; tone: "good" | "bad" | "neutral" } | null {
  if (s.days < 2 || s.low === null) return null;
  if (s.aboveLowPct === 0 && s.cheapestForDays !== null && s.cheapestForDays >= 2) return { text: `günstigster Stand seit ${s.cheapestForDays} Tagen`, tone: "good" };
  if (s.aboveLowPct && s.aboveLowPct > 0) return { text: `${s.aboveLowPct.toLocaleString("de-DE")} % über deinem Tief (${s.low.toFixed(2).replace(".", ",")} €)`, tone: "bad" };
  return null;
}

/** Punkte für eine kleine Verlaufskurve (SVG-Pfad in einer Box w×h). */
export function sparkPath(points: PricePoint[], w = 80, h = 18): string | null {
  const pts = points.filter((p): p is { day: string; price: number } => p.price !== null).sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length < 2) return null;
  const t0 = Date.parse(pts[0].day);
  const span = Math.max(1, Date.parse(pts[pts.length - 1].day) - t0);
  const min = Math.min(...pts.map((p) => p.price));
  const max = Math.max(...pts.map((p) => p.price));
  const y = (v: number) => (max === min ? h / 2 : h - 1 - ((v - min) / (max - min)) * (h - 2));
  // Treppenkurve: Preis gilt bis zur nächsten Änderung.
  let d = "";
  pts.forEach((p, i) => {
    const x = ((Date.parse(p.day) - t0) / span) * w;
    d += i === 0 ? `M0 ${y(p.price).toFixed(1)}` : ` H${x.toFixed(1)} V${y(p.price).toFixed(1)}`;
  });
  return `${d} H${w}`;
}

// ---- Kalkulation je Angebot -------------------------------------------------------------------

export type OfferCalcInput = {
  price: number | null;
  /** Preis der Liste ist brutto. */
  gross: boolean;
  /** USt-Satz als Anteil, z. B. 0.19. */
  vatRate: number;
  /** Aufschlag in % (Versand, Zoll …). */
  costPct: number;
  /** Stück je Preis-Einheit (Karton). */
  caseQty: number;
  /** Amazon-Verkaufspreis brutto. */
  sale: number | null;
  fbaFee: number;
  /** Anteil, z. B. 0.15. */
  referralRate: number;
  /** Lieferanten-Einheiten je Amazon-Verkauf (z. B. 2 beim „2er Set“) – Standard 1. */
  unitsPerSale?: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Netto-EK je Verkaufseinheit, Gewinn und ROI – Amazon-Provision vom Bruttopreis. */
export function offerCalc(i: OfferCalcInput): { unitNet: number | null; profit: number | null; roi: number | null; costPerSale?: number } {
  if (i.price === null) return { unitNet: null, profit: null, roi: null };
  const net = i.gross ? i.price / (1 + i.vatRate) : i.price;
  const unitNet = r2((net * (1 + i.costPct / 100)) / Math.max(1, i.caseQty));
  // EK eines Amazon-Verkaufs: so viele Einheiten, wie das Amazon-Angebot enthält.
  const units = Math.max(1, Math.round(i.unitsPerSale ?? 1));
  const cost = r2(unitNet * units);
  if (i.sale === null) return { unitNet, profit: null, roi: null, ...(units > 1 ? { costPerSale: cost } : {}) };
  const profit = r2(i.sale / (1 + i.vatRate) - i.sale * i.referralRate - i.fbaFee - cost);
  return { unitNet, profit, roi: cost > 0 ? r1((profit / cost) * 100) : null, ...(units > 1 ? { costPerSale: cost } : {}) };
}

/** Wann eine Keepa-Abfrage für eine EAN fällig ist: neu zuerst, dann geänderter EK, dann älteste. */
export function keepaPriority(o: { checkedAt: string | null; priceChangedAt: string | null; now: string; maxAgeDays: number }): number | null {
  if (!o.checkedAt) return 0;
  if (o.priceChangedAt && o.priceChangedAt > o.checkedAt) return 1;
  const age = (Date.parse(o.now) - Date.parse(o.checkedAt)) / 86_400_000;
  return age >= o.maxAgeDays ? 2 + Math.min(1, 1 / age) : null;
}
