"use server";

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CLAIM_TYPES, type TenantSettings } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { syncClaims } from "@/lib/claims/service";
import { parseAmount } from "@/lib/numbers";

const num = (fd: FormData, key: string) => {
  const v = parseAmount(fd.get(key));
  return v === null ? undefined : v;
};
const pct = (fd: FormData, key: string) => {
  const v = num(fd, key);
  return v === undefined ? undefined : v / 100;
};
const str = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? undefined : v;
};

export async function saveSettings(fd: FormData) {
  const session = await requireOwner();
  const windowDays: Record<string, number> = {};
  for (const t of CLAIM_TYPES) {
    const v = num(fd, `window_${t}`);
    if (v !== undefined) windowDays[t] = Math.round(v);
  }
  const settings: TenantSettings = {
    vatRate: pct(fd, "vatRate"),
    importReminderDays: num(fd, "importReminderDays"),
    claims: {
      dailyLimit: num(fd, "dailyLimit"),
      resetHour: num(fd, "resetHour"),
      minAmount: num(fd, "minAmount"),
      windowDays,
    },
    shipper: {
      name1: str(fd, "shipper_name1"),
      name2: str(fd, "shipper_name2"),
      street: str(fd, "shipper_street"),
      houseNo: str(fd, "shipper_houseNo"),
      zip: str(fd, "shipper_zip"),
      city: str(fd, "shipper_city"),
      country: str(fd, "shipper_country") ?? "DEU",
      email: str(fd, "shipper_email"),
      phone: str(fd, "shipper_phone"),
    },
    dhl: {
      sandbox: fd.get("dhl_sandbox") === "on",
      billingNumberPaket: str(fd, "dhl_billingNumberPaket"),
      billingNumberKleinpaket: str(fd, "dhl_billingNumberKleinpaket"),
      productKleinpaket: str(fd, "dhl_productKleinpaket"),
      labelFormat: str(fd, "dhl_labelFormat"),
      kleinpaketMaxKg: num(fd, "dhl_kleinpaketMaxKg"),
    },
    pricing: {
      referralRate: pct(fd, "referralRate"),
      minProfit: num(fd, "minProfit"),
      maxPriceFactor: num(fd, "maxPriceFactor"),
      defaultFbaFee: num(fd, "defaultFbaFee"),
    },
    aging: {
      unsellableWarnDays: num(fd, "unsellableWarnDays"),
      noSaleWarnDays: num(fd, "noSaleWarnDays"),
    },
    returns: {
      graceFba: num(fd, "returns_graceFba"),
      claimFba: num(fd, "returns_claimFba"),
      graceFbm: num(fd, "returns_graceFbm"),
      marketplace: [str(fd, "returns_marketplace")].find((m) => m && /^sellercentral[a-z-]*\.amazon\.[a-z.]+$/.test(m)),
    },
  };
  const name = str(fd, "tenantName");
  await db
    .update(schema.tenants)
    // Nur die Bereiche dieses Formulars ersetzen – Drive-Ordner, Kontostand usw. bleiben erhalten.
    .set({ settings: sql`${schema.tenants.settings} || ${JSON.stringify(settings)}::jsonb`, ...(name ? { name } : {}) })
    .where(eq(schema.tenants.id, session.tenantId));
  // Fristen können sich geändert haben – Ansprüche neu berechnen.
  await syncClaims(session.tenantId);
  revalidatePath("/", "layout");
}

export async function saveSupplierName(fd: FormData) {
  const session = await requireOwner();
  const id = z.string().uuid().parse(fd.get("id"));
  const name = String(fd.get("name") ?? "").trim() || null;
  await db
    .update(schema.suppliers)
    .set({ name })
    .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.tenantId, session.tenantId)));
  revalidatePath("/einstellungen");
}

export type UserState = { ok: boolean; message: string } | null;

export async function addUser(_prev: UserState, fd: FormData): Promise<UserState> {
  const session = await requireOwner();
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().max(100), role: z.enum(["owner", "staff"]) })
    .safeParse({ email: fd.get("email"), name: fd.get("name") ?? "", role: fd.get("role") });
  if (!parsed.success) return { ok: false, message: "Bitte gültige E-Mail angeben." };
  const password = randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(password, 12);
  let [user] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, parsed.data.email));
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({ email: parsed.data.email, name: parsed.data.name || null, passwordHash: hash })
      .returning();
  }
  await db
    .insert(schema.memberships)
    .values({ tenantId: session.tenantId, userId: user.id, role: parsed.data.role })
    .onConflictDoUpdate({ target: [schema.memberships.tenantId, schema.memberships.userId], set: { role: parsed.data.role } });
  revalidatePath("/einstellungen");
  return user.passwordHash === hash
    ? { ok: true, message: `Angelegt. Einmal-Passwort für ${user.email}: ${password}` }
    : { ok: true, message: `${user.email} hatte schon ein Konto und wurde hinzugefügt.` };
}

export async function removeUser(fd: FormData) {
  const session = await requireOwner();
  const userId = z.string().uuid().parse(fd.get("userId"));
  if (userId === session.userId) return;
  await db
    .delete(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, userId)));
  revalidatePath("/einstellungen");
}

export async function changePassword(_prev: UserState, fd: FormData): Promise<UserState> {
  const session = await requireOwner();
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 10) return { ok: false, message: "Mindestens 10 Zeichen." };
  await db.update(schema.users).set({ passwordHash: await bcrypt.hash(pw, 12) }).where(eq(schema.users.id, session.userId));
  return { ok: true, message: "Passwort geändert." };
}

/** Bereiche und Marken eines Mitarbeiters festlegen. */
export async function updateAccess(_prev: UserState, fd: FormData): Promise<UserState> {
  const session = await requireOwner();
  const userId = z.string().uuid().parse(fd.get("userId"));
  if (userId === session.userId) return { ok: false, message: "Die eigenen Rechte lassen sich nicht ändern." };
  const { AREA_KEYS } = await import("@/lib/auth/areas");
  const areas = fd.get("areaMode") === "all" ? null : fd.getAll("areas").map(String).filter((a) => (AREA_KEYS as string[]).includes(a));
  const brandRows = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.tenantId, session.tenantId));
  const valid = new Set(brandRows.map((b) => b.id));
  const brandIds = fd.get("brandMode") === "all" ? null : fd.getAll("brands").map(String).filter((b) => valid.has(b));
  await db
    .update(schema.memberships)
    .set({ areas, brandIds })
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, userId), eq(schema.memberships.role, "staff")));
  revalidatePath("/einstellungen");
  return { ok: true, message: areas === null ? "Gespeichert – Zugriff auf alle Bereiche." : `Gespeichert – ${areas.length} Bereich${areas.length === 1 ? "" : "e"} freigegeben. Gilt spätestens nach 30 Sekunden.` };
}
