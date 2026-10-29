import { z } from "zod";
import { videoTeil } from "@/lib/retouren-station/service";
import { stationZugang } from "@/lib/retouren-station/zugang";

// Ein Stück der Paket-Aufnahme (MediaRecorder, alle paar Sekunden). Teile werden einzeln verschlüsselt abgelegt.

const MAX = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const z0 = await stationZugang(true);
  if ("antwort" in z0) return z0.antwort;
  const url = new URL(req.url);
  const pruefung = z.string().uuid().safeParse(url.searchParams.get("pruefung"));
  const teil = z.coerce.number().int().min(1).max(9999).safeParse(url.searchParams.get("teil"));
  if (!pruefung.success || !teil.success) return Response.json({ fehler: "Ungültige Angaben." }, { status: 400 });
  const daten = new Uint8Array(await req.arrayBuffer());
  if (!daten.length) return Response.json({ ok: true, leer: true });
  if (daten.length > MAX) return Response.json({ fehler: "Teil zu groß." }, { status: 413 });
  const r = await videoTeil(z0.session, pruefung.data, teil.data, daten, req.headers.get("content-type") ?? "video/webm");
  return Response.json(r, { status: r.ok ? 200 : 404 });
}
