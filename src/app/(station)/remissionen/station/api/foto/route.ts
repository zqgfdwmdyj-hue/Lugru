import { z } from "zod";
import { foto } from "@/lib/retouren-station/service";
import { stationZugang } from "@/lib/retouren-station/zugang";

// Foto von der Station: volle Auflösung (Ablage) + verkleinert (~1600 px, für die KI), dazu ein erkannter Code.

const MAX = 15 * 1024 * 1024;
const JPEG = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function POST(req: Request) {
  const z0 = await stationZugang(true);
  if ("antwort" in z0) return z0.antwort;
  const fd = await req.formData().catch(() => null);
  if (!fd) return Response.json({ fehler: "Kein Foto empfangen." }, { status: 400 });
  const art = z.enum(["etikett", "lieferschein", "produkt_lpn", "inhalt"]).safeParse(fd.get("art"));
  const pruefung = z.string().uuid().nullable().safeParse(fd.get("pruefung") || null);
  const voll = fd.get("voll");
  const klein = fd.get("klein");
  if (!art.success || !pruefung.success || !(voll instanceof Blob)) return Response.json({ fehler: "Ungültige Angaben." }, { status: 400 });
  if (voll.size > MAX || (klein instanceof Blob && klein.size > MAX)) return Response.json({ fehler: "Foto zu groß." }, { status: 413 });
  const v = new Uint8Array(await voll.arrayBuffer());
  const k = klein instanceof Blob ? new Uint8Array(await klein.arrayBuffer()) : null;
  if (!JPEG(v) || (k && !JPEG(k))) return Response.json({ fehler: "Nur JPEG-Fotos." }, { status: 415 });
  const code = String(fd.get("code") ?? "").trim().slice(0, 80) || null;
  return Response.json(await foto(z0.session, pruefung.data, { art: art.data, voll: v, klein: k, code, ersetzen: fd.get("ersetzen") === "1", neuerArtikel: fd.get("neu") === "1" }));
}
