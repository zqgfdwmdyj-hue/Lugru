import { agentPruefen } from "@/lib/druck/api";
import { auftragDaten } from "@/lib/druck/service";

// Druckdaten (Brother-Raster) eines reservierten Auftrags – der Agent schickt sie unverändert an den Drucker.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400 });
  const d = await auftragDaten(p.agent, id);
  if (!d) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(d), { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
}
