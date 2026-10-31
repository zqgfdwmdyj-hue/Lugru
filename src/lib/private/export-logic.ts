// Ausdrücklicher Export privater Einträge in einen eigenen Kalender – reine Logik, damit testbar.
// Nur einzeln angehakte Einträge (`extern: true`), nur neutral („Privater Termin“, ganztägig, ohne Inhalt),
// nie Periode, Nähe, Streicheln/Massage – auch wenn dort jemand ein Kennzeichen setzen würde.

import { statusOf } from "./logic";

export const EXPORTABLE_KINDS = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit"] as const;
export const NEUTRAL_TITLE = "Privater Termin";

export type ExportRow = { id: string; kind: string; data: { day?: unknown; extern?: unknown; status?: unknown; linkId?: unknown } };
export type NeutralItem = { key: string; title: string; date: string; description: string; link: string; category: string; remind: boolean };

/** Was in den privaten Kalender soll – je Vorgang einmal (verknüpfte Kinderzeit/Auszeit nur einmal). */
export function neutralExportItems(rows: ExportRow[], from: string, to: string): NeutralItem[] {
  const out: NeutralItem[] = [];
  const seenLinks = new Set<string>();
  for (const r of rows) {
    if (!(EXPORTABLE_KINDS as readonly string[]).includes(r.kind)) continue;
    if (r.data.extern !== true) continue;
    const day = typeof r.data.day === "string" ? r.data.day : null;
    if (!day || day < from || day > to) continue;
    if (statusOf(r.data as { status?: string }) === "ausgefallen") continue;
    const link = typeof r.data.linkId === "string" ? r.data.linkId : null;
    if (link) {
      if (seenLinks.has(link)) continue;
      seenLinks.add(link);
    }
    out.push({ key: `priv:${link ?? r.id}`, title: NEUTRAL_TITLE, date: day, description: "", link: "/privat", category: "", remind: false });
  }
  return out;
}

/** Der Export-Kalender darf weder der System-Kalender noch ein für Mitarbeiter freigegebener Kalender sein. */
export function exportCalendarProblem(name: string, systemCalendar: string, staffCalendars: string[] | undefined): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return "Bitte einen Kalendernamen angeben.";
  if (n === systemCalendar.trim().toLowerCase()) return `„${name}“ ist der geschäftliche Kalender des Systems – bitte einen eigenen Namen wählen, z. B. „Privat“.`;
  if ((staffCalendars ?? []).some((s) => s.trim().toLowerCase() === n)) return `„${name}“ ist für Mitarbeiter freigegeben – dort darf nichts Privates hinein.`;
  return null;
}
