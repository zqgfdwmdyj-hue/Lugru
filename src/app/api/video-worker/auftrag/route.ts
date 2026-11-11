import { fehlerAntwort, workerPruefen } from "@/lib/video/api";
import { naechsterAuftrag } from "@/lib/video/service";

// Nächster Auftrag für den Worker (nur einer gleichzeitig). Ohne Auftrag: { auftrag: null, grund? }.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  try {
    return Response.json(await naechsterAuftrag(p.worker));
  } catch (e) {
    return fehlerAntwort(e);
  }
}
