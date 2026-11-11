import { fehlerAntwort, workerPruefen } from "@/lib/video/api";
import { youtubeBestaetigen, youtubeZugangFuerWorker } from "@/lib/video/service";

// GET: kurzlebiges Zugangs-Token zum privaten Upload (nur mit „Privat hochladen“ + freigegebener Vorschau).
// POST { videoId }: Seller-System prüft die Sichtbarkeit (muss „private“ sein) und schließt den Auftrag ab.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  try {
    return Response.json({ ok: true, ...(await youtubeZugangFuerWorker(p.worker, id)) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fehlerAntwort(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { videoId?: string };
  try {
    return Response.json({ ok: true, ...(await youtubeBestaetigen(p.worker, id, String(b.videoId ?? ""))) });
  } catch (e) {
    return fehlerAntwort(e);
  }
}
