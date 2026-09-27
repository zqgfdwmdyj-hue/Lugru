"use server";

import { and, desc, eq, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addScan, resolveCode, splitQuantity, type ResolvedItem } from "@/lib/inbound/service";
import { parseAmount } from "@/lib/numbers";

const uuid = z.string().uuid();

async function ownShipment(tenantId: string, id: string) {
  const [s] = await db.select().from(schema.inboundShipments).where(and(eq(schema.inboundShipments.id, id), eq(schema.inboundShipments.tenantId, tenantId)));
  if (!s) throw new Error("Sendung nicht gefunden");
  return s;
}

export async function createShipment(fd: FormData) {
  const session = await requireSession();
  const name = String(fd.get("name") ?? "").trim() || `Sendung ${new Date().toLocaleDateString("de-DE")}`;
  const [row] = await db.insert(schema.inboundShipments).values({ tenantId: session.tenantId, name, createdBy: session.userId }).returning({ id: schema.inboundShipments.id });
  await db.insert(schema.inboundBoxes).values({ tenantId: session.tenantId, shipmentId: row.id, number: 1 });
  redirect(`/inbound/${row.id}`);
}

export type ScanState = {
  ok: boolean;
  message: string;
  last?: { sku: string; fnsku: string | null; title: string | null; quantity: number; scanned: number; planned: number };
  options?: (ResolvedItem & { purchaseDate: string | null })[];
  pendingCode?: string;
  pendingQuantity?: number;
  seq: number;
} | null;

export async function scanAction(prev: ScanState, fd: FormData): Promise<ScanState> {
  const session = await requireSession();
  const shipmentId = uuid.parse(fd.get("shipmentId"));
  const shipment = await ownShipment(session.tenantId, shipmentId);
  const seq = (prev?.seq ?? 0) + 1;
  if (!["draft", "ready"].includes(shipment.status)) return { ok: false, message: "Die Sendung ist schon übertragen – Scannen nicht mehr möglich.", seq };
  const raw = String(fd.get("code") ?? "");
  const chosenSku = String(fd.get("chooseSku") ?? "");
  const boxId = uuid.safeParse(fd.get("boxId")).success ? String(fd.get("boxId")) : null;
  const split = splitQuantity(raw);
  const qtyField = Math.round(parseAmount(fd.get("quantity")) ?? 1);
  const quantity = split.quantity ?? (qtyField || 1);
  if (!split.code) return { ok: false, message: "Kein Code.", seq };

  let res = await resolveCode(session.tenantId, shipmentId, chosenSku || split.code);
  if (res.kind === "unknown") return { ok: false, message: `„${split.code}“ nicht gefunden – weder FNSKU, SKU, EAN noch ASIN.`, seq };
  if (res.kind === "ambiguous") {
    return { ok: false, message: `Mehrere Chargen passen zu „${split.code}“ – bitte wählen.`, options: res.options, pendingCode: split.code, pendingQuantity: quantity, seq };
  }
  const item = await addScan({ tenantId: session.tenantId, userId: session.userId, shipmentId, item: res.item, quantity, boxId, code: split.code });
  revalidatePath(`/inbound/${shipmentId}`);
  return {
    ok: true,
    message: quantity > 0 ? `+${quantity} ${res.item.title ?? res.item.sku}` : `${quantity} ${res.item.title ?? res.item.sku}`,
    last: { sku: res.item.sku, fnsku: res.item.fnsku, title: res.item.title, quantity, scanned: item.scannedQuantity, planned: item.plannedQuantity },
    seq,
  };
}

export async function undoLastScan(fd: FormData) {
  const session = await requireSession();
  const shipmentId = uuid.parse(fd.get("shipmentId"));
  await ownShipment(session.tenantId, shipmentId);
  const [last] = await db
    .select()
    .from(schema.inboundScans)
    .where(and(eq(schema.inboundScans.shipmentId, shipmentId), sql`${schema.inboundScans.quantity} > 0`))
    .orderBy(desc(schema.inboundScans.createdAt))
    .limit(1);
  if (!last?.itemId) return;
  const [item] = await db.select().from(schema.inboundItems).where(eq(schema.inboundItems.id, last.itemId));
  if (!item) return;
  const res = await resolveCode(session.tenantId, shipmentId, item.sku);
  if (res.kind !== "ok") return;
  await addScan({ tenantId: session.tenantId, userId: session.userId, shipmentId, item: res.item, quantity: -last.quantity, boxId: last.boxId, code: `RÜCKGÄNGIG ${last.code}` });
  revalidatePath(`/inbound/${shipmentId}`);
}

