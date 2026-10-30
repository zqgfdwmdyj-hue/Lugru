"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseDate } from "@/lib/numbers";
import { refreshVerlustTasks } from "@/lib/money/verlust-service";

const SKU = z.string().trim().min(1).max(200);
const meldung = (m: string) => `/verlust?meldung=${encodeURIComponent(m)}`;

/** Bewusster Verlustverkauf (Abverkauf, Liquidation …): keine Aufgabe mehr, aber in der Ausnahme-Liste sichtbar. */
export async function ausnahmeAction(fd: FormData) {
  const session = await requireArea("geld");
  const sku = SKU.parse(fd.get("sku"));
  const grund = String(fd.get("grund") ?? "").trim().slice(0, 200) || "Bewusster Abverkauf";
  const bisRoh = String(fd.get("bis") ?? "").trim();
  const bis = bisRoh ? parseDate(bisRoh) : null;
  if (bisRoh && !bis) redirect(meldung("Datum „bis“ nicht erkannt (TT.MM.JJJJ)."));
  const A = schema.verlustAusnahmen;
  await db
    .insert(A)
    .values({ tenantId: session.tenantId, sku, grund, bis, angelegtVon: session.userId })
    .onConflictDoUpdate({ target: [A.tenantId, A.sku], set: { grund, bis, angelegtVon: session.userId, angelegtAm: new Date() } });
  await refreshVerlustTasks(session.tenantId, todayIso());
  revalidatePath("/verlust");
  redirect(meldung(`${sku} als Ausnahme eingetragen.`));
}

export async function ausnahmeBeendenAction(fd: FormData) {
  const session = await requireArea("geld");
  const sku = SKU.parse(fd.get("sku"));
  const A = schema.verlustAusnahmen;
  await db.delete(A).where(and(eq(A.tenantId, session.tenantId), eq(A.sku, sku)));
  await refreshVerlustTasks(session.tenantId, todayIso());
  revalidatePath("/verlust");
  redirect(meldung(`Ausnahme für ${sku} beendet – wird wieder geprüft.`));
}

/** Schwelle für „Kosten ohne Verkauf“ (€ je Artikel und Woche). */
export async function schwelleAction(fd: FormData) {
  const session = await requireArea("geld");
  const n = Number(String(fd.get("schwelle") ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 10_000) redirect(meldung("Schwelle als Betrag in € angeben (z. B. 5)."));
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t?.settings ?? {};
  await db.update(schema.tenants).set({ settings: { ...alt, verlust: { ...(alt.verlust ?? {}), kostenOhneVerkaufSchwelle: n } } }).where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/verlust");
  redirect(meldung(`Schwelle „Kosten ohne Verkauf“: ${n.toFixed(2).replace(".", ",")} € je Woche.`));
}
