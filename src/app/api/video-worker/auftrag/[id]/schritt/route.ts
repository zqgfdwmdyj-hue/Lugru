import { fehlerAntwort, workerPruefen } from "@/lib/video/api";
import { schrittMelden, type SchrittMeldung } from "@/lib/video/service";

// Schritt-Meldung: läuft (mit Fortschritt je Szene) / fertig (mit Daten) / fehler. Antwort: weiter, nächster Schritt oder Freigabe.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, fehler: "Ungültige Kennung" }, { status: 400 });
  const b = (await request.json().catch(() => null)) as SchrittMeldung | null;
  if (!b?.schritt || !b.status) return Response.json({ ok: false, fehler: "schritt und status fehlen" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await schrittMelden(p.worker, id, b)) });
  } catch (e) {
    return fehlerAntwort(e);
  }
}
