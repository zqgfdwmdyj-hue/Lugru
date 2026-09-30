import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { handleEbayApi } from "@/lib/ebay/server";

// Die Schnittstelle des eBay-Tools (bisher Express unter /api) – hier je Mandant.

export const dynamic = "force-dynamic";

async function handle(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canAccess(session, "ebay")) return Response.json({ error: "Kein Zugriff auf den eBay-Bereich." }, { status: 403 });
  const { path } = await ctx.params;
  const url = new URL(request.url);
  let body: unknown = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
      }
    }
  }
  return handleEbayApi({
    tenantId: session.tenantId,
    role: session.role,
    method: request.method,
    path: "/" + path.map(encodeURIComponent).join("/"),
    query: url.searchParams,
    body,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
