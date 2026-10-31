"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";

const prozent = (v: FormDataEntryValue | null, fallback: number) => {
  const n = parseAmount(v);
  return n === null ? fallback : Math.round(Math.min(1000, Math.max(-100, n)) * 10) / 1000;
};
const tage = (v: FormDataEntryValue | null, fallback: number) => {
  const n = parseAmount(v);
  return n === null ? fallback : Math.round(Math.min(730, Math.max(1, n)));
};

/** Ziele der Kapital-Ampel: Ziel-Rendite, „gering“, Reichweite grün/rot. */
export async function kapitalZieleAction(fd: FormData) {
  const session = await requireArea("geld");
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t.settings.kapital ?? {};
  const zielRendite = prozent(fd.get("ziel"), alt.zielRendite ?? 0.3);
  const geringRendite = Math.min(zielRendite, prozent(fd.get("gering"), alt.geringRendite ?? 0.05));
  const gruenReichweite = tage(fd.get("gruen"), alt.gruenReichweite ?? 60);
  const rotReichweite = Math.max(gruenReichweite + 1, tage(fd.get("rot"), alt.rotReichweite ?? 120));
  await db
    .update(schema.tenants)
    .set({ settings: { ...t.settings, kapital: { zielRendite, geringRendite, gruenReichweite, rotReichweite } } })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/kapital");
  revalidatePath("/einkauf/vorschlaege");
  redirect("/kapital?meldung=" + encodeURIComponent("Ziele gespeichert."));
}
