"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FeedMapping } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";

const uuid = z.string().uuid();

export async function createFeed(fd: FormData) {
  const session = await requireArea("wawi");
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const supplierId = uuid.safeParse(fd.get("supplierId")).success ? String(fd.get("supplierId")) : null;
  const [f] = await db.insert(schema.supplierFeeds).values({ tenantId: session.tenantId, name, supplierId }).returning({ id: schema.supplierFeeds.id });
  redirect(`/lieferanten/${f.id}`);
}

export type FeedState = { ok: boolean; message: string; headers?: string[] } | null;

export async function uploadFeed(_prev: FeedState, fd: FormData): Promise<FeedState> {
  const session = await requireArea("wawi");
  const feedId = uuid.parse(fd.get("feedId"));
  const [feed] = await db.select().from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, session.tenantId)));
  if (!feed) return { ok: false, message: "Feed nicht gefunden." };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Bitte Datei wählen." };
  const table = readTable(new Uint8Array(await file.arrayBuffer()));
  const pick = (k: keyof FeedMapping) => String(fd.get(`map_${k}`) ?? "") || feed.mapping[k] || "";
  const mapping: FeedMapping = { ean: pick("ean"), asin: pick("asin"), supplierSku: pick("supplierSku"), title: pick("title"), price: pick("price"), stock: pick("stock") };
  if (!mapping.supplierSku || !table.headers.includes(mapping.supplierSku)) {
    return { ok: false, message: "Bitte die Spalten zuordnen (mindestens Lieferanten-Artikelnummer).", headers: table.headers };
  }
  const idx = (h?: string) => (h ? table.headers.indexOf(h) : -1);
  const col = { ean: idx(mapping.ean), asin: idx(mapping.asin), sku: idx(mapping.supplierSku), title: idx(mapping.title), price: idx(mapping.price), stock: idx(mapping.stock) };
  const values = table.rows
    .map((r) => ({
      tenantId: session.tenantId,
      feedId,
      supplierSku: (r[col.sku] ?? "").trim(),
      ean: col.ean >= 0 ? (r[col.ean] ?? "").replace(/\D/g, "") || null : null,
      asin: col.asin >= 0 ? (r[col.asin] ?? "").trim().toUpperCase() || null : null,
      title: col.title >= 0 ? (r[col.title] ?? "").trim() || null : null,
      price: col.price >= 0 ? parseAmount(r[col.price]) : null,
      stock: col.stock >= 0 ? Math.round(parseAmount(r[col.stock]) ?? 0) : null,
    }))
    .filter((v) => v.supplierSku);
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(schema.supplierOffers)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [schema.supplierOffers.feedId, schema.supplierOffers.supplierSku],
        set: { ean: sql`excluded.ean`, asin: sql`excluded.asin`, title: sql`excluded.title`, price: sql`excluded.price`, stock: sql`excluded.stock`, updatedAt: new Date() },
      });
  }
  await db.update(schema.supplierFeeds).set({ mapping, lastImportAt: new Date() }).where(eq(schema.supplierFeeds.id, feedId));
  revalidatePath(`/lieferanten/${feedId}`);
  return { ok: true, message: `${values.length} Angebote übernommen.` };
}

export async function offerToListing(fd: FormData) {
  const session = await requireArea("wawi");
  const id = uuid.parse(fd.get("offerId"));
  const [o] = await db.select().from(schema.supplierOffers).where(and(eq(schema.supplierOffers.id, id), eq(schema.supplierOffers.tenantId, session.tenantId)));
  if (!o) return;
  const price = parseAmount(fd.get("price"));
  await db
    .insert(schema.listings)
    .values({ tenantId: session.tenantId, channel: "ebay", sku: `L-${o.supplierSku}`.slice(0, 50), title: (o.title ?? o.supplierSku).slice(0, 80), ean: o.ean, price, quantity: Math.max(0, o.stock ?? 0), payload: { supplierOfferId: o.id } })
    .onConflictDoNothing();
  redirect(`/listings?kanal=ebay&sku=${encodeURIComponent(`L-${o.supplierSku}`.slice(0, 50))}`);
}
