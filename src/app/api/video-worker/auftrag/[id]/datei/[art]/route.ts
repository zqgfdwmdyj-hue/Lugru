import { workerPruefen } from "@/lib/video/api";
import { dateiOeffnen, dateiSpeichern, dateiStrom } from "@/lib/video/service";

// Upload einer fertigen Datei (mp4, thumbnail, skript, quellen, untertitel) als Strom – kein Puffer im Speicher.

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; art: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id, art } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, fehler: "Ungültige Kennung" }, { status: 400 });
  const laenge = request.headers.get("content-length");
  const r = await dateiSpeichern(p.worker, id, art, request.body, laenge && /^\d+$/.test(laenge) ? Number(laenge) : null);
  return r.ok ? Response.json(r) : Response.json(r, { status: r.status });
}

/** Download für den Worker (z. B. „Privat hochladen“ später, wenn der PC sein Projekt schon aufgeräumt hat). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; art: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id, art } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, fehler: "Ungültige Kennung" }, { status: 400 });
  const d = await dateiOeffnen(p.worker.tenantId, id, art);
  if (!d) return Response.json({ ok: false, fehler: "Datei nicht gefunden" }, { status: 404 });
  return new Response(dateiStrom(d.pfad), { headers: { "content-type": d.typ, "content-length": String(d.groesse), "cache-control": "no-store" } });
}
