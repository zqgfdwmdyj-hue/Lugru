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
