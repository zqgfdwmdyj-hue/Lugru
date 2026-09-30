"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addOwnProduct, importTikTok, refreshOwnProducts, suggestListing } from "@/lib/brands/shop-service";
import { readTable } from "@/lib/tabular";

export type ShopState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function addProductAction(_prev: ShopState, fd: FormData): Promise<ShopState> {
  const s = await requireSession();
  const inputs = String(fd.get("asins") ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!inputs.length) return { ok: false, message: "Bitte ASIN oder Amazon-Link einfügen." };
  const added: string[] = [];
  try {
    for (const i of inputs.slice(0, 50)) added.push(await addOwnProduct(s.tenantId, uuid.parse(fd.get("brandId")), i));
  } catch (e) {
    return { ok: false, message: `${added.length ? `${added.join(", ")} hinzugefügt. ` : ""}${msg(e)}` };
  }
  revalidatePath("/marken/shop");
  return { ok: true, message: `Hinzugefügt: ${added.join(", ")}.` };
}

export async function removeProductAction(fd: FormData) {
  const s = await requireSession();
  await db.delete(schema.brandProducts).where(and(eq(schema.brandProducts.id, uuid.parse(fd.get("id"))), eq(schema.brandProducts.tenantId, s.tenantId)));
  revalidatePath("/marken/shop");
}

export async function refreshAction(_prev: ShopState): Promise<ShopState> {
  const s = await requireSession();
  const r = await refreshOwnProducts(s.tenantId, true);
  revalidatePath("/marken/shop");
  return r.error ? { ok: false, message: `${r.error} Unter Anbindungen → Keepa eintragen.` } : { ok: true, message: `${r.updated} Produkte aktualisiert.` };
}

export async function listingAction(_prev: ShopState, fd: FormData): Promise<ShopState> {
  const s = await requireSession();
  try {
    await suggestListing(s.tenantId, uuid.parse(fd.get("id")));
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
  revalidatePath("/marken/shop");
  return { ok: true, message: "Vorschlag erstellt." };
}

export async function tiktokImportAction(_prev: ShopState, fd: FormData): Promise<ShopState> {
  const s = await requireSession();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Bitte den TikTok-Export (CSV oder Excel) auswählen." };
  try {
    const brandId = uuid.parse(fd.get("brandId"));
    const [b] = await db.select({ id: schema.brands.id }).from(schema.brands).where(and(eq(schema.brands.id, brandId), eq(schema.brands.tenantId, s.tenantId)));
    if (!b) return { ok: false, message: "Marke nicht gefunden." };
    const t = readTable(new Uint8Array(await file.arrayBuffer()));
    const n = await importTikTok(s.tenantId, brandId, file.name, [t.headers, ...t.rows]);
    revalidatePath("/marken/shop");
    return { ok: true, message: `${n} TikTok-Produkte übernommen – sie fließen jetzt auch in die KI-Ideen ein.` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}
