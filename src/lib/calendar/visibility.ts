// Wer sieht welche eigenen Kalender (iCloud/Google …)? Der Inhaber und Personen mit Privat-Zugang alle.
// Mitarbeiter ohne Privat-Zugang (auch „nur ansehen“) nur die Kalender, die der Inhaber ausdrücklich für
// Mitarbeiter freigegeben hat – ohne Freigabe keinen. So landen Familien- und Privattermine nie auf der
// geschäftlichen Startseite fremder Konten. Systemeinträge (Aufgaben, Fristen, Versand) sind davon unberührt.

export type CalendarViewer = { role: "owner" | "staff"; privateAccess: boolean };

export const seesAllCalendars = (v: CalendarViewer) => v.role === "owner" || v.privateAccess;

/** Sieht diese Person Termine aus dem Kalender `name`? `staffCalendars` = freigegebene Namen (beliebige Schreibweise). */
export function calendarVisible(v: CalendarViewer, name: string, staffCalendars: string[] | undefined): boolean {
  if (seesAllCalendars(v)) return true;
  const allowed = new Set((staffCalendars ?? []).map((n) => n.trim().toLowerCase()));
  return allowed.has(name.trim().toLowerCase());
}

/**
 * Geschäft oder privat? Geschäftlich sind die für Mitarbeiter freigegebenen Kalender und der Kalender, in den
 * das System selbst schreibt; alle anderen verbundenen Kalender gelten als privat/Familie (Privatkalender,
 * Filter „Privat“ im Kalender).
 */
export function isBusinessCalendar(name: string, staffCalendars: string[] | undefined, pushCalendar?: string | null): boolean {
  const n = name.trim().toLowerCase();
  if (pushCalendar && n === pushCalendar.trim().toLowerCase()) return true;
  return (staffCalendars ?? []).some((s) => s.trim().toLowerCase() === n);
}
