"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { LEAD_KINDS, LEAD_SOURCES, LEAD_STATUSES, type LeadSource } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { importLucidPayload, leadToSupplier, sendDrafts, startBrandLoading, startDrafts, startResearch } from "@/lib/leads/service";
import { startBrandSearch } from "@/lib/leads/sources";
import { sendFollowUp } from "@/lib/board/service";
import { importFairData, startFairImport } from "@/lib/leads/messe-service";
import { assertPublicUrl } from "@/lib/suppliers/feed-service";

const uuid = z.string().uuid();
const L = schema.supplierLeads;
const ids = (fd: FormData) => fd.getAll("ids").map(String).filter((s) => uuid.safeParse(s).success);
/** Zurück zur Liste – oder zur Detailseite, von der die Aktion kam. */
const back = (params: Record<string, string>, fd?: FormData) => {
  const from = String(fd?.get("back") ?? "");
  if (/^\/lieferanten\/finden\/[0-9a-f-]{36}$/.test(from)) redirect(`${from}?${new URLSearchParams({ meldung: params.meldung ?? "" })}`);
  redirect(`/lieferanten/finden?${new URLSearchParams(params)}`);
};

export async function searchBrandAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const brand = String(fd.get("brand") ?? "").trim();
  const sources = fd.getAll("quelle").map(String).filter((s): s is LeadSource => (LEAD_SOURCES as readonly string[]).includes(s));
  let msg: string;
  let failed = false;
  try {
    if (!sources.length) throw new Error("Bitte mindestens eine Quelle ankreuzen.");
    const r = await startBrandSearch(session.tenantId, brand, sources, { onlyActive: fd.get("onlyActive") === "on" });
    msg = r.message;
    failed = Boolean(r.lucidError);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  back({ marke: brand, meldung: msg, ...(failed ? { register: "browser" } : {}) });
}

/** Fehlende Markenlisten jetzt nachladen (Server, nacheinander). */
export async function loadBrandsAction() {
  const session = await requireArea("lieferanten");
  back({ meldung: await startBrandLoading(session.tenantId, true) });
}

/** Daten vom Register-Lesezeichen (Abfrage im eigenen Browser). */
export async function importRegisterDataAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  let msg: string;
  let brand = "";
  try {
    const r = await importLucidPayload(session.tenantId, String(fd.get("data") ?? ""), { onlyActive: fd.get("onlyActive") === "on" });
    brand = r.brand;
    msg =
      r.mode === "brands"
        ? `Verpackungsregister (über deinen Browser): ${r.stored} von ${r.total} fehlenden Markenlisten übernommen.`
        : `Verpackungsregister (über deinen Browser): ${r.total} Einträge zu „${r.brand}“, ${r.stored} übernommen (${r.created} neu) – inklusive Markenlisten.`;
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

async function setStatus(fd: FormData, status: (typeof LEAD_STATUSES)[number]) {
  const session = await requireArea("lieferanten");
  await db.update(L).set({ status, updatedAt: new Date() }).where(and(eq(L.tenantId, session.tenantId), inArray(L.id, ids(fd))));
  // Abgeschlossen = wird Lieferant (Einkauf).
  if (status === "abgeschlossen") {
    for (const r of await db.select({ id: L.id }).from(L).where(and(eq(L.tenantId, session.tenantId), inArray(L.id, ids(fd)), isNull(L.supplierId)))) await leadToSupplier(session.tenantId, r.id);
  }
  revalidatePath("/lieferanten/finden", "layout");
}

/** Messe-Ausstellerverzeichnis per Link auslesen (im Hintergrund). */
export async function fairImportAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const url = String(fd.get("url") ?? "").trim();
  let msg: string;
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error("Bitte den Link zur Ausstellerliste eintragen (https://…).");
    assertPublicUrl(url);
    await startFairImport(session.tenantId, url, { fairName: String(fd.get("fair") ?? ""), details: fd.get("details") === "on", categories: String(fd.get("categories") ?? "") });
    msg = "Die Ausstellerliste wird im Hintergrund gelesen – Stand unter „Letzte Suchläufe“.";
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  back({ meldung: msg, quelle: "messe" });
}

/** Daten vom Messe-Lesezeichen oder eingefügter Text. */
export async function fairDataAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  let msg: string;
  try {
    const fair = await importFairData(session.tenantId, String(fd.get("data") ?? ""), { fairName: String(fd.get("fair") ?? ""), details: false, categories: String(fd.get("categories") ?? "") });
    msg = `Die KI liest die Aussteller von „${fair}“ – Stand unter „Letzte Suchläufe“.`;
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  back({ meldung: msg, quelle: "messe" });
}

