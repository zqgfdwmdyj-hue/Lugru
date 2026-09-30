// KI-Aufträge für Marken: Ideen für Themenboxen/Produkte und Content (TikTok, YouTube Shorts).
// Ohne Server-Abhängigkeiten – Aufbau und Einlesen sind testbar.

import type { ChecklistItem } from "@/db/tables/brands";

export type BrandProfile = { name: string; description: string | null; audience: string | null; priceRange: string | null; tone: string | null };

export type IdeaDraft = {
  title: string;
  concept: string;
  contents: string[];
  targetPrice: number | null;
  costEstimate: number | null;
  why: string;
  sourcing: string;
  kind: "box" | "product" | "other";
};

export type ContentDraft = { format: string; hook: string; script: string; shots: string[]; caption: string; hashtags: string; soundIdea: string };

const profile = (b: BrandProfile) =>
  [`Marke: ${b.name}`, b.description && `Sortiment/Positionierung: ${b.description}`, b.audience && `Zielgruppe: ${b.audience}`, b.priceRange && `Preisrahmen: ${b.priceRange}`, b.tone && `Tonalität: ${b.tone}`]
    .filter(Boolean)
    .join("\n");

export function ideasPrompt(input: { brand: BrandProfile; occasion: { name: string; date: string } | null; existing: string[]; trends: string[]; count: number; wish?: string }): string {
  return [
    "Du bist Produktentwickler für einen kleinen Online-Händler (Amazon, eBay, TikTok Shop, eigener Shop) in Deutschland.",
    profile(input.brand),
    input.occasion ? `Anlass: ${input.occasion.name} am ${input.occasion.date}. Die Ideen müssen bis dahin realistisch umsetzbar sein (Einkauf, Verpackung, Listing, Content).` : "Anlass: ganzjährig.",
    input.wish ? `Wunsch/Schwerpunkt: ${input.wish}` : "",
    input.trends.length ? `Aktuelle Meldungen und Trends (nur als Anregung, nichts erfinden):\n${input.trends.slice(0, 25).map((t) => `- ${t}`).join("\n")}` : "",
    input.existing.length ? `Diese Ideen gibt es schon – nicht wiederholen:\n${input.existing.slice(0, 60).map((t) => `- ${t}`).join("\n")}` : "",
    "",
    `Schlage ${input.count} unterschiedliche, konkrete Ideen vor (Themenboxen, Sets oder Produkte). Achte auf Marge, einfache Beschaffung in Deutschland/EU, Versandfähigkeit (Gewicht, Hitze bei Schokolade), Lebensmittel-Kennzeichnung und darauf, was auf TikTok gut zeigbar ist.`,
    'Antworte NUR mit einem JSON-Array: [{"titel":"…","art":"box|product|other","konzept":"2-3 Sätze","inhalt":["…"],"vk_preis":29.99,"ek_schaetzung":12.5,"warum_jetzt":"1 Satz","beschaffung":"wo/wie einkaufen, 1-2 Sätze"}]',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function contentPrompt(input: { brand: BrandProfile; subject: { title: string; concept: string | null; contents: string[] }; platform: string; count: number; occasion: string | null }): string {
  return [
    `Du bist Social-Media-Producer für ${input.platform === "youtube" ? "YouTube (Shorts und Videos)" : input.platform === "instagram" ? "Instagram Reels" : "TikTok (inkl. TikTok Shop)"}.`,
    profile(input.brand),
    `Produkt/Box: ${input.subject.title}${input.subject.concept ? ` – ${input.subject.concept}` : ""}${input.subject.contents.length ? `\nInhalt: ${input.subject.contents.join(", ")}` : ""}`,
    input.occasion ? `Anlass: ${input.occasion}` : "",
    "",
    `Entwirf ${input.count} unterschiedliche Kurzvideo-Ideen (15–45 Sekunden), die mit Handy und wenig Aufwand drehbar sind: z. B. Unboxing, Geschmackstest/Reaktion, „Packt mit mir“, Vorher/Nachher, Fakten, POV, Trend-Format.`,
    "Starker Hook in den ersten 2 Sekunden, deutsch, zur Tonalität passend, keine gesundheits- oder wettbewerbsrechtlich heiklen Aussagen.",
    'Antworte NUR mit einem JSON-Array: [{"format":"…","hook":"erster Satz/Einblendung","skript":"gesprochener Text bzw. Ablauf","szenen":["Einstellung 1","…"],"caption":"…","hashtags":"#… #…","sound":"Musik-/Sound-Idee"}]',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** JSON-Array aus einer KI-Antwort holen – auch aus Codeblöcken und abgeschnittenen Antworten. */
export function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  if (start < 0) return [];
  const body = text.slice(start);
  for (const end of [body.lastIndexOf("]") + 1, body.lastIndexOf("}") + 1]) {
    if (end <= 0) continue;
    try {
      const v = JSON.parse(end === body.lastIndexOf("]") + 1 ? body.slice(0, end) : `${body.slice(0, end)}]`);
      if (Array.isArray(v)) return v;
    } catch {
      /* nächster Versuch */
    }
  }
  return [];
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
};
const list = (v: unknown, max = 30) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, max) : []);

export function parseIdeas(text: string): IdeaDraft[] {
  return extractJsonArray(text)
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((r) => ({
      title: str(r.titel ?? r.title, 200),
      concept: str(r.konzept ?? r.concept),
      contents: list(r.inhalt ?? r.contents),
      targetPrice: num(r.vk_preis),
      costEstimate: num(r.ek_schaetzung),
      why: str(r.warum_jetzt, 500),
      sourcing: str(r.beschaffung, 800),
      kind: (["box", "product", "other"].includes(String(r.art)) ? r.art : "box") as IdeaDraft["kind"],
    }))
    .filter((i) => i.title);
}

export function parseContent(text: string): ContentDraft[] {
  return extractJsonArray(text)
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((r) => ({
      format: str(r.format, 100),
      hook: str(r.hook, 300),
      script: str(r.skript ?? r.script, 3000),
      shots: list(r.szenen ?? r.shots, 20),
      caption: str(r.caption, 2200),
      hashtags: str(r.hashtags, 500),
      soundIdea: str(r.sound, 300),
    }))
    .filter((c) => c.hook);
}

/** Checkliste von der Idee bis zum Launch. */
export function checklistFor(kind: "box" | "product" | "other"): ChecklistItem[] {
  const box = ["Inhalt und Menge festlegen", "Lieferanten und EK klären (Einkauf)", "Muster bestellen und probieren", "Verpackung, Etikett, Lebensmittel-Kennzeichnung", "Fotos und Video drehen", "Listing anlegen (Amazon, eBay, TikTok Shop)", "Ware bestellen", "Content planen und posten", "Launch"];
  const product = ["Muster bei Lieferanten anfragen", "Muster prüfen (Qualität, Maße, Material)", "Kalkulation (EK, Gebühren, Versand, Marge)", "Branding / Logo / Verpackung", "Fotos und Video drehen", "YouTube-Video oder Short planen", "Listing anlegen", "Ware bestellen", "Launch"];
  const other = ["Idee ausarbeiten", "Kosten und Aufwand schätzen", "Umsetzen", "Launch"];
  return (kind === "box" ? box : kind === "product" ? product : other).map((text) => ({ text, done: false }));
}

export const IDEA_STATUS_LABEL: Record<string, [string, string]> = {
  idea: ["Idee", "tag-neutral"],
  review: ["Prüfen", "tag-info"],
  planned: ["Geplant", "tag-info"],
  in_progress: ["In Umsetzung", "tag-warn"],
  live: ["Live", "tag-ok"],
  rejected: ["Verworfen", "tag-neutral"],
};

export const CONTENT_STATUS_LABEL: Record<string, [string, string]> = {
  idea: ["Idee", "tag-neutral"],
  filmed: ["Gedreht", "tag-info"],
  edited: ["Geschnitten", "tag-info"],
  scheduled: ["Geplant", "tag-warn"],
  published: ["Veröffentlicht", "tag-ok"],
};
