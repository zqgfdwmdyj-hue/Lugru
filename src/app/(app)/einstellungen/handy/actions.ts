"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";

const ziel = (m: string) => `/einstellungen/handy?meldung=${encodeURIComponent(m)}`;
const zeilen = (v: FormDataEntryValue | null) => String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 10).map((s) => s.slice(0, 200));
const zahl = (v: FormDataEntryValue | null, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};
const zeit = (v: FormDataEntryValue | null, d: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? "")) ? String(v) : d);

async function inhaber() {
  const s = await requireSession();
  if (s.role !== "owner" || s.readOnly) redirect("/einstellungen");
  return s;
}

export async function handySpeichern(fd: FormData) {
  const s = await inhaber();
  const nummer = String(fd.get("nummer") ?? "").replace(/[^\d+]/g, "").slice(0, 20);
  const alt = (await (await import("@/lib/settings")).getSettings(s.tenantId)).mobil;
  const mobil = {
    orte: { lager: zeilen(fd.get("lager")), prep: zeilen(fd.get("prep")), palettenlager: zeilen(fd.get("palettenlager")), zuhause: String(fd.get("zuhause") ?? "").trim().slice(0, 200) },
    fahrzeitMin: zahl(fd.get("fahrzeitMin"), 0, 180, 20),
    jeAnrufMin: zahl(fd.get("jeAnrufMin"), 1, 60, 5),
    sms: { an: fd.get("smsAn") === "on" && nummer.length >= 8, nummer, limit: zahl(fd.get("limit"), 1, 50, 10), ruheVon: zeit(fd.get("ruheVon"), "20:00"), ruheBis: zeit(fd.get("ruheBis"), "07:30"), dealSchwelle: zahl(fd.get("dealSchwelle"), 0, 100000, 100) },
    verspaetungToleranz: zahl(fd.get("toleranz"), 0, 120, 10),
    tesla: {
      ...alt.tesla,
      vin: String(fd.get("vin") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17),
      vorheizen: fd.get("vorheizen") === "on",
      vorheizMin: zahl(fd.get("vorheizMin"), 1, 60, 10),
      zielTemp: zahl(fd.get("zielTemp"), 15, 28, 21),
    },
  };
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('mobil', ${JSON.stringify(mobil)}::jsonb)` }).where(eq(schema.tenants.id, s.tenantId));
  revalidatePath("/einstellungen/handy");
  redirect(ziel(fd.get("smsAn") === "on" && nummer.length < 8 ? "Gespeichert – SMS bleibt aus, bis eine Handynummer eingetragen ist." : "Gespeichert."));
}

/** Test-SMS an die eingetragene Nummer (zählt zum Tageslimit, beachtet keine Ruhezeit). */
export async function testSms() {
  const s = await inhaber();
  const { smsMelden } = await import("@/lib/mobil/sms");
  const r = await smsMelden(s.tenantId, { art: "test", rot: true, kern: "Test aus dem Seller-System", schluessel: `test:${Date.now()}`, codes: ["OK"] });
  redirect(ziel(r === "gesendet" ? "Test-SMS gesendet." : r === "aus" ? "SMS ist nicht eingerichtet (Anbindung Twilio + Nummer + „SMS an“)." : `Test-SMS: ${r}`));
}

export async function teslaTest() {
  const s = await inhaber();
  const { testIntegration } = await import("@/lib/integrations/test");
  const r = await testIntegration(s.tenantId, "tesla");
  redirect(ziel(r.message));
}

/** Heim-Standort = aktueller Standort des Autos (für „nur vorheizen, wenn das Auto zu Hause steht“). */
export async function heimStandort() {
  const s = await inhaber();
  const { heimUebernehmen } = await import("@/lib/mobil/auto");
  const m = await heimUebernehmen(s).catch((e) => (e instanceof Error ? e.message : "Tesla nicht erreichbar."));
  revalidatePath("/einstellungen/handy");
  redirect(ziel(m));
}
