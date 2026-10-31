"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseAmount, parseDate } from "@/lib/numbers";
import { bloeckeGeaendert, freieZeitenAnwenden } from "@/lib/zeit/service";

const Z = schema.zeitbloecke;
const ziel = (m: string) => `/kalender/zeiten?meldung=${encodeURIComponent(m)}`;
const ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Freie Zeit (eigene) oder reservierte Zeit (für alle) anlegen. */
export async function blockAnlegenAction(fd: FormData) {
  const session = await requireArea("kalender");
  const art = z.enum(["frei", "reserviert"]).parse(fd.get("art"));
  if (art === "reserviert" && session.role !== "owner") redirect(ziel("Reservierte Zeiten legt der Inhaber fest."));
  const titel = String(fd.get("titel") ?? "").trim().slice(0, 120) || (art === "frei" ? "Freie Zeit" : "Reserviert");
  const wochentage = fd.getAll("wt").map(Number).filter((n) => n >= 1 && n <= 7);
  if (!wochentage.length) redirect(ziel("Mindestens einen Wochentag wählen."));
  const vonZeit = String(fd.get("von_zeit") ?? "").trim();
  const ganztags = !vonZeit;
  if (vonZeit && !ZEIT.test(vonZeit)) redirect(ziel("Uhrzeit als HH:MM, z. B. 18:00."));
  const ab = String(fd.get("ab") ?? "").trim();
  const bis = String(fd.get("bis") ?? "").trim();
  await db.insert(Z).values({
    tenantId: session.tenantId,
    userId: art === "frei" ? session.userId : null,
    art,
    titel,
    wochentage: [...new Set(wochentage)].sort(),
    ganztags,
    vonZeit: vonZeit || null,
    gueltigVon: ab ? parseDate(ab) : null,
    gueltigBis: bis ? parseDate(bis) : null,
    stunden: art === "reserviert" ? Math.min(12, Math.max(0.5, parseAmount(fd.get("stunden")) ?? 2)) : null,
    link: art === "reserviert" ? String(fd.get("link") ?? "").trim().slice(0, 200) || null : null,
  });
  bloeckeGeaendert(session.tenantId);
  const r = art === "frei" ? await freieZeitenAnwenden(session.tenantId, todayIso()) : { verschoben: 0 };
  revalidatePath("/kalender");
  redirect(ziel(`Gespeichert.${r.verschoben ? ` ${r.verschoben} Aufgaben auf den nächsten Arbeitstag verschoben.` : ""}`));
}

const eigene = (tenantId: string, userId: string, id: string) => and(eq(Z.tenantId, tenantId), eq(Z.id, id), or(eq(Z.userId, userId), isNull(Z.userId)));

export async function blockUmschaltenAction(fd: FormData) {
  const session = await requireArea("kalender");
  const id = z.string().uuid().parse(fd.get("id"));
  const [b] = await db.select({ aktiv: Z.aktiv, userId: Z.userId }).from(Z).where(eigene(session.tenantId, session.userId, id));
  if (!b || (b.userId === null && session.role !== "owner")) redirect(ziel("Nicht erlaubt."));
  await db.update(Z).set({ aktiv: !b.aktiv }).where(eigene(session.tenantId, session.userId, id));
  bloeckeGeaendert(session.tenantId);
  revalidatePath("/kalender");
  redirect(ziel(b.aktiv ? "Pausiert." : "Wieder aktiv."));
}

export async function blockLoeschenAction(fd: FormData) {
  const session = await requireArea("kalender");
  const id = z.string().uuid().parse(fd.get("id"));
  const [b] = await db.select({ userId: Z.userId }).from(Z).where(eigene(session.tenantId, session.userId, id));
  if (!b || (b.userId === null && session.role !== "owner")) redirect(ziel("Nicht erlaubt."));
  await db.delete(Z).where(eigene(session.tenantId, session.userId, id));
  bloeckeGeaendert(session.tenantId);
  revalidatePath("/kalender");
  redirect(ziel("Entfernt."));
}

/** Rückfrage „wichtig + Frist heute an einem freien Tag“: auf den nächsten Arbeitstag verschieben. */
export async function rueckfrageVerschiebenAction(fd: FormData) {
  const session = await requireArea("start");
  const id = z.string().uuid().parse(fd.get("id"));
  const { ladeBloecke } = await import("@/lib/zeit/service");
  const { naechsterArbeitstag, plusTage } = await import("@/lib/zeit/bloecke");
  const nach = naechsterArbeitstag(await ladeBloecke(session.tenantId), plusTage(todayIso(), 1), session.userId);
  await db.update(schema.tasks).set({ dueDate: nach }).where(and(eq(schema.tasks.tenantId, session.tenantId), eq(schema.tasks.id, id)));
  revalidatePath("/");
  redirect("/");
}
