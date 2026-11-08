import { agentPruefen } from "@/lib/druck/api";
import { auftragMelden } from "@/lib/druck/service";

// Rückmeldung je Auftrag: gedruckt, fehler oder wartet (zurück in die Warteschlange, z. B. „Drucker startet nicht“).

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ ok: false }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as { status?: unknown; meldung?: unknown };
  const ok = await auftragMelden(p.agent, id, String(b.status ?? ""), typeof b.meldung === "string" ? b.meldung : null);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
