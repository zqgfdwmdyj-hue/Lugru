"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { LEAD_KINDS, LEAD_SOURCES, LEAD_STATUSES, type LeadSource } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { importLucidPayload, leadSenders, leadToSupplier, sendDrafts, startBrandLoading, startDrafts, startResearch } from "@/lib/leads/service";
import { startBrandSearch } from "@/lib/leads/sources";
import { sendFollowUp } from "@/lib/board/service";
import { importFairData, startFairImport } from "@/lib/leads/messe-service";
import { startEmailSearch } from "@/lib/leads/email-service";
import { assertPublicUrl } from "@/lib/suppliers/feed-service";
import { listQueryFrom } from "@/lib/leads/list";

const uuid = z.string().uuid();
const L = schema.supplierLeads;
const ids = (fd: FormData) => fd.getAll("ids").map(String).filter((s) => uuid.safeParse(s).success);
/** Filter der Liste (Reiter, Quelle, Marke) aus dem Formular – bleiben nach jeder Aktion erhalten. */
const listOf = (fd?: FormData) => new URLSearchParams(fd?.get("liste") ? listQueryFrom(String(fd.get("liste"))) : "");

/** Zurück zur Liste – oder zur Detailseite, von der die Aktion kam. */
const back = (params: Record<string, string>, fd?: FormData) => {
  const from = String(fd?.get("back") ?? "");
  const q = listOf(fd);
  if (/^\/lieferanten\/finden\/[0-9a-f-]{36}$/.test(from)) {
    q.set("meldung", params.meldung ?? "");
    redirect(`${from}?${q}`);
  }
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  redirect(`/lieferanten/finden?${q}${q.get("m") ? "#liste" : ""}`);
};

/** Zur Detailseite einer Firma – mit den Filtern der Liste (für „zurück zur Suche“ und „nächste Firma“). */
const toLead = (id: string, meldung: string, fd: FormData): never => {
  const q = listOf(fd);
  q.set("meldung", meldung);
  redirect(`/lieferanten/finden/${id}?${q}`);
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
  const r = await sendDrafts(session.tenantId, ids(fd), { userId: session.userId });
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

/** Beim Öffnen einer Firma ohne E-Mail: Suche starten (Website, Impressum, Kontakt; ggf. kurze Websuche). */
export async function autoFindEmailAction(id: string) {
  const session = await requireArea("lieferanten");
  // Nur wenn noch nie gesucht wurde – eine veraltete Seitenansicht startet sonst ein zweites Mal.
  await startEmailSearch(session.tenantId, [uuid.parse(id)], { onlyNew: true });
}

/** „Erneut suchen“ im Schreibfenster bzw. „E-Mail-Adressen suchen“ für die Auswahl in der Liste. */
export async function searchEmailAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const one = uuid.safeParse(fd.get("id"));
  const list = one.success ? [one.data] : ids(fd);
  const n = await startEmailSearch(session.tenantId, list);
  if (one.success) toLead(one.data, n ? "Suche die E-Mail-Adresse …" : "Hat schon eine E-Mail-Adresse oder läuft gerade.", fd);
  back({ meldung: n ? `Suche die E-Mail-Adressen von ${n} Firmen (Website, Impressum, Kontaktseite) – die Liste aktualisiert sich.` : "Alle ausgewählten haben schon eine E-Mail-Adresse." }, fd);
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
  toLead(id, msg, fd);
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
  // Gewähltes Absender-Postfach – nur eigene, aktive Postfächer des Mandanten.
  const fromRaw = String(fd.get("fromId") ?? "");
  const fromId = fromRaw && (await leadSenders(tenantId)).boxes.some((b) => b.id === fromRaw) ? fromRaw : undefined;
  await db
    .update(L)
    .set({
      email,
      ...(fromId ? { mailFromId: fromId } : {}),
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
  const r = await sendDrafts(session.tenantId, [id], { userId: session.userId });
  toLead(id, r.sent ? "Anfrage gesendet." : `Nicht gesendet: ${r.skipped.join(" · ")}`, fd);
}

export async function composeSaveAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = await saveCompose(session.tenantId, fd);
  toLead(id, "Gespeichert.", fd);
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
  toLead(id, msg, fd);
}

export async function toSupplierAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const id = uuid.parse(fd.get("id"));
  await leadToSupplier(session.tenantId, id);
  revalidatePath(`/lieferanten/finden/${id}`);
}
