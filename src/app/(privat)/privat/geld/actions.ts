"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { importMeldung, kontoauszugImportieren } from "@/lib/bank/service";
import { todayIso } from "@/lib/dates";
import { parseAmount } from "@/lib/numbers";
import { erinnerungErledigt, STANDARD_ERINNERUNGEN, type Erinnerung, type GeldEintrag } from "@/lib/private/geld";
import { clip, isDay } from "@/lib/private/logic";
import { addEntry, deleteEntry, loadEntries, loadEntry, requirePrivate, updateEntry } from "@/lib/private/service";
import { readTable } from "@/lib/tabular";

// Privates Geld – nur Privatbereich mit vollem Umfang, je Person (nur der Verfasser sieht seine Einträge).

const ziel = (m: string) => `/privat/geld?meldung=${encodeURIComponent(m)}`;
const betrag = (v: FormDataEntryValue | null) => Math.round(Math.abs(parseAmount(v) ?? 0) * 100) / 100;
const monatOk = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

async function priv() {
  return requirePrivate({ full: true });
}

/** Eintrag anlegen – je nach Typ. */
export async function geldEintragAction(fd: FormData) {
  const session = await priv();
  const typ = z.enum(["einkommen", "fixkosten", "ruecklage", "anlage", "erinnerung", "steuerberater"]).parse(fd.get("typ"));
  let e: GeldEintrag;
  if (typ === "einkommen") {
    const monat = String(fd.get("monat") ?? "");
    if (!monatOk(monat)) redirect(ziel("Monat als JJJJ-MM angeben."));
    e = { typ, art: z.enum(["gehalt", "ausschuettung", "sonstiges"]).catch("gehalt").parse(fd.get("art")), betrag: betrag(fd.get("betrag")), monat, status: fd.get("status") === "erhalten" ? "erhalten" : "geplant", ...(clip(fd.get("notiz"), 300) ? { notiz: clip(fd.get("notiz"), 300) } : {}) };
  } else if (typ === "fixkosten") {
    const name = clip(fd.get("name"), 100);
    if (!name) redirect(ziel("Name fehlt."));
    e = { typ, name, betrag: betrag(fd.get("betrag")), rhythmus: z.enum(["monatlich", "quartal", "jaehrlich"]).catch("monatlich").parse(fd.get("rhythmus")) };
  } else if (typ === "ruecklage") {
    const name = clip(fd.get("name"), 100);
    if (!name) redirect(ziel("Name fehlt."));
    e = { typ, name, ziel: betrag(fd.get("ziel")), stand: betrag(fd.get("stand")), ...(betrag(fd.get("monatlich")) ? { monatlich: betrag(fd.get("monatlich")) } : {}) };
  } else if (typ === "anlage") {
    const name = clip(fd.get("name"), 100);
    if (!name) redirect(ziel("Name fehlt."));
    e = { typ, name, art: z.enum(["etf", "immobilie", "konto", "sonstiges"]).catch("sonstiges").parse(fd.get("art")), wert: betrag(fd.get("wert")), standAm: todayIso(), ...(betrag(fd.get("sparrate")) ? { sparrate: betrag(fd.get("sparrate")) } : {}) };
  } else if (typ === "erinnerung") {
    const titel = clip(fd.get("titel"), 150);
    const f = fd.get("faellig");
    if (!titel || !isDay(f)) redirect(ziel("Titel und Datum angeben."));
    e = { typ, titel, faellig: f as string, wiederholung: z.enum(["einmal", "monatlich", "jaehrlich"]).catch("einmal").parse(fd.get("wiederholung")) };
  } else {
    const frage = clip(fd.get("frage"), 500);
    if (!frage) redirect(ziel("Frage fehlt."));
    e = { typ, frage };
  }
  await addEntry(session, "privatgeld", e);
  revalidatePath("/privat/geld");
  redirect(ziel("Gespeichert."));
}

