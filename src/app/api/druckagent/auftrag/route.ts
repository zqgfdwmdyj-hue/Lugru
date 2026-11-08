import { agentPruefen } from "@/lib/druck/api";
import { auftragAbholen } from "@/lib/druck/service";

// Langes Abfragen (bis 25 s): nächster Druckauftrag für diesen Agenten, sonst 204. Ersetzt die WebSocket-Verbindung.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const warten = Number(new URL(request.url).searchParams.get("warten") ?? 0) || 0;
  const j = await auftragAbholen(p.agent, warten, request.signal);
  if (!j) return new Response(null, { status: 204 });
  return Response.json({ auftrag: { id: j.id, titel: j.titel, drucker: j.drucker, medium: j.medium, anzahl: j.anzahl, seiten: j.seiten, format: "brother-raster", sha256: j.sha256 } });
}
