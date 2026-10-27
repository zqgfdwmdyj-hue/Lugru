import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { POSTER_THEMES, type IdeaResult } from "@/db/schema";
import { formatDate } from "@/lib/numbers";
import { collagePrice, packLabel } from "@/lib/layout";
import { publicText } from "@/lib/price-logic";

// Ideen für eine Verteilung: Themenpakete, Rezepte und ein Werbetext – aus den Produkten des Tages.
// Nur Text (keine Fotos, keine Websuche): Claude Sonnet, wenige Cent je Durchlauf.

export const IDEAS_MODEL = "claude-sonnet-5-5";
/** $ je 1 Mio. Token (Eingabe/Ausgabe) – nur für die Kostenanzeige */
const PRICE_IN = 2;
const PRICE_OUT = 10;
export const ideasCostUsd = (input: number | null, output: number | null) => ((input ?? 0) * PRICE_IN + (output ?? 0) * PRICE_OUT) / 1_000_000;

/** Vorschläge zum Antippen; der Monat entscheidet, welche saisonalen zuerst kommen. */
export function themeSuggestions(month: number): string[] {
  const seasonal: Record<number, string[]> = {
    1: ["Winterpaket", "Gesund ins neue Jahr"],
    2: ["Winterpaket", "Fasching"],
    3: ["Frühlingspaket", "Ostern"],
    4: ["Ostern", "Frühlingspaket"],
    5: ["Grillpaket", "Picknick"],
    6: ["Grillpaket", "Sommerpaket"],
    7: ["Sommerpaket", "Grillpaket"],
    8: ["Schulanfang", "Sommerpaket"],
    9: ["Schulanfang", "Herbstpaket"],
    10: ["Halloween", "Herbstpaket"],
    11: ["Winterpaket", "Sankt Martin"],
    12: ["Weihnachten", "Winterpaket"],
  };
  return [...(seasonal[month] ?? []), "Alles zusammen kochen", "Frühstückspaket", "Familienpaket", "Single-/Studentenpaket", "Baby & Kleinkind", "Schnell verbrauchen (MHD bald)"];
}

