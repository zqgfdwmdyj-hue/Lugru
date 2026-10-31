"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseAmount } from "@/lib/numbers";
import { helferBereinigen, type EinsatzEintrag, type Helfer, type HelferArt } from "@/lib/private/haushaltshilfe";
import { clip, isDay } from "@/lib/private/logic";
import { addEntry, deleteEntry, loadEntries, loadEntry, privateSettings, requirePrivate, savePrivateSettings, updateEntry } from "@/lib/private/service";

// Babysitter & Putzhilfe – nur Privatbereich mit vollem Umfang. Gespeichert wird nur, was von Hand geändert wird;
// Einsätze aus dem Kalender werden sonst bei jedem Aufruf neu berechnet.

const zurueck = (monat: string, m: string) => `/privat/haushaltshilfe?monat=${monat}&meldung=${encodeURIComponent(m)}`;
const monatAus = (fd: FormData) => {
  const m = String(fd.get("monat") ?? "");
  return /^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7);
};
const euro = (v: FormDataEntryValue | null) => {
  const n = parseAmount(v);
  return n === null || !String(v ?? "").trim() ? null : Math.round(Math.abs(n) * 100) / 100;
};
const zeit = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : undefined;
};
/** Stunden („2,5“) → Minuten; leer = keine Korrektur. */
const minuten = (v: FormDataEntryValue | null) => {
  if (!String(v ?? "").trim()) return undefined;
  const n = parseAmount(v);
  return n === null ? undefined : Math.round(Math.abs(n) * 60);
};
const STATUS = z.enum(["geplant", "stattgefunden", "ausgefallen"]);

/** Stundensätze und Erkennungsbegriffe speichern (alle Hilfen auf einmal, plus optional eine neue). */
export async function helferSpeichernAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const monat = monatAus(fd);
  const ids = fd.getAll("id").map(String);
  const liste: Helfer[] = ids.map((id, i) => ({
    id,
    name: String(fd.getAll("name")[i] ?? ""),
    art: z.enum(["babysitter", "putzhilfe", "sonstiges"]).catch("sonstiges").parse(fd.getAll("art")[i]) as HelferArt,
    begriffe: String(fd.getAll("begriffe")[i] ?? "").split(/[,;\n]/),
    satz: euro(fd.getAll("satz")[i] ?? null),
    satzWach: euro(fd.getAll("satzWach")[i] ?? null),
    satzSchlaf: euro(fd.getAll("satzSchlaf")[i] ?? null),
    schlafAb: zeit(fd.getAll("schlafAb")[i] ?? null),
    wachAb: zeit(fd.getAll("wachAb")[i] ?? null),
    aktiv: fd.getAll("aktiv").map(String).includes(id),
  }));
  const neuName = clip(fd.get("neuName"), 60);
  if (neuName) {
    const art = z.enum(["babysitter", "putzhilfe", "sonstiges"]).catch("sonstiges").parse(fd.get("neuArt")) as HelferArt;
    liste.push({ id: "", name: neuName, art, begriffe: [neuName, ...String(fd.get("neuBegriffe") ?? "").split(/[,;\n]/)], satz: euro(fd.get("neuSatz")), satzWach: art === "babysitter" ? euro(fd.get("neuSatz")) : null, satzSchlaf: null, aktiv: true });
  }
  await savePrivateSettings(session, { haushaltshilfe: { helfer: helferBereinigen(liste) } });
  revalidatePath("/privat/haushaltshilfe");
  redirect(zurueck(monat, "Stundensätze gespeichert."));
}

/** Einsatz korrigieren (Uhrzeit, Stunden wach/schlafend, Betrag, Status, bezahlt, Notiz) – legt den Eintrag bei Bedarf an. */
export async function einsatzSpeichernAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const monat = monatAus(fd);
  const recordId = String(fd.get("recordId") ?? "");
  const helfer = (await privateSettings(session.tenantId)).haushaltshilfe?.helfer ?? [];
  const helferId = String(fd.get("helferId") ?? "");
  if (!helfer.some((h) => h.id === helferId)) redirect(zurueck(monat, "Hilfe nicht gefunden."));
  const day = String(fd.get("day") ?? "");
  if (!isDay(day)) redirect(zurueck(monat, "Datum fehlt."));
  const quelle = z.enum(["kalender", "termin", "hand"]).catch("hand").parse(fd.get("quelle"));
  const ref = clip(fd.get("ref"), 400) || undefined;
  const daten: EinsatzEintrag = {
    ...(ref ? { ref } : {}),
    quelle,
    helferId,
    day,
    ...(clip(fd.get("titel"), 200) ? { titel: clip(fd.get("titel"), 200) } : {}),
    status: STATUS.catch("stattgefunden").parse(fd.get("status")),
    bezahlt: fd.get("bezahlt") === "on",
  };
  // Nur abweichende Angaben speichern: Uhrzeit, wenn geändert; Stunden/Betrag, wenn ausgefüllt.
  const from = zeit(fd.get("from"));
  const to = zeit(fd.get("to"));
  if (from && from !== String(fd.get("fromKalender") ?? "")) daten.from = from;
  if (to && to !== String(fd.get("toKalender") ?? "")) daten.to = to;
  const mw = minuten(fd.get("stdWach"));
  const ms = minuten(fd.get("stdSchlaf"));
  if (mw !== undefined) daten.minWach = mw;
  if (ms !== undefined) daten.minSchlaf = ms;
  const b = euro(fd.get("betrag"));
  if (b !== null) daten.betrag = b;
  const notiz = clip(fd.get("notiz"), 300);
  if (notiz) daten.notiz = notiz;
  if (recordId) {
    const e = await loadEntry<EinsatzEintrag>(session, recordId);
    if (!e || e.kind !== "haushaltshilfe") redirect(zurueck(monat, "Nicht gefunden."));
    await updateEntry(session, recordId, "haushaltshilfe", daten as unknown as Record<string, unknown>, true);
  } else {
    // Gleiche Termin-Kennung nie doppelt.
    const schon = ref ? (await loadEntries<EinsatzEintrag>(session, ["haushaltshilfe"])).find((e) => e.data.ref === ref) : undefined;
    if (schon) await updateEntry(session, schon.id, "haushaltshilfe", daten as unknown as Record<string, unknown>, true);
    else await addEntry(session, "haushaltshilfe", daten as unknown as Record<string, unknown>);
  }
  revalidatePath("/privat/haushaltshilfe");
  redirect(zurueck(monat, "Einsatz gespeichert."));
}

/** Einsatz von Hand anlegen (z. B. nicht im Kalender). */
export async function einsatzHandAction(fd: FormData) {
  fd.set("quelle", "hand");
  fd.delete("ref");
  fd.delete("recordId");
  return einsatzSpeichernAction(fd);
}

/** Korrektur zurücknehmen (Kalender-Einsatz wird wieder berechnet) bzw. von Hand erfassten Einsatz löschen. */
export async function einsatzZuruecksetzenAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const monat = monatAus(fd);
  const id = z.string().uuid().parse(fd.get("recordId"));
  const e = await loadEntry<EinsatzEintrag>(session, id);
  if (!e || e.kind !== "haushaltshilfe") redirect(zurueck(monat, "Nicht gefunden."));
  await deleteEntry(session, id, "haushaltshilfe");
  revalidatePath("/privat/haushaltshilfe");
  redirect(zurueck(monat, e.data.quelle === "hand" ? "Einsatz gelöscht." : "Korrektur zurückgenommen – wird wieder aus dem Kalender berechnet."));
}
