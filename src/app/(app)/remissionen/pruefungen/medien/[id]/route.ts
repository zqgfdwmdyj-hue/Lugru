import { z } from "zod";
import { medium } from "@/lib/retouren-station/fall";
import { kleinSchluessel, lesen, teilSchluessel } from "@/lib/medien/ablage";
import { stationZugang } from "@/lib/retouren-station/zugang";

// Foto/Video der Retouren-Station ausliefern – nur angemeldet mit Bereich „Amazon FBA“, nie öffentlich, nie zwischengespeichert.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const z0 = await stationZugang(false);
  if ("antwort" in z0) return z0.antwort;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return new Response("Nicht gefunden", { status: 404 });
  const m = await medium(z0.session.tenantId, id.data);
  if (!m) return new Response("Nicht gefunden (oder nach Ablauf der Aufbewahrung gelöscht)", { status: 404 });
  const kopf = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" };
  if (m.art === "video") {
    // Teile nacheinander entschlüsseln und als ein WebM ausliefern.
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        i++;
        if (i > m.teile) return c.close();
        const b = await lesen(teilSchluessel(m.pfad, i)).catch(() => null);
        if (b) c.enqueue(new Uint8Array(b));
      },
    });
    return new Response(stream, { headers: { ...kopf, "Content-Type": m.mime } });
  }
  const klein = new URL(req.url).searchParams.get("klein") === "1";
  const b = await lesen(klein ? kleinSchluessel(m.pfad) : m.pfad).catch(() => (klein ? lesen(m.pfad).catch(() => null) : null));
  if (!b) return new Response("Datei fehlt in der Ablage", { status: 404 });
  return new Response(new Uint8Array(b), { headers: { ...kopf, "Content-Type": m.mime } });
}
