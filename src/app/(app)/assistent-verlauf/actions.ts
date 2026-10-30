"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rueckgaengig } from "@/lib/assistant/registry";
import { requireSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

/** Änderung des Assistenten zurücknehmen (grün, höchstens 7 Tage). */
export async function rueckgaengigAction(fd: FormData) {
  const session = await requireSession();
  const id = z.string().uuid().parse(fd.get("id"));
  if (session.readOnly) redirect(`/assistent-verlauf?meldung=${encodeURIComponent("Nur-ansehen-Konten können nichts zurücknehmen.")}`);
  const s = await getSettings(session.tenantId);
  const r = await rueckgaengig({ session, channel: "app", canWrite: true, privat: false, today: todayIso(), baseUrl: "", stufen: s.assistant.stufen }, id);
  revalidatePath("/", "layout");
  redirect(`/assistent-verlauf?meldung=${encodeURIComponent(r.meldung)}`);
}
