import { todayIso } from "@/lib/dates";
import { appUrl } from "@/lib/oauth/state";
import { handleMcpMessage, type McpDeps, type RpcResponse } from "@/lib/assistant/mcp";
import { inputSchema, runTool, toolsFor } from "@/lib/assistant/registry";
import { grantFromAccessToken } from "@/lib/assistant/oauth-service";
import { CORS, jsonResponse, preflight } from "@/lib/assistant/http";

// Claude-Konnektor (MCP, Streamable HTTP): nur mit gültigem Zugangs-Token aus der OAuth-Freigabe.
// Rechte = die der Person, die freigegeben hat (frisch aus der Mitgliedschaft), plus Scope der Freigabe.

function unauthorized(req: Request, why: string, ascii: string) {
  const base = appUrl(req);
  return new Response(JSON.stringify({ error: "invalid_token", error_description: why }), {
    status: 401,
    headers: { "Content-Type": "application/json", ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="${ascii}"` },
  });
}

export async function POST(req: Request) {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? null;
  const auth = await grantFromAccessToken(token);
  if (!auth) return token ? unauthorized(req, "Zugang abgelaufen oder getrennt", "token expired or revoked") : unauthorized(req, "Anmeldung nötig", "authorization required");
  const scope = new Set(auth.grant.scope.split(" "));
  const ctx = {
    session: auth.session,
    channel: "claude" as const,
    canWrite: scope.has("aendern") && !auth.session.readOnly,
    privat: scope.has("privat") && auth.session.privateAccess,
    today: todayIso(),
    baseUrl: appUrl(req),
  };
  const deps: McpDeps = { tools: toolsFor(ctx), schemaOf: inputSchema, call: (name, args) => runTool(ctx, name, args) };
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Kein gültiges JSON" } }, 400);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMcpMessage(m, ctx, deps)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? jsonResponse(out) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await handleMcpMessage(body, ctx, deps);
  return res ? jsonResponse(res) : new Response(null, { status: 202, headers: CORS });
}

// Kein Event-Stream und keine Sitzungen: GET/DELETE gibt es nicht (laut MCP erlaubt).
export async function GET() {
  return new Response("Nur POST (MCP Streamable HTTP ohne Event-Stream).", { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}
export async function OPTIONS() {
  return preflight();
}
