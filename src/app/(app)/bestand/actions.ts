"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";

const uuid = z.string().uuid();

export async function setOwnStock(fd: FormData) {
  const session = await requireSession();
  const sku = String(fd.get("sku") ?? "").trim();
  const qty = Math.round(parseAmount(fd.get("quantity")) ?? NaN);
  if (!sku || !Number.isFinite(qty)) return;
  const [cur] = await db.select().from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, session.tenantId), eq(schema.ownStock.sku, sku)));
  const delta = qty - (cur?.quantity ?? 0);
  await db
    .insert(schema.ownStock)
    .values({ tenantId: session.tenantId, sku, quantity: qty, location: String(fd.get("location") ?? "").trim() || null })
    .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: qty, location: sql`coalesce(excluded.location, ${schema.ownStock.location})`, updatedAt: new Date() } });
  if (delta) await db.insert(schema.stockMovements).values({ tenantId: session.tenantId, sku, delta, reason: String(fd.get("reason") ?? "Korrektur") || "Korrektur", userId: session.userId });
  revalidatePath("/bestand");
}

export async function createCount(fd: FormData) {
  const session = await requireSession();
  const name = String(fd.get("name") ?? "").trim() || `Inventur ${new Date().toLocaleDateString("de-DE")}`;
  const [c] = await db.insert(schema.inventoryCounts).values({ tenantId: session.tenantId, name, createdBy: session.userId }).returning();
  const stock = await db.select().from(schema.ownStock).where(eq(schema.ownStock.tenantId, session.tenantId));
  if (stock.length) await db.insert(schema.inventoryCountLines).values(stock.map((s) => ({ tenantId: session.tenantId, countId: c.id, sku: s.sku, expected: s.quantity, counted: 0 })));
  redirect(`/bestand/inventur/${c.id}`);
}

export type CountState = { ok: boolean; message: string; seq: number } | null;

export async function countScan(prev: CountState, fd: FormData): Promise<CountState> {
  const session = await requireSession();
  const countId = uuid.parse(fd.get("countId"));
  const seq = (prev?.seq ?? 0) + 1;
  const [c] = await db.select().from(schema.inventoryCounts).where(and(eq(schema.inventoryCounts.id, countId), eq(schema.inventoryCounts.tenantId, session.tenantId)));
  if (!c || c.status !== "open") return { ok: false, message: "Inventur ist abgeschlossen.", seq };
  const raw = String(fd.get("code") ?? "").trim();
  const m = /^(\d{1,4})\s*[*xX×]\s*(.+)$/.exec(raw);
  const qty = m ? Number(m[1]) : Math.round(parseAmount(fd.get("quantity")) ?? 1);
  const code = (m ? m[2] : raw).trim();
  if (!code) return { ok: false, message: "Kein Code.", seq };
  // SKU, FNSKU oder EAN → SKU
  const [lot] = await db
    .select({ sku: schema.lots.sku })
    .from(schema.lots)
    .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
    .where(and(eq(schema.lots.tenantId, session.tenantId), sql`(${schema.lots.sku} = ${code} or upper(${schema.lots.fnsku}) = upper(${code}) or ${schema.products.ean} = ${code})`))
    .orderBy(sql`${schema.lots.purchaseDate} desc nulls last`)
    .limit(1);
  const sku = lot?.sku ?? code;
  await db
    .insert(schema.inventoryCountLines)
    .values({ tenantId: session.tenantId, countId, sku, expected: 0, counted: qty })
    .onConflictDoUpdate({ target: [schema.inventoryCountLines.countId, schema.inventoryCountLines.sku], set: { counted: sql`${schema.inventoryCountLines.counted} + ${qty}`, updatedAt: new Date() } });
  revalidatePath(`/bestand/inventur/${countId}`);
  return { ok: true, message: `+${qty} ${sku}${lot ? "" : " (unbekannte SKU – als neue Position erfasst)"}`, seq };
}

export async function setCounted(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("lineId"));
  const counted = Math.max(0, Math.round(parseAmount(fd.get("counted")) ?? 0));
  const [l] = await db.update(schema.inventoryCountLines).set({ counted, updatedAt: new Date() }).where(and(eq(schema.inventoryCountLines.id, id), eq(schema.inventoryCountLines.tenantId, session.tenantId))).returning();
  if (l) revalidatePath(`/bestand/inventur/${l.countId}`);
}

export async function bookCount(fd: FormData) {
  const session = await requireSession();
  const countId = uuid.parse(fd.get("countId"));
  const [c] = await db.select().from(schema.inventoryCounts).where(and(eq(schema.inventoryCounts.id, countId), eq(schema.inventoryCounts.tenantId, session.tenantId)));
  if (!c || c.status !== "open") return;
  const lines = await db.select().from(schema.inventoryCountLines).where(eq(schema.inventoryCountLines.countId, countId));
  for (const l of lines) {
    const [cur] = await db.select().from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, session.tenantId), eq(schema.ownStock.sku, l.sku)));
    const delta = l.counted - (cur?.quantity ?? 0);
    await db.insert(schema.ownStock).values({ tenantId: session.tenantId, sku: l.sku, quantity: l.counted }).onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: l.counted, updatedAt: new Date() } });
    if (delta) await db.insert(schema.stockMovements).values({ tenantId: session.tenantId, sku: l.sku, delta, reason: "Inventur", reference: c.name, userId: session.userId });
  }
  await db.update(schema.inventoryCounts).set({ status: "booked", bookedAt: new Date() }).where(eq(schema.inventoryCounts.id, countId));
  revalidatePath("/bestand", "layout");
}
