"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";

export type FixState = { ok: boolean; message: string } | null;

const amount = (v: FormDataEntryValue | null, label: string) => {
  const n = parseAmount(v);
  if (n === null || n < 0 || n > 1_000_000) throw new Error(`Bitte ${label} als Betrag eingeben.`);
  return Math.round(n * 10000) / 10000;
};
const done = (message: string): FixState => {
  revalidatePath("/gewinn", "layout");
  revalidatePath("/bestand");
  return { ok: true, message };
};
const fail = (e: unknown): FixState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

/** EK je SKU von Hand (für SKUs ohne Charge). Gilt für Gewinn und Lagerwert. */
export async function setSkuCostAction(_prev: FixState, fd: FormData): Promise<FixState> {
  const session = await requireArea("geld", "wawi");
  try {
    const sku = z.string().trim().min(1).max(120).parse(fd.get("sku"));
    const cost = amount(fd.get("cost"), "den EK");
    await db
      .insert(schema.skuCosts)
      .values({ tenantId: session.tenantId, sku, unitCostNet: cost, note: "von Hand (Gewinn → fehlende Werte)" })
      .onConflictDoUpdate({ target: [schema.skuCosts.tenantId, schema.skuCosts.sku], set: { unitCostNet: cost, updatedAt: new Date() } });
    return done(`EK für ${sku} gespeichert.`);
  } catch (e) {
    return fail(e);
  }
}

/** EK an einer vorhandenen Charge ohne EK. */
export async function setLotCostAction(_prev: FixState, fd: FormData): Promise<FixState> {
  const session = await requireArea("geld", "wawi");
  try {
    const id = z.string().uuid().parse(fd.get("lotId"));
    const cost = amount(fd.get("cost"), "den EK");
    const r = await db
      .update(schema.lots)
      .set({ unitCostNet: String(cost), unitCostSource: "manual", updatedAt: new Date() })
      .where(and(eq(schema.lots.id, id), eq(schema.lots.tenantId, session.tenantId)))
      .returning({ sku: schema.lots.sku });
    if (!r.length) throw new Error("Charge nicht gefunden.");
    return done(`EK an der Charge ${r[0].sku} gespeichert.`);
  } catch (e) {
    return fail(e);
  }
}

/** Kanalgebühren einer Bestellung von Hand (z. B. ältere eBay-Bestellungen ohne Angabe). */
export async function setOrderFeeAction(_prev: FixState, fd: FormData): Promise<FixState> {
  const session = await requireArea("geld");
  try {
    const id = z.string().uuid().parse(fd.get("orderId"));
    const fee = amount(fd.get("fee"), "die Gebühr");
    const r = await db
      .update(schema.orders)
      .set({ fees: fee, feesSource: "manuell", updatedAt: new Date() })
      .where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, session.tenantId)))
      .returning({ ext: schema.orders.externalId });
    if (!r.length) throw new Error("Bestellung nicht gefunden.");
    return done(`Gebühr für ${r[0].ext} gespeichert.`);
  } catch (e) {
    return fail(e);
  }
}

/** Bruttopreis je Stück einer Auftragsposition (z. B. Temu-Positionen ohne Preis). */
export async function setLinePriceAction(_prev: FixState, fd: FormData): Promise<FixState> {
  const session = await requireArea("geld");
  try {
    const id = z.string().uuid().parse(fd.get("itemId"));
    const price = amount(fd.get("price"), "den Preis");
    const own = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(and(eq(schema.orderItems.id, id), eq(schema.orderItems.tenantId, session.tenantId)));
    if (!own.length) throw new Error("Position nicht gefunden.");
    await db.update(schema.orderItems).set({ price }).where(inArray(schema.orderItems.id, own.map((o) => o.id)));
    return done("Preis gespeichert.");
  } catch (e) {
    return fail(e);
  }
}
