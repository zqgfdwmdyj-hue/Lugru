const TZ = "Europe/Berlin";

/** Heutiges Datum in deutscher Zeit als JJJJ-MM-TT. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Guten Tag";
  return "Guten Abend";
}

export function longDate(now = new Date()): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now);
}

/** Relativ für Fälligkeiten: "heute", "morgen", "Fr", sonst TT.MM. */
export function dueLabel(iso: string, today: string): string {
  if (iso < today) {
    const days = Math.round((Date.parse(today) - Date.parse(iso)) / 86400_000);
    return days === 1 ? "gestern" : `vor ${days} T.`;
  }
  if (iso === today) return "heute";
  if (iso === addDaysIso(today, 1)) return "morgen";
  const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400_000);
  const d = new Date(`${iso}T12:00:00Z`);
  if (diff < 7) return new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" }).format(d);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/** Tage von `from` bis `to` (beides JJJJ-MM-TT). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86400_000);
}
