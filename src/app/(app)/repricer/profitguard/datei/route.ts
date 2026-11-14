import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { profitguardExportDatei } from "@/lib/repricing/soll-service";

// ProfitGuard-Importdatei eines Exports: ?export=<id>&land=DE (ein Land) oder ohne land (alle Länder in einer Datei).
// Format wie der letzte ProfitGuard-Export (Kopfzeile, Trennzeichen, Dezimalzeichen). Es wird nichts gesendet.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "buchhaltung")) return new Response("Keine Freigabe für den Repricer.", { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("export") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Export fehlt.", { status: 400 });
  const land = url.searchParams.get("land");
  if (land && !/^[A-Z]{2}$/.test(land)) return new Response("Land ungültig.", { status: 400 });
  const d = await profitguardExportDatei(session.tenantId, id, land);
  if (!d) return new Response("Export nicht gefunden.", { status: 404 });
  return new Response(d.text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${d.name}"` } });
}
