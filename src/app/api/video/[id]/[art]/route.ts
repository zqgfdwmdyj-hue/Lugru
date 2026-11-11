import { requireSession } from "@/lib/auth/session";
import { dateiOeffnen, dateiStrom, driveLink } from "@/lib/video/service";

// Fertige Video-Dateien ansehen/herunterladen (nur angemeldet, eigener Mandant). Mit Range für den Video-Player.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; art: string }> }) {
  const s = await requireSession();
  const { id, art } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const d = await dateiOeffnen(s.tenantId, id, art);
  if (!d) return new Response("Nicht gefunden", { status: 404 });
  // Ablage Google Drive: dorthin weiterleiten (Ansicht/Download in Drive, mit deiner Google-Anmeldung)
  if ("drive" in d) return Response.redirect(driveLink(d.drive), 302);
  const herunterladen = new URL(request.url).searchParams.has("download");
  const kopf: Record<string, string> = { "content-type": d.typ, "accept-ranges": "bytes", "cache-control": "private, no-store", "content-disposition": `${herunterladen ? "attachment" : "inline"}; filename="${d.name}"` };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, d.groesse - Number(range[2]));
    let ende = range[1] && range[2] ? Number(range[2]) : d.groesse - 1;
    ende = Math.min(ende, d.groesse - 1);
    if (start > ende || start >= d.groesse) return new Response(null, { status: 416, headers: { "content-range": `bytes */${d.groesse}` } });
    start = Math.max(0, start);
    return new Response(dateiStrom(d.pfad, start, ende), { status: 206, headers: { ...kopf, "content-range": `bytes ${start}-${ende}/${d.groesse}`, "content-length": String(ende - start + 1) } });
  }
  return new Response(dateiStrom(d.pfad), { headers: { ...kopf, "content-length": String(d.groesse) } });
}
