"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { nextPalletCodes } from "@/lib/pallets/billing";

const P = schema.pallets;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type ScanState = { ok: boolean; message: string; codes?: string[] } | null;

function readDate(v: FormDataEntryValue | null): string {
  const s = String(v ?? "").trim();
  const today = todayIso();
  // Kein Datum in der Zukunft – sonst stimmt die Abrechnung nicht.
  return isoDate.safeParse(s).success && s <= today ? s : today;
}

/**
 * Scan-Feld: Einlagern (neue Palette, Timer startet) oder Auslagern (Timer stoppt).
 * Leere Nummer beim Einlagern = automatisch P-0001, P-0002 …, mit Anzahl auch mehrere auf einmal.
 */
export async function scanPallet(_prev: ScanState, fd: FormData): Promise<ScanState> {
  const session = await requireArea("wawi");
  const t = session.tenantId;
  const mode = z.enum(["ein", "aus"]).parse(fd.get("mode"));
  const code = String(fd.get("code") ?? "").trim().slice(0, 80);
  const day = readDate(fd.get("date"));

  if (mode === "aus") {
    if (!code) return { ok: false, message: "Bitte Palettennummer scannen oder eingeben." };
    const [open] = await db.select().from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), sql`lower(${P.code}) = lower(${code})`));
    if (!open) return { ok: false, message: `Palette „${code}“ ist nicht eingelagert.` };
    const outAt = day < open.inAt ? open.inAt : day;
    await db.update(P).set({ outAt, updatedAt: new Date() }).where(and(eq(P.id, open.id), eq(P.tenantId, t)));
    revalidatePath("/paletten");
    return { ok: true, message: `Palette ${open.code} ausgelagert${open.customer ? ` (${open.customer})` : ""}.`, codes: [open.code] };
  }

  const customer = String(fd.get("customer") ?? "").trim().slice(0, 120) || null;
  const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
  const count = Math.min(100, Math.max(1, Math.round(Number(fd.get("count")) || 1)));
  const openCodes = (await db.select({ code: P.code }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt)))).map((r) => r.code.toLowerCase());

  let codes: string[];
  if (code) {
    if (count > 1) return { ok: false, message: "Mehrere Paletten auf einmal nur ohne Nummer (dann werden Nummern vergeben)." };
    if (openCodes.includes(code.toLowerCase())) return { ok: false, message: `Palette „${code}“ ist schon eingelagert. Zum Auslagern oben „Auslagern“ wählen.` };
    codes = [code];
  } else {
    const all = (await db.select({ code: P.code }).from(P).where(eq(P.tenantId, t))).map((r) => r.code);
    codes = nextPalletCodes(all, count);
  }
  await db.insert(P).values(codes.map((c) => ({ tenantId: t, code: c, customer, note, inAt: day })));
  revalidatePath("/paletten");
  return {
    ok: true,
    message: codes.length === 1 ? `Palette ${codes[0]} eingelagert – Timer läuft ab ${day.split("-").reverse().join(".")}.` : `${codes.length} Paletten eingelagert: ${codes[0]} bis ${codes[codes.length - 1]}.`,
    codes,
  };
}

/** Knopf in der Liste: Palette ist weg. */
export async function checkOutPallet(fd: FormData) {
  const session = await requireArea("wawi");
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  if (!p || p.outAt) return;
  const day = readDate(fd.get("date"));
  await db.update(P).set({ outAt: day < p.inAt ? p.inAt : day, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  revalidatePath("/paletten");
}

/** Auslagern rückgängig (versehentlich gescannt). */
export async function undoCheckOut(fd: FormData) {
  const session = await requireArea("wawi");
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  if (!p || !p.outAt) return;
  const [clash] = await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, session.tenantId), isNull(P.outAt), eq(P.code, p.code)));
  if (clash) return; // Nummer ist inzwischen wieder belegt
  await db.update(P).set({ outAt: null, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  revalidatePath("/paletten");
}

/** Daten korrigieren (Kunde, Notiz, Ein-/Auslagerungstag). */
export async function updatePallet(fd: FormData) {
  const session = await requireArea("wawi");
  const id = z.string().uuid().parse(fd.get("id"));
  const inAt = isoDate.parse(fd.get("inAt"));
  const outRaw = String(fd.get("outAt") ?? "").trim();
  const outAt = outRaw ? isoDate.parse(outRaw) : null;
  if (outAt && outAt < inAt) return;
  await db
    .update(P)
    .set({
      inAt,
      ...(fd.has("outAt") ? { outAt } : {}),
      customer: String(fd.get("customer") ?? "").trim().slice(0, 120) || null,
      note: String(fd.get("note") ?? "").trim().slice(0, 300) || null,
      updatedAt: new Date(),
    })
    .where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  revalidatePath("/paletten");
}

export async function deletePallet(fd: FormData) {
  const session = await requireArea("wawi");
  const id = z.string().uuid().parse(fd.get("id"));
  await db.delete(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  revalidatePath("/paletten");
}

/** Preise ändert nur der Inhaber. */
export async function savePalletRates(fd: FormData) {
  const session = await requireOwner();
  const pricePerMonth = z.coerce.number().min(0).max(10000).parse(String(fd.get("pricePerMonth") ?? "").replace(",", "."));
  const freeDays = z.coerce.number().int().min(0).max(365).parse(fd.get("freeDays"));
  const mode = z.enum(["monat", "anteilig"]).parse(fd.get("mode"));
  const patch = JSON.stringify({ pallets: { pricePerMonth, freeDays, mode } });
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || ${patch}::jsonb` })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/paletten");
}
