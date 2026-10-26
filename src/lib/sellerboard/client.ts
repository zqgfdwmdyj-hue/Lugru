import "server-only";
import { accessToken, mcpUrl, readConn } from "./connection";
import { isPreparing, parseToolText } from "./parse";

// Werkzeuge des sellerboard-Connectors aufrufen (MCP über HTTP, zustandslos). Hält sich an das Limit
// (höchstens ~3 Anfragen/Sekunde je Konto), wartet bei „preparing“ und 429 und erneuert das Token bei 401.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastCall = new Map<string, number>();
const GAP_MS = Number(process.env.SELLERBOARD_GAP_MS ?? 400);
const PREPARING_WAIT_MS = Number(process.env.SELLERBOARD_PREPARING_MS ?? 3000);

async function pace(tenantId: string) {
  const wait = (lastCall.get(tenantId) ?? 0) + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(tenantId, Date.now());
}

let rpcId = 0;

/** Ein JSON-RPC-Aufruf; Antwort als JSON oder als Event-Stream. */
async function rpc(token: string, method: string, params: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const r = await fetch(mcpUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await r.text();
  if (!r.ok) return { status: r.status, body: null };
  if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
    // Letzte „data:“-Zeile mit einer JSON-RPC-Antwort
    const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    for (let i = data.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(data[i]) as Record<string, unknown>;
        if ("result" in j || "error" in j) return { status: r.status, body: j };
      } catch {
        // weiter
      }
    }
    return { status: r.status, body: null };
  }
  try {
    return { status: r.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: r.status, body: null };
  }
}

/** Werkzeug aufrufen und den JSON-Teil der Antwort liefern. account_id wird automatisch ergänzt. */
export async function sbCall(tenantId: string, tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const conn = await readConn(tenantId);
  const params = { name: tool, arguments: { ...(conn?.config.accountId && tool !== "list_accounts" ? { account_id: conn.config.accountId } : {}), ...args } };
  let token = await accessToken(tenantId);
  let refreshed = false;
  let rateTries = 0;
  for (let preparing = 0; preparing < 40; ) {
    await pace(tenantId);
    const { status, body } = await rpc(token, "tools/call", params);
    if (status === 401 && !refreshed) {
      token = await accessToken(tenantId, true);
      refreshed = true;
      continue;
    }
    if (status === 429 || (status >= 500 && status < 600)) {
      if (++rateTries > 6) throw new Error(`sellerboard antwortet nicht (HTTP ${status}).`);
      await sleep(Math.min(30_000, 1000 * 2 ** rateTries));
      continue;
    }
    if (!body) throw new Error(`sellerboard: unerwartete Antwort (HTTP ${status}).`);
    if (body.error) throw new Error(`sellerboard: ${String((body.error as { message?: string }).message ?? "Fehler")}`);
    const result = body.result as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> } | undefined;
    const text = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    if (result?.isError) {
      if (/429|rate limit/i.test(text) && ++rateTries <= 6) {
        await sleep(Math.min(30_000, 1000 * 2 ** rateTries));
        continue;
      }
      throw new Error(`sellerboard (${tool}): ${text.split("\n")[0].slice(0, 300)}`);
    }
    const data = result?.structuredContent && typeof result.structuredContent === "object" && "status" in result.structuredContent ? result.structuredContent : parseToolText(text);
    if (isPreparing(data)) {
      preparing++;
      await sleep(PREPARING_WAIT_MS);
      continue;
    }
    return data;
  }
  throw new Error(`sellerboard (${tool}): Daten nach mehreren Minuten noch nicht fertig – später erneut.`);
}

/** Alle Seiten eines Werkzeugs mit page/count lesen (total = Gesamtzahl). */
export async function sbAllPages(tenantId: string, tool: string, args: Record<string, unknown>, count: number, maxPages = 400) {
  const rows: Record<string, unknown>[] = [];
  let total = Infinity;
  for (let page = 1; page <= maxPages && (page - 1) * count < total; page++) {
    const reply = await sbCall(tenantId, tool, { ...args, page, count });
    const list = (reply.result as Record<string, unknown>[] | undefined) ?? [];
    total = Number(reply.total ?? list.length);
    rows.push(...list);
    if (!list.length) break;
  }
  return rows;
}
