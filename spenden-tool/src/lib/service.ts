import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DONATION_CATEGORIES } from "@/lib/layout";

const P = schema.products;
const E = schema.events;
const I = schema.eventItems;

/** Bilder, die angenommen werden. SVG bewusst nicht (könnte Skripte enthalten). */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export async function storeImage(file: File): Promise<string | null> {
  if (!file.size || file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(file.type)) return null;
  const data = Buffer.from(await file.arrayBuffer());
  const [f] = await db
    .insert(schema.files)
    .values({ name: file.name || "foto.jpg", mimeType: file.type, size: data.length, sha256: sha256(data), data })
    .returning({ id: schema.files.id });
  return f.id;
}

/** Produkt, dessen Foto genau dieses Bild ist (gleiche Datei erneut hochgeladen). */
export async function productByImage(file: File): Promise<string | null> {
  const hash = sha256(Buffer.from(await file.arrayBuffer()));
  const [row] = await db
    .select({ id: P.id })
    .from(P)
    .innerJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .where(eq(schema.files.sha256, hash))
    .orderBy(asc(P.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function loadEvent(id: string) {
  const [event] = await db.select().from(E).where(eq(E.id, id));
  return event ?? null;
}

export async function loadEventItems(eventId: string) {
  return db.select({ item: I, product: P }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.eventId, eventId)).orderBy(asc(I.sort), asc(I.createdAt));
}

/** Zuletzt verwendeter Preis je Produkt (aus früheren Verteilungen). */
export async function lastPrices(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([I.productId], { productId: I.productId, price: I.price })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(and(inArray(I.productId, productIds), sql`${I.price} is not null`))
    .orderBy(I.productId, desc(E.eventDate), desc(I.createdAt));
  return new Map(rows.filter((r) => r.price !== null).map((r) => [r.productId, r.price as number]));
}

type Preset = { price: number | null; priceNote: string | null; caption: string | null };

/** Nimmt Produkte in eine Verteilung auf (bereits enthaltene werden übersprungen). */
export async function addProductsToEvent(eventId: string, productIds: string[], presets?: Map<string, Preset>) {
  if (productIds.length === 0) return 0;
  const products = await db.select({ id: P.id, price: P.price }).from(P).where(inArray(P.id, productIds));
  if (products.length === 0) return 0;
  const last = await lastPrices(products.map((p) => p.id));
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${I.sort}), 0)::int` }).from(I).where(eq(I.eventId, eventId));
  const order = new Map(productIds.map((id, i) => [id, i]));
  products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const inserted = await db
    .insert(I)
    .values(
      products.map((p, i) => {
        const given = presets?.get(p.id);
        return {
          eventId,
          productId: p.id,
          price: given ? given.price : (last.get(p.id) ?? p.price ?? null),
          priceNote: given?.priceNote ?? null,
          caption: given?.caption ?? null,
          sort: max + (i + 1) * 10,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: I.id });
  await db.update(E).set({ updatedAt: new Date() }).where(eq(E.id, eventId));
  return inserted.length;
}

/** Wann und zu welchem Preis ein Produkt dabei war. */
export async function productHistory(productId: string) {
  return db
    .select({ eventId: E.id, eventDate: E.eventDate, title: E.title, price: I.price, priceNote: I.priceNote, quantity: I.quantity })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(eq(I.productId, productId))
    .orderBy(desc(E.eventDate));
}

/** Vorgegebene und bereits benutzte Kategorien – für die Auswahlliste. */
export async function knownCategories(): Promise<string[]> {
  const rows = await db.selectDistinct({ c: P.category }).from(P);
  const set = new Set<string>(DONATION_CATEGORIES);
  for (const r of rows) set.add(r.c);
  return [...set];
}

const escapeLike = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
export const productStats = {
  lastUsed: sql<string | null>`(select max(e.event_date)::text from event_items i join events e on e.id = i.event_id where i.product_id = products.id)`,
  times: sql<number>`(select count(*)::int from event_items i where i.product_id = products.id)`,
};

/** Produkte, die noch nicht in der Verteilung sind – zuletzt benutzte zuerst. */
export async function productPicker(eventId: string, q: string) {
  const like = escapeLike(q);
  return db
    .select({ p: P, ...productStats })
    .from(P)
    .where(
      and(
        eq(P.archived, false),
        sql`not exists (select 1 from event_items i where i.event_id = ${eventId} and i.product_id = products.id)`,
        q ? sql`(${P.name} ilike ${like} or ${P.variant} ilike ${like} or ${P.category} ilike ${like})` : undefined,
      ),
    )
    .orderBy(sql`${productStats.lastUsed} desc nulls last`, asc(P.name))
    .limit(80);
}

export async function searchProducts(opts: { q: string; category: string; archived: boolean }) {
  const like = escapeLike(opts.q);
  return db
    .select({ p: P, ...productStats })
    .from(P)
    .where(
      and(
        eq(P.archived, opts.archived),
        opts.category ? eq(P.category, opts.category) : undefined,
        opts.q ? sql`(${P.name} ilike ${like} or ${P.variant} ilike ${like} or ${P.note} ilike ${like})` : undefined,
      ),
    )
    .orderBy(asc(P.category), asc(P.name), asc(P.variant))
    .limit(500);
}

/** Letzte Preisrecherche je Produkt. */
export async function latestPriceChecks(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, typeof schema.priceChecks.$inferSelect>();
  const rows = await db
    .selectDistinctOn([schema.priceChecks.productId])
    .from(schema.priceChecks)
    .where(inArray(schema.priceChecks.productId, productIds))
    .orderBy(schema.priceChecks.productId, desc(schema.priceChecks.createdAt));
  return new Map(rows.map((r) => [r.productId, r]));
}
