// Monatsansicht: Raster (Montag bis Sonntag) und Einträge je Tag – ohne Server-Abhängigkeiten.

import { addDaysIso } from "@/lib/dates";

export type DayEntry = {
  id: string;
  title: string;
  /** Uhrzeit (Berlin) bei Terminen mit Uhrzeit, sonst null. */
  time: string | null;
  color: string;
  /** Kurzbezeichnung der Quelle, z. B. Kalendername oder „Frist". */
  label: string;
  link: string | null;
  location?: string | null;
  overdue?: boolean;
  /** Kürzel des eigenen Kalenders bzw. Symbol der Systemkategorie – Bedeutung nie nur über die Farbe. */
  abbr?: string;
  icon?: string;
  /** Fälligkeit aus dem System (Aufgabe, Frist …) statt eigener Termin – wird umrandet statt gefüllt gezeigt. */
  system?: boolean;
};

export type CalendarView = "monat" | "woche" | "agenda";

/** Ansicht aus der Adresse – unbekannt → Monat. */
export function parseView(value: string | undefined): CalendarView {
  return value === "woche" || value === "agenda" ? value : "monat";
}

/** Montag bis Sonntag der Woche, in der der Tag liegt. */
export function weekDays(day: string): string[] {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Mo = 0
  const start = addDaysIso(day, -weekday);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

/** „27.10.–2.11.2026“ bzw. „28.12.2026–3.1.2027“ – Überschrift der Wochenansicht. */
export function weekTitle(days: string[]): string {
  const a = days[0], b = days[days.length - 1];
  const dm = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`;
  return a.slice(0, 4) === b.slice(0, 4) ? `${dm(a)}–${dm(b)}${b.slice(0, 4)}` : `${dm(a)}${a.slice(0, 4)}–${dm(b)}${b.slice(0, 4)}`;
}

/** "2026-10" → gültiger Monat, sonst der aktuelle. */
export function parseMonth(value: string | undefined, today: string): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : today.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Alle Tage des Rasters: ab dem Montag vor dem Monatsersten bis zum Sonntag nach dem Monatsletzten. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // Mo = 0
  const start = addDaysIso(first, -weekday);
  const last = addDaysIso(`${shiftMonth(month, 1)}-01`, -1);
  const days: string[] = [];
  for (let d = start; d <= last || days.length % 7 !== 0; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

/** Mehrtägige Termine auf jeden Tag verteilen (Ende exklusiv wie in iCalendar), begrenzt auf das Raster. */
export function spreadDays(startDay: string, endDayExclusive: string | null, from: string, to: string): string[] {
  const end = endDayExclusive && endDayExclusive > startDay ? endDayExclusive : addDaysIso(startDay, 1);
  const out: string[] = [];
  for (let d = startDay < from ? from : startDay; d < end && d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_DE[m - 1]} ${y}`;
}
