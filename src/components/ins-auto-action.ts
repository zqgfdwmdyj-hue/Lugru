"use server";

import { requireSession } from "@/lib/auth/session";
import { insAuto } from "@/lib/mobil/service";

export type InsAutoState = { ok: boolean; text: string } | null;

/** „Ins Auto“: Navigationsziel an den Tesla – nur Inhaber, nur auf Knopfdruck. Klima nur mit Häkchen. */
export async function insAutoAction(_prev: InsAutoState, fd: FormData): Promise<InsAutoState> {
  const s = await requireSession();
  return insAuto(s, String(fd.get("ziel") ?? ""), { klima: fd.get("klima") === "on" });
}
