"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { parseAmount } from "@/lib/numbers";
import { alsErledigt, VORSORGE_VORSCHLAEGE, type FristEintrag } from "@/lib/private/fristen";
import { clip, isDay } from "@/lib/private/logic";
import { addEntry, deleteEntry, loadEntry, requirePrivate, updateEntry } from "@/lib/private/service";

// Vorsorge, Fristen & Verträge – nur Privatbereich mit vollem Umfang.

const ziel = (m: string) => `/privat/fristen?meldung=${encodeURIComponent(m)}`;
const tag = (v: FormDataEntryValue | null) => (isDay(v) ? (v as string) : undefined);
const zahl = (v: FormDataEntryValue | null) => {
  const n = parseAmount(v);
  return n === null ? undefined : Math.abs(n);
};
const ganz = (v: FormDataEntryValue | null) => {
  const n = zahl(v);
  return n === undefined ? undefined : Math.round(n);
};
/** Leere Felder weglassen. */
const ohneLeer = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

export async function fristAnlegenAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const typ = z.enum(["vorsorge", "dokument", "fahrzeug", "garantie", "vertrag"]).parse(fd.get("typ"));
  const basis = { firma: fd.get("firma") === "1" || undefined, notiz: clip(fd.get("notiz"), 300), vorlaufWochen: ganz(fd.get("vorlauf")) };
  let e: FristEintrag;
  if (typ === "vorsorge") {
    const was = clip(fd.get("was"), 80);
    const person = clip(fd.get("person"), 60);
    if (!was || !person) redirect(ziel("Was und für wen?"));
    e = { typ, was, person, intervallMonate: ganz(fd.get("intervall")) || null, zuletzt: tag(fd.get("zuletzt")), faellig: tag(fd.get("faellig")), ...basis };
  } else if (typ === "dokument") {
    const was = clip(fd.get("was"), 80);
    const person = clip(fd.get("person"), 60);
    const ablauf = tag(fd.get("ablauf"));
    if (!was || !person || !ablauf) redirect(ziel("Dokument, Person und Ablaufdatum angeben."));
    e = { typ, was, person, ablauf, ...basis };
  } else if (typ === "fahrzeug") {
    const fahrzeug = clip(fd.get("fahrzeug"), 60);
    const was = z.enum(["tuev", "reifen", "inspektion", "sonstiges"]).catch("tuev").parse(fd.get("was"));
    const faellig = tag(fd.get("faellig"));
    if (!fahrzeug || (was !== "reifen" && !faellig)) redirect(ziel("Fahrzeug und Datum angeben (Reifenwechsel ohne Datum: Oktober/April)."));
    e = { typ, fahrzeug, was, bezeichnung: clip(fd.get("bezeichnung"), 80), faellig, ...basis };
  } else if (typ === "garantie") {
    const was = clip(fd.get("was"), 100);
    const bis = tag(fd.get("bis"));
    if (!was || !bis) redirect(ziel("Gerät und Garantie-Ende angeben."));
    e = { typ, was, bis, haendler: clip(fd.get("haendler"), 80), ...basis };
  } else {
    const anbieter = clip(fd.get("anbieter"), 80);
    const was = clip(fd.get("was"), 80);
    if (!anbieter || !was) redirect(ziel("Anbieter und Vertrag angeben."));
    e = {
      typ,
      anbieter,
      was,
      kostenMonat: Math.round((zahl(fd.get("kosten")) ?? 0) * 100) / 100,
      laufzeitBis: tag(fd.get("laufzeit_bis")),
      verlaengerungMonate: ganz(fd.get("verlaengerung")),
      kuendigungsfristWochen: ganz(fd.get("kuendigungsfrist")),
      ansprechpartner: clip(fd.get("ansprechpartner"), 120),
      erinnerungWochen: ganz(fd.get("erinnerung")) ?? 4,
      ...basis,
    };
  }
  await addEntry(session, "frist", ohneLeer(e));
  revalidatePath("/privat/fristen");
  redirect(ziel("Gespeichert."));
}

/** Erledigt (Termin war, Dokument erneuert, Vertrag behalten) – mit optional neuem Datum. */
export async function fristErledigtAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const id = z.string().uuid().parse(fd.get("id"));
  const e = await loadEntry<FristEintrag>(session, id);
  if (!e || e.kind !== "frist") redirect(ziel("Nicht gefunden."));
  const neu = tag(fd.get("neu"));
  // Vorsorge: „neu“ = Tag des letzten Termins (auch nachträglich); sonst das neue Ablauf-/Fälligkeitsdatum.
  const patch = e.data.typ === "vorsorge" ? alsErledigt(e.data, neu ?? todayIso()) : alsErledigt(e.data, todayIso(), neu);
  await updateEntry(session, id, "frist", patch);
  revalidatePath("/privat/fristen");
  redirect(ziel("Erledigt – nächste Frist berechnet."));
}

/** Vorsorge-Termin gebucht bzw. Vertrag gekündigt. */
export async function fristDatumAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const id = z.string().uuid().parse(fd.get("id"));
  const datum = tag(fd.get("datum"));
  const e = await loadEntry<FristEintrag>(session, id);
  if (!e || e.kind !== "frist" || !datum) redirect(ziel("Bitte ein Datum wählen."));
  if (e.data.typ === "vorsorge") await updateEntry(session, id, "frist", { gebuchtAm: datum });
  else if (e.data.typ === "vertrag") await updateEntry(session, id, "frist", { gekuendigtZum: datum });
  revalidatePath("/privat/fristen");
  redirect(ziel(e.data.typ === "vertrag" ? "Als gekündigt vermerkt." : "Termin vermerkt."));
}

export async function fristLoeschenAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  await deleteEntry(session, z.string().uuid().parse(fd.get("id")), "frist");
  revalidatePath("/privat/fristen");
  redirect(ziel("Gelöscht."));
}

/** Vorsorge-Vorschläge (Zahnarzt, Check-up …) für eine Person anlegen – Datum „zuletzt“ danach eintragen. */
export async function vorsorgeVorschlaegeAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const person = clip(fd.get("person"), 60);
  if (!person) redirect(ziel("Für wen?"));
  const gewaehlt = new Set(fd.getAll("was").map(String));
  let n = 0;
  for (const v of VORSORGE_VORSCHLAEGE.filter((x) => gewaehlt.has(x.was))) {
    await addEntry(session, "frist", { typ: "vorsorge", was: v.was, person, intervallMonate: v.intervallMonate });
    n++;
  }
  revalidatePath("/privat/fristen");
  redirect(ziel(`${n} Vorsorge-Einträge für ${person} angelegt – bitte „zuletzt“ nachtragen.`));
}
