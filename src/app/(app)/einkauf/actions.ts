"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { addItem, createDraftsFromSuggestions, createPurchaseOrder, receiveGoods, removeItem, updatePurchaseOrder } from "@/lib/purchasing/service";

export type PoState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
/** Deutsche Zahlen („12,50“) und englische („12.50“) annehmen. */
const num = (v: string) => (v === "" ? null : Number(v.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createPoAction(_prev: PoState, fd: FormData): Promise<PoState> {
  const session = await requireArea("wawi");
  let id: string;
  try {
    id = await createPurchaseOrder(session.tenantId, session.userId, {
      supplier: str(fd, "supplier"),
      supplierOrderNo: str(fd, "supplierOrderNo"),
      orderDate: str(fd, "orderDate"),
      expectedDate: str(fd, "expectedDate"),
    });
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
  redirect(`/einkauf/${id}`);
}

export async function addItemAction(_prev: PoState, fd: FormData): Promise<PoState> {
  const session = await requireArea("wawi");
  const poId = uuid.parse(fd.get("poId"));
  try {
    await addItem(session.tenantId, poId, {
      asin: str(fd, "asin"),
      quantity: num(str(fd, "quantity")) ?? 0,
      unitCostGross: num(str(fd, "unitCostGross")) ?? NaN,
      vatRate: num(str(fd, "vatRate")) ?? 19,
      targetPrice: num(str(fd, "targetPrice")),
      title: str(fd, "title") || null,
    });
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
  revalidatePath(`/einkauf/${poId}`);
  return { ok: true, message: "Position hinzugefügt." };
}

export async function removeItemAction(fd: FormData) {
  const session = await requireArea("wawi");
  await removeItem(session.tenantId, uuid.parse(fd.get("id")));
  revalidatePath("/einkauf", "layout");
}

export async function updatePoAction(_prev: PoState, fd: FormData): Promise<PoState> {
  const session = await requireArea("wawi");
  const poId = uuid.parse(fd.get("poId"));
  try {
    const status = str(fd, "status");
    await updatePurchaseOrder(session.tenantId, poId, {
      ...(status ? { status } : {}),
      ...(fd.has("supplierOrderNo")
        ? {
            supplierOrderNo: str(fd, "supplierOrderNo"),
            orderDate: str(fd, "orderDate"),
            expectedDate: str(fd, "expectedDate"),
            carrier: str(fd, "carrier"),
            trackingNumber: str(fd, "trackingNumber"),
            shippingCostGross: num(str(fd, "shippingCostGross")),
            notes: str(fd, "notes"),
          }
        : {}),
    });
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
  revalidatePath("/einkauf", "layout");
  return { ok: true, message: "Gespeichert." };
}

export async function setStatusAction(fd: FormData) {
  const session = await requireArea("wawi");
  await updatePurchaseOrder(session.tenantId, uuid.parse(fd.get("poId")), { status: str(fd, "status") });
  revalidatePath("/", "layout");
}

export async function receiveAction(_prev: PoState, fd: FormData): Promise<PoState> {
  const session = await requireArea("wawi");
  const poId = uuid.parse(fd.get("poId"));
  const quantities: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("qty:")) quantities[k.slice(4)] = num(String(v).trim()) ?? 0;
  }
  try {
    const r = await receiveGoods(session.tenantId, session.userId, poId, quantities, str(fd, "location"));
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.booked} Stück eingebucht${r.status === "received" ? " – Bestellung vollständig eingegangen." : "."}` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function draftsFromSuggestions(_prev: PoState, fd: FormData): Promise<PoState> {
  const session = await requireArea("wawi");
  const picks = fd.getAll("pick").map(String).map((asin) => ({
    asin,
    quantity: num(str(fd, `qty:${asin}`)) ?? 0,
    supplier: str(fd, `sup:${asin}`),
    unitCostGross: num(str(fd, `ek:${asin}`)) ?? 0,
    title: str(fd, `title:${asin}`) || null,
  }));
  if (picks.length === 0) return { ok: false, message: "Bitte mindestens einen Artikel ankreuzen." };
  if (picks.some((p) => !p.supplier)) return { ok: false, message: "Bei jedem angekreuzten Artikel einen Lieferanten angeben." };
  let ids: string[];
  try {
    ids = await createDraftsFromSuggestions(session.tenantId, session.userId, picks);
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
  revalidatePath("/einkauf", "layout");
  redirect(ids.length === 1 ? `/einkauf/${ids[0]}` : "/einkauf?ansicht=entwuerfe");
}
