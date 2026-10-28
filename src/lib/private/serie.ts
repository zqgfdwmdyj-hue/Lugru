// Wiederholungen für Termine, Kinderzeit, Auszeit, Ausschlafen und Paarzeit. Jede Wiederholung ist ein eigener
// Eintrag (eigener Status, eigene Notiz) mit gemeinsamer `repeatId`. Einzeln geänderte Einträge sind Ausnahmen
// (`exception`) und bleiben bei späteren Änderungen der Serie, wie sie sind – ebenso alles, was schon
// stattgefunden hat oder ausgefallen ist. Reine Logik ohne Datenbank, damit testbar.

import { addDays, daysBetween, type EntryStatus } from "./logic";

export type RepeatFields = { repeatId?: string; repeatEvery?: number; exception?: boolean };
export type SeriesScope = "dieser" | "folgende" | "alle";
export const REPEAT_EVERY = { woche: 7, "2wochen": 14 } as const;
export const REPEAT_LABEL: Record<number, string> = { 7: "wöchentlich", 14: "alle 2 Wochen" };
/** Höchstens so viele Einträge auf einmal (ein Jahr wöchentlich). */
export const REPEAT_MAX = 53;

export const seriesScope = (v: unknown): SeriesScope => (v === "folgende" || v === "alle" ? v : "dieser");

/**
 * Tage einer neuen Serie aus dem Formular (`wiederholung` = woche | 2wochen, `bis` = letzter Tag).
 * Ohne Wiederholung nur der Starttag.
 */
export function repeatDays(start: string, wiederholung: unknown, bis: unknown): { days: string[]; every?: number } | { error: string } {
  if (wiederholung !== "woche" && wiederholung !== "2wochen") return { days: [start] };
  const every = REPEAT_EVERY[wiederholung];
  if (typeof bis !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) return { error: "Bitte angeben, bis wann sich der Eintrag wiederholt." };
  if (bis < start) return { error: "„Wiederholen bis“ liegt vor dem ersten Tag – bitte prüfen." };
  if (daysBetween(start, bis) > 366) return { error: "Wiederholungen bitte höchstens für ein Jahr anlegen." };
  const days: string[] = [];
  for (let d = start; d <= bis && days.length < REPEAT_MAX; d = addDays(d, every)) days.push(d);
  return { days, every };
}

type Row = { id: string; data: { day: string; status?: EntryStatus | string; exception?: boolean; repeatId?: string } };

/**
 * Welche Einträge eine Änderung „dieser und alle folgenden“ bzw. „alle“ betrifft: dieselbe Serie, nur noch
 * Geplantes ohne Ausnahme – der geöffnete Eintrag immer. `kept` = wie viele bewusst unverändert bleiben.
 */
export function seriesTargets<R extends Row>(rows: R[], cur: R, scope: SeriesScope): { targets: R[]; kept: number } {
  if (scope === "dieser" || !cur.data.repeatId) return { targets: [cur], kept: 0 };
  const same = rows.filter((r) => r.data.repeatId === cur.data.repeatId && (scope === "alle" || r.data.day >= cur.data.day));
  // Ohne Status gilt ein Eintrag als stattgefunden (ältere Einträge) – also nur ausdrücklich Geplantes.
  const targets = same.filter((r) => r.id === cur.id || (r.data.status === "geplant" && !r.data.exception));
  return { targets: targets.sort((a, b) => a.data.day.localeCompare(b.data.day)), kept: same.length - targets.length };
}

/** Beim Löschen: dieselbe Serie (ab diesem Tag oder ganz), unabhängig vom Status – ausdrücklich gewählt. */
export function seriesDeleteIds<R extends Row>(rows: R[], cur: R, scope: SeriesScope): string[] {
  if (scope === "dieser" || !cur.data.repeatId) return [cur.id];
  return rows.filter((r) => r.data.repeatId === cur.data.repeatId && (scope === "alle" || r.data.day >= cur.data.day)).map((r) => r.id);
}

/** Überblick für die Detailseite: Anzahl, Rhythmus, erster/letzter Tag, Ausnahmen, Position. */
export function seriesInfo<R extends Row & { data: RepeatFields }>(rows: R[], cur: R) {
  if (!cur.data.repeatId) return null;
  const same = rows.filter((r) => r.data.repeatId === cur.data.repeatId).sort((a, b) => a.data.day.localeCompare(b.data.day));
  return {
    count: same.length,
    every: cur.data.repeatEvery ?? 7,
    first: same[0]?.data.day ?? cur.data.day,
    last: same[same.length - 1]?.data.day ?? cur.data.day,
    position: same.findIndex((r) => r.id === cur.id) + 1,
    exceptions: same.filter((r) => r.data.exception).length,
    following: same.filter((r) => r.data.day >= cur.data.day).length,
  };
}

/** Wurde Tag oder Uhrzeit dieses einen Eintrags geändert? Dann ist er eine Ausnahme der Serie. */
export function changesTiming(before: Record<string, unknown>, after: Record<string, unknown>) {
  return ["day", "from", "to", "time", "hours"].some((k) => (before[k] ?? null) !== (after[k] ?? null));
}
