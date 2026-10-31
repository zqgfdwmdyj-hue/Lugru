"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { datumOk, type Jahrestag } from "@/lib/private/familie-termine";
import { clip } from "@/lib/private/logic";
import { addEntry, deleteEntry, loadEntry, requirePrivate, updateEntry } from "@/lib/private/service";

// Geburtstage & Jahrestage (Modul 9) – nur Privatbereich mit vollem Umfang.

const ziel = (m: string) => `/privat/geburtstage?meldung=${encodeURIComponent(m)}`;

/** Datum aus dem Formular: „2026-03-14“ (Kalenderfeld) oder „14.03.“ / „14.03.1990“ → „MM-TT“ bzw. „JJJJ-MM-TT“. */
function datumAus(v: FormDataEntryValue | null, mitJahr: boolean): string | null {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return mitJahr ? `${m[1]}-${m[2]}-${m[3]}` : `${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(s);
  if (m) {
    const mmtt = `${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return m[3] && mitJahr ? `${m[3]}-${mmtt}` : mmtt;
  }
  return null;
}

export async function jahrestagSpeichernAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const name = clip(fd.get("name"), 80);
  const art = z.enum(["geburtstag", "jahrestag"]).catch("geburtstag").parse(fd.get("art"));
  const datum = datumAus(fd.get("datum"), fd.get("jahr") === "1");
  if (!name || !datum || !datumOk(datum)) redirect(ziel("Bitte Name und Datum angeben (z. B. 14.03. oder 14.03.1990)."));
  const e: Jahrestag = { name, datum, art, ...(clip(fd.get("beziehung"), 60) ? { beziehung: clip(fd.get("beziehung"), 60)! } : {}), ...(clip(fd.get("ideen"), 1000) ? { ideen: clip(fd.get("ideen"), 1000)! } : {}) };
  const id = String(fd.get("id") ?? "");
  if (id) {
    const cur = await loadEntry(session, id);
    if (!cur || cur.kind !== "geburtstag") redirect(ziel("Eintrag nicht gefunden."));
    await updateEntry(session, id, "geburtstag", e as unknown as Record<string, unknown>, true);
    redirect(ziel(`${name} geändert.`));
  }
  await addEntry(session, "geburtstag", e as unknown as Record<string, unknown>);
  redirect(ziel(`${name} gespeichert – Erinnerung 14 und 3 Tage vorher.`));
}

export async function jahrestagLoeschenAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  await deleteEntry(session, String(fd.get("id")), "geburtstag");
  redirect(ziel("Gelöscht."));
}
