// Serientermine (RRULE) in einzelne Termine auflösen – für Kalender, die per Link (iCal) gelesen
// werden. Deckt ab, was Kalender-Apps üblicherweise erzeugen: täglich, wöchentlich (an Wochentagen),
// monatlich (am Tag oder „2. Dienstag“ / „letzter Freitag“), jährlich; mit INTERVAL, COUNT, UNTIL,
// EXDATE und geänderten Einzelterminen (RECURRENCE-ID).

import { zonedToUtc, type InEvent } from "./ics";

export type Occurrence = { start: string; end: string | null };
type Local = { y: number; m: number; d: number; h: number; mi: number; s: number };

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_STEPS = 20000;

function toLocal(iso: string, tz: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const dateKey = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export function parseRrule(rule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) out[k.toUpperCase()] = v.toUpperCase();
  }
  return out;
}

/** Tage eines Monats nach BYDAY („MO“, „2TU“, „-1FR“). */
function byDayInMonth(y: number, m: number, byday: string[]): number[] {
  const out: number[] = [];
  const n = daysInMonth(y, m);
  for (const spec of byday) {
    const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(spec);
    if (!mm) continue;
    const wd = DAYS.indexOf(mm[2]);
    const all = Array.from({ length: n }, (_, i) => i + 1).filter((d) => weekday(y, m, d) === wd);
    if (!mm[1]) out.push(...all);
    else {
      const k = Number(mm[1]);
      const d = k > 0 ? all[k - 1] : all[all.length + k];
      if (d) out.push(d);
    }
  }
  return out;
}

/**
 * Alle Termine eines Ereignisses im Zeitraum. `skip` enthält Beginn-Zeitpunkte (ISO), die durch
 * geänderte Einzeltermine ersetzt wurden.
 */
