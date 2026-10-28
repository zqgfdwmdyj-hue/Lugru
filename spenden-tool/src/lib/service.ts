import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MorePack, PriceBox } from "@/db/schema";
import { DONATION_CATEGORIES, flyerSections } from "@/lib/layout";
import { isDrink, LEGACY_CATEGORIES, packOffers, UNSORTED_CATEGORY } from "@/lib/price-logic";
import sharp from "sharp";
import { closestPhoto, photoHash, photoMatch } from "@/lib/image-hash";

const P = schema.products;
const E = schema.events;
const I = schema.eventItems;

/** Bilder, die angenommen werden. SVG bewusst nicht (könnte Skripte enthalten). */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

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

/** Fotos, die weder Produktfoto noch MHD-Foto sind (ersetzt, entfernt, Produkt zusammengeführt/gelöscht). */
// Erst nach einer Stunde – ein Foto, das gerade hochgeladen wird, ist kurz noch keinem Produkt zugeordnet.
const orphanFilter = sql`not exists (select 1 from products p where p.image_file_id = files.id)
  and not exists (select 1 from product_photos pp where pp.file_id = files.id)
  and not exists (select 1 from event_items i where i.best_before_file_id = files.id)
  and files.created_at < now() - interval '1 hour'`;

export async function orphanFileStats() {
  const [r] = await db.select({ count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint` }).from(schema.files).where(orphanFilter);
  return { count: Number(r.count), bytes: Number(r.bytes) };
}

export async function deleteOrphanFiles() {
  const stats = await orphanFileStats();
  await db.delete(schema.files).where(orphanFilter);
  return stats;
}

/**
 * Produktfoto drehen (im Uhrzeigersinn um 90/180/270 Grad). Es entsteht eine neue Datei – Fotos werden lange im
 * Browser zwischengespeichert, eine geänderte Datei unter derselben Adresse käme nicht an. Die Lage eines
 * aufgedruckten Preises wird mitgedreht; die alte Datei räumt „Aufräumen“ später weg.
 */
export async function rotateProductPhoto(productId: string, degrees: 90 | 180 | 270): Promise<string | null> {
  const [p] = await db.select({ fileId: P.imageFileId }).from(P).where(eq(P.id, productId));
  if (!p?.fileId) return null;
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, p.fileId));
  if (!f) return null;
  // Erst die Kamera-Ausrichtung (EXIF) anwenden, dann drehen.
  const upright = await sharp(f.data, { failOn: "none" }).rotate().toBuffer();
  const png = f.mimeType === "image/png";
  const turned = sharp(upright).rotate(degrees);
  const data = png ? await turned.png().toBuffer() : await turned.jpeg({ quality: 90 }).toBuffer();
  const b = f.printedPriceBox;
  const box = !b ? null : degrees === 90 ? { x: 1 - b.y - b.h, y: b.x, w: b.h, h: b.w } : degrees === 180 ? { x: 1 - b.x - b.w, y: 1 - b.y - b.h, w: b.w, h: b.h } : { x: b.y, y: 1 - b.x - b.w, w: b.h, h: b.w };
  const [nf] = await db
    .insert(schema.files)
    .values({
      name: f.name,
      mimeType: png ? "image/png" : "image/jpeg",
      size: data.length,
      sha256: sha256(data),
      phash: (await photoHash(data)) ?? "",
      data,
      printedStatus: f.printedStatus,
      printedPrice: f.printedPrice,
      printedPriceText: f.printedPriceText,
      printedPriceBox: box,
      printedScannedAt: f.printedScannedAt,
    })
    .returning({ id: schema.files.id });
  await db.update(P).set({ imageFileId: nf.id, updatedAt: new Date() }).where(eq(P.id, productId));
  return nf.id;
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
  // Ältere Fotos bekommen ihren Fingerabdruck beim Start (scripts/migrate.ts); hier nur noch ein kleiner Rest.
  await backfillPhotoHashes(20);
  const main = await db
    .select({ productId: P.id, sha: schema.files.sha256, hash: schema.files.phash, createdAt: P.createdAt })
    .from(P)
    .innerJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .orderBy(asc(P.createdAt));
  // Rückseiten/Infofotos zählen mit: dieselbe Rückseite noch einmal hochgeladen → vorhandenes Produkt.
  const extra = await db
    .select({ productId: schema.productPhotos.productId, sha: schema.files.sha256, hash: schema.files.phash, createdAt: schema.productPhotos.createdAt })
    .from(schema.productPhotos)
    .innerJoin(schema.files, eq(schema.files.id, schema.productPhotos.fileId));
  return [...main, ...extra];
}

/** Rückseiten/Infofotos je Produkt (Datei-IDs, älteste zuerst). */
export async function extraPhotos(productIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (productIds.length === 0) return map;
  const rows = await db
    .select({ productId: schema.productPhotos.productId, fileId: schema.productPhotos.fileId })
    .from(schema.productPhotos)
    .where(inArray(schema.productPhotos.productId, productIds))
    .orderBy(asc(schema.productPhotos.createdAt));
  for (const r of rows) map.set(r.productId, [...(map.get(r.productId) ?? []), r.fileId]);
  return map;
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
  // Ein Produkt mit Vorder- und Rückseite steht zweimal im Index – nur verschiedene Produkte zählen.
  return groups.map((g) => [...new Set(g.ids)]).filter((ids) => ids.length > 1);
}

export async function loadEvent(id: string) {
  const [event] = await db.select().from(E).where(eq(E.id, id));
  return event ?? null;
}

const F = schema.files;
/** Was über das Produktfoto bekannt ist – ohne die Bilddaten selbst. */
const photoInfo = { status: F.printedStatus, price: F.printedPrice, text: F.printedPriceText, box: F.printedPriceBox, reader: F.printedReader };

export async function loadEventItems(eventId: string) {
  return db
    .select({ item: I, product: P, photo: photoInfo })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .leftJoin(F, eq(F.id, P.imageFileId))
    .where(eq(I.eventId, eventId))
    .orderBy(asc(I.sort), asc(I.createdAt));
}

/** Aushang/Messenger: Produkte mit Häkchen „Aushang“, gruppiert – überall dieselbe Preislogik (lib/price-logic.ts). */
export function eventFlyerSections(rows: Awaited<ReturnType<typeof loadEventItems>>) {
  return flyerSections(
    rows
      .filter((r) => r.item.inFlyer)
      .map((r) => ({ ...r.product, price: r.item.price, priceNote: r.item.priceNote, unit: r.item.unit, unitCount: r.item.unitCount, bestBefore: r.item.bestBefore, packs: packOffers(r.item, isDrink(r.product), r.product.variant) })),
  );
}

/** Zuletzt verwendeter Preis je Produkt (aus früheren Verteilungen) – mit Bestätigt-Status. */
export async function lastPrices(productIds: string[]): Promise<Map<string, { price: number; confirmed: boolean }>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([I.productId], { productId: I.productId, price: I.price, confirmed: I.priceConfirmed })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(and(inArray(I.productId, productIds), sql`${I.price} is not null`))
    .orderBy(I.productId, desc(E.eventDate), desc(I.createdAt));
  return new Map(rows.filter((r) => r.price !== null).map((r) => [r.productId, { price: r.price as number, confirmed: r.confirmed }]));
}

type Preset = { price: number | null; priceNote: string | null; caption: string | null; packNote?: string | null; packPrice?: number | null; unit?: "stueck" | "packung" | "karton" | "kasten" | "tray" | "palette" | null; unitCount?: number | null; packKind?: "karton" | "kasten" | "packung" | "tray" | "palette" | null; packCount?: number | null; morePacks?: MorePack[]; priceConfirmed?: boolean; priceSource?: "manuell" | "foto" | "ki" | "vorlage" | null };

/** Nimmt Produkte in eine Verteilung auf (bereits enthaltene werden übersprungen). */
export async function addProductsToEvent(eventId: string, productIds: string[], presets?: Map<string, Preset>) {
  if (productIds.length === 0) return 0;
  const products = await db.select({ id: P.id, price: P.price, confirmed: P.priceConfirmed, defaults: P.itemDefaults }).from(P).where(inArray(P.id, productIds));
  if (products.length === 0) return 0;
  const last = await lastPrices(products.map((p) => p.id));
  // Abgabeeinheit und Varianten (Packung, Karton …) vom letzten Mal übernehmen – einmal angelegt, immer wieder auswählbar.
  const prevSetup = presets ? new Map<string, typeof I.$inferSelect>() : await lastItemSetup(products.map((p) => p.id));
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${I.sort}), 0)::int` }).from(I).where(eq(I.eventId, eventId));
  const order = new Map(productIds.map((id, i) => [id, i]));
  products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const inserted = await db
    .insert(I)
    .values(
      products.map((p, i) => {
        // Vorlage aus der Produktkartei hat Vorrang vor dem letzten Mal.
        const setup = p.defaults ?? prevSetup.get(p.id);
        const given = presets?.get(p.id) ?? (setup ? { price: null, priceNote: setup.priceNote, caption: p.defaults?.caption ?? null, unit: setup.unit, unitCount: setup.unitCount, packNote: setup.packNote, packKind: setup.packKind, packCount: setup.packCount, packPrice: setup.packPrice, morePacks: setup.morePacks, fromSetup: true } : undefined);
        const prev = last.get(p.id);
        const fromSetup = !!given && "fromSetup" in given;
        const price = given && !fromSetup ? given.price : (prev?.price ?? p.price ?? null);
        // Bestätigt nur, wenn der Preis dort schon bestätigt war – unbestätigte Foto-/KI-Preise bleiben zur Prüfung.
        const confirmed = given && !fromSetup ? (given.priceConfirmed ?? false) : prev ? prev.confirmed : p.confirmed;
        return {
          eventId,
          productId: p.id,
          price,
          priceSource: price === null ? null : ((given && !fromSetup ? given.priceSource : null) ?? ("vorlage" as const)),
          priceConfirmed: price !== null && confirmed,
          unit: given?.unit ?? null,
          unitCount: given?.unitCount ?? null,
          priceNote: given?.priceNote ?? null,
          caption: given?.caption ?? null,
          packNote: given?.packNote ?? null,
          packKind: given?.packKind ?? null,
          packCount: given?.packCount ?? null,
          packPrice: given?.packPrice ?? null,
          morePacks: given?.morePacks ?? [],
          unitConfirmed: fromSetup && !!given?.unit,
          ...(p.defaults && !presets?.get(p.id) ? { inCollage: p.defaults.inCollage, inFlyer: p.defaults.inFlyer } : {}),
          sort: max + (i + 1) * 10,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: I.id });
  await db.update(E).set({ updatedAt: new Date() }).where(eq(E.id, eventId));
  return inserted.length;
}

/** Abgabeeinheit und Varianten aus der letzten Verteilung je Produkt (nur, wo etwas festgelegt war). */
async function lastItemSetup(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, typeof I.$inferSelect>();
  const rows = await db
    .selectDistinctOn([I.productId], { item: I })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(and(inArray(I.productId, productIds), sql`(${I.unit} is not null or ${I.packPrice} is not null or jsonb_array_length(${I.morePacks}) > 0)`))
    .orderBy(I.productId, desc(E.eventDate), desc(I.createdAt));
  return new Map(rows.map((r) => [r.item.productId, r.item]));
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
  // Alte Sammelkategorien („Drogerie & Haushalt“, „Hautpflege“, „Haarpflege“) nicht mehr anbieten – Produkte darin
  // zeigen ihren Wert weiter an und erscheinen unter „Kategorie prüfen“.
  for (const r of rows) if (!(LEGACY_CATEGORIES as readonly string[]).includes(r.c)) set.add(r.c);
  set.add(UNSORTED_CATEGORY);
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

export const PRODUCT_FILTERS = {
  "ohne-preis": "Ohne Preis",
  pruefen: "Unbestätigte Angaben",
  zuletzt: "Zuletzt verwendet",
} as const;
export type ProductFilter = keyof typeof PRODUCT_FILTERS;

export async function searchProducts(opts: { q: string; category: string; archived: boolean; filter?: ProductFilter | null }) {
  const like = escapeLike(opts.q);
  const f = opts.filter;
  return db
    .select({ p: P, ...productStats })
    .from(P)
    .where(
      and(
        eq(P.archived, opts.archived),
        opts.category ? eq(P.category, opts.category) : undefined,
        opts.q ? sql`(${P.name} ilike ${like} or ${P.variant} ilike ${like} or ${P.note} ilike ${like})` : undefined,
        f === "ohne-preis" ? sql`${P.price} is null` : undefined,
        // Von der KI eingetragen und noch nicht bestätigt, oder Kategorie noch offen
        f === "pruefen" ? sql`(${P.reviewNote} is not null or ${P.category} = ${UNSORTED_CATEGORY})` : undefined,
        f === "zuletzt" ? sql`${productStats.lastUsed} is not null` : undefined,
      ),
    )
    .orderBy(...(f === "zuletzt" ? [sql`${productStats.lastUsed} desc`, asc(P.name)] : [asc(P.category), asc(P.name), asc(P.variant)]))
    .limit(f === "zuletzt" ? 120 : 500);
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
