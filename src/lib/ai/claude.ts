// Aufruf der Anthropic Messages API (Claude) – gemeinsam für Recherche und Amazon-ToDos.

export const DEFAULT_MODEL = "claude-sonnet-5";

export async function askClaude(apiKey: string, prompt: string, opts: { model?: string; maxTokens?: number; timeoutMs?: number } = {}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetch(`${(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: opts.model || DEFAULT_MODEL, max_tokens: opts.maxTokens ?? 1000, messages: [{ role: "user", content: prompt }] }),
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
