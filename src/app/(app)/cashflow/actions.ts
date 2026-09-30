"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { parseAmount, parseDate } from "@/lib/numbers";

export async function addCashItem(fd: FormData) {
  const session = await requireArea("geld");
  const amount = parseAmount(fd.get("amount"));
  const date = parseDate(String(fd.get("date") ?? ""));
  const description = String(fd.get("description") ?? "").trim();
  if (amount === null || !date || !description) return;
  const sign = fd.get("direction") === "in" ? 1 : -1;
  await db.insert(schema.cashItems).values({
    tenantId: session.tenantId,
    date,
    amount: Math.abs(amount) * sign,
    description,
    category: String(fd.get("category") ?? "sonstiges"),
    recurrence: z.enum(["none", "weekly", "monthly"]).catch("none").parse(fd.get("recurrence")),
    endDate: parseDate(String(fd.get("endDate") ?? "")),
  });
  revalidatePath("/cashflow");
}

export async function deleteCashItem(fd: FormData) {
  const session = await requireArea("geld");
  await db.delete(schema.cashItems).where(and(eq(schema.cashItems.id, z.string().uuid().parse(fd.get("id"))), eq(schema.cashItems.tenantId, session.tenantId)));
  revalidatePath("/cashflow");
}

export async function saveStartBalance(fd: FormData) {
  const session = await requireArea("geld");
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const v = parseAmount(fd.get("balance"));
  await db
    .update(schema.tenants)
    .set({ settings: { ...t.settings, cash: { startBalance: v ?? undefined, asOf: new Date().toISOString().slice(0, 10) } } })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/cashflow");
}
