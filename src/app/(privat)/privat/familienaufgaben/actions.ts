"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { abhaken, KATEGORIEN, type FamilienAufgabe, type Kategorie } from "@/lib/private/familie-aufgaben";
import { clip, isDay } from "@/lib/private/logic";
import { addEntry, deleteEntry, loadEntry, myPartner, privateSettings, requirePrivate, savePrivateSettings, updateEntry } from "@/lib/private/service";
import type { FormState } from "../actions";

// Familien-Aufgaben: auch mit Umfang „familie“ (eigener Zugang z. B. für die Partnerin) – nur diese Liste.

const uuid = z.string().uuid();
const zust = (v: unknown) => (v === "a" || v === "b" ? v : "beide");
const wied = (v: unknown) => (v === "woechentlich" || v === "monatlich" || v === "jaehrlich" ? v : "einmal");
const kat = (v: unknown): Kategorie => (typeof v === "string" && v in KATEGORIEN ? (v as Kategorie) : "sonstiges");
const fertig = (message: string): FormState => {
  revalidatePath("/privat", "layout");
  return { ok: true, message };
};

export async function familienAufgabeAnlegenAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const titel = clip(fd.get("titel"), 200);
  if (!titel) return { ok: false, message: "Bitte die Aufgabe beschreiben." };
  const due = fd.get("faellig");
  const a: FamilienAufgabe = { titel, zustaendig: zust(fd.get("zustaendig")), faellig: isDay(due) ? (due as string) : null, wiederholung: wied(fd.get("wiederholung")), kategorie: kat(fd.get("kategorie")), erledigt: [], ...(clip(fd.get("notiz"), 1000) ? { notiz: clip(fd.get("notiz"), 1000) } : {}) };
  if (a.wiederholung !== "einmal" && !a.faellig) a.faellig = todayIso();
  await addEntry(session, "familienaufgabe", a);
  return fertig("Aufgabe angelegt.");
}

/** Abhaken: einmalig erledigt, wiederkehrend → nächster Termin. Gemerkt wird, wer es erledigt hat. */
export async function familienAufgabeAbhakenAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  const e = await loadEntry<FamilienAufgabe>(session, id);
  if (!e || e.kind !== "familienaufgabe") return;
  const s = await privateSettings(session.tenantId);
  const ich = myPartner(s, session) ?? (e.data.zustaendig === "b" ? "b" : "a");
  const neu = e.data.abgeschlossen ? { ...e.data, abgeschlossen: false } : abhaken({ ...e.data, erledigt: e.data.erledigt ?? [] }, ich, todayIso());
  await updateEntry(session, id, "familienaufgabe", neu, true);
  revalidatePath("/privat", "layout");
}

export async function familienAufgabeZustaendigAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  await updateEntry(session, id, "familienaufgabe", { zustaendig: zust(fd.get("zustaendig")) });
  revalidatePath("/privat", "layout");
}

export async function familienAufgabeLoeschenAction(fd: FormData) {
  const session = await requirePrivate();
  await deleteEntry(session, uuid.parse(fd.get("id")), "familienaufgabe");
  revalidatePath("/privat", "layout");
}

/** Fairness-Übersicht ein/aus (gilt für die Familie). */
export async function fairnessUmschaltenAction() {
  const session = await requirePrivate();
  const s = await privateSettings(session.tenantId);
  await savePrivateSettings(session, { familienFairness: !s.familienFairness });
  revalidatePath("/privat", "layout");
}
