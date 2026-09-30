"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { applyCostPriority, recomputeReturnCosts } from "@/lib/imports/apply";
import { parseAmount } from "@/lib/numbers";

export async function setManualCost(formData: FormData) {
  const session = await requireArea("wawi");
  const id = z.string().uuid().parse(formData.get("id"));
  const value = parseAmount(formData.get("cost"));
  if (value === null || value < 0) return;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.lots)
      .set({ unitCostNet: String(value), unitCostSource: "manual", parentLotId: null, updatedAt: new Date() })
      .where(and(eq(schema.lots.id, id), eq(schema.lots.tenantId, session.tenantId)));
    await recomputeReturnCosts(tx, session.tenantId);
  });
  revalidatePath("/", "layout");
}

export async function resetCost(formData: FormData) {
  const session = await requireArea("wawi");
  const id = z.string().uuid().parse(formData.get("id"));
  await db.transaction(async (tx) => {
    await tx
      .update(schema.lots)
      .set({ unitCostNet: null, unitCostSource: null, parentLotId: null, updatedAt: new Date() })
      .where(and(eq(schema.lots.id, id), eq(schema.lots.tenantId, session.tenantId)));
    await applyCostPriority(tx, session.tenantId);
    await recomputeReturnCosts(tx, session.tenantId);
  });
  revalidatePath("/", "layout");
}
