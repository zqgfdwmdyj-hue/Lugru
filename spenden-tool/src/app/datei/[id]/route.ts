import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLoggedIn } from "@/lib/auth";

// Liefert ein gespeichertes Foto – nur angemeldet.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Nicht angemeldet", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, id));
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "")}"`,
      // Fotos ändern sich nie (neues Foto = neue Datei)
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
