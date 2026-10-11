import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/db";
import { isLoggedIn } from "@/lib/auth";

/** Erlaubte Vorschaugrößen (?w=…) – kleine Bilder für Listen statt des vollen Fotos, spart am Handy viel Datenvolumen. */
const SIZES = new Set([200, 400]);

// Liefert ein gespeichertes Foto – nur angemeldet.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Nicht angemeldet", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, id));
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  const headers = {
    // Fotos ändern sich nie (neues Foto = neue Datei)
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  const w = Number(new URL(req.url).searchParams.get("w"));
  if (SIZES.has(w)) {
    try {
      const small = await sharp(f.data, { failOn: "none" }).rotate().resize(w, w, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
      return new Response(new Uint8Array(small), { headers: { ...headers, "Content-Type": "image/jpeg" } });
    } catch {
      // Nicht verkleinerbar – dann das Original
    }
  }
  return new Response(new Uint8Array(f.data), {
    headers: { ...headers, "Content-Type": f.mimeType, "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "")}"` },
  });
}
