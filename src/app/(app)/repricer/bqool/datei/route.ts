import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { bqoolExportDateien } from "@/lib/bqool/export-service";
import { createZip } from "@/lib/ebay/export/zip";

// BQool-Dateien eines Exports: ?export=<id>&land=DE (eine .txt) oder ohne land (ZIP mit allen Ländern).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "buchhaltung")) return new Response("Keine Freigabe für den Repricer.", { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("export") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Export fehlt.", { status: 400 });
  const dateien = await bqoolExportDateien(session.tenantId, id);
  if (!dateien) return new Response("Export nicht gefunden.", { status: 404 });
  const land = url.searchParams.get("land");
  if (land) {
    const d = dateien.find((x) => x.land === land);
    if (!d) return new Response("Land nicht im Export.", { status: 404 });
    return new Response(d.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${d.name}"` } });
  }
  const zip = createZip(dateien.map((d) => ({ name: d.name, data: d.text })));
  return new Response(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="BQool_${dateien.map((d) => d.land).join("-")}.zip"` } });
}
