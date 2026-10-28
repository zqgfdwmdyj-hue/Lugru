"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";

/** Aufträge zuordnen: wer hat verschickt (ich / Prep Center) – einzeln oder alle offenen des Monats. */
export async function assignShipperAction(fd: FormData) {
  const session = await requireArea("wawi");
  const v = String(fd.get("shipper") ?? "");
  if (v !== "self" && v !== "prep") return;
  const ids = fd.getAll("orderId").map(String).filter((s) => z.string().uuid().safeParse(s).success).slice(0, 3000);
  if (!ids.length) return;
  await db.update(schema.orders).set({ shippedBy: v, updatedAt: new Date() }).where(and(eq(schema.orders.tenantId, session.tenantId), inArray(schema.orders.id, ids)));
  revalidatePath("/auftraege/prep-center");
}