/** Ausgewählte Kontakte aufs Board legen (Spalte „Zu kontaktieren“). */
export async function toBoardAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  await db.update(L).set({ onBoard: true, updatedAt: new Date() }).where(and(eq(L.tenantId, session.tenantId), inArray(L.id, ids(fd))));
  back({ meldung: `${ids(fd).length} aufs Board gelegt (Spalte „Zu kontaktieren“).` }, fd);
}

/** Nachfass-Mail zur ersten Anfrage senden. */
export async function followUpAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  let msg = "Nachfass-Mail gesendet.";
  try {
    await sendFollowUp(session.tenantId, id, String(fd.get("subject") ?? ""), String(fd.get("body") ?? ""));
  } catch (e) {
    msg = `Nicht gesendet: ${e instanceof Error ? e.message : String(e)}`;
  }
  redirect(`/lieferanten/finden/${id}?meldung=${encodeURIComponent(msg)}`);
}

/** Formular mit action={…}: Der geklickte Knopf schickt name="status" mit. */
export async function setStatusAction(fd: FormData) {
  await setStatus(fd, z.enum(LEAD_STATUSES).parse(fd.get("status")));
}

// Knöpfe mit formAction={…} können kein name/value mitschicken (React belegt name) – daher je Status eine Action.
export async function excludeAction(fd: FormData) {
  await setStatus(fd, "ausgeschlossen");
}

export async function reincludeAction(fd: FormData) {
  await setStatus(fd, "neu");
}

export async function saveLeadAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  await db
    .update(L)
    .set({
      kind: z.enum(LEAD_KINDS).parse(fd.get("kind")),
      notes: String(fd.get("notes") ?? "").trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(L.id, id), eq(L.tenantId, session.tenantId)));
  revalidatePath(`/lieferanten/finden/${id}`);
}

/** Beim Öffnen einer Firma: Entwurf automatisch schreiben lassen (einmal; Fehler bleiben am Kontakt stehen). */
export async function autoDraftAction(id: string) {
  const session = await requireArea("lieferanten");
  const leadId = uuid.parse(id);
  try {
    await startDrafts(session.tenantId, session.userId, [leadId], "");
  } catch (e) {
    await db.update(L).set({ mailError: `Entwurf: ${e instanceof Error ? e.message : String(e)}` }).where(and(eq(L.id, leadId), eq(L.tenantId, session.tenantId)));
  }
}

async function saveCompose(tenantId: string, fd: FormData) {
  const id = uuid.parse(fd.get("id"));
  const email = String(fd.get("email") ?? "").trim().toLowerCase() || null;
  await db
    .update(L)
    .set({
      email,
      mailSubject: String(fd.get("mailSubject") ?? "").trim() || null,
      mailBody: String(fd.get("mailBody") ?? "").trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(L.id, id), eq(L.tenantId, tenantId), isNull(L.mailedAt)));
  return id;
}

/** Schreibfenster: gegengelesen → speichern und senden (gleiche Sperren wie immer: Tageslimit, nie doppelt). */
export async function composeSendAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = await saveCompose(session.tenantId, fd);
  const r = await sendDrafts(session.tenantId, [id]);
  redirect(`/lieferanten/finden/${id}?meldung=${encodeURIComponent(r.sent ? "Anfrage gesendet." : `Nicht gesendet: ${r.skipped.join(" · ")}`)}`);
}

export async function composeSaveAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = await saveCompose(session.tenantId, fd);
  redirect(`/lieferanten/finden/${id}?meldung=${encodeURIComponent("Gespeichert.")}`);
}

/** Neu formulieren: alten Entwurf verwerfen, KI schreibt neu. */
export async function redraftAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = await saveCompose(session.tenantId, fd);
  await db.update(L).set({ mailBody: null, mailSubject: null, mailError: null }).where(and(eq(L.id, id), eq(L.tenantId, session.tenantId), isNull(L.mailedAt)));
  let msg = "Die KI schreibt einen neuen Entwurf …";
  try {
    if (!(await startDrafts(session.tenantId, session.userId, [id], String(fd.get("wish") ?? "").trim().slice(0, 300)))) msg = "Kein Entwurf möglich (gesperrt oder schon angeschrieben).";
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  redirect(`/lieferanten/finden/${id}?meldung=${encodeURIComponent(msg)}`);
}

export async function toSupplierAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  await leadToSupplier(session.tenantId, id);
  revalidatePath(`/lieferanten/finden/${id}`);
}
