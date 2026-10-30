"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { offeneAufMorgen } from "@/lib/feierabend/service";

/** Feierabend: offene Aufgaben von heute auf morgen schieben (wichtige bleiben stehen). */
export async function aufMorgenAction() {
  const session = await requireArea("kalender");
  const r = await offeneAufMorgen(session, todayIso());
  revalidatePath("/kalender/feierabend");
  revalidatePath("/");
  redirect(`/kalender/feierabend?meldung=${encodeURIComponent(`${r.verschoben} Aufgabe${r.verschoben === 1 ? "" : "n"} auf morgen verschoben${r.wichtigGeblieben ? ` – ${r.wichtigGeblieben} wichtige bleiben stehen (bitte entscheiden)` : ""}.`)}`);
}
