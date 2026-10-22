// „Zuletzt angemeldet / aktiv“ lesbar machen – reine Logik ohne Datenbank.

const TZ = "Europe/Berlin";
const day = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
const time = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
const date = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/** „gerade eben“, „vor 12 Min.“, „heute 14:02“, „gestern 09:10“, „12.10.2026 08:00“ oder „noch nie“. */
export function formatSeen(at: Date | string | null | undefined, now: Date = new Date()): string {
  if (!at) return "noch nie";
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "noch nie";
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 5) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  if (day(d) === day(now)) return `heute ${time(d)}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `gestern ${time(d)}`;
  return `${date(d)} ${time(d)}`;
}

/** Gilt als „gerade aktiv“, wenn in den letzten 10 Minuten etwas kam. */
export const isOnline = (seen: Date | null | undefined, now: Date = new Date()) => Boolean(seen && now.getTime() - seen.getTime() < 10 * 60_000);
