import { workerPruefen } from "@/lib/video/api";
import { workerMelden, type Meldung } from "@/lib/video/service";

// Lebenszeichen des Video-Workers (alle ~30 s): Version, freier Speicher, System; Antwort: freigegebene Arbeitsordner zum Löschen.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const b = (await request.json().catch(() => ({}))) as Meldung;
  return Response.json(await workerMelden(p.worker, b));
}
