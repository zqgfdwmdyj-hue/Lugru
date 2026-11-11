import { workerPruefen } from "@/lib/video/api";
import { referenzLesen } from "@/lib/video/service";

// B36.9: Stil-Referenzbild eines Kanals für den Worker (Vorlage fürs Bildmodell). Nur mit Worker-Token, eigener Mandant.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ kanal: string; nr: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { kanal, nr } = await params;
  if (!/^[0-9a-f-]{36}$/.test(kanal) || !/^\d{1,3}$/.test(nr)) return Response.json({ ok: false, fehler: "Ungültige Kennung" }, { status: 400 });
  const r = await referenzLesen(p.worker.tenantId, kanal, Number(nr));
  if (!r) return Response.json({ ok: false, fehler: "Referenzbild nicht gefunden" }, { status: 404 });
  return new Response(new Uint8Array(r.daten), { headers: { "content-type": r.typ, "cache-control": "no-store", "x-hash": r.ref.hash } });
}
