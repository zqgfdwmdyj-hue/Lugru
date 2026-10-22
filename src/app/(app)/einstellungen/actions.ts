"use server";

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CLAIM_TYPES, type TenantSettings } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { isEmailLogin, loginNameError, normalizeLogin, passwordError } from "@/lib/auth/username";
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
      problemCarriers: str(fd, "problemCarriers") ?? "",
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
      storageFee: num(fd, "storageFee"),
      minRoi: pct(fd, "minRoi"),
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

/**
 * Passwort eines anderen Benutzers dieser Firma setzen. Nicht bei Konten, die auch zu einer anderen
 * Firma gehören – deren Passwort ändert nur der Benutzer selbst. Danach sind seine Geräte abgemeldet.
 */
async function setMemberPassword(tenantId: string, actorId: string, userId: string, password: string): Promise<string | null> {
  if (userId === actorId) return "Das eigene Passwort bitte unten unter „Eigenes Passwort“ ändern.";
  const ms = await db.select({ tenantId: schema.memberships.tenantId }).from(schema.memberships).where(eq(schema.memberships.userId, userId));
  if (!ms.some((m) => m.tenantId === tenantId)) return "Benutzer nicht gefunden.";
  if (ms.some((m) => m.tenantId !== tenantId)) return "Dieses Konto gehört auch zu einer anderen Firma – das Passwort kann nur der Benutzer selbst ändern.";
  await db.update(schema.users).set({ passwordHash: await bcrypt.hash(password, 12) }).where(eq(schema.users.id, userId));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  return null;
}

/** Benutzer anlegen: Benutzername (oder E-Mail) und – wenn angegeben – das Passwort vom Inhaber. */
export async function addUser(_prev: UserState, fd: FormData): Promise<UserState> {
  const session = await requireOwner();
  const login = normalizeLogin(fd.get("login") ?? fd.get("email"));
  const loginError = loginNameError(login);
  if (loginError) return { ok: false, message: loginError };
  const role = z.enum(["owner", "staff"]).safeParse(fd.get("role"));
  if (!role.success) return { ok: false, message: "Bitte Rolle wählen." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 100);
  const typed = String(fd.get("password") ?? "");
  if (typed) {
    const pwError = passwordError(typed);
    if (pwError) return { ok: false, message: pwError };
  }

  const [existing] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, login));
  if (existing) {
    const ms = await db.select({ tenantId: schema.memberships.tenantId }).from(schema.memberships).where(eq(schema.memberships.userId, existing.id));
    if (existing.id === session.userId) return { ok: false, message: "Das bist du selbst." };
    if (ms.some((m) => m.tenantId === session.tenantId)) {
      await db
        .update(schema.memberships)
        .set({ role: role.data })
        .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, existing.id)));
      const pwError = typed ? await setMemberPassword(session.tenantId, session.userId, existing.id, typed) : null;
      revalidatePath("/einstellungen");
      if (pwError) return { ok: false, message: `${login} gibt es schon. ${pwError}` };
      return { ok: true, message: `${login} gibt es schon – Rolle gespeichert${typed ? ", Passwort neu gesetzt" : ""}.` };
    }
    // Benutzernamen sind eindeutig: ein fremdes Konto nur über seine E-Mail-Adresse dazunehmen.
    if (!isEmailLogin(login)) return { ok: false, message: `Benutzername „${login}“ ist schon vergeben – bitte einen anderen wählen.` };
    await db.insert(schema.memberships).values({ tenantId: session.tenantId, userId: existing.id, role: role.data }).onConflictDoNothing();
    revalidatePath("/einstellungen");
    return { ok: true, message: `${login} hatte schon ein Konto und wurde hinzugefügt – das Passwort bleibt wie bisher.` };
  }

  const password = typed || randomBytes(9).toString("base64url");
  const [user] = await db
    .insert(schema.users)
    .values({ email: login, name: name || null, passwordHash: await bcrypt.hash(password, 12) })
    .returning();
  await db.insert(schema.memberships).values({ tenantId: session.tenantId, userId: user.id, role: role.data });
  revalidatePath("/einstellungen");
  return typed
    ? { ok: true, message: `Angelegt: ${login} meldet sich mit dem vergebenen Passwort an.` }
    : { ok: true, message: `Angelegt. Einmal-Passwort für ${login}: ${password}` };
}

/** Inhaber vergibt einem Benutzer ein neues Passwort (z. B. vergessen oder neuer Mitarbeiter). */
export async function setUserPassword(_prev: UserState, fd: FormData): Promise<UserState> {
  const session = await requireOwner();
  const userId = z.string().uuid().safeParse(fd.get("userId"));
  if (!userId.success) return { ok: false, message: "Benutzer nicht gefunden." };
  const password = String(fd.get("password") ?? "");
  const pwError = passwordError(password);
  if (pwError) return { ok: false, message: pwError };
  const error = await setMemberPassword(session.tenantId, session.userId, userId.data, password);
  if (error) return { ok: false, message: error };
  return { ok: true, message: "Passwort gesetzt – ab jetzt gilt das neue." };
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
    .set({ areas, brandIds, readOnly: fd.get("readOnly") === "on" })
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, userId), eq(schema.memberships.role, "staff")));
  revalidatePath("/einstellungen");
  const ro = fd.get("readOnly") === "on" ? " Nur ansehen (kann nichts ändern)." : "";
  return { ok: true, message: (areas === null ? "Gespeichert – Zugriff auf alle Bereiche." : `Gespeichert – ${areas.length} Bereich${areas.length === 1 ? "" : "e"} freigegeben. Gilt spätestens nach 30 Sekunden.`) + ro };
}
