"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { erfolgskontrolle } from "@/lib/b2b/kontrolle";

/** Erfolgskontrolle sofort statt im täglichen Hintergrundlauf. */
export async function kontrolleJetztAction() {
  const session = await requireArea("b2b");
  const n = await erfolgskontrolle(session.tenantId);
  revalidatePath("/b2b/bilanz");
  redirect(`/b2b/bilanz?meldung=${encodeURIComponent(n ? `${n} Kontrolle(n) neu erfasst.` : "Nichts fällig – Kontrollen 30 und 60 Tage nach Wareneingang.")}`);
}
