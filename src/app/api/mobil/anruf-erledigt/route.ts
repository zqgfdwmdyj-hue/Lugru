import { mobilPruefen } from "@/lib/mobil/token";
import { anrufErledigen } from "@/lib/mobil/service";

// „Anruf erledigt: Konrad, Notiz: nimmt 60 Stück“ (Kurzbefehl/Diktat) oder { id, notiz } → Aufgabe erledigt + Notiz.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await mobilPruefen(request, "anruf-erledigt", { schreibend: true });
  if (!p.ok) return Response.json({ error: p.fehler }, { status: p.status });
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; text?: unknown; notiz?: unknown };
  const r = await anrufErledigen(p.session, { id: typeof b.id === "string" ? b.id : undefined, text: typeof b.text === "string" ? b.text.slice(0, 600) : undefined, notiz: typeof b.notiz === "string" ? b.notiz.slice(0, 500) : null });
  return Response.json(r, { status: r.ok ? 200 : 404 });
}
