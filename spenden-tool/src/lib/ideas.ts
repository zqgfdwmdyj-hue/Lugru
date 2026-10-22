import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { IdeaResult } from "@/db/schema";
import { formatDate } from "@/lib/numbers";
import { collagePrice } from "@/lib/layout";

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
Du bekommst die Produktliste des Tages (mit Spendenpreis, Menge und Mindesthaltbarkeitsdatum, soweit bekannt) und Wünsche des Teams.
Mach die Verteilung schmackhaft: kreative, alltagstaugliche Ideen auf Deutsch, herzlich und kurz.
Regeln:
- Verwende in Paketen und als Hauptzutaten in Rezepten nur Produkte aus der Liste und schreibe die Produktnamen genau wie in der Liste.
- Bei Rezepten darfst du übliche Grundzutaten ergänzen (Salz, Öl, Zwiebeln, Wasser …) – liste sie unter „zusaetzlich“.
- Produkte mit bald ablaufendem MHD bevorzugt einplanen und darauf hinweisen. Keine Gesundheitsversprechen.
- Babynahrung nur in Baby-/Familienpaketen, Drogerieartikel nicht in Rezepten.
Antworte nur mit JSON in genau diesem Aufbau:
{"titel": "kurzer, einladender Titel", "einleitung": "1–2 Sätze",
 "pakete": [{"name": "…", "beschreibung": "1–2 Sätze", "produkte": ["Produktname", "…"]}],
 "rezepte": [{"name": "…", "aus_der_verteilung": ["Produktname"], "zusaetzlich": ["…"], "anleitung": "3–6 kurze Sätze", "dauer": "z. B. 20 Min."}],
 "aktionstext": "fertiger Text für WhatsApp/Instagram, 3–6 Zeilen, gern mit 1–3 Emojis",
 "tipps": ["kurzer Tipp für das Team, z. B. wie man die Pakete am Stand präsentiert"]}
2–4 Pakete, 2–4 Rezepte, 1–3 Tipps.`;

const Result = z.object({
  titel: z.string().default("Ideen für die Verteilung"),
  einleitung: z.string().default(""),
  pakete: z.array(z.object({ name: z.string(), beschreibung: z.string().default(""), produkte: z.array(z.string()).default([]) })).default([]),
  rezepte: z
    .array(z.object({ name: z.string(), aus_der_verteilung: z.array(z.string()).default([]), zusaetzlich: z.array(z.string()).default([]), anleitung: z.string().default(""), dauer: z.string().nullish() }))
    .default([]),
  aktionstext: z.string().default(""),
  tipps: z.array(z.string()).default([]),
});

export type IdeaProduct = { name: string; variant: string | null; category: string; price: number | null; priceNote: string | null; quantity: number | null; bestBefore: string | null };

export function productLines(items: IdeaProduct[]): string {
  return items
    .map((p) => {
      const name = [p.name, p.variant].filter(Boolean).join(" ");
      const extra = [
        p.category,
        p.price !== null ? `${p.priceNote ? `${p.priceNote} ` : ""}${collagePrice(p.price)}` : "",
        p.quantity ? `Menge ${p.quantity}` : "",
        p.bestBefore ? `MHD ${formatDate(p.bestBefore)}` : "",
      ].filter(Boolean);
      return `- ${name} (${extra.join(", ")})`;
    })
    .join("\n");
}

export async function generateIdeas(input: { dateLabel: string; items: IdeaProduct[]; themes: string[]; wish: string }) {
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
        content: `Verteilung am ${input.dateLabel}.\n\nProdukte:\n${productLines(input.items)}\n\n${wishes || "Keine besonderen Wünsche – schlage passende Themen zur Jahreszeit vor."}`,
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
