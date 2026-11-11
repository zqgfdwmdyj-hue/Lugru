import { fehlerAntwort, workerPruefen } from "@/lib/video/api";
import { driveZugangFuerWorker } from "@/lib/video/service";

// Ablage „Google Drive“: kurzlebiges Zugangs-Token + Zielordner für diesen Auftrag. Der Worker lädt direkt nach Drive;
// bei Ablage „Seller-Server“ kommt { ablage: "server" } zurück.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, fehler: "Ungültige Kennung" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await driveZugangFuerWorker(p.worker, id)) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fehlerAntwort(e);
  }
}
