import "server-only";
import { accessToken, mcpUrl, readConn } from "./connection";
import { isPreparing, parseToolText } from "./parse";

// Werkzeuge des sellerboard-Connectors aufrufen (MCP über HTTP, zustandslos). Hält sich an das Limit
// (höchstens ~3 Anfragen/Sekunde je Konto), wartet bei „preparing“ und 429 und erneuert das Token bei 401.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastCall = new Map<string, number>();
const GAP_MS = Number(process.env.SELLERBOARD_GAP_MS ?? 400);
const PREPARING_WAIT_MS = Number(process.env.SELLERBOARD_PREPARING_MS ?? 3000);
const NET_RETRY_MS = Number(process.env.SELLERBOARD_NET_RETRY_MS ?? 1000);

/** Kurzer Grund eines Netzwerkfehlers, z. B. „terminated: other side closed“. */
function netError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
  return (cause && cause !== msg ? `${msg}: ${cause}` : msg).slice(0, 160);
}

async function pace(tenantId: string) {
  const wait = (lastCall.get(tenantId) ?? 0) + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(tenantId, Date.now());
}

let rpcId = 0;

/**
 * Event-Stream lesen, bis die JSON-RPC-Antwort (result/error) da ist – nicht auf das Stream-Ende warten:
 * manche Server halten die Verbindung danach offen.
 */
async function readSse(r: Response): Promise<Record<string, unknown> | null> {
  if (!r.body) return null;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  const take = (): Record<string, unknown> | null => {
    if (!data.length) return null;
    const raw = data.join("\n");
    data = [];
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      return "result" in j || "error" in j ? j : null;
    } catch {
      return null;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = done ? "" : (lines.pop() ?? "");
      for (const line of done ? [...lines, ""] : lines) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line === "") {
          const j = take();
          if (j) return j;
        }
      }
      if (done) return take();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Ein JSON-RPC-Aufruf; Antwort als JSON oder als Event-Stream. */
async function rpc(token: string, method: string, params: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const r = await fetch(mcpUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) {
    await r.body?.cancel().catch(() => undefined);
    return { status: r.status, body: null };
  }
  if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) return { status: r.status, body: await readSse(r) };
  const text = await r.text();
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
  let netTries = 0;
  for (let preparing = 0; preparing < 40; ) {
    await pace(tenantId);
    let reply: Awaited<ReturnType<typeof rpc>>;
    try {
      reply = await rpc(token, "tools/call", params);
    } catch (e) {
      // Verbindung mittendrin abgebrochen („terminated“, „fetch failed“, Zeitüberschreitung): Lesen ist gefahrlos
      // wiederholbar – mit wachsender Pause noch einmal.
      if (++netTries > 5) throw new Error(`sellerboard (${tool}): Verbindung abgebrochen (${netError(e)}) – mehrfach versucht.`);
      await sleep(Math.min(30_000, NET_RETRY_MS * 2 ** netTries));
      continue;
    }
    const { status, body } = reply;
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
    if (!body) {
      // Stream ohne vollständige Antwort beendet – wie ein Abbruch behandeln.
      if (++netTries <= 5) {
        await sleep(Math.min(30_000, NET_RETRY_MS * 2 ** netTries));
        continue;
      }
      throw new Error(`sellerboard (${tool}): unvollständige Antwort (HTTP ${status}) – mehrfach versucht.`);
    }
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
