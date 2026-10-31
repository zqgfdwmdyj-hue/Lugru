import "server-only";

// Gemeinsame Antworten für /api/mcp und die OAuth-Endpunkte: JSON, CORS (ohne Cookies – nur Bearer-Token).
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...headers } });

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** Formular- oder JSON-Körper als einfache Schlüssel/Wert-Liste. */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (type.includes("application/json")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}
