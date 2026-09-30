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

export type BoxDraft = { title: string; concept: string; items: { nr: number; qty: number }[]; targetPrice: number | null; why: string; hook: string; searchTerm: string };

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
    'Antworte NUR mit einem JSON-Array: [{"titel":"Box-Name für Amazon","konzept":"2 Sätze: Thema, Zielgruppe, Anlass","artikel":[{"nr":1,"menge":2}],"vk_preis":29.99,"warum":"1 Satz: warum sich das jetzt verkauft (Trend/TikTok-Bezug)","tiktok_hook":"erster Satz für ein Unboxing-Video","amazon_suchbegriff":"2–4 Wörter, mit denen man vergleichbare Boxen auf amazon.de findet"}]',
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
    return [{ title, concept: str(r.konzept ?? r.concept), items: [...qty].map(([nr, q]) => ({ nr, qty: q })), targetPrice: num(r.vk_preis ?? r.price), why: str(r.warum ?? r.why, 500), hook: str(r.tiktok_hook ?? r.hook, 300), searchTerm: str(r.amazon_suchbegriff ?? r.searchTerm, 80) || title.split(/\s+/).slice(0, 4).join(" ") }];
  });
}

export type BoxCalc = { goods: number; cost: number; units: number; lines: string[]; profit: ReturnType<typeof calcProfit> | null };

/** Exakte Kalkulation: Einkauf aus Einzelpreisen + Verpackung, Gewinn nach Amazon-Provision und FBA. */
export function calcBox(box: BoxDraft, catalog: CatalogItem[], opts: { packaging: number; vatRate: number; fbaFee: number; referralPct?: number; storageFee?: number }): BoxCalc {
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
  const profit = box.targetPrice ? calcProfit({ price: box.targetPrice, cost, vatRate: opts.vatRate, referralPct: opts.referralPct ?? 15, fbaFee: opts.fbaFee, storageFee: opts.storageFee }, "fba") : null;
  return { goods, cost, units, lines, profit };
}

export type MarketHint = { count: number; price: number | null; priceLow: number | null; priceHigh: number | null; fbaFee: number | null; referralPct: number | null; monthlySold: number | null };

/**
 * Verkaufspreis und Gebühren für die Kalkulation: Amazon-Vergleich (Keepa) schlägt Schätzwerte.
 * VK: KI-Vorschlag, aber in die Spanne vergleichbarer Boxen geholt; ohne KI-Preis der Median.
 */
export function pricingFor(aiPrice: number | null, m: MarketHint | null, fallbackFba: number): { price: number | null; fbaFee: number; referralPct: number; note: string | null } {
  const fbaFee = m?.fbaFee ?? fallbackFba;
  const referralPct = m?.referralPct ?? 15;
  if (!m || !m.count || m.price === null) return { price: aiPrice, fbaFee, referralPct, note: null };
  let price = aiPrice ?? m.price;
  let note: string | null = null;
  if (m.priceHigh !== null && price > m.priceHigh * 1.15) {
    note = `KI-Preis ${aiPrice?.toFixed(2)} € lag deutlich über vergleichbaren Boxen – auf ${m.priceHigh.toFixed(2)} € gesetzt.`;
    price = m.priceHigh;
  }
  return { price: Math.round(price * 100) / 100, fbaFee, referralPct, note };
}

/** Wie viel Ware (EK) darf eine Box kosten, damit bei diesem VK die Zielmarge bleibt? */
export function goodsBudget(o: { price: number; vatRate: number; referralPct: number; fbaFee: number; packaging: number; targetMarginPct?: number }): number {
  const net = o.price / (1 + o.vatRate / 100);
  const b = net - o.price * (o.referralPct / 100) - o.fbaFee - o.packaging - o.price * ((o.targetMarginPct ?? 25) / 100);
  return Math.max(0, Math.round(b * 100) / 100);
}

/** Zweite Runde: unrentable Boxen mit festem Warenbudget neu zusammenstellen lassen. */
export function repairPrompt(input: { catalog: CatalogItem[]; boxes: { title: string; concept: string; price: number; budget: number; current: number }[] }): string {
  return [
    "Diese Themenboxen sind so nicht rentabel. Stelle jede Box NEU zusammen – gleiches Thema, gleicher Name, aber der Wareneinsatz (Summe EK je Einheit × Menge) muss unter dem Budget bleiben.",
    ...input.boxes.map((b, n) => `${n + 1}. „${b.title}“ – ${b.concept} · VK ${b.price.toFixed(2)} € · Budget Ware max. ${b.budget.toFixed(2)} € (bisher ${b.current.toFixed(2)} €)`),
    "",
    "Verfügbare Artikel (Nr | Artikel | EK je Einheit in €):",
    ...input.catalog.map((c) => `${c.nr} | ${c.title}${c.unitSize ? ` [${c.unitSize}]` : ""} | ${c.unitCost.toFixed(2)}`),
    "",
    "Regeln: günstige Einheiten bevorzugen, trotzdem 5–15 Einheiten und abwechslungsreich. Ist das Budget nicht einzuhalten, lieber weniger, aber stimmige Teile.",
    'Antworte NUR mit einem JSON-Array in derselben Reihenfolge: [{"titel":"…","konzept":"…","artikel":[{"nr":1,"menge":2}],"vk_preis":29.99,"warum":"…","tiktok_hook":"…","amazon_suchbegriff":"…"}]',
  ].join("\n");
}
