"use server";

import { requireSession } from "@/lib/auth/session";

export type AutoStatusState = { ok: boolean; text: string } | null;

/** Fahrzeugstatus auf Knopfdruck (Tesla berechnet je Abfrage – darum kein automatisches Laden). Nur Inhaber. */
export async function autoStatusAction(_prev: AutoStatusState): Promise<AutoStatusState> {
  const s = await requireSession();
  if (s.role !== "owner") return { ok: false, text: "Nur der Inhaber." };
  const { autoStatus } = await import("@/lib/mobil/auto");
  const r = await autoStatus(s);
  return { ok: r.verbunden && !r.fehler, text: r.vorlesen };
}