const SYSTEM = `Du hilfst einem Foodsharing-Team bei einer Lebensmittelverteilung: Gerettete Lebensmittel und Spenden werden gegen eine kleine Spende abgegeben.
Du bekommst die Produktliste des Tages (mit Spendenempfehlung je Stück, ggf. Spendenempfehlung für eine ganze Packung, Menge und Mindesthaltbarkeitsdatum) und Wünsche des Teams.
Mach die Verteilung schmackhaft: kreative, alltagstaugliche Ideen auf Deutsch, herzlich und kurz.
Regeln:
- Schreibe nie „Preis“, „kostet“ oder „kaufen“ – es sind Spendenempfehlungen („Spendenempfehlung“, „gegen eine kleine Spende“, „mitnehmen“).
- Verwende in Paketen, auf dem Plakat und als Hauptzutaten in Rezepten nur Produkte aus der Liste und schreibe die Produktnamen genau wie in der Liste.
- Nenne keine Beträge selbst – die Spendenempfehlungen setzt das Programm aus der Liste ein. Ausnahme: im Werbetext dürfen die Beträge aus der Liste stehen.
- Bei Rezepten darfst du übliche Grundzutaten ergänzen (Salz, Öl, Zwiebeln, Wasser …) – liste sie unter „zusaetzlich“.
- Produkte mit bald ablaufendem MHD bevorzugt einplanen und darauf hinweisen. Keine Gesundheitsversprechen.
- Babynahrung nur in Baby-/Familienpaketen, Drogerieartikel nicht in Rezepten.
Werbetext (für WhatsApp/Instagram): herzliche Anrede („Ihr Lieben“), 1–2 Sätze Einleitung zum Thema; gibt es Packungs-Spendenempfehlungen, eine Liste mit passendem Emoji je Zeile („🌭 Produkt – ganzer Karton: 5 €“); dann kurze Absätze zu Gruppen von Produkten; herzlicher Schluss. Emojis sparsam, aber passend.
Plakat (A4 zum Aushängen und Teilen): thema ist eines von ${POSTER_THEMES.join(", ")}. titel kurz und groß (max. 5 Wörter, z. B. „Bevorratet euch für den Winter!“), untertitel ein Satz, notiz ein kurzer Satz für einen Zettel am Rand.
hervorgehoben: 3–9 Produkte mit Foto-Kachel – bevorzugt solche mit Packungs-Spendenempfehlung. gruppen: 0–3 Gruppen weiterer Produkte mit kurzem Titel und einem Satz (z. B. „Wenn es mal schnell gehen muss …“). schluss: ein Satz für das Band unten.
Antworte nur mit JSON in genau diesem Aufbau:
{"titel": "kurzer, einladender Titel", "einleitung": "1–2 Sätze",
 "pakete": [{"name": "…", "beschreibung": "1–2 Sätze", "produkte": ["Produktname", "…"]}],
 "rezepte": [{"name": "…", "aus_der_verteilung": ["Produktname"], "zusaetzlich": ["…"], "anleitung": "3–6 kurze Sätze", "dauer": "z. B. 20 Min."}],
 "aktionstext": "fertiger Werbetext wie oben beschrieben",
 "tipps": ["kurzer Tipp für das Team"],
 "plakat": {"thema": "winter", "titel": "…", "untertitel": "…", "notiz": "…", "hervorgehoben": ["Produktname"], "gruppen": [{"titel": "…", "text": "…", "produkte": ["Produktname"]}], "schluss": "Wir freuen uns auf euch bei unserer nächsten Verteilung!"},
 "verwendung": [{"produkt": "Produktname", "ideen": ["kurze, konkrete Idee", "…"]}]}
Der Modus in der Anfrage sagt, welche Teile gefragt sind; nicht gefragte Teile leer lassen ([] bzw. null).
Verwendung: zu jedem Produkt 2–3 konkrete Ideen, wofür man es nutzen kann (bei Lebensmitteln Gerichte oder Kombinationen, bei Drogerie-/Haushaltsartikeln, Deko, DVDs usw. praktische Einsatzzwecke, Geschenkidee, für wen es sich eignet). Kurz und alltagsnah, je Idee höchstens ein Satz.`;

const Result = z.object({
  titel: z.string().default("Ideen für die Verteilung"),
  einleitung: z.string().default(""),
  pakete: z.array(z.object({ name: z.string(), beschreibung: z.string().default(""), produkte: z.array(z.string()).default([]) })).default([]),
  rezepte: z
    .array(z.object({ name: z.string(), aus_der_verteilung: z.array(z.string()).default([]), zusaetzlich: z.array(z.string()).default([]), anleitung: z.string().default(""), dauer: z.string().nullish() }))
    .default([]),
  aktionstext: z.string().default(""),
  tipps: z.array(z.string()).default([]),
  verwendung: z.array(z.object({ produkt: z.string(), ideen: z.array(z.string()).default([]) })).default([]),
  plakat: z
    .object({
      thema: z.enum(POSTER_THEMES).catch("allgemein"),
      titel: z.string().default("Unsere Spendenempfehlungen"),
      untertitel: z.string().default(""),
      notiz: z.string().default(""),
      hervorgehoben: z.array(z.string()).default([]),
      gruppen: z.array(z.object({ titel: z.string(), text: z.string().default(""), produkte: z.array(z.string()).default([]) })).default([]),
      schluss: z.string().default("Wir freuen uns auf euch bei unserer nächsten Verteilung!"),
    })
    .nullish()
    .catch(null),
});

export type IdeaProduct = { name: string; variant: string | null; category: string; price: number | null; priceNote: string | null; quantity: number | null; bestBefore: string | null; packs?: { label: string; price: number }[] };

