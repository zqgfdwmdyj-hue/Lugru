"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { RETOUREN_BEFUNDE, RETOUREN_VERBLEIB } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { markiereEingereicht } from "@/lib/claims/eingereicht";
import { falltextErzeugen, retChargeAnlegen } from "@/lib/retouren-station/fall";
import { entscheidungFuer } from "@/lib/retouren-station/service";

const uuid = z.string().uuid();
const Pos = schema.retourenPositionen;
const zurueck = (id: string, q: string) => redirect(`/remissionen/pruefungen/fall/${id}?${q}`);

/** Fallnummer eintragen und „Eingereicht“ – gleiche Logik wie das Claude-Werkzeug „anspruch_eingereicht“. */
export async function eingereichtAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("positionId"));
  const fallnummer = String(fd.get("fallnummer") ?? "").trim().slice(0, 40);
  const [x] = await db.select({ anspruchId: Pos.anspruchId }).from(Pos).where(and(eq(Pos.tenantId, session.tenantId), eq(Pos.id, id)));
  if (!x?.anspruchId) zurueck(id, "meldung=kein-anspruch");
  if (fallnummer && fallnummer.length < 3) zurueck(id, "meldung=fallnummer");
  const r = await markiereEingereicht(session.tenantId, x!.anspruchId!, { fallnummer: fallnummer || null, userId: session.userId, via: "Fall-Paket der Retouren-Station" });
  revalidatePath("/", "layout");
  zurueck(id, `meldung=${r.ok ? "eingereicht" : "abgeschlossen"}`);
}

export async function falltextNeuAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("positionId"));
  await falltextErzeugen(session.tenantId, id);
  revalidatePath(`/remissionen/pruefungen/fall/${id}`);
  zurueck(id, "meldung=text");
}

/** Befund/Verbleib korrigieren (ohne Sprache) – Entscheidung und Anspruch werden neu gerechnet. */
export async function korrekturAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("positionId"));
  const befund = z.enum(RETOUREN_BEFUNDE).safeParse(fd.get("befund"));
  const verbleib = z.enum(RETOUREN_VERBLEIB).or(z.literal("")).safeParse(fd.get("verbleib") ?? "");
  const [x] = await db.select().from(Pos).where(and(eq(Pos.tenantId, session.tenantId), eq(Pos.id, id)));
  if (!x || !befund.success) zurueck(id, "meldung=ungueltig");
  const e = await entscheidungFuer(session.tenantId, x!, befund.data!);
  await db
    .update(Pos)
    .set({ befund: befund.data!, entscheidung: e.entscheidung, erstattetBetrag: e.erstattet ?? x!.erstattetBetrag, amazonGezahlt: e.gezahlt, verbleib: verbleib.success && verbleib.data ? verbleib.data : null, updatedAt: new Date() })
    .where(eq(Pos.id, id));
  if (e.entscheidung === "fall" && !x!.fallTextDe) await falltextErzeugen(session.tenantId, id);
  const { syncClaims } = await import("@/lib/claims/service");
  await syncClaims(session.tenantId);
  revalidatePath("/", "layout");
  zurueck(id, "meldung=korrigiert");
}

/** RET-SKU von Hand anlegen (z. B. nachdem der Verbleib geändert wurde). */
export async function retSkuAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("positionId"));
  const [x] = await db.select().from(Pos).where(and(eq(Pos.tenantId, session.tenantId), eq(Pos.id, id)));
  const v = x?.verbleib;
  if (!x || !v || !["fba", "b_ware", "ebay"].includes(v)) zurueck(id, "meldung=verbleib");
  const r = await retChargeAnlegen(session.tenantId, x!, v!);
  revalidatePath(`/remissionen/pruefungen/fall/${id}`);
  zurueck(id, `meldung=${r ? "ret" : "ret-fehlt"}`);
}
