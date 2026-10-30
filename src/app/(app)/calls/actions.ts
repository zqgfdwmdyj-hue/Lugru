"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseDate } from "@/lib/numbers";
import { archivImportieren, callAuswerten, callBearbeiten, callImportieren, callsSammelImport, discordCallsImport, offeneCallsAuswerten, punktAnlegen, punkteUebernehmen, punktStatus, wissenNeuAnstossen } from "@/lib/calls/service";
import { datumAusText, type CallArt } from "@/lib/calls/logic";

const ID = z.string().uuid();
const ART = (v: FormDataEntryValue | null): CallArt => (v === "gruppe" ? "gruppe" : "consultant");
const zurueck = (pfad: string, m: string) => `${pfad}${pfad.includes("?") ? "&" : "?"}meldung=${encodeURIComponent(m)}`;

/** Transkript als Text oder Google-Docs-Link importieren; die KI wertet gleich aus. */
export async function callImportAction(fd: FormData) {
  const session = await requireArea("amazon");
  const link = String(fd.get("link") ?? "").trim();
  const text = String(fd.get("text") ?? "");
  const titelRoh = String(fd.get("titel") ?? "").trim();
  const datumRoh = String(fd.get("datum") ?? "").trim();
  const datum = (datumRoh && parseDate(datumRoh)) || datumAusText(`${titelRoh} ${text.slice(0, 300)}`, todayIso());
  const art = ART(fd.get("art"));
  const titel = titelRoh || `${art === "gruppe" ? "Wochen-Call Deal-Gruppe" : "Consultant-Call"} ${datum.split("-").reverse().join(".")}`;
  if (!link && text.trim().length < 20) redirect(zurueck("/calls", "Bitte Transkript einfügen oder einen Google-Docs-Link angeben."));
  if (text.length > 400_000) redirect(zurueck("/calls", "Transkript zu lang (höchstens 400.000 Zeichen)."));
  let r: Awaited<ReturnType<typeof callImportieren>>;
  try {
    r = await callImportieren(session.tenantId, link ? { titel, datum, link, quelle: "google_doc", art } : { titel, datum, text, quelle: "text", art });
  } catch (e) {
    redirect(zurueck("/calls", e instanceof Error ? e.message : String(e)));
  }
  if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
  revalidatePath("/calls");
  redirect(zurueck(`/calls/${r.id}`, !r.neu ? "Dieser Call ist schon im Archiv." : r.fehler ? `Importiert – Auswertung: ${r.fehler}` : `Importiert – ${r.punkte} Punkte zur Prüfung.`));
}

export async function discordImportAction(fd: FormData) {
  const session = await requireArea("amazon");
  const nachholen = fd.get("nachholen") === "1";
  let m: string;
  try {
    const r = await discordCallsImport(session.tenantId, todayIso(), { nachrichten: nachholen ? 2000 : 50 });
    m = `${r.neu} neue Calls aus Discord${nachholen ? ` (${r.gelesen} Nachrichten gelesen)` : ""}.${r.neu ? " Die KI wertet sie nacheinander aus." : ""}${r.fehler.length ? ` Probleme: ${r.fehler.join(" · ")}` : ""}`;
    if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
  } catch (e) {
    m = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/calls");
  redirect(zurueck("/calls", m.slice(0, 500)));
}

/** Mehrere Calls auf einmal: Dateien (Word, PDF, Text, Untertitel, ZIP) und/oder eingefügte Links/Discord-Nachrichten. */
export async function sammelImportAction(fd: FormData) {
  const session = await requireArea("amazon");
  const art = ART(fd.get("art"));
  const bezeichnung = String(fd.get("bezeichnung") ?? "").trim().slice(0, 120) || null;
  const linkText = String(fd.get("links") ?? "").slice(0, 200_000);
  const dateien: { name: string; daten: Uint8Array }[] = [];
  let groesse = 0;
  for (const f of fd.getAll("dateien")) {
    if (!(f instanceof File) || !f.size) continue;
    groesse += f.size;
    if (groesse > 20 * 1024 * 1024) redirect(zurueck("/calls", "Zusammen höchstens 20 MB – bitte in mehreren Schritten hochladen."));
    dateien.push({ name: f.name, daten: new Uint8Array(await f.arrayBuffer()) });
  }
  if (!dateien.length && !/docs\.google\.com\/document/.test(linkText)) redirect(zurueck("/calls", "Bitte Dateien auswählen oder Google-Docs-Links einfügen."));
  const r = await callsSammelImport(session.tenantId, { art, bezeichnung, linkText, dateien, heute: todayIso() });
  if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
  revalidatePath("/calls");
  const teile = [
    `${r.neu} Calls übernommen${r.neu ? " – die KI wertet sie nacheinander aus" : ""}.`,
    r.ohneDatum ? `${r.ohneDatum} ohne erkennbares Datum (heute eingetragen – im Call unter „Titel und Datum ändern“ korrigieren).` : "",
    r.vorhanden.length ? `${r.vorhanden.length} waren schon da: ${r.vorhanden.slice(0, 5).join(" · ")}${r.vorhanden.length > 5 ? " …" : ""}.` : "",
    r.fehler.length ? `Nicht übernommen: ${r.fehler.slice(0, 5).join(" · ")}${r.fehler.length > 5 ? ` … (+${r.fehler.length - 5})` : ""}.` : "",
  ];
  redirect(zurueck("/calls", teile.filter(Boolean).join(" ").slice(0, 1500)));
}

export async function callBearbeitenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("id"));
  const titel = String(fd.get("titel") ?? "").trim();
  const datum = parseDate(String(fd.get("datum") ?? "").trim());
  if (!titel || !datum) redirect(zurueck(`/calls/${id}`, "Bitte Titel und Datum (TT.MM.JJJJ) angeben."));
  await callBearbeiten(session.tenantId, id, { titel, datum, art: ART(fd.get("art")) });
  revalidatePath(`/calls/${id}`);
  revalidatePath("/calls");
  redirect(zurueck(`/calls/${id}`, "Gespeichert."));
}

