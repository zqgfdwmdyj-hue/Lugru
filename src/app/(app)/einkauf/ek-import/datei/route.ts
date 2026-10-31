import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { sellerboardImportDatei } from "@/lib/ek-import/service";

// sellerboard-Kostenimport (.xls wie aus ArbitrageOne) eines EK-Imports.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "wawi")) return new Response("Keine Freigabe für den Einkauf.", { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Import fehlt.", { status: 400 });
  const d = await sellerboardImportDatei(session.tenantId, id);
  if (!d) return new Response("Import nicht gefunden.", { status: 404 });
  return new Response(new Uint8Array(d.bytes), { headers: { "Content-Type": "application/vnd.ms-excel", "Content-Disposition": `attachment; filename="${d.name}"` } });
}