export async function addBox(fd: FormData) {
  const session = await requireSession();
  const shipmentId = uuid.parse(fd.get("shipmentId"));
  await ownShipment(session.tenantId, shipmentId);
  const [{ n }] = await db.select({ n: max(schema.inboundBoxes.number) }).from(schema.inboundBoxes).where(eq(schema.inboundBoxes.shipmentId, shipmentId));
  await db.insert(schema.inboundBoxes).values({ tenantId: session.tenantId, shipmentId, number: (n ?? 0) + 1 });
  revalidatePath(`/inbound/${shipmentId}`);
}

export async function updateBox(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("boxId"));
  const v = (k: string) => {
    const n = parseAmount(fd.get(k));
    return n === null ? null : String(n);
  };
  const [box] = await db
    .update(schema.inboundBoxes)
    .set({ lengthCm: v("lengthCm"), widthCm: v("widthCm"), heightCm: v("heightCm"), weightKg: v("weightKg") })
    .where(and(eq(schema.inboundBoxes.id, id), eq(schema.inboundBoxes.tenantId, session.tenantId)))
    .returning();
  if (box) revalidatePath(`/inbound/${box.shipmentId}`);
}

export async function setPlanned(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("itemId"));
  const qty = Math.max(0, Math.round(parseAmount(fd.get("planned")) ?? 0));
  const [item] = await db
    .update(schema.inboundItems)
    .set({ plannedQuantity: qty })
    .where(and(eq(schema.inboundItems.id, id), eq(schema.inboundItems.tenantId, session.tenantId)))
    .returning();
  if (item) revalidatePath(`/inbound/${item.shipmentId}`);
}

export async function removeItem(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("itemId"));
  const [item] = await db
    .delete(schema.inboundItems)
    .where(and(eq(schema.inboundItems.id, id), eq(schema.inboundItems.tenantId, session.tenantId)))
    .returning();
  if (item) revalidatePath(`/inbound/${item.shipmentId}`);
}

export async function saveProductData(fd: FormData) {
  const session = await requireSession();
  const productId = uuid.parse(fd.get("productId"));
  const n = (k: string) => {
    const x = parseAmount(fd.get(k));
    return x === null ? null : x;
  };
  await db
    .update(schema.products)
    .set({
      weightGrams: n("weightGrams") === null ? null : Math.round(n("weightGrams")!),
      lengthCm: n("lengthCm") === null ? null : String(n("lengthCm")),
      widthCm: n("widthCm") === null ? null : String(n("widthCm")),
      heightCm: n("heightCm") === null ? null : String(n("heightCm")),
      ean: String(fd.get("ean") ?? "").trim() || null,
      prepInstructions: String(fd.get("prep") ?? "").trim() || null,
      isHazmat: fd.get("hazmat") === "on",
    })
    .where(and(eq(schema.products.id, productId), eq(schema.products.tenantId, session.tenantId)));
  const fnsku = String(fd.get("fnsku") ?? "").trim();
  const sku = String(fd.get("sku") ?? "");
  if (fnsku && sku) {
    await db.update(schema.lots).set({ fnsku }).where(and(eq(schema.lots.tenantId, session.tenantId), eq(schema.lots.sku, sku)));
    await db.update(schema.inboundItems).set({ fnsku }).where(and(eq(schema.inboundItems.tenantId, session.tenantId), eq(schema.inboundItems.sku, sku)));
  }
  // Prüfungen aller offenen Sendungen mit dieser SKU neu berechnen
  const { computeChecks } = await import("@/lib/inbound/service");
  if (sku) {
    const checks = await computeChecks(session.tenantId, sku);
    await db.update(schema.inboundItems).set({ checks }).where(and(eq(schema.inboundItems.tenantId, session.tenantId), eq(schema.inboundItems.sku, sku)));
  }
  revalidatePath("/inbound", "layout");
}

export async function updateShipmentStatus(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("shipmentId"));
  await ownShipment(session.tenantId, id);
  const status = z.enum(schema.INBOUND_STATUSES).parse(fd.get("status"));
  const amazonShipmentId = String(fd.get("amazonShipmentId") ?? "").trim().toUpperCase() || null;
  await db
    .update(schema.inboundShipments)
    .set({
      status,
      ...(amazonShipmentId ? { amazonShipmentId } : {}),
      ...(status === "transmitted" ? { transmittedAt: new Date() } : {}),
      ...(status === "shipped" ? { shippedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.inboundShipments.id, id));
  revalidatePath(`/inbound/${id}`);
}

export async function deleteShipment(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("shipmentId"));
  const s = await ownShipment(session.tenantId, id);
  if (s.status !== "draft") return;
  await db.delete(schema.inboundShipments).where(eq(schema.inboundShipments.id, id));
  redirect("/inbound");
}
