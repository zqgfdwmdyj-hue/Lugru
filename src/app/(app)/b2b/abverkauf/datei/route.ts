import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { preislisteDatei, serienbrief } from "@/lib/abverkauf/service";

// B34.3 Downloads: Preisliste (PDF/Excel, ohne EK/Break-even) und Serienbrief einer Charge (PDF mit Datenschutzhinweis).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(s, "b2b")) return new Response("Kein Zugriff", { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("id fehlt", { status: 400 });
  if (url.searchParams.get("art") === "serienbrief") {
    const d = await serienbrief(s.tenantId, id);
    if (!d) return new Response("Nicht gefunden", { status: 404 });
    return new Response(new Uint8Array(d.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${d.name}"` } });
  }
  const d = await preislisteDatei(s.tenantId, id, url.searchParams.get("format") === "xlsx" ? "xlsx" : "pdf");
  if (!d) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(d.bytes), { headers: { "Content-Type": d.typ, "Content-Disposition": `attachment; filename="${d.name}"` } });
}
