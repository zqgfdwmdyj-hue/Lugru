import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resolveShareLink } from "@/lib/pallets/shipment-service";

// Foto einer Sendung für den Kunden-Link – nur solange der Link gilt und nur Fotos, die für den Kunden
// freigegeben sind. Ohne Anmeldung (der zufällige Link ist der Schlüssel).
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return new Response("Nicht gefunden", { status: 404 });
  const r = await resolveShareLink(token);
  if (!r || !r.photos.includes(fileId)) return new Response("Nicht gefunden", { status: 404 });
  const [f] = await db.select({ data: schema.files.data, mimeType: schema.files.mimeType }).from(schema.files).where(and(eq(schema.files.tenantId, r.link.tenantId), eq(schema.files.id, fileId)));
  if (!f || !f.mimeType.startsWith("image/")) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { "Content-Type": f.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" },
  });
}
