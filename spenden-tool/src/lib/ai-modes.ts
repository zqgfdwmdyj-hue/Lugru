// Drei Stufen für die KI-Recherche – vom fast kostenlosen Erkennen bis zur genauen Preissuche.
// Preise: US-Dollar je Million Token (Eingabe/Ausgabe), Websuche 10 $ je 1000 Suchen.

export const AI_MODES = ["erkennen", "sparsam", "genau"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const AI_MODE_INFO: Record<AiMode, { label: string; hint: string; model: string; inPrice: number; outPrice: number; searches: number }> = {
  erkennen: {
    label: "Nur Namen erkennen",
    hint: "Produkt auf dem Foto erkennen, ohne Preissuche – fast kostenlos",
    model: "claude-haiku-4-5",
    inPrice: 1,
    outPrice: 5,
    searches: 0,
  },
  sparsam: {
    label: "Preis suchen – sparsam",
    hint: "Kleines Modell, höchstens 2 Suchen – deutlich günstiger, etwas ungenauer",
    model: "claude-haiku-4-5",
    inPrice: 1,
    outPrice: 5,
    searches: 2,
  },
  genau: {
    label: "Preis suchen – genau",
    hint: "Größeres Modell, bis zu 4 Suchen – teurer, findet öfter das exakte Produkt",
    model: "claude-sonnet-5-5",
    inPrice: 2,
    outPrice: 10,
    searches: 4,
  },
};

export function isAiMode(v: unknown): v is AiMode {
  return typeof v === "string" && (AI_MODES as readonly string[]).includes(v);
}

/** Standard-Stufe für den Knopf in der Tabelle (per KI_MODUS in der .env änderbar). */
export function defaultAiMode(): AiMode {
  const v = process.env.KI_MODUS;
  return isAiMode(v) ? v : "sparsam";
}

/** Kosten einer Recherche in US-Dollar aus den gemeldeten Token und Suchen. */
export function aiCostUsd(mode: string, inputTokens: number | null, outputTokens: number | null, searches: number | null): number {
  const m = AI_MODE_INFO[isAiMode(mode) ? mode : "genau"];
  return ((inputTokens ?? 0) * m.inPrice + (outputTokens ?? 0) * m.outPrice) / 1e6 + (searches ?? 0) * 0.01;
}
