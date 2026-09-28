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
};

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
