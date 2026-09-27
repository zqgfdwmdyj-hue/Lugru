// Optionale KI-Zusammenfassung der neuen Artikel eines Themas (Anthropic Messages API).
// Ohne API-Schlüssel entfällt sie – die Einträge enthalten dann nur die Artikelliste.

export const DEFAULT_MODEL = "claude-sonnet-5";

export type SummaryInput = { topic: string; items: { title: string; source: string | null; snippet: string; published: string | null }[] };

export function summaryPrompt(input: SummaryInput): string {
  const list = input.items
    .map((a, i) => `[${i + 1}] ${a.title}${a.source ? ` (${a.source})` : ""}${a.published ? `, ${a.published.slice(0, 10)}` : ""}${a.snippet ? `\n    ${a.snippet}` : ""}`)
    .join("\n");
  return [
    `Du hilfst einem Online-Händler (Amazon FBA und Private Label, eBay), der sich auch für Immobilien und Aktien interessiert, auf dem Laufenden zu bleiben.`,
    `Hier sind neue Meldungen zum Thema „${input.topic}". Du kennst nur Titel und Kurztext, nicht den ganzen Artikel.`,
    ``,
    list,
    ``,
    `Schreib auf Deutsch eine kurze Zusammenfassung für die eigene Wissensdatenbank:`,
    `- höchstens 6 Stichpunkte mit dem Wichtigsten, jeweils mit Quellennummer wie [2]`,
    `- danach eine Zeile „Relevanz:" – was davon für einen Online-Händler bzw. Anleger konkret wichtig sein könnte`,
    `- nichts erfinden, was nicht in den Meldungen steht; bei Unsicherheit weglassen`,
    `- keine Einleitung, kein Markdown außer „- " für Stichpunkte`,
  ].join("\n");
}

export async function summarize(apiKey: string, input: SummaryInput, model = DEFAULT_MODEL): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: "user", content: summaryPrompt(input) }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`KI-Zusammenfassung fehlgeschlagen: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
}
