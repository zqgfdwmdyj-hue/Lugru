"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { publishListing } from "@/lib/listings/publish";
import { parseAmount } from "@/lib/numbers";

const uuid = z.string().uuid();

export async function saveListing(fd: FormData) {
  const session = await requireArea("wawi");
  const channel = z.enum(CHANNELS).parse(fd.get("channel"));
  const sku = String(fd.get("sku") ?? "").trim();
  if (!sku) return;
  const [lot] = await db
    .select({ productId: schema.lots.productId, title: schema.products.title, ean: schema.products.ean, asin: schema.products.asin })
    .from(schema.lots)
    .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
    .where(and(eq(schema.lots.tenantId, session.tenantId), eq(schema.lots.sku, sku)));
  const title = String(fd.get("title") ?? "").trim() || lot?.title || sku;
  await db
    .insert(schema.listings)
    .values({
      tenantId: session.tenantId,
      channel,
      sku,
      productId: lot?.productId ?? null,
      title: title.slice(0, 80),
      description: String(fd.get("description") ?? "").trim() || null,
      ean: String(fd.get("ean") ?? "").trim() || lot?.ean || null,
      condition: String(fd.get("condition") ?? "NEW"),
      price: parseAmount(fd.get("price")),
      quantity: Math.max(0, Math.round(parseAmount(fd.get("quantity")) ?? 1)),
      payload: {
        categoryId: String(fd.get("categoryId") ?? "").trim() || undefined,
        imageUrls: String(fd.get("imageUrls") ?? "").split(/\s+/).filter((u) => /^https:\/\//.test(u)),
      },
    })
    .onConflictDoUpdate({
      target: [schema.listings.tenantId, schema.listings.channel, schema.listings.sku],
      set: { payload: sql`excluded.payload`, title: sql`excluded.title`, description: sql`excluded.description`, ean: sql`excluded.ean`, condition: sql`excluded.condition`, price: sql`excluded.price`, quantity: sql`excluded.quantity`, updatedAt: new Date() },
    });
  revalidatePath("/listings");
}

export async function publishAction(fd: FormData) {
  const session = await requireArea("wawi");
  const [l] = await db.select().from(schema.listings).where(and(eq(schema.listings.id, uuid.parse(fd.get("id"))), eq(schema.listings.tenantId, session.tenantId)));
  if (l) await publishListing(session.tenantId, l);
  revalidatePath("/listings");
}

export async function deleteListing(fd: FormData) {
  const session = await requireArea("wawi");
  await db.delete(schema.listings).where(and(eq(schema.listings.id, uuid.parse(fd.get("id"))), eq(schema.listings.tenantId, session.tenantId)));
  revalidatePath("/listings");
}

/** Entwürfe für alle SKUs im eigenen Lager, die auf dem Kanal noch fehlen. */
export async function draftsFromOwnStock(fd: FormData) {
  const session = await requireArea("wawi");
  const channel = z.enum(CHANNELS).parse(fd.get("channel"));
  await db.execute(sql`
    insert into listings (tenant_id, channel, sku, product_id, title, ean, price, quantity)
    select os.tenant_id, ${channel}, os.sku, l.product_id, left(coalesce(p.title, os.sku), 80), p.ean, l.sku_target_price, os.quantity
      from own_stock os
      left join lots l on l.tenant_id = os.tenant_id and l.sku = os.sku
      left join products p on p.id = l.product_id
     where os.tenant_id = ${session.tenantId} and os.quantity > 0
    on conflict (tenant_id, channel, sku) do nothing`);
  revalidatePath("/listings");
}
