import { agentPruefen } from "@/lib/druck/api";
import { heartbeat, type HeartbeatEingabe } from "@/lib/druck/service";

// Heartbeat des Druckagenten (alle 30 s): Gerät, Betriebssystem, Version, Druckerliste, letzter Start/Druck.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const b = (await request.json().catch(() => ({}))) as HeartbeatEingabe;
  return Response.json(await heartbeat(p.agent, b));
}
