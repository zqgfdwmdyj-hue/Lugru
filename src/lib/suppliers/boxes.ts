// Boxen/Bundles aus Lieferanten-Artikeln: KI wählt Artikel und Mengen, gerechnet wird exakt mit den
// Einzelpreisen. Ohne Server-Abhängigkeiten.

import { extractJsonArray, profile, type BrandProfile } from "@/lib/brands/ai";
import { calcProfit } from "@/lib/brands/market";

export type CatalogItem = {
  nr: number;
  offerId: string;
  title: string;
  /** EK je Einheit inkl. Nebenkosten-Aufschlag. */
  unitCost: number;
  unitSize: string | null;
  amazonPrice: number | null;
  monthlySold: number | null;
};

export type BoxDraft = { title: string; concept: string; items: { nr: number; qty: number }[]; targetPrice: number | null; why: string; hook: string };

export function boxPrompt(input: { brand: BrandProfile; occasion: { name: string; date: string } | null; trends: string[]; catalog: CatalogItem[]; count: number; wish?: string; packaging: number; existing: string[] }): string {
  return [
    "Du stellst für einen Online-Händler in Deutschland verkaufsfertige Themenboxen/Bundles für Amazon.de (und TikTok Shop) zusammen.",
    profile(input.brand),
    input.occasion ? `Anlass: ${input.occasion.name} am ${input.occasion.date}.` : "Anlass: ganzjährig.",
    input.wish ? `Wunsch/Schwerpunkt: ${input.wish}` : "",
    input.trends.length ? `Was sich gerade verkauft/trendet (TikTok Shop, Meldungen) – als Orientierung:\n${input.trends.slice(0, 20).map((t) => `- ${t}`).join("\n")}` : "",
    input.existing.length ? `Diese Boxen gibt es schon – nicht wiederholen:\n${input.existing.slice(0, 40).map((t) => `- ${t}`).join("\n")}` : "",
    "",
    "Verfügbare Artikel (Nr | Artikel | EK je Einheit in € | Amazon.de-Preis der Einheit, falls bekannt | Verkäufe/Monat):",
    ...input.catalog.map((c) => `${c.nr} | ${c.title}${c.unitSize ? ` [${c.unitSize}]` : ""} | ${c.unitCost.toFixed(2)} | ${c.amazonPrice ?? "-"} | ${c.monthlySold ?? "-"}`),
    "",
    `Stelle ${input.count} unterschiedliche Boxen zusammen – NUR aus Artikeln der Liste (per Nr), Mengen in Einheiten.`,
    `Regeln: 5–15 Einheiten je Box, abwechslungsreich (Geschmack, Marke, Form), stimmiges Thema, das sich auf TikTok gut zeigen lässt. Verpackung kostet ${input.packaging.toFixed(2)} € je Box.`,
    "Verkaufspreis realistisch für Amazon.de wählen (Brutto, typische Themenboxen 15–45 €); Ziel: nach Provision (15 %), FBA-Gebühr (~4–6 €) und Einkauf mindestens 25 % Marge.",
    'Antworte NUR mit einem JSON-Array: [{"titel":"Box-Name für Amazon","konzept":"2 Sätze: Thema, Zielgruppe, Anlass","artikel":[{"nr":1,"menge":2}],"vk_preis":29.99,"warum":"1 Satz: warum sich das jetzt verkauft (Trend/TikTok-Bezug)","tiktok_hook":"erster Satz für ein Unboxing-Video"}]',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 10000 ? Math.round(n * 100) / 100 : null;
};

/** KI-Antwort lesen; nur Artikel, die es im Katalog gibt; gleiche Nr zusammenfassen. */
export function parseBoxes(text: string, catalog: CatalogItem[]): BoxDraft[] {
  const known = new Set(catalog.map((c) => c.nr));
  return extractJsonArray(text).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const title = str(r.titel ?? r.title, 200);
    const qty = new Map<number, number>();
    for (const a of Array.isArray(r.artikel ?? r.items) ? ((r.artikel ?? r.items) as unknown[]) : []) {
      const o = (a ?? {}) as Record<string, unknown>;
      const nr = Number(o.nr);
      const q = Math.round(Number(o.menge ?? o.qty ?? 1));
      if (known.has(nr) && q > 0 && q <= 50) qty.set(nr, (qty.get(nr) ?? 0) + q);
    }
    if (!title || qty.size === 0) return [];
    return [{ title, concept: str(r.konzept ?? r.concept), items: [...qty].map(([nr, q]) => ({ nr, qty: q })), targetPrice: num(r.vk_preis ?? r.price), why: str(r.warum ?? r.why, 500), hook: str(r.tiktok_hook ?? r.hook, 300) }];
  });
}

export type BoxCalc = { goods: number; cost: number; units: number; lines: string[]; profit: ReturnType<typeof calcProfit> | null };

/** Exakte Kalkulation: Einkauf aus Einzelpreisen + Verpackung, Gewinn nach Amazon-Provision und FBA. */
export function calcBox(box: BoxDraft, catalog: CatalogItem[], opts: { packaging: number; vatRate: number; fbaFee: number; referralPct?: number }): BoxCalc {
  const byNr = new Map(catalog.map((c) => [c.nr, c]));
  let goods = 0;
  let units = 0;
  const lines: string[] = [];
  for (const { nr, qty } of box.items) {
    const c = byNr.get(nr)!;
    goods += c.unitCost * qty;
    units += qty;
    lines.push(`${qty}× ${c.title} (je ${c.unitCost.toFixed(2).replace(".", ",")} €)`);
  }
  goods = Math.round(goods * 100) / 100;
  const cost = Math.round((goods + opts.packaging) * 100) / 100;
  const profit = box.targetPrice ? calcProfit({ price: box.targetPrice, cost, vatRate: opts.vatRate, referralPct: opts.referralPct ?? 15, fbaFee: opts.fbaFee }, "fba") : null;
  return { goods, cost, units, lines, profit };
}
