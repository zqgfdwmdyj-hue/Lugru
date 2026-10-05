"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { syncClaims } from "@/lib/claims/service";
import { refreshStockWarnings } from "@/lib/stock/warnings";

export async function confirmRemovalReceipt(fd: FormData) {
  const session = await requireArea("amazon");
  const id = z.string().uuid().parse(fd.get("id"));
  const qty = Math.max(0, Math.round(Number(fd.get("received"))));
  if (!Number.isFinite(qty)) return;
  await db
    .update(schema.amazonRemovalOrders)
    .set({ receivedQuantity: qty, receivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.amazonRemovalOrders.id, id), eq(schema.amazonRemovalOrders.tenantId, session.tenantId)));
  await syncClaims(session.tenantId);
  await refreshStockWarnings(session.tenantId);
  revalidatePath("/", "layout");
}

/** Paket einer Remission als angekommen / verloren markieren (oder Markierung zurücknehmen). */
export async function markRemovalShipment(fd: FormData) {
  const session = await requireArea("amazon");
  const orderId = z.string().trim().min(1).max(80).parse(fd.get("orderId"));
  const trackingNumber = z.string().trim().min(1).max(120).parse(fd.get("tracking"));
  const status = z.enum(["received", "lost", "clear"]).parse(fd.get("status"));
  const M = schema.amazonRemovalShipmentMarks;
  const where = and(eq(M.tenantId, session.tenantId), eq(M.orderId, orderId), eq(M.trackingNumber, trackingNumber));
  if (status === "clear") await db.delete(M).where(where);
  else
    await db
      .insert(M)
      .values({ tenantId: session.tenantId, orderId, trackingNumber, status })
      .onConflictDoUpdate({ target: [M.tenantId, M.orderId, M.trackingNumber], set: { status, updatedAt: new Date() } });
  await syncClaims(session.tenantId);
  revalidatePath("/", "layout");
}
