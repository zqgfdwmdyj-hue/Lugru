import { workerPruefen } from "@/lib/video/api";
import { fotoLesen } from "@/lib/video/story";

// B37: Eigenes Lager-Foto (Foto-Mediathek des Instagram-Kanals) für eine „Einblick“-Story – nur mit Worker-Token, eigener Mandant.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  const f = await fotoLesen(p.worker.tenantId, id);
  if (!f) return Response.json({ ok: false, fehler: "Foto nicht gefunden" }, { status: 404 });
  return new Response(new Uint8Array(f.daten), { headers: { "content-type": f.typ, "cache-control": "no-store" } });
}
