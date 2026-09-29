import { getSession } from "@/lib/auth/session";
import { importLegacyTodos } from "@/lib/amazon-todos/import";

// Übernahme aus dem Retouren-Tool: die Datei app.db als Rohdaten im Body.
// Eigener Weg statt Server Action, weil die app.db leicht größer als 20 MB ist.

export const dynamic = "force-dynamic";
const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (session.role !== "owner") return Response.json({ error: "Nur der Inhaber darf Daten übernehmen." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Die Dateien sind zusammen größer als 500 MB." }, { status: 400 });
  // Mehrere Dateien: app.db und (falls vorhanden) app.db-wal.
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const main = files.find((f) => !/-(wal|shm)$/i.test(f.name));
  const wal = files.find((f) => /-wal$/i.test(f.name));
  if (!main) return Response.json({ error: "Bitte die app.db auswählen (optional zusätzlich app.db-wal)." }, { status: 400 });
  try {
    return Response.json(await importLegacyTodos(session.tenantId, new Uint8Array(await main.arrayBuffer()), wal ? new Uint8Array(await wal.arrayBuffer()) : undefined));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: /not a database|file is not a database/i.test(msg) ? "Die Datei ist keine SQLite-Datenbank – bitte die app.db auswählen." : msg }, { status: 400 });
  }
}
