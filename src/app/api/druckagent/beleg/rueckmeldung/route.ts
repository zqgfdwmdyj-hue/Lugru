import { agentPruefen } from "@/lib/druck/api";
import { rueckmeldung } from "@/lib/belege/ablage";

// B34.2 Rückmeldung des Agenten: verschoben (relativer Pfad in der Ablage) bzw. Dublette nach Freigabe gelöscht.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; verschoben?: unknown; geloescht?: unknown; meldung?: unknown };
  const id = typeof b.id === "string" && /^[0-9a-f-]{36}$/.test(b.id) ? b.id : null;
  if (!id) return Response.json({ ok: false, fehler: "id fehlt" }, { status: 400 });
  const ok = await rueckmeldung(p.agent, { id, verschoben: typeof b.verschoben === "string" ? b.verschoben : null, geloescht: typeof b.geloescht === "boolean" ? b.geloescht : null, meldung: typeof b.meldung === "string" ? b.meldung : null });
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