export function productLines(items: IdeaProduct[]): string {
  return items
    .map((p) => {
      const name = [publicText(p.name), publicText(p.variant)].filter(Boolean).join(" ");
      const extra = [
        p.category,
        p.price !== null ? `Spendenempfehlung ${p.priceNote ? `${p.priceNote} ` : ""}${collagePrice(p.price)}` : "",
        packLabel(p.packs) ? `Packung: ${packLabel(p.packs)}` : "",
        p.quantity ? `Menge ${p.quantity}` : "",
        p.bestBefore ? `MHD ${formatDate(p.bestBefore)}` : "",
      ].filter(Boolean);
      return `- ${name} (${extra.join(", ")})`;
    })
    .join("\n");
}

/** Was die KI liefern soll: alles (Pakete, Rezepte, Plakat …), nur Rezepte oder Verwendungsideen je Produkt. */
export const IDEA_MODES = {
  alles: { label: "Alles", hint: "Pakete, Rezepte, Werbetext und Plakat", instruction: "Modus: Alles – 2–4 Pakete, 2–4 Rezepte, Werbetext, 1–3 Tipps und das Plakat. verwendung leer lassen." },
  rezepte: {
    label: "🍲 Rezept-Ideen",
    hint: "5–8 Rezepte aus den Produkten",
    instruction: "Modus: Rezept-Ideen – 5–8 abwechslungsreiche Rezepte (Frühstück, Hauptgericht, Snack, Süßes; auch einfache ohne Backofen), die möglichst viele Lebensmittel der Liste verwenden. Werbetext zu den Rezepten (z. B. „Was ihr mit unseren Schätzen kochen könnt“), 1–2 Tipps. pakete und verwendung leer, plakat null.",
  },
  verwendung: {
    label: "💡 Verwendungs-Ideen",
    hint: "Wofür man jedes Produkt nutzen kann",
    instruction: "Modus: Verwendungs-Ideen – verwendung für alle Produkte der Liste (gleiche Namen wie in der Liste), dazu ein kurzer Werbetext mit den schönsten Ideen und 1–2 Tipps. pakete und rezepte leer, plakat null.",
  },
} as const;
export type IdeaMode = keyof typeof IDEA_MODES;
export const isIdeaMode = (v: unknown): v is IdeaMode => typeof v === "string" && v in IDEA_MODES;

export async function generateIdeas(input: { dateLabel: string; items: IdeaProduct[]; themes: string[]; wish: string; mode?: IdeaMode }) {
  const client = new Anthropic();
  const wishes = [input.themes.length ? `Themen: ${input.themes.join(", ")}.` : "", input.wish ? `Wunsch des Teams: ${input.wish}` : ""].filter(Boolean).join("\n");
  const response = await client.beta.messages.create({
    model: IDEAS_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Verteilung am ${input.dateLabel}.\n\nProdukte:\n${productLines(input.items)}\n\n${wishes || "Keine besonderen Wünsche – schlage passende Themen zur Jahreszeit vor."}\n\n${IDEA_MODES[input.mode ?? "alles"].instruction}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Die KI hat die Anfrage abgelehnt.");
  if (response.stop_reason === "max_tokens") throw new Error("Die Antwort der KI war zu lang – bitte weniger Themen auf einmal wählen.");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Antwort der KI war unvollständig – bitte erneut versuchen.");
  const result: IdeaResult = Result.parse(JSON.parse(text.slice(start, end + 1)));
  return { result, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

/** Produkte eines Pakets mit Preisen aus der Verteilung zusammenführen (Namen der KI ungefähr zuordnen). */
export function matchProducts<T extends { name: string; variant: string | null }>(names: string[], items: T[]): { label: string; item: T | null }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return names.map((label) => {
    const n = norm(label);
    const item =
      items.find((i) => norm([i.name, i.variant].filter(Boolean).join(" ")) === n) ??
      items.find((i) => norm(i.name) === n) ??
      items.find((i) => n.includes(norm(i.name)) || norm(i.name).includes(n)) ??
      null;
    return { label, item };
  });
}
