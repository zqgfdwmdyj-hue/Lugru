import { workerPruefen } from "@/lib/video/api";
import { clipsMelden } from "@/lib/video/clips";

// B36.12 Eigene Clip-Bibliothek: Der Worker meldet alle Clips aus seinem Ordner (nur Metadaten, keine Videos).
// Antwort: welche Vorschaubilder noch fehlen.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const b = await request.json().catch(() => null);
  if (!b) return Response.json({ ok: false, fehler: "JSON erwartet" }, { status: 400 });
  return Response.json(await clipsMelden(p.worker, b));
}
