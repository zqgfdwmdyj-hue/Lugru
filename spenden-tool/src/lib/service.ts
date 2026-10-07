import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PriceBox } from "@/db/schema";
import type { PrintedInfo } from "@/lib/printed-price";
import { DONATION_CATEGORIES } from "@/lib/layout";
import { closestPhoto, photoHash, photoMatch } from "@/lib/image-hash";

const P = schema.products;
const E = schema.events;
const I = schema.eventItems;

/** Bilder, die angenommen werden. SVG bewusst nicht (könnte Skripte enthalten). */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Prüft die ersten Bytes – der Dateityp allein sagt nichts (z. B. HEIC mit falscher Endung). */
export function looksLikeImage(data: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  return (
    (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) ||
    (data[0] === 0x89 && ascii(1, 4) === "PNG") ||
    ascii(0, 4) === "GIF8" ||
    (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
  );
}

/** Geprüftes Bild mit Prüfsumme und Fingerabdruck – noch nicht gespeichert. */
export type CheckedImage = { name: string; mimeType: string; data: Buffer; sha: string; hash: string | null };

export async function checkImage(file: File): Promise<CheckedImage | null> {
  if (!file.size || file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(file.type)) return null;
  const data = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(data)) return null;
  return { name: file.name || "foto.jpg", mimeType: file.type, data, sha: sha256(data), hash: await photoHash(data) };
}

export async function storeChecked(img: CheckedImage): Promise<string> {
  const [f] = await db
    .insert(schema.files)
    .values({ name: img.name, mimeType: img.mimeType, size: img.data.length, sha256: img.sha, phash: img.hash, data: img.data })
    .returning({ id: schema.files.id });
  return f.id;
}

export async function storeImage(file: File): Promise<string | null> {
  const img = await checkImage(file);
  return img ? storeChecked(img) : null;
}

/** Fingerabdrücke für ältere Fotos nachtragen (vor dieser Funktion hochgeladen). */
export async function backfillPhotoHashes(limit = 300) {
  const rows = await db.select({ id: schema.files.id, data: schema.files.data }).from(schema.files).where(sql`${schema.files.phash} is null`).limit(limit);
  for (const r of rows) {
    // Nicht lesbare Bilder bekommen "" – so werden sie nicht bei jedem Aufruf erneut versucht.
    await db.update(schema.files).set({ phash: (await photoHash(r.data)) ?? "" }).where(eq(schema.files.id, r.id));
  }
  return rows.length;
}

export type PhotoEntry = { productId: string; sha: string; hash: string | null; createdAt: Date };

/** Alle Produktfotos mit Prüfsumme und Fingerabdruck – zum Wiedererkennen beim Hochladen. */
export async function photoIndex(): Promise<PhotoEntry[]> {
  await backfillPhotoHashes();
  return db
    .select({ productId: P.id, sha: schema.files.sha256, hash: schema.files.phash, createdAt: P.createdAt })
    .from(P)
    .innerJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .orderBy(asc(P.createdAt));
}

/**
 * Gibt es dieses Foto schon? „gleich“: dieselbe Datei; „wiedererkannt“: dasselbe Foto verkleinert/neu gespeichert
 * (vorhandenes Produkt wird genommen); „ähnlich“: nur ähnlich – wird neu angelegt, aber als mögliches Doppel markiert.
 */
export function findPhoto(img: CheckedImage, index: PhotoEntry[]): { productId: string; how: "gleich" | "wiedererkannt" | "ähnlich" } | null {
  const exact = index.find((e) => e.sha === img.sha);
  if (exact) return { productId: exact.productId, how: "gleich" };
  const near = closestPhoto(img.hash, index);
  if (!near) return null;
  return { productId: near.productId, how: near.match === "gleich" ? "wiedererkannt" : "ähnlich" };
}

/** Produkte mit (fast) demselben Foto wie dieses – für „Doppelt angelegt?“. */
export async function productsWithSamePhoto(productId: string) {
  const index = await photoIndex();
  const me = index.find((e) => e.productId === productId);
  if (!me) return [];
  return index
    .filter((e) => e.productId !== productId)
    .map((e) => ({ productId: e.productId, match: e.sha === me.sha ? ("gleich" as const) : photoMatch(me.hash, e.hash) }))
    .filter((e): e is { productId: string; match: "gleich" | "ähnlich" } => e.match !== null);
}

/**
 * Gruppen von Produkten mit (fast) demselben Foto – für „Mögliche Doppelte“. Jede Gruppe hat das älteste Produkt
 * als Anker; nur was zum Anker passt, kommt dazu (keine Ketten aus jeweils leicht ähnlichen Fotos).
 */
export async function duplicatePhotoGroups(): Promise<string[][]> {
  const index = await photoIndex();
  const groups: { anchor: PhotoEntry; ids: string[] }[] = [];
  for (const e of index) {
    const g = groups.find((g) => g.anchor.sha === e.sha || photoMatch(g.anchor.hash, e.hash));
    if (g) g.ids.push(e.productId);
    else groups.push({ anchor: e, ids: [e.productId] });
  }
  return groups.map((g) => g.ids).filter((ids) => ids.length > 1);
}

export async function loadEvent(id: string) {
  const [event] = await db.select().from(E).where(eq(E.id, id));
  return event ?? null;
}

const F = schema.files;
/** Was über das Produktfoto bekannt ist – ohne die Bilddaten selbst. */
const photoInfo = { status: F.printedStatus, price: F.printedPrice, text: F.printedPriceText, box: F.printedPriceBox };

export async function loadEventItems(eventId: string) {
  return db
    .select({ item: I, product: P, photo: photoInfo })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .leftJoin(F, eq(F.id, P.imageFileId))
    .where(eq(I.eventId, eventId))
    .orderBy(asc(I.sort), asc(I.createdAt));
}

/** Preis, der schon im Foto steht – null, wenn keiner (oder noch nicht gelesen). */
export function printedInfo(photo: { price: number | null; text: string | null; box: unknown } | null): PrintedInfo {
  return photo?.text ? { price: photo.price, text: photo.text, box: (photo.box as PriceBox | null) ?? null } : null;
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
    .select({ eventId: E.id, eventDate: E.eventDate, title: E.title, price: I.price, priceNote: I.priceNote, quantity: I.quantity, bestBefore: I.bestBefore })
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
