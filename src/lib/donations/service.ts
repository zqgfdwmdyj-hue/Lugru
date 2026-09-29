import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DONATION_CATEGORIES } from "@/lib/donations/layout";
import { storeFile } from "@/lib/orders/service";

const P = schema.donationProducts;
const E = schema.donationEvents;
const I = schema.donationEventItems;

/** Bilder, die angenommen werden. SVG bewusst nicht (könnte Skripte enthalten). */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export async function storeImage(tenantId: string, file: File): Promise<string | null> {
  if (!file.size || file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(file.type)) return null;
  return storeFile(tenantId, file.name || "foto.jpg", file.type, Buffer.from(await file.arrayBuffer()));
}

/** Produkt, dessen Foto genau dieses Bild ist (gleiche Datei erneut hochgeladen). */
export async function productByImage(tenantId: string, file: File): Promise<string | null> {
  const sha = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  const [row] = await db
    .select({ id: P.id })
    .from(P)
    .innerJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .where(and(eq(P.tenantId, tenantId), eq(schema.files.tenantId, tenantId), eq(schema.files.sha256, sha)))
    .orderBy(asc(P.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function loadEvent(tenantId: string, id: string) {
  const [event] = await db.select().from(E).where(and(eq(E.id, id), eq(E.tenantId, tenantId)));
  return event ?? null;
}

export async function loadEventItems(tenantId: string, eventId: string) {
  return db
    .select({ item: I, product: P })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .where(and(eq(I.tenantId, tenantId), eq(I.eventId, eventId)))
    .orderBy(asc(I.sort), asc(I.createdAt));
}

/** Zuletzt verwendeter Preis je Produkt (aus früheren Aktionen), sonst der Produktpreis. */
export async function lastPrices(tenantId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([I.productId], { productId: I.productId, price: I.price })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(and(eq(I.tenantId, tenantId), inArray(I.productId, productIds), sql`${I.price} is not null`))
    .orderBy(I.productId, desc(E.eventDate), desc(I.createdAt));
  return new Map(rows.filter((r) => r.price !== null).map((r) => [r.productId, r.price as number]));
}

/** Nimmt Produkte in eine Aktion auf (bereits enthaltene werden übersprungen). */
export async function addProductsToEvent(tenantId: string, eventId: string, productIds: string[], prices?: Map<string, { price: number | null; priceNote: string | null; caption: string | null }>) {
  if (productIds.length === 0) return 0;
  const products = await db.select({ id: P.id, price: P.price }).from(P).where(and(eq(P.tenantId, tenantId), inArray(P.id, productIds)));
  if (products.length === 0) return 0;
  const last = await lastPrices(tenantId, products.map((p) => p.id));
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${I.sort}), 0)::int` }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.eventId, eventId)));
  const order = new Map(productIds.map((id, i) => [id, i]));
  products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const inserted = await db
    .insert(I)
    .values(
      products.map((p, i) => {
        const given = prices?.get(p.id);
        return {
          tenantId,
          eventId,
          productId: p.id,
          price: given ? given.price : last.get(p.id) ?? p.price ?? null,
          priceNote: given?.priceNote ?? null,
          caption: given?.caption ?? null,
          sort: max + (i + 1) * 10,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: I.id });
  await db.update(E).set({ updatedAt: new Date() }).where(and(eq(E.id, eventId), eq(E.tenantId, tenantId)));
  return inserted.length;
}

/** Wie oft und wann ein Produkt dabei war – für die Produktseite. */
export async function productHistory(tenantId: string, productId: string) {
  return db
    .select({ eventId: E.id, eventDate: E.eventDate, title: E.title, price: I.price, priceNote: I.priceNote, quantity: I.quantity })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(and(eq(I.tenantId, tenantId), eq(I.productId, productId)))
    .orderBy(desc(E.eventDate));
}

/** Vorgegebene und bereits benutzte Kategorien – für die Auswahlliste. */
export async function knownCategories(tenantId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ c: P.category }).from(P).where(eq(P.tenantId, tenantId));
  const set = new Set<string>(DONATION_CATEGORIES);
  for (const r of rows) set.add(r.c);
  return [...set];
}

/** Produkte aus der Datenbank, die noch nicht in der Aktion sind – zuletzt benutzte zuerst. */
export async function productPicker(tenantId: string, eventId: string, q: string) {
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const lastUsed = sql<string | null>`(select max(e.event_date)::text from donation_event_items i join donation_events e on e.id = i.event_id where i.product_id = donation_products.id)`;
  return db
    .select({
      p: P,
      lastUsed,
      times: sql<number>`(select count(*)::int from donation_event_items i where i.product_id = donation_products.id)`,
    })
    .from(P)
    .where(
      and(
        eq(P.tenantId, tenantId),
        eq(P.archived, false),
        sql`not exists (select 1 from donation_event_items i where i.event_id = ${eventId} and i.product_id = donation_products.id)`,
        q ? sql`(${P.name} ilike ${like} or ${P.variant} ilike ${like} or ${P.category} ilike ${like})` : undefined,
      ),
    )
    .orderBy(sql`${lastUsed} desc nulls last`, asc(P.name))
    .limit(80);
}
