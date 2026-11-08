import "server-only";
import { agentPerToken, type Agent } from "./service";

// Gemeinsame Prüfung der Agent-Schnittstellen: Bearer-Gerätetoken (da_…), widerrufen → 401 „abgemeldet“.

export async function agentPruefen(request: Request): Promise<{ ok: true; agent: Agent } | { ok: false; antwort: Response }> {
  const r = await agentPerToken(request.headers.get("authorization"));
  if (r.agent) return { ok: true, agent: r.agent };
  return { ok: false, antwort: Response.json({ ok: false, abgemeldet: r.abgemeldet, fehler: r.abgemeldet ? "Agent deaktiviert – Token widerrufen" : "Gerätetoken fehlt oder ungültig" }, { status: 401 }) };
}
