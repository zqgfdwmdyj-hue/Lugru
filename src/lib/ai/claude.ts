// Aufruf der Anthropic Messages API (Claude) – gemeinsam für Recherche, Amazon-ToDos und Marken.

/** Günstig: Einstufen, Zusammenfassen (1 $ / 5 $ je Mio. Tokens). */
export const CHEAP_MODEL = "claude-haiku-4-5";
/** Besser formuliert: Ideen, Video-Skripte, Listings (2 $ / 10 $ je Mio. Tokens). */
export const SMART_MODEL = "claude-sonnet-5-5";
export const DEFAULT_MODEL = CHEAP_MODEL;

/** simple = Einstufen/Zusammenfassen, creative = Ideen/Content/Listing. */
export type AiTask = "simple" | "creative";
export type AiTier = "sparsam" | "ausgewogen" | "qualitaet";

/** Welches Modell für eine Aufgabe: eigenes Modell aus den Einstellungen gewinnt, sonst die Stufe. */
export function modelFor(cfg: { tier?: string; model?: string } | null | undefined, task: AiTask): string {
  const own = cfg?.model?.trim();
  if (own) return own;
  const tier = (cfg?.tier || "ausgewogen") as AiTier;
  if (tier === "sparsam") return CHEAP_MODEL;
  if (tier === "qualitaet") return SMART_MODEL;
  return task === "creative" ? SMART_MODEL : CHEAP_MODEL;
}

/**
 * Sonnet/Opus ab Generation 5 denken immer mit (kostet Ausgabe-Tokens). Mit niedriger „effort“ bleibt das
 * knapp; Haiku 4.5 und ältere Modelle kennen den Parameter nicht.
 */
/** Text oder Bausteine mit Bild/PDF (Base64) – Haiku und Sonnet lesen beides. */
export type AiContent =
  | string
  | ({ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } } | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } })[];

export function requestBody(model: string, prompt: AiContent, maxTokens: number, task: AiTask) {
  const thinks = /^claude-(sonnet|opus|fable)-5/.test(model);
  return {
    model,
    // Denken zählt gegen max_tokens – etwas Luft, damit die Antwort nicht abgeschnitten wird.
    max_tokens: thinks ? maxTokens + 3000 : maxTokens,
    ...(thinks ? { output_config: { effort: task === "creative" ? "medium" : "low" } } : {}),
    messages: [{ role: "user", content: prompt }],
  };
}

export async function askClaude(apiKey: string, prompt: AiContent, opts: { model?: string; task?: AiTask; maxTokens?: number; timeoutMs?: number } = {}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const model = opts.model || DEFAULT_MODEL;
  const res = await fetch(`${(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(requestBody(model, prompt, opts.maxTokens ?? 1000, opts.task ?? "simple")),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  const json = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!res.ok) throw new Error(`KI-Aufruf fehlgeschlagen: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return {
    text: (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim(),
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}

/** Websuche: neuere Modelle filtern Ergebnisse selbst (2026-02-09), ältere (z. B. Haiku 4.5) nutzen die Grundversion. */
export function webTools(model: string, maxSearches: number) {
  const dynamic = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6)|fable-5)/.test(model);
  return dynamic
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses: maxSearches },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.max(2, Math.ceil(maxSearches / 2)) },
      ]
    : [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
}

type Block = { type: string; text?: string; [k: string]: unknown };

/**
 * Wie askClaude, aber mit Websuche auf Anthropic-Seite. Läuft die Suche in die Pause
 * (`pause_turn`), wird mit der bisherigen Antwort fortgesetzt – ohne neue Nutzernachricht.
 * Liefert den Schlusstext, die Zahl der Suchen (je 0,01 $) und die gefundenen Quellen.
 */
export async function askClaudeWithWeb(
  apiKey: string,
  prompt: string,
  opts: { model?: string; maxSearches?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; searches: number; sources: string[]; inputTokens: number; outputTokens: number }> {
  const model = opts.model || DEFAULT_MODEL;
  const base = requestBody(model, prompt, opts.maxTokens ?? 2000, "simple");
  const messages: { role: "user" | "assistant"; content: string | Block[] }[] = [{ role: "user", content: prompt }];
  let searches = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const sources = new Set<string>();
  let last: Block[] = [];
  for (let round = 0; round < 4; round++) {
    const res = await fetch(`${(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ ...base, messages, tools: webTools(model, opts.maxSearches ?? 5) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      content?: Block[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(`KI-Aufruf fehlgeschlagen: ${json.error?.message ?? `HTTP ${res.status}`}`);
    inputTokens += json.usage?.input_tokens ?? 0;
    outputTokens += json.usage?.output_tokens ?? 0;
    searches += json.usage?.server_tool_use?.web_search_requests ?? 0;
    last = json.content ?? [];
    for (const b of last) {
      // Erfolgreiche Suche: Liste von Treffern; Fehler: ein Objekt mit error_code.
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content as { url?: string }[]) if (r.url) sources.add(r.url);
    }
    if (json.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: last });
  }
  return { text: last.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim(), searches, sources: [...sources], inputTokens, outputTokens };
}
