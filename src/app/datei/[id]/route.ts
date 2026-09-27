import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";

// Liefert eine gespeicherte Datei (Label-PDF, Rechnung) – nur für den eigenen Mandanten.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const [f] = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.tenantId, session.tenantId)));
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `inline; filename="${f.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
