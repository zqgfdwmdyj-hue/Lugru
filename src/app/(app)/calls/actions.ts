"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseDate } from "@/lib/numbers";
import { archivImportieren, callAuswerten, callImportieren, discordCallsImport, punktAnlegen, punkteUebernehmen, punktStatus } from "@/lib/calls/service";
import { datumAusText } from "@/lib/calls/logic";

const ID = z.string().uuid();
const zurueck = (pfad: string, m: string) => `${pfad}${pfad.includes("?") ? "&" : "?"}meldung=${encodeURIComponent(m)}`;

/** Transkript als Text oder Google-Docs-Link importieren; die KI wertet gleich aus. */
export async function callImportAction(fd: FormData) {
  const session = await requireArea("amazon");
  const link = String(fd.get("link") ?? "").trim();
  const text = String(fd.get("text") ?? "");
  const titelRoh = String(fd.get("titel") ?? "").trim();
  const datumRoh = String(fd.get("datum") ?? "").trim();
  const datum = (datumRoh && parseDate(datumRoh)) || datumAusText(`${titelRoh} ${text.slice(0, 300)}`, todayIso());
  const titel = titelRoh || `Consultant-Call ${datum.split("-").reverse().join(".")}`;
  if (!link && text.trim().length < 20) redirect(zurueck("/calls", "Bitte Transkript einfügen oder einen Google-Docs-Link angeben."));
  if (text.length > 400_000) redirect(zurueck("/calls", "Transkript zu lang (höchstens 400.000 Zeichen)."));
  let r: Awaited<ReturnType<typeof callImportieren>>;
  try {
    r = await callImportieren(session.tenantId, link ? { titel, datum, link, quelle: "google_doc" } : { titel, datum, text, quelle: "text" });
  } catch (e) {
    redirect(zurueck("/calls", e instanceof Error ? e.message : String(e)));
  }
  revalidatePath("/calls");
  redirect(zurueck(`/calls/${r.id}`, !r.neu ? "Dieser Call ist schon im Archiv." : r.fehler ? `Importiert – Auswertung: ${r.fehler}` : `Importiert – ${r.punkte} Punkte zur Prüfung.`));
}

export async function discordImportAction() {
  const session = await requireArea("amazon");
  let m: string;
  try {
    const r = await discordCallsImport(session.tenantId, todayIso());
    m = `${r.neu} neue Calls aus Discord.${r.fehler.length ? ` Probleme: ${r.fehler.join(" · ")}` : ""}`;
  } catch (e) {
    m = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/calls");
  redirect(zurueck("/calls", m.slice(0, 500)));
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
  revalidatePath("/calls");
  redirect(zurueck("/calls", r.fehler ?? `${r.neu} Calls übernommen${r.vorhanden ? `, ${r.vorhanden} waren schon da` : ""}. To-dos, Entscheidungen und Fragen stehen zur Prüfung im Call.`));
}
