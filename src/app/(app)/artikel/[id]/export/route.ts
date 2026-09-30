import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { brandAllowed, canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { createZip } from "@/lib/ebay/export/zip";

// ZIP mit allen Bildern (01-hauptbild.jpg …) und den Texten – zum Hochladen in Seller Central,
// für den Fotografen oder als Sicherung.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !canAccess(session, "artikel")) return new Response("Nicht erlaubt", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const [a] = await db.select().from(schema.articles).where(and(eq(schema.articles.tenantId, session.tenantId), eq(schema.articles.id, id)));
  if (!a || (a.brandId && !brandAllowed(session.brandIds, session.role, a.brandId))) return new Response("Nicht gefunden", { status: 404 });
  const imgs = await db.select().from(schema.articleImages).where(and(eq(schema.articleImages.tenantId, session.tenantId), eq(schema.articleImages.articleId, a.id))).orderBy(schema.articleImages.position);
  const files = imgs.length ? await db.select().from(schema.files).where(and(eq(schema.files.tenantId, session.tenantId), inArray(schema.files.id, imgs.map((i) => i.fileId)))) : [];
  const ext = (m: string) => (m === "image/png" ? "png" : m === "image/webp" ? "webp" : m === "image/gif" ? "gif" : "jpg");
  const entries: { name: string; data: Uint8Array | string }[] = imgs.flatMap((img, n) => {
    const f = files.find((x) => x.id === img.fileId);
    return f ? [{ name: `bilder/${String(n + 1).padStart(2, "0")}${n === 0 ? "-hauptbild" : ""}.${ext(f.mimeType)}`, data: new Uint8Array(f.data) }] : [];
  });
  const text = [
    `SKU: ${a.sku}`,
    `Titel: ${a.title}`,
    a.ean ? `EAN: ${a.ean}` : "",
    a.asin ? `ASIN: ${a.asin}` : "",
    "",
    "Stichpunkte:",
    ...a.bullets.map((b) => `- ${b}`),
    "",
    "Beschreibung:",
    a.description ?? "",
    "",
    `Suchbegriffe: ${a.keywords ?? ""}`,
    "",
    "Inhalt:",
    ...a.contents.map((c) => `- ${c}`),
    "",
    ...Object.entries(a.food).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
  entries.push({ name: "texte.txt", data: text });
  const zip = createZip(entries);
  return new Response(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${a.sku.replace(/[^A-Za-z0-9_-]/g, "_")}.zip"`, "Cache-Control": "private, no-store" },
  });
}
