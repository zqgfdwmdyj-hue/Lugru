import type { ToolCtx, ToolDef, ToolOut } from "./types";

/** Was der MCP-Teil vom Werkzeug-Register braucht (in Tests ersetzbar). */
export type McpDeps = { tools: ToolDef[]; schemaOf: (t: ToolDef) => Record<string, unknown>; call: (name: string, args: unknown) => Promise<ToolOut> };

// MCP-Server (Streamable HTTP, ohne Sitzungs-ID und ohne Event-Stream): JSON-RPC rein, JSON raus.
// claude.ai ruft initialize, tools/list und tools/call auf; Werkzeuge kommen aus dem gemeinsamen Register.

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "seller-system", title: "Seller-System", version: "1.0.0" };

type Id = string | number | null;
type Req = { jsonrpc?: string; id?: Id; method?: unknown; params?: Record<string, unknown> };
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

function instructions(ctx: Pick<ToolCtx, "session" | "canWrite" | "privat" | "today">) {
  return [
    `Seller-System von ${ctx.session.tenantName} (Online-Handel: Amazon, eBay, Temu, eigenes Lager, Palettenlager für Kunden). Angemeldet: ${ctx.session.name || ctx.session.email}.`,
    "Antworte auf Deutsch. Nutze „ueberblick“ als Einstieg, „suche“ wenn unklar ist, wo etwas steht.",
    ctx.canWrite ? "Ändernde Werkzeuge nur auf ausdrücklichen Wunsch und mit genau den genannten Angaben benutzen; im Zweifel vorher nachfragen." : "Diese Verbindung darf nur lesen.",
    ctx.privat ? "Der Privatbereich ist freigegeben (privat_*): vertraulich behandeln, nicht ungefragt mit Geschäftlichem vermischen." : "",
    `Heute ist ${ctx.today}. Links in den Antworten führen ins Seller-System.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Eine JSON-RPC-Nachricht beantworten; Benachrichtigungen (ohne id) → null. */
export async function handleMcpMessage(msg: unknown, ctx: Pick<ToolCtx, "session" | "canWrite" | "privat" | "today">, deps: McpDeps): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "Ungültige Anfrage");
  const m = msg as Req;
  const isNotification = !("id" in m) || m.id === undefined;
  const id: Id = isNotification ? null : (m.id ?? null);
  if (typeof m.method !== "string") return isNotification ? null : fail(id, -32600, "Ungültige Anfrage");
  if (isNotification) return null; // notifications/initialized, notifications/cancelled …
  const params = m.params ?? {};
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructions(ctx),
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: deps.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: deps.schemaOf(t),
          annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const out = await deps.call(name, params.arguments ?? {});
      return ok(id, { content: [{ type: "text", text: out.text }], isError: Boolean(out.isError) });
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fail(id, -32601, `Methode nicht unterstützt: ${m.method}`);
  }
}
