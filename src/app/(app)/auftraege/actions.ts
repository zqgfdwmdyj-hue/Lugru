"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";
import { cancelLabel, createLabel, estimateWeightKg, loadOrder, markShipped, uploadTracking } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";

const uuid = z.string().uuid();
export type LabelState = { ok: boolean; message: string; fileId?: string } | null;

export async function createLabelAction(_prev: LabelState, fd: FormData): Promise<LabelState> {
  const session = await requireSession();
  const orderId = uuid.parse(fd.get("orderId"));
  const weightKg = parseAmount(fd.get("weightKg"));
  if (weightKg === null || weightKg <= 0) return { ok: false, message: "Bitte Gewicht angeben." };
  const product = fd.get("product") === "kleinpaket" ? "kleinpaket" : "paket";
  try {
    const r = await createLabel({ tenantId: session.tenantId, orderId, weightKg, product });
    revalidatePath("/auftraege", "layout");
    return { ok: true, message: `Label erstellt: ${r.trackingNumber}${r.sandbox ? " (Sandbox – Testlabel)" : ""}${r.warnings.length ? ` · Hinweise: ${r.warnings.join("; ")}` : ""}`, fileId: r.fileId };
  } catch (e) {
    revalidatePath(`/auftraege/${orderId}`);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type BatchState = { results: { id: string; ref: string; ok: boolean; message: string; fileId?: string }[] } | null;

/** Labels für mehrere Aufträge – Gewicht aus Artikeldaten, Produkt nach Gewichtsgrenze. */
export async function batchLabels(_prev: BatchState, fd: FormData): Promise<BatchState> {
  const session = await requireSession();
  const ids = fd.getAll("ids").map(String).filter((s) => uuid.safeParse(s).success);
  const settings = await getSettings(session.tenantId);
  const results: NonNullable<BatchState>["results"] = [];
  for (const id of ids) {
    const data = await loadOrder(session.tenantId, id);
    if (!data) continue;
    const ref = `${data.order.channel} ${data.order.externalId}`;
    if (data.order.status !== "open") {
      results.push({ id, ref, ok: false, message: "hat schon ein Label oder ist versandt" });
      continue;
    }
    const w = estimateWeightKg(data.items);
    if (w === null) {
      results.push({ id, ref, ok: false, message: "Artikelgewicht fehlt – im Auftrag von Hand angeben" });
      continue;
    }
    try {
      const r = await createLabel({ tenantId: session.tenantId, orderId: id, weightKg: w, product: w <= settings.dhl.kleinpaketMaxKg ? "kleinpaket" : "paket" });
      results.push({ id, ref, ok: true, message: `${r.trackingNumber} (${w} kg)`, fileId: r.fileId });
    } catch (e) {
      results.push({ id, ref, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  revalidatePath("/auftraege", "layout");
  return { results };
}

export async function markShippedAction(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("orderId"));
  const trackingNumber = String(fd.get("trackingNumber") ?? "").trim() || undefined;
  const carrier = String(fd.get("carrier") ?? "").trim() || undefined;
  await markShipped(session.tenantId, id, session.userId, { trackingNumber, carrier });
  revalidatePath("/", "layout");
}

export async function markAllLabeledShipped() {
  const session = await requireSession();
  const rows = await db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.tenantId, session.tenantId), eq(schema.orders.status, "label_created")));
  for (const r of rows) await markShipped(session.tenantId, r.id, session.userId);
  revalidatePath("/", "layout");
}

export async function retryTracking(fd: FormData) {
  const session = await requireSession();
  await uploadTracking(session.tenantId, uuid.parse(fd.get("orderId")));
  revalidatePath("/auftraege", "layout");
}

export async function cancelLabelAction(fd: FormData) {
  const session = await requireSession();
  await cancelLabel(session.tenantId, uuid.parse(fd.get("parcelId")));
  revalidatePath("/auftraege", "layout");
}

export async function saveAddress(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("orderId"));
  const g = (k: string) => String(fd.get(k) ?? "").trim() || undefined;
  const shipTo = { name1: g("name1"), name2: g("name2"), street: g("street"), houseNo: g("houseNo"), zip: g("zip"), city: g("city"), country: g("country") ?? "DE", email: g("email"), phone: g("phone") };
  await db.update(schema.orders).set({ shipTo, buyerName: shipTo.name1, updatedAt: new Date() }).where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, session.tenantId)));
  revalidatePath(`/auftraege/${id}`);
}

export async function cancelOrder(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("orderId"));
  await db.update(schema.orders).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, session.tenantId)));
  revalidatePath("/", "layout");
}

export async function createManualOrder(fd: FormData) {
  const session = await requireSession();
  const channel = z.enum(CHANNELS).parse(fd.get("channel") || "manual");
  const externalId = String(fd.get("externalId") ?? "").trim() || `M-${Date.now().toString(36).toUpperCase()}`;
  const [row] = await db
    .insert(schema.orders)
    .values({ tenantId: session.tenantId, channel, externalId, orderDate: new Date(), fulfillment: "FBM", status: "open", shipTo: {} })
    .returning({ id: schema.orders.id });
  const sku = String(fd.get("sku") ?? "").trim();
  if (sku) await db.insert(schema.orderItems).values({ tenantId: session.tenantId, orderId: row.id, sku, quantity: Math.max(1, Math.round(parseAmount(fd.get("quantity")) ?? 1)) });
  redirect(`/auftraege/${row.id}`);
}
