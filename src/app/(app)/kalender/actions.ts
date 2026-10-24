"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { syncCalendar } from "@/lib/calendar/sync";

export type SyncState = { ok: boolean; message: string } | null;

export async function syncCalendarNow(_prev: SyncState): Promise<SyncState> {
  const session = await requireArea("kalender");
  try {
    const r = await syncCalendar(session.tenantId);
    revalidatePath("/kalender");
    if (!r) return { ok: false, message: "Kein Kalender verbunden." };
    return { ok: true, message: `Abgeglichen – ${r.appointments} eigene Termine, ${r.created + r.updated} Einträge geschrieben${r.fromCalendar ? `, ${r.fromCalendar} Änderungen aus dem Kalender übernommen` : ""}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Inhaber: welche eigenen Kalender Mitarbeiter ohne Privat-Zugang sehen dürfen (ohne Auswahl: keine). */
export async function saveStaffCalendarsAction(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const names = formData
    .getAll("calendar")
    .map((v) => String(v).trim())
    .filter((v) => v && v.length <= 120)
    .slice(0, 50);
  const T = schema.tenants;
  await db
    .update(T)
    .set({ settings: sql`${T.settings} || jsonb_build_object('calendar', coalesce(${T.settings}->'calendar', '{}'::jsonb) || ${JSON.stringify({ staffCalendars: names })}::jsonb)` })
    .where(eq(T.id, session.tenantId));
  revalidatePath("/kalender");
  revalidatePath("/");
}
