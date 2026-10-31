"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { updatePrefs } from "@/lib/auth/prefs";

/** Kalender auf der Startseite ein- oder ausblenden (z. B. private Kalender) – gilt nur für mich. */
export async function toggleCalendarAction(fd: FormData) {
  const session = await requireSession();
  const name = z.string().trim().min(1).max(200).parse(fd.get("calendar"));
  await updatePrefs(session, (p) => {
    const set = new Set(p.hiddenCalendars ?? []);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    return { ...p, hiddenCalendars: [...set] };
  });
  revalidatePath("/");
}

/** Anruf-Aufgabe: Telefonnummer speichern (eingetippt oder bestätigter Vorschlag). */
export async function anrufTelefonAction(fd: FormData) {
  const session = await requireSession();
  if (session.readOnly) redirect("/?ansicht=liste");
  const id = z.string().uuid().parse(fd.get("id"));
  const roh = z.string().trim().min(3).max(40).parse(fd.get("telefon"));
  const { telefonAus } = await import("@/lib/mobil/logic");
  const T = schema.tasks;
  await db.update(T).set({ telefon: telefonAus(roh) ?? roh }).where(and(eq(T.tenantId, session.tenantId), eq(T.id, id)));
  revalidatePath("/");
  redirect("/?ansicht=liste");
}

/** Anruf-Aufgabe: Nummer im Web suchen (auf Knopfdruck) – Ergebnis nur als Vorschlag, gespeichert wird erst nach Bestätigung. */
export async function anrufTelefonSuchenAction(fd: FormData) {
  const session = await requireSession();
  const id = z.string().uuid().parse(fd.get("id"));
  const T = schema.tasks;
  const [t] = await db.select({ title: T.title }).from(T).where(and(eq(T.tenantId, session.tenantId), eq(T.id, id)));
  if (!t || session.readOnly) redirect("/?ansicht=liste");
  const { anrufName } = await import("@/lib/mobil/logic");
  const { telefonVorschlag } = await import("@/lib/mobil/telefon");
  const { canAccess } = await import("@/lib/auth/areas");
  const v = await telefonVorschlag(session.tenantId, anrufName(t.title), { web: true, mails: canAccess(session, "posteingang") }).catch(() => null);
  const q = new URLSearchParams({ ansicht: "liste", tel: id, ...(v ? { nr: v.nummer, nrq: v.quelle } : { nr: "" }) });
  redirect(`/?${q.toString()}`);
}
