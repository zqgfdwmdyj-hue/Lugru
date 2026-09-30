import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Öffentlicher Link auf ein Artikelbild – nur über die zufällige Kennung erreichbar (Amazon lädt
// Produktbilder per URL). Ohne Anmeldung, liefert ausschließlich Bilder aus dem Artikelstamm.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return new Response("Nicht gefunden", { status: 404 });
  const [row] = await db
    .select({ data: schema.files.data, mimeType: schema.files.mimeType })
    .from(schema.articleImages)
    .innerJoin(schema.files, eq(schema.files.id, schema.articleImages.fileId))
    .where(eq(schema.articleImages.publicToken, token));
  if (!row || !row.mimeType.startsWith("image/")) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: { "Content-Type": row.mimeType, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
