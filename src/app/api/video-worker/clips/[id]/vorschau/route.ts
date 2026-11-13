import { workerPruefen } from "@/lib/video/api";
import { clipVorschauSpeichern } from "@/lib/video/clips";

// B36.12: Vorschaubild (JPEG, ≤ 400 KB, 4 Standbilder des Clips) für die Clip-Bibliothek auf der Seite Video.

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  const laenge = Number(request.headers.get("content-length") ?? 0);
  if (laenge > 400 * 1024) return Response.json({ ok: false, fehler: "Vorschaubild größer als 400 KB" }, { status: 413 });
  const r = await clipVorschauSpeichern(p.worker, id, await request.arrayBuffer());
  return Response.json(r, { status: r.ok ? 200 : (r.status ?? 400) });
}
