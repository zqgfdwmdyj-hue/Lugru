"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { LEAD_KINDS, LEAD_STATUSES } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { importFromLucid, leadToSupplier, sendDrafts, startDrafts, startResearch } from "@/lib/leads/service";

const uuid = z.string().uuid();
const L = schema.supplierLeads;
const ids = (fd: FormData) => fd.getAll("ids").map(String).filter((s) => uuid.safeParse(s).success);
/** Zurück zur Liste – oder zur Detailseite, von der die Aktion kam. */
const back = (params: Record<string, string>, fd?: FormData) => {
  const from = String(fd?.get("back") ?? "");
  if (/^\/lieferanten\/finden\/[0-9a-f-]{36}$/.test(from)) redirect(`${from}?${new URLSearchParams({ meldung: params.meldung ?? "" })}`);
  redirect(`/lieferanten/finden?${new URLSearchParams(params)}`);
};

export async function searchRegisterAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const brand = String(fd.get("brand") ?? "").trim();
  let msg: string;
  try {
    const r = await importFromLucid(session.tenantId, brand, { onlyActive: fd.get("onlyActive") === "on" });
    msg = `${r.total} Einträge im Verpackungsregister zu „${brand}“ – ${r.stored} übernommen (${r.created} neu). Die Markenlisten werden jetzt geladen; Firmen, bei denen „${brand}“ nur Wortteil ist, werden ausgeblendet.`;
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  back({ marke: brand, meldung: msg });
}

export async function researchAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  let msg: string;
  try {
    const n = await startResearch(session.tenantId, ids(fd));
    msg = n ? `${n} Firmen werden per Websuche geprüft (je ca. 1–2 Minuten, ca. 3–5 Cent pro Firma).` : "Nichts ausgewählt (oder läuft schon).";
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  back({ meldung: msg }, fd);
}

export async function draftAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  let msg: string;
  try {
    const n = await startDrafts(session.tenantId, session.userId, ids(fd), String(fd.get("wish") ?? "").trim().slice(0, 300));
    msg = n ? `${n} Entwürfe werden geschrieben – danach unter „Entwürfe“ prüfen und freigeben.` : "Keine passenden Firmen ausgewählt (Privatpersonen, Salons, Marktplätze und schon angeschriebene werden übersprungen).";
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  back({ ansicht: "entwurf", meldung: msg }, fd);
}

export async function sendAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  if (fd.get("confirm") !== "on") back({ ansicht: "entwurf", meldung: "Bitte bestätigen, dass die Entwürfe geprüft sind." });
  const r = await sendDrafts(session.tenantId, ids(fd));
  back({ ansicht: "angeschrieben", meldung: `${r.sent} Anfragen gesendet.${r.skipped.length ? ` Übersprungen: ${r.skipped.join(" · ")}` : ""}` });
}

export async function setStatusAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const status = z.enum(LEAD_STATUSES).parse(fd.get("status"));
  await db.update(L).set({ status, updatedAt: new Date() }).where(and(eq(L.tenantId, session.tenantId), inArray(L.id, ids(fd))));
  revalidatePath("/lieferanten/finden", "layout");
}

export async function saveLeadAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  const email = String(fd.get("email") ?? "").trim().toLowerCase() || null;
  await db
    .update(L)
    .set({
      kind: z.enum(LEAD_KINDS).parse(fd.get("kind")),
      email,
      mailSubject: String(fd.get("mailSubject") ?? "").trim() || null,
      mailBody: String(fd.get("mailBody") ?? "").trim() || null,
      notes: String(fd.get("notes") ?? "").trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(L.id, id), eq(L.tenantId, session.tenantId)));
  revalidatePath(`/lieferanten/finden/${id}`);
}

export async function sendOneAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  if (fd.get("confirm") !== "on") redirect(`/lieferanten/finden/${id}?meldung=${encodeURIComponent("Bitte bestätigen, dass der Text geprüft ist.")}`);
  const r = await sendDrafts(session.tenantId, [id]);
  redirect(`/lieferanten/finden/${id}?meldung=${encodeURIComponent(r.sent ? "Anfrage gesendet." : `Nicht gesendet: ${r.skipped.join(" · ")}`)}`);
}

export async function toSupplierAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  await leadToSupplier(session.tenantId, id);
  revalidatePath(`/lieferanten/finden/${id}`);
}