export function expandEvent(ev: InEvent, range: { from: Date; to: Date }, skip: Set<string> = new Set()): Occurrence[] {
  const startMs = ev.allDay ? Date.parse(`${ev.start}T00:00:00Z`) : Date.parse(ev.start);
  const endMs = ev.end ? (ev.allDay ? Date.parse(`${ev.end}T00:00:00Z`) : Date.parse(ev.end)) : null;
  const duration = endMs !== null ? endMs - startMs : ev.allDay ? 86400_000 : 0;
  const overlaps = (s: number) => s < range.to.getTime() && s + Math.max(duration, 1) > range.from.getTime();

  if (!ev.rrule) return overlaps(startMs) ? [{ start: ev.start, end: ev.end }] : [];

  const r = parseRrule(ev.rrule);
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : null;
  const untilV = r.UNTIL ? /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(r.UNTIL) : null;
  const untilMs = untilV ? Date.UTC(+untilV[1], +untilV[2] - 1, +untilV[3], untilV[4] ? +untilV[4] : 23, untilV[5] ? +untilV[5] : 59, untilV[6] ? +untilV[6] : 59) : null;
  const byday = r.BYDAY ? r.BYDAY.split(",") : null;
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null;
  const bymonth = r.BYMONTH ? r.BYMONTH.split(",").map(Number) : null;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return overlaps(startMs) ? [{ start: ev.start, end: ev.end }] : [];

  const tz = ev.tzid ?? "Europe/Berlin";
  const base: Local = ev.allDay ? { y: +ev.start.slice(0, 4), m: +ev.start.slice(5, 7), d: +ev.start.slice(8, 10), h: 0, mi: 0, s: 0 } : toLocal(ev.start, tz);
  const baseKey = dateKey(base.y, base.m, base.d);
  const exdates = new Set(ev.exdates);
  const toMs = range.to.getTime();

  const out: Occurrence[] = [];
  let emitted = 0;
  // Ein Datum der Serie prüfen; gibt false zurück, wenn die Serie zu Ende ist.
  const consider = (y: number, m: number, d: number): boolean => {
    if (dateKey(y, m, d) < baseKey) return true;
    const startIso = ev.allDay ? dateKey(y, m, d) : zonedToUtc(y, m, d, base.h, base.mi, base.s, tz).toISOString();
    const sMs = ev.allDay ? Date.parse(`${startIso}T00:00:00Z`) : Date.parse(startIso);
    if (untilMs !== null && sMs > untilMs) return false;
    if (count !== null && emitted >= count) return false;
    emitted++;
    if (sMs >= toMs) return false;
    if (exdates.has(startIso) || skip.has(startIso)) return true;
    if (overlaps(sMs)) {
      const e = endMs === null ? null : ev.allDay ? new Date(sMs + duration).toISOString().slice(0, 10) : new Date(sMs + duration).toISOString();
      out.push({ start: startIso, end: e });
    }
    return true;
  };

  let steps = 0;
  if (freq === "DAILY") {
    for (let i = 0; steps++ < MAX_STEPS; i += interval) {
      const t = addDays(base.y, base.m, base.d, i);
      if (bymonth && !bymonth.includes(t.m)) continue;
      if (byday && !byday.some((b) => b.endsWith(DAYS[weekday(t.y, t.m, t.d)]))) continue;
      if (!consider(t.y, t.m, t.d)) break;
    }
  } else if (freq === "WEEKLY") {
    const wds = (byday ?? [DAYS[weekday(base.y, base.m, base.d)]]).map((b) => DAYS.indexOf(b.slice(-2))).filter((x) => x >= 0);
    // Wochen beginnen am Montag (WKST=MO), innerhalb der Woche in Reihenfolge Mo..So.
    const monOffset = (weekday(base.y, base.m, base.d) + 6) % 7;
    const order = [...new Set(wds)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    outer: for (let w = 0; steps++ < MAX_STEPS; w += interval) {
      for (const wd of order) {
        const t = addDays(base.y, base.m, base.d, w * 7 - monOffset + ((wd + 6) % 7));
        if (!consider(t.y, t.m, t.d)) break outer;
      }
    }
  } else if (freq === "MONTHLY") {
    outer: for (let k = 0; steps++ < MAX_STEPS; k += interval) {
      const y = base.y + Math.floor((base.m - 1 + k) / 12);
      const m = ((base.m - 1 + k) % 12) + 1;
      const n = daysInMonth(y, m);
      const days = byday ? byDayInMonth(y, m, byday) : (bymonthday ?? [base.d]).map((d) => (d < 0 ? n + d + 1 : d)).filter((d) => d >= 1 && d <= n);
      for (const d of [...new Set(days)].sort((a, b) => a - b)) if (!consider(y, m, d)) break outer;
    }
  } else {
    outer: for (let k = 0; steps++ < MAX_STEPS; k += interval) {
      const y = base.y + k;
      for (const m of (bymonth ?? [base.m]).sort((a, b) => a - b)) {
        const n = daysInMonth(y, m);
        const days = byday ? byDayInMonth(y, m, byday) : (bymonthday ?? [base.d]).filter((d) => d >= 1 && d <= n);
        for (const d of days.sort((a, b) => a - b)) if (!consider(y, m, d)) break outer;
      }
    }
  }
  return out;
}

/**
 * Alle Termine eines Kalenders im Zeitraum: Serien aufgelöst, geänderte Einzeltermine eingesetzt.
 */
export function expandCalendar(events: InEvent[], range: { from: Date; to: Date }): (InEvent & Occurrence)[] {
  const overrides = new Map<string, Set<string>>();
  for (const e of events) if (e.recurrenceId) overrides.set(e.uid, (overrides.get(e.uid) ?? new Set()).add(e.recurrenceId));
  const out: (InEvent & Occurrence)[] = [];
  for (const e of events) {
    const occ = e.recurrenceId ? expandEvent({ ...e, rrule: null }, range) : expandEvent(e, range, overrides.get(e.uid));
    for (const o of occ) out.push({ ...e, ...o });
  }
  return out;
}
