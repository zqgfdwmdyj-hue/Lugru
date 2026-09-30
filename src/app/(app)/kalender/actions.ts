"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
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
