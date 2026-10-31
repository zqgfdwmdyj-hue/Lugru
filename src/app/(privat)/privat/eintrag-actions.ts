"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePrivate } from "@/lib/private/service";
import { endPeriod, handleOccurrence, repairLink, saveAppointment, saveNaehe, savePeriod, saveRitual, saveTimeEntry, saveTouches, setStatus, type OccurrenceOp, type SaveResult } from "@/lib/private/save";
import type { FormState } from "./actions";

// Gemeinsamer Privatkalender: ein Formular für alle Arten („Eintragen“), Ändern je Eintrag, Status,
// Vorkommen des Abendrituals. Neu angelegte Einträge öffnen danach den Kalender am betreffenden Tag.

const uuid = z.string().uuid();
const ARTEN = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "naehe", "zuwendung", "periode"] as const;
type Art = (typeof ARTEN)[number];

function finish(r: SaveResult, isNew: boolean): FormState {
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/privat", "layout");
  if (isNew && r.id) redirect(`/privat/kalender?tag=${r.day ?? ""}&neu=${r.id}&ok=${encodeURIComponent(r.message.slice(0, 200))}`);
  return { ok: true, message: r.message };
}

/** Anlegen (ohne `id`) oder ändern (mit `id`) – Art aus dem Feld `art`. */
export async function saveEntryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const art = String(fd.get("art") ?? "") as Art;
  if (!ARTEN.includes(art)) return { ok: false, message: "Bitte wählen, was du eintragen möchtest." };
  if (fd.get("id") && !uuid.safeParse(fd.get("id")).success) return { ok: false, message: "Eintrag nicht gefunden." };
  const isNew = !fd.get("id");
  // Umfang „nur Familie“: nur Kinderzeit, Ausschlafen, Auszeit.
  if (session.privateScope === "familie" && !["kinder", "auszeit", "ausschlafen"].includes(art)) return { ok: false, message: "Dafür reicht der Privat-Zugang nicht." };
  const r =
    art === "termin" ? await saveAppointment(session, fd)
    : art === "naehe" ? await saveNaehe(session, fd)
    : art === "zuwendung" ? await saveTouches(session, fd)
    : art === "periode" ? await savePeriod(session, fd)
    : await saveTimeEntry(session, art, fd);
  return finish(r, isNew);
}

/** Schnellknöpfe „stattgefunden“ / „ausgefallen“ / „geplant“ (Kalender, Heute). */
export async function setStatusAction(fd: FormData) {
  const session = await requirePrivate({ full: false });
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return;
  await setStatus(session, id.data, fd.get("status"));
  revalidatePath("/privat", "layout");
}

const OPS: OccurrenceOp[] = ["stattgefunden", "ausgefallen", "auslassen"];

/** Ein Vorkommen des Abendrituals bestätigen, als ausgefallen markieren oder auslassen. */
export async function occurrenceAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const op = String(fd.get("op") ?? "") as OccurrenceOp;
  if (!OPS.includes(op)) return;
  await handleOccurrence(session, String(fd.get("vorkommen") ?? ""), op);
  revalidatePath("/privat", "layout");
}

/** Ein Vorkommen verschieben (nur dieses eine). */
export async function moveOccurrenceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate({ full: true });
  const r = await handleOccurrence(session, String(fd.get("vorkommen") ?? ""), "verschieben", fd);
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/privat", "layout");
  redirect(`/privat/eintrag/${r.id}?ok=${encodeURIComponent(r.message.slice(0, 200))}`);
}

export async function saveRitualAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate({ full: true });
  if (fd.get("id") && !uuid.safeParse(fd.get("id")).success) return { ok: false, message: "Vorlage nicht gefunden." };
  const r = await saveRitual(session, fd);
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/privat", "layout");
  return { ok: true, message: r.message };
}

export async function endPeriodAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate({ full: true });
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { ok: false, message: "Eintrag nicht gefunden." };
  const r = await endPeriod(session, id.data, fd.get("end"));
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/privat", "layout");
  return { ok: true, message: r.message };
}

/** Widerspruch zwischen verknüpfter Auszeit und Kinderzeit reparieren – gewählte Variante. */
export async function repairLinkAction(fd: FormData) {
  const session = await requirePrivate();
  const r = await repairLink(session, String(fd.get("key") ?? ""), fd.get("fix"));
  revalidatePath("/privat", "layout");
  redirect(`/privat/pruefen?${r.ok ? "ok" : "fehler"}=${encodeURIComponent(r.message.slice(0, 200))}`);
}
