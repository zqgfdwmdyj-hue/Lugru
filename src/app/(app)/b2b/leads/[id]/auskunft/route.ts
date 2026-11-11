import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { leadAuskunft } from "@/lib/abverkauf/lead-maschine";

// B35 Auskunft (Art. 15 DSGVO) je Lead als JSON-Datei.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(s, "b2b")) return new Response("Kein Zugriff", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("id fehlt", { status: 400 });
  const d = await leadAuskunft(s.tenantId, id);
  if (!d) return new Response("Nicht gefunden", { status: 404 });
  return new Response(JSON.stringify(d, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="auskunft-lead-${id.slice(0, 8)}.json"` } });
}