/** Wert aktualisieren (Rücklage-Stand, Anlage-Wert, Einkommen erhalten). */
export async function geldAendernAction(fd: FormData) {
  const session = await priv();
  const id = z.string().uuid().parse(fd.get("id"));
  const e = await loadEntry<GeldEintrag>(session, id);
  if (!e || e.kind !== "privatgeld") redirect(ziel("Nicht gefunden."));
  const d = e.data;
  if (d.typ === "ruecklage") await updateEntry(session, id, "privatgeld", { stand: betrag(fd.get("stand")) });
  else if (d.typ === "anlage") await updateEntry(session, id, "privatgeld", { wert: betrag(fd.get("wert")), standAm: todayIso() });
  else if (d.typ === "einkommen") await updateEntry(session, id, "privatgeld", { status: d.status === "erhalten" ? "geplant" : "erhalten" });
  else if (d.typ === "erinnerung") await updateEntry(session, id, "privatgeld", erinnerungErledigt(d as Erinnerung, todayIso()), true);
  else if (d.typ === "steuerberater") await updateEntry(session, id, "privatgeld", { erledigt: !d.erledigt });
  revalidatePath("/privat/geld");
  redirect("/privat/geld");
}

export async function geldLoeschenAction(fd: FormData) {
  const session = await priv();
  await deleteEntry(session, z.string().uuid().parse(fd.get("id")), "privatgeld");
  revalidatePath("/privat/geld");
  redirect(ziel("Gelöscht."));
}

/** Vorschläge: Sparpläne prüfen, Freistellungsauftrag, Steuerunterlagen – je einmal. */
export async function standardErinnerungenAction() {
  const session = await priv();
  const heute = todayIso();
  const da = new Set((await loadEntries<GeldEintrag>(session, ["privatgeld"])).filter((e) => e.data.typ === "erinnerung").map((e) => (e.data as Erinnerung).titel));
  let n = 0;
  for (const s of STANDARD_ERINNERUNGEN) {
    if (da.has(s.titel)) continue;
    let f = `${heute.slice(0, 4)}-${s.monatTag}`;
    if (f < heute) f = `${Number(heute.slice(0, 4)) + 1}-${s.monatTag}`;
    await addEntry(session, "privatgeld", { typ: "erinnerung", titel: s.titel, faellig: f, wiederholung: s.wiederholung });
    n++;
  }
  revalidatePath("/privat/geld");
  redirect(ziel(n ? `${n} Erinnerungen angelegt.` : "Schon alle vorhanden."));
}

/** Privatkonto: Kontoauszug (CSV/CAMT) – nur für diese Person, getrennt vom Geschäftskonto. */
export async function privatKontoAction(fd: FormData) {
  const session = await priv();
  const datei = fd.get("datei");
  if (!(datei instanceof File) || datei.size === 0) redirect(ziel("Bitte die Datei auswählen."));
  if (datei.size > 10 * 1024 * 1024) redirect(ziel("Datei zu groß (höchstens 10 MB)."));
  let m: string;
  try {
    const r = await kontoauszugImportieren(session.tenantId, "privat", session.userId, new Uint8Array(await datei.arrayBuffer()), { saldoBank: parseAmount(fd.get("saldo")) });
    m = importMeldung(r);
  } catch (e) {
    m = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/privat/geld");
  redirect(ziel(m));
}

/** Anlagen per CSV (Spalten Name; Art; Wert) – ersetzt keine vorhandenen, legt neue an. */
export async function anlagenCsvAction(fd: FormData) {
  const session = await priv();
  const datei = fd.get("datei");
  if (!(datei instanceof File) || datei.size === 0 || datei.size > 2 * 1024 * 1024) redirect(ziel("Bitte eine CSV-Datei (bis 2 MB) wählen."));
  const t = readTable(new Uint8Array(await datei.arrayBuffer()));
  const h = t.headers.map((x) => x.toLowerCase());
  const iName = h.findIndex((x) => /name|bezeichnung|anlage/.test(x));
  const iWert = h.findIndex((x) => /wert|betrag|stand/.test(x));
  const iArt = h.findIndex((x) => /art|typ/.test(x));
  if (iName < 0 || iWert < 0) redirect(ziel("Spalten „Name“ und „Wert“ nicht gefunden."));
  let n = 0;
  for (const r of t.rows.slice(0, 200)) {
    const name = clip(r[iName], 100);
    const wert = parseAmount(r[iWert]);
    if (!name || wert === null) continue;
    const a = String(iArt >= 0 ? r[iArt] : "").toLowerCase();
    await addEntry(session, "privatgeld", { typ: "anlage", name, art: /etf|fonds|spar/.test(a) ? "etf" : /immo|wohnung|haus/.test(a) ? "immobilie" : /konto|tages|geld/.test(a) ? "konto" : "sonstiges", wert: Math.abs(wert), standAm: todayIso() });
    n++;
  }
  revalidatePath("/privat/geld");
  redirect(ziel(`${n} Anlagen übernommen.`));
}
