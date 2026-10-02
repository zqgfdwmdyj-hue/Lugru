import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeMhd } from "@/lib/mhd-parse";

// MHD vom Foto ablesen: kleinstes Modell, keine Websuche – kostet einen Bruchteil eines Cents.

const PROMPT = `Auf dem Foto ist ein aufgedrucktes Haltbarkeitsdatum einer Verpackung (MHD, „mindestens haltbar bis“, „zu verbrauchen bis“, „best before“, „EXP“, „BBE“).
Lies das Datum ab. Chargennummern (L…), Uhrzeiten und Preise ignorieren.
Antworte nur mit JSON: {"text": "das Datum genau wie aufgedruckt", "datum": "JJJJ-MM-TT"}
Steht nur Monat und Jahr da, nimm den letzten Tag des Monats. Ist kein Datum lesbar: {"text": null, "datum": null}`;

export type MhdReading = { date: string | null; raw: string | null; inputTokens: number; outputTokens: number };

export async function readBestBefore(image: { mimeType: string; data: Buffer }): Promise<MhdReading> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mimeType as "image/jpeg", data: image.data.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let raw: string | null = null;
  let date: string | null = null;
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { text?: string | null; datum?: string | null };
    raw = json.text ?? null;
    // Erst das Datum der KI prüfen, sonst den abgelesenen Text selbst auswerten.
    date = normalizeMhd(json.datum) ?? normalizeMhd(json.text);
  } catch {
    date = normalizeMhd(text);
  }
  return { date, raw, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}
