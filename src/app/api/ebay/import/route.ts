import { getSession } from "@/lib/auth/session";
import { importLugruDb } from "@/lib/ebay/import";

// Übernahme aus dem bisherigen eBay-Tool: die Datei lugru.db als Rohdaten im Body.

export const dynamic = "force-dynamic";
const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (session.role !== "owner") return Response.json({ error: "Nur der Inhaber darf Daten übernehmen." }, { status: 403 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return Response.json({ error: "Keine Datei erhalten." }, { status: 400 });
  if (bytes.length > MAX_BYTES) return Response.json({ error: "Die Datei ist zu groß." }, { status: 400 });
  try {
    return Response.json(await importLugruDb(session.tenantId, bytes));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
