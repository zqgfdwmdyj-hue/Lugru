"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CHANNELS, RETURN_STATUSES } from "@/db/schema";
import { syncSoon, wawiSku } from "@/lib/stock/channel-sync";
import { requireArea } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";

const uuid = z.string().uuid();

export async function createReturn(fd: FormData) {
  const session = await requireArea("service");
  const orderRef = String(fd.get("orderRef") ?? "").trim();
  if (!orderRef) return;
  const channel = z.enum(CHANNELS).parse(fd.get("channel"));
  const [order] = await db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.tenantId, session.tenantId), eq(schema.orders.channel, channel), eq(schema.orders.externalId, orderRef)));
  await db.insert(schema.customerReturns).values({
    tenantId: session.tenantId,
    channel,
    orderRef,
    orderId: order?.id ?? null,
    sku: String(fd.get("sku") ?? "").trim() || null,
    quantity: Math.max(1, Math.round(parseAmount(fd.get("quantity")) ?? 1)),
    reason: String(fd.get("reason") ?? "").trim() || null,
    trackingNumber: String(fd.get("trackingNumber") ?? "").trim() || null,
  });
  revalidatePath("/retouren");
}

export async function updateReturn(fd: FormData) {
  const session = await requireArea("service");
  const id = uuid.parse(fd.get("id"));
  const [r] = await db.select().from(schema.customerReturns).where(and(eq(schema.customerReturns.id, id), eq(schema.customerReturns.tenantId, session.tenantId)));
  if (!r) return;
  const status = z.enum(RETURN_STATUSES).parse(fd.get("status"));
  const condition = z.enum(["sellable", "damaged", "missing", "wrong_item"]).nullable().catch(null).parse(fd.get("condition") || null);
  const restock = fd.get("restock") === "on" && condition === "sellable" && !r.restocked && !!r.sku;
  await db
    .update(schema.customerReturns)
    .set({
      status,
      condition,
      refundAmount: parseAmount(fd.get("refundAmount")),
      notes: String(fd.get("notes") ?? ""),
      receivedAt: status !== "announced" ? (r.receivedAt ?? new Date()) : null,
      refundedAt: status === "refunded" || status === "closed" ? (r.refundedAt ?? new Date()) : r.refundedAt,
      restocked: restock ? 1 : r.restocked,
      updatedAt: new Date(),
    })
    .where(eq(schema.customerReturns.id, id));
  if (restock && r.sku) {
    const sku = await wawiSku(session.tenantId, r.channel, r.sku);
    await db
      .insert(schema.ownStock)
      .values({ tenantId: session.tenantId, sku, quantity: r.quantity })
      .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: sql`${schema.ownStock.quantity} + ${r.quantity}`, updatedAt: new Date() } });
    await db.insert(schema.stockMovements).values({ tenantId: session.tenantId, sku, delta: r.quantity, reason: "Retoure", reference: `${r.channel} ${r.orderRef}`, userId: session.userId });
    syncSoon(session.tenantId, [sku]);
  }
  revalidatePath("/retouren");
}
