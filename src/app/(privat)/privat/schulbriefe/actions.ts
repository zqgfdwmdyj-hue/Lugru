"use server";

import { redirect } from "next/navigation";
import { todayIso } from "@/lib/dates";
import { neuerSchluessel, speichern } from "@/lib/medien/ablage";
import { schulbriefAuftrag, schulbriefLesen, type SchulVorschlag } from "@/lib/private/schulbrief";
import { addEntry, loadEntry, privateSettings, requirePrivate, updateEntry } from "@/lib/private/service";

// Briefe von Schule/Kita (Modul 8): Original verschlüsselt ablegen, KI-Vorschläge, Übernahme nur nach Bestätigung.

export type Schulbrief = { key: string; mime: string; name: string; hochgeladen: string; vorschlaege: (SchulVorschlag & { uebernommen?: string })[]; hinweis?: string };

const ziel = (m: string, id?: string) => `/privat/schulbriefe?${id ? `brief=${id}&` : ""}meldung=${encodeURIComponent(m)}`;
const MAX = 15 * 1024 * 1024;

export async function schulbriefHochladenAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const f = fd.get("datei");
  if (!(f instanceof File) || !f.size) redirect(ziel("Bitte ein Foto oder PDF wählen."));
  if (f.size > MAX) redirect(ziel("Zu groß (höchstens 15 MB)."));
  const mime = f.type === "application/pdf" ? "application/pdf" : /^image\/(jpeg|png|webp|gif)$/.test(f.type) ? f.type : null;
  if (!mime) redirect(ziel("Nur Fotos (JPG, PNG, WebP) oder PDF."));
  const bytes = new Uint8Array(await f.arrayBuffer());
  const key = neuerSchluessel(session.tenantId);
  await speichern(key, bytes);
  const s = await privateSettings(session.tenantId);
  let vorschlaege: SchulVorschlag[] = [];
  let hinweis: string | undefined;
  const { getIntegration } = await import("@/lib/integrations/store");
  const ai = await getIntegration(session.tenantId, "anthropic");
  if (ai?.apiKey) {
    const { askClaude, modelFor } = await import("@/lib/ai/claude");
    const data = Buffer.from(bytes).toString("base64");
    const inhalt = mime === "application/pdf" ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } } : { type: "image" as const, source: { type: "base64" as const, media_type: mime, data } };
    const r = await askClaude(ai.apiKey, [inhalt, { type: "text", text: schulbriefAuftrag(todayIso(), s.kids) }], { model: modelFor(ai, "simple"), task: "simple", maxTokens: 1500, timeoutMs: 90_000 }).catch(() => null);
    vorschlaege = r ? schulbriefLesen(r.text, s.kids) : [];
    if (!r) hinweis = "Die KI war nicht erreichbar – bitte später erneut hochladen oder von Hand eintragen.";
    else if (!vorschlaege.length) hinweis = "Keine Termine oder Aufgaben erkannt.";
  } else hinweis = "Kein KI-Schlüssel hinterlegt – Termine bitte von Hand eintragen (das Original ist gespeichert).";
  const brief: Schulbrief = { key, mime, name: (f.name || "Brief").slice(0, 120), hochgeladen: todayIso(), vorschlaege, ...(hinweis ? { hinweis } : {}) };
  const id = await addEntry(session, "schulbrief", brief as unknown as Record<string, unknown>);
  redirect(ziel(vorschlaege.length ? `${vorschlaege.length} Vorschläge erkannt – bitte prüfen und übernehmen.` : (hinweis ?? "Gespeichert."), id));
}

/** Ausgewählte Vorschläge übernehmen: Termine in den Privatkalender, Aufgaben als Privat-Aufgaben – mit Link zum Original. */
export async function schulbriefUebernehmenAction(fd: FormData) {
  const session = await requirePrivate({ full: true });
  const id = String(fd.get("id") ?? "");
  const e = await loadEntry<Schulbrief>(session, id);
  if (!e || e.kind !== "schulbrief") redirect(ziel("Brief nicht gefunden."));
  const gewaehlt = new Set(fd.getAll("nr").map(String));
  const original = `/privat/schulbriefe/${e.id}/original`;
  const { saveAppointment } = await import("@/lib/private/save");
  const { privatEintragAnlegen } = await import("@/lib/private/anlegen");
  let n = 0;
  const neu = [...e.data.vorschlaege];
  for (const [i, v] of neu.entries()) {
    if (!gewaehlt.has(String(i)) || v.uebernommen) continue;
    const titel = (fd.get(`titel-${i}`) ? String(fd.get(`titel-${i}`)).trim() : v.titel).slice(0, 120) || v.titel;
    const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get(`tag-${i}`) ?? "")) ? String(fd.get(`tag-${i}`)) : v.tag;
    const notiz = [v.kind ? `Für: ${v.kind}` : "", v.notiz ?? "", `Original: ${original}`].filter(Boolean).join("\n");
    if (v.art === "termin" && tag) {
      const f = new FormData();
      f.set("day", tag);
      if (v.uhrzeit) f.set("time", v.uhrzeit);
      f.set("with", "familie");
      f.set("title", v.kind ? `${titel} (${v.kind})` : titel);
      f.set("notes", notiz);
      f.set("status", tag >= todayIso() ? "geplant" : "stattgefunden");
      const r = await saveAppointment(session, f);
      if (r.ok && r.id) {
        neu[i] = { ...v, uebernommen: r.id };
        n++;
      }
    } else {
      const r = await privatEintragAnlegen(session, { art: "aufgabe", tag: tag ?? undefined, text: `${v.kind ? `${v.kind}: ` : ""}${titel}${v.notiz ? ` – ${v.notiz}` : ""} (Brief: ${original})` });
      if (r.ok && r.id) {
        neu[i] = { ...v, uebernommen: r.id };
        n++;
      }
    }
  }
  await updateEntry(session, e.id, "schulbrief", { vorschlaege: neu });
  redirect(ziel(n ? `${n} übernommen.` : "Nichts ausgewählt.", e.id));
}
