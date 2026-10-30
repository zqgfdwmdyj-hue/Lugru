"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { aufgabeVerschieben, aufwandSetzen } from "@/lib/tagesplan/service";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
const zurueck = (fd: FormData, meldung: string) => {
  const tag = String(fd.get("tag") ?? "");
  const privat = fd.get("privat") === "1";
  return `/kalender/tagesplan?${new URLSearchParams({ ...(ISO.test(tag) ? { tag } : {}), ...(privat ? { privat: "1" } : {}), meldung }).toString()}`;
};

/** Aufwand einer Aufgabe festlegen (S/M/L) oder auf „geschätzt“ zurücksetzen. */
export async function aufwandAction(fd: FormData) {
  const session = await requireArea("kalender");
  const id = z.string().regex(/^[0-9a-f-]{36}$/i).parse(fd.get("id"));
  const a = String(fd.get("aufwand") ?? "");
  await aufwandSetzen(session.tenantId, [id], a === "S" || a === "M" || a === "L" ? a : null);
  revalidatePath("/kalender/tagesplan");
  redirect(zurueck(fd, "Aufwand gespeichert."));
}

/** Eine Aufgabe auf ein Datum verschieben (auch: vorgeschlagenes neues Datum übernehmen). */
export async function verschiebenAction(fd: FormData) {
  const session = await requireArea("kalender");
  const id = z.string().regex(/^[0-9a-f-]{36}$/i).parse(fd.get("id"));
  const datum = String(fd.get("datum") ?? "");
  if (!ISO.test(datum)) redirect(zurueck(fd, "Bitte ein Datum wählen."));
  const r = await aufgabeVerschieben(session, id, datum);
  revalidatePath("/kalender/tagesplan");
  revalidatePath("/");
  redirect(zurueck(fd, r ? `„${r.titel}“ auf ${datum.split("-").reverse().join(".")} verschoben.` : "Aufgabe nicht gefunden."));
}

/** Alle vorgeschlagenen Verschiebungen übernehmen (Paare id:datum). */
export async function alleVerschiebenAction(fd: FormData) {
  const session = await requireArea("kalender");
  let n = 0;
  for (const paar of fd.getAll("v").map(String)) {
    const [id, datum] = paar.split("|");
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !ISO.test(datum ?? "")) continue;
    if (await aufgabeVerschieben(session, id, datum)) n++;
  }
  revalidatePath("/kalender/tagesplan");
  revalidatePath("/");
  redirect(zurueck(fd, `${n} Aufgabe${n === 1 ? "" : "n"} verschoben.`));
}

/** Eigene Arbeitszeit je Wochentag speichern (leer = kein Arbeitstag). */
export async function arbeitszeitAction(fd: FormData) {
  const session = await requireArea("kalender");
  const az: Record<string, { von: string; bis: string } | null> = {};
  for (let wt = 1; wt <= 7; wt++) {
    const von = String(fd.get(`von${wt}`) ?? "").trim();
    const bis = String(fd.get(`bis${wt}`) ?? "").trim();
    if (!von && !bis) az[String(wt)] = null;
    else if (ZEIT.test(von) && ZEIT.test(bis) && von < bis) az[String(wt)] = { von, bis };
    else redirect(zurueck(fd, "Arbeitszeit als HH:MM, „von“ vor „bis“ – oder beide Felder leer für einen freien Tag."));
  }
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t?.settings ?? {};
  const tp = alt.tagesplan ?? {};
  await db
    .update(schema.tenants)
    .set({ settings: { ...alt, tagesplan: { ...tp, personen: { ...(tp.personen ?? {}), [session.userId]: az } } } })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/kalender/tagesplan");
  redirect(zurueck(fd, "Arbeitszeit gespeichert."));
}
