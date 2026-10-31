"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { ausSasUebernehmen, belegUrteil, markeAnlegen } from "@/lib/echtheit/service";

const ID = z.string().uuid();

export async function markeAnlegenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const marke = String(fd.get("marke") ?? "").trim();
  if (marke.length < 2) redirect("/echtheit?meldung=" + encodeURIComponent("Bitte einen Markennamen eingeben (mindestens 2 Zeichen)."));
  const aliase = String(fd.get("aliase") ?? "").split(/[,;\n]/).map((a) => a.trim()).filter(Boolean);
  const r = await markeAnlegen(session.tenantId, marke, aliase);
  revalidatePath("/echtheit");
  redirect(`/echtheit/${r.id}${r.neu ? "" : "?meldung=" + encodeURIComponent("Die Marke gibt es schon.")}`);
}

export async function ausSasAction() {
  const session = await requireArea("amazon");
  const n = await ausSasUebernehmen(session.tenantId);
  revalidatePath("/echtheit");
  redirect("/echtheit?meldung=" + encodeURIComponent(n ? `${n} Marken aus der SAS-Auswahl übernommen.` : "Keine neuen Marken in der SAS-Auswahl."));
}

export async function markeAliaseAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("id"));
  const aliase = [...new Set(String(fd.get("aliase") ?? "").split(/[,;\n]/).map((a) => a.trim().slice(0, 80)).filter((a) => a.length >= 2))].slice(0, 10);
  const notiz = String(fd.get("notiz") ?? "").trim().slice(0, 500) || null;
  await db.update(schema.echtheitMarken).set({ aliase, notiz }).where(and(eq(schema.echtheitMarken.tenantId, session.tenantId), eq(schema.echtheitMarken.id, id)));
  revalidatePath(`/echtheit/${id}`);
  redirect(`/echtheit/${id}?meldung=` + encodeURIComponent("Gespeichert."));
}

/** Nur der Ordner wird entfernt – Rechnungen bleiben unverändert. */
export async function markeEntfernenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("id"));
  await db.delete(schema.echtheitMarken).where(and(eq(schema.echtheitMarken.tenantId, session.tenantId), eq(schema.echtheitMarken.id, id)));
  revalidatePath("/echtheit");
  redirect("/echtheit?meldung=" + encodeURIComponent("Ordner entfernt (Rechnungen bleiben erhalten)."));
}

export async function belegUrteilAction(fd: FormData) {
  const session = await requireArea("amazon");
  const markeId = ID.parse(fd.get("marke"));
  const invoiceId = ID.parse(fd.get("rechnung"));
  const urteil = z.enum(["stimmt", "falsch", "zurueck"]).parse(fd.get("urteil"));
  await belegUrteil(session.tenantId, session.userId, markeId, invoiceId, urteil === "zurueck" ? null : urteil);
  revalidatePath(`/echtheit/${markeId}`);
}

/** Rechnung von Hand zuordnen (Marke steht nicht im Text) – Suche nach Rechnungsnummer oder Lieferant. */
export async function belegZuordnenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const markeId = ID.parse(fd.get("marke"));
  const invoiceId = ID.parse(fd.get("rechnung"));
  await belegUrteil(session.tenantId, session.userId, markeId, invoiceId, "stimmt", true);
  revalidatePath(`/echtheit/${markeId}`);
  redirect(`/echtheit/${markeId}?meldung=` + encodeURIComponent("Rechnung zugeordnet."));
}
