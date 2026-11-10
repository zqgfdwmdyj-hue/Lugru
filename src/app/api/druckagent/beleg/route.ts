import { agentPruefen } from "@/lib/druck/api";
import { belegAusOrdner, belegStand, loeschListe } from "@/lib/belege/ablage";

// B34.2 Download-Ordner am Arbeits-PC: POST = Datei (PDF/Foto) → Antwort mit Zielordner/-name, Dublette oder
// „liegen lassen“; GET ?id= = Stand (Fotos werden per KI gelesen); GET ?loeschen=1 = freigegebene Dubletten.
// Nur mit Gerätetoken des Druckagenten.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const name = decodeURIComponent(request.headers.get("x-dateiname") ?? "datei.pdf").replace(/[\\/]/g, "_").slice(0, 200);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return Response.json({ fehler: "leer oder größer als 25 MB" }, { status: 400 });
  try {
    return Response.json(await belegAusOrdner(p.agent, name, bytes));
  } catch (e) {
    return Response.json({ fehler: e instanceof Error ? e.message.slice(0, 300) : "Fehler" }, { status: 422 });
  }
}

export async function GET(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const url = new URL(request.url);
  if (url.searchParams.get("loeschen")) return Response.json({ loeschen: await loeschListe(p.agent) });
  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ fehler: "id fehlt" }, { status: 400 });
  const r = await belegStand(p.agent, id);
  return r ? Response.json(r) : Response.json({ fehler: "unbekannt" }, { status: 404 });
}