export async function neuAuswertenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("id"));
  const r = await callAuswerten(session.tenantId, id);
  revalidatePath(`/calls/${id}`);
  redirect(zurueck(`/calls/${id}`, r.fehler ?? `${r.punkte} Punkte zur Prüfung.`));
}

/** Ausgewählte Vorschläge bestätigen: eigene Aufgaben werden Aufgaben (Amazon/SAS) mit Link zur Call-Stelle. */
export async function uebernehmenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("call"));
  const ids = fd.getAll("punkt").map(String).filter((x) => ID.safeParse(x).success);
  const n = await punkteUebernehmen(session.tenantId, session.userId, ids);
  revalidatePath(`/calls/${id}`);
  revalidatePath("/");
  redirect(zurueck(`/calls/${id}`, n ? `${n} übernommen.` : "Nichts ausgewählt."));
}

export async function punktStatusAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("call"));
  // „verwerfen“-Knopf im Übernehmen-Formular trägt die ID im eigenen Feld (die Häkchen heißen „punkt“).
  await punktStatus(session.tenantId, ID.parse(fd.get("verwerfen") ?? fd.get("punkt")), z.enum(["verworfen", "geklaert", "vorschlag"]).parse(fd.get("status")));
  revalidatePath(`/calls/${id}`);
  revalidatePath("/calls/offen");
  const zurueckZu = fd.get("zurueck") === "offen" ? "/calls/offen" : `/calls/${id}`;
  redirect(zurueckZu);
}

export async function punktAnlegenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("call"));
  const text = String(fd.get("text") ?? "").trim().slice(0, 400);
  if (text.length < 3) redirect(zurueck(`/calls/${id}`, "Text fehlt."));
  const fristRoh = String(fd.get("frist") ?? "").trim();
  await punktAnlegen(session.tenantId, id, { art: z.enum(["vereinbarung", "aufgabe", "entscheidung", "frage"]).parse(fd.get("art")), text, verantwortlich: String(fd.get("wer") ?? "").trim().slice(0, 60) || null, frist: fristRoh ? parseDate(fristRoh) : null });
  revalidatePath(`/calls/${id}`);
  redirect(`/calls/${id}`);
}

/** Einmaliger Umzug: Export-Datei (JSON) aus dem bisherigen Call-Archiv. */
export async function archivImportAction(fd: FormData) {
  const session = await requireArea("amazon");
  const datei = fd.get("datei");
  if (!(datei instanceof File) || datei.size === 0) redirect(zurueck("/calls", "Bitte die Export-Datei (JSON) auswählen."));
  if (datei.size > 20 * 1024 * 1024) redirect(zurueck("/calls", "Datei zu groß (höchstens 20 MB)."));
  let roh: unknown;
  try {
    roh = JSON.parse(await datei.text());
  } catch {
    redirect(zurueck("/calls", "Die Datei ist kein gültiges JSON."));
  }
  const r = await archivImportieren(session.tenantId, roh);
  if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
  revalidatePath("/calls");
  redirect(zurueck("/calls", r.fehler ?? `${r.neu} Calls übernommen${r.vorhanden ? `, ${r.vorhanden} waren schon da` : ""}. To-dos, Entscheidungen und Fragen stehen zur Prüfung im Call.`));
}

/** Wissen aus einem Call neu ziehen lassen (ungeprüfte, unbearbeitete Einträge werden ersetzt). */
export async function wissenNeuAction(fd: FormData) {
  const session = await requireArea("amazon");
  const id = ID.parse(fd.get("id"));
  await wissenNeuAnstossen(session.tenantId, id);
  after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
  revalidatePath(`/calls/${id}`);
  redirect(zurueck(`/calls/${id}`, "Das Wissen wird im Hintergrund neu gezogen – Seite in etwa einer Minute neu laden."));
}

/** Ausstehendes Wissen aus älteren Calls jetzt nachholen (sonst alle 30 Minuten automatisch). */
export async function wissenNachholenAction() {
  const session = await requireArea("amazon");
  after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
  redirect(zurueck("/calls", "Läuft im Hintergrund – die KI zieht das Wissen Call für Call (je etwa eine Minute)."));
}
