"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { loeschenFreigeben } from "@/lib/belege/ablage";

const PFAD = "/rechnungsstation/ablage";

/** Dubletten zum Löschen freigeben – gelöscht wird erst beim nächsten Lauf des Agenten (Prüfsumme muss stimmen). */
export async function freigebenAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  if (s.role !== "owner") redirect(`${PFAD}?meldung=${encodeURIComponent("Nur der Inhaber gibt Dubletten zum Löschen frei.")}`);
  const ids = fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const n = await loeschenFreigeben(s, fd.get("alle") === "1" ? "alle" : ids);
  revalidatePath(PFAD);
  redirect(`${PFAD}?meldung=${encodeURIComponent(n ? `${n} Dublette${n === 1 ? "" : "n"} zum Löschen freigegeben – der Agent löscht beim nächsten Lauf.` : "Nichts freigegeben.")}`);
}
