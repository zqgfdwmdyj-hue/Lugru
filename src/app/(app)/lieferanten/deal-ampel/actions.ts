"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { profitgoLink } from "@/lib/deal-ampel/logic";
import { parseAmount } from "@/lib/numbers";

/** Ziele der Deal-Ampel speichern (nur Inhaber). */
export async function dealAmpelEinstellungenAction(fd: FormData) {
  const session = await requireOwner();
  const zahl = (k: string, min: number, max: number) => {
    const v = parseAmount(fd.get(k));
    return v === null ? undefined : Math.min(max, Math.max(min, v));
  };
  const laender = String(fd.get("laender") ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z]{2}$/.test(x))
    .slice(0, 8);
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t?.settings ?? {};
  await db
    .update(schema.tenants)
    .set({
      settings: {
        ...alt,
        dealAmpel: {
          ...(alt.dealAmpel ?? {}),
          zielMarge: zahl("zielMarge", 0, 80),
          maxAbverkaufTage: zahl("maxAbverkaufTage", 7, 365),
          maxAngebote: zahl("maxAngebote", 1, 200),
          amazonMaxProzent: zahl("amazonMaxProzent", 0, 100),
          preisverfallProzent: zahl("preisverfallProzent", 1, 80),
          nebenkosten: zahl("nebenkosten", 0, 100),
          ...(laender.length ? { laender } : {}),
          ...(fd.has("profitgoVorlage") ? { profitgoVorlage: (() => {
            const v = String(fd.get("profitgoVorlage") ?? "").trim().slice(0, 300);
            return v === "" || profitgoLink(v, "B000000000") ? v : (alt.dealAmpel?.profitgoVorlage ?? "");
          })() } : {}),
        },
      },
    })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/lieferanten/deal-ampel");
  redirect("/lieferanten/deal-ampel?gespeichert=1");
}
