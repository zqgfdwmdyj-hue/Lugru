// Gemeinsamer Privatkalender: alle privaten Einträge in einer Ansicht – Termine, Kinderzeit, Auszeit,
// Ausschlafen, Paarzeit, Nähe, Streicheln/Massage (auch aus dem Abendritual), Periode und die verbundenen
// Familienkalender. Reine Logik ohne Datenbank, damit testbar.

import { addDays, statusOf, weekStart, type AppointmentEntry, type DateEntry, type EntryStatus, type IntimEntry, type KidsEntry, type PartnerKey, type SleepEntry } from "./logic";

const other = (p: PartnerKey): PartnerKey => (p === "a" ? "b" : "a");

// ---- Periode -------------------------------------------------------------------------------------------

/**
 * Periode als Zeitraum: Beginn, Ende (offen, solange sie läuft). Sichtbar nur für die Person, die sie
 * eingetragen hat, und für ausdrücklich freigegebene Konten (`shareWith`). Nur tatsächliche Einträge –
 * eine spätere Vorhersage wäre getrennt und als Schätzung gekennzeichnet.
 */
export type PeriodEntry = { start: string; end?: string; person: PartnerKey; note?: string; shareWith?: string[] };

/** Letzter Tag (laufende Periode: heute; liegt der Beginn in der Zukunft, der Beginn). */
export const periodEnd = (p: Pick<PeriodEntry, "start" | "end">, today: string) => p.end ?? (p.start <= today ? today : p.start);
export const periodDays = (p: Pick<PeriodEntry, "start" | "end">, today: string) => Math.round((Date.parse(`${periodEnd(p, today)}T12:00:00Z`) - Date.parse(`${p.start}T12:00:00Z`)) / 86_400_000) + 1;

/** Prüft einen Zeitraum: Ende nicht vor dem Beginn, keine Überschneidung mit einer anderen Periode derselben Person. */
export function periodProblem(p: Pick<PeriodEntry, "start" | "end" | "person">, others: (Pick<PeriodEntry, "start" | "end" | "person"> & { id: string })[], today: string, ignoreId?: string): string | null {
  if (p.end && p.end < p.start) return "Das Ende liegt vor dem Beginn – bitte prüfen.";
  if (p.start > today) return "Eine Periode kann erst eingetragen werden, wenn sie begonnen hat.";
  if (p.end && p.end > today) return "Das Ende liegt in der Zukunft – bitte erst eintragen, wenn sie vorbei ist.";
  const end = periodEnd(p, today);
  const clash = others.find((o) => o.id !== ignoreId && o.person === p.person && o.start <= end && periodEnd(o, today) >= p.start);
  return clash ? `Überschneidet sich mit der Periode ab ${clash.start.split("-").reverse().join(".")} – bitte dort Beginn oder Ende anpassen.` : null;
}

// ---- Streicheln & Massage ------------------------------------------------------------------------------

export type TouchKind = "streicheln" | "massage";
export const TOUCH_LABEL: Record<TouchKind, string> = { streicheln: "Streicheln", massage: "Massage" };

/**
 * Streicheln oder Massage: wer gibt, wer empfängt, Tag, optional Uhrzeit/Dauer, Status. Aus dem Abendritual
 * entstandene Einträge tragen `seriesId` und `occurrence` (welches Vorkommen der Serie sie bestätigen,
 * verschieben oder auslassen).
 */
export type TouchEntry = { day: string; kind: TouchKind; giver: PartnerKey; receiver: PartnerKey; time?: string; minutes?: number; status: EntryStatus; seriesId?: string; occurrence?: string; note?: string; skipped?: boolean };

/** Ein fester Platz im Wochenablauf: Wochentag (1 = Montag … 7 = Sonntag), Art, wer gibt, wer empfängt. */
export type RitualSlot = { weekday: number; kind: TouchKind; giver: PartnerKey; receiver: PartnerKey; time?: string };
/** „Unser Abendritual“: Wochenvorlage; nach `strokesPerMassage` bestätigten Streicheleinheiten eine Massage. */
export type RitualEntry = { title: string; slots: RitualSlot[]; from: string; until?: string; strokesPerMassage: number; active: boolean };

export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const isoWeekday = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Vorschlag aus eurem Beispiel: Mo–Do streichelt Partner 1, Di und Do massiert Partner 2; Fr–So frei. */
export function defaultRitual(from: string): RitualEntry {
  const s = (weekday: number, kind: TouchKind, giver: PartnerKey): RitualSlot => ({ weekday, kind, giver, receiver: other(giver) });
  return { title: "Unser Abendritual", from, strokesPerMassage: 2, active: true, slots: [s(1, "streicheln", "a"), s(2, "streicheln", "a"), s(2, "massage", "b"), s(3, "streicheln", "a"), s(4, "streicheln", "a"), s(4, "massage", "b")] };
}

export const slotKey = (s: Pick<RitualSlot, "weekday" | "kind" | "giver" | "receiver">) => `${s.weekday}-${s.kind}-${s.giver}${s.receiver}`;
/** Eindeutiges Vorkommen einer Serie: Serie, ursprünglicher Tag, Platz im Wochenablauf. */
export const occurrenceKey = (seriesId: string, day: string, s: RitualSlot) => `${seriesId}|${day}|${slotKey(s)}`;
export function parseOccurrence(key: string): { seriesId: string; day: string; slot: string } | null {
  const [seriesId, day, slot] = key.split("|");
  return seriesId && /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") && slot ? { seriesId, day, slot } : null;
}

/**
 * Geplante Vorkommen einer Serie im Zeitraum – ohne die, die schon als eigener Eintrag bestätigt, verschoben
 * oder ausgelassen wurden. Änderungen an der Serie wirken nur auf diese offenen Vorkommen.
 */
export function ritualOccurrences(seriesId: string, r: RitualEntry, from: string, to: string, handled: Set<string>): { key: string; day: string; slot: RitualSlot }[] {
  if (!r.active) return [];
  const out: { key: string; day: string; slot: RitualSlot }[] = [];
  const start = from > r.from ? from : r.from;
  const end = r.until && r.until < to ? r.until : to;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    for (const slot of r.slots.filter((s) => s.weekday === wd)) {
      const key = occurrenceKey(seriesId, d, slot);
      if (!handled.has(key)) out.push({ key, day: d, slot });
    }
  }
  return out;
}

/**
 * Rhythmus „n Streicheleinheiten, dann eine Massage“: bestätigte Streicheleinheiten seit der letzten
 * bestätigten Massage (gleiche Richtung wie im Ritual). Am selben Tag zählt Streicheln vor der Massage,
 * außer die Uhrzeit sagt etwas anderes. Geplantes zählt nie.
 */
export function touchRhythm(entries: TouchEntry[], r: Pick<RitualEntry, "slots" | "strokesPerMassage"> | null) {
  const target = Math.max(1, r?.strokesPerMassage ?? 2);
  const strokePair = r?.slots.find((s) => s.kind === "streicheln");
  const massagePair = r?.slots.find((s) => s.kind === "massage");
  const matches = (e: TouchEntry, p?: RitualSlot) => !p || (e.giver === p.giver && e.receiver === p.receiver);
  const done = entries.filter((e) => e.status === "stattgefunden");
  const order = (e: TouchEntry) => `${e.day}T${e.time ?? (e.kind === "massage" ? "99:98" : "99:97")}`;
  const massages = done.filter((e) => e.kind === "massage" && matches(e, massagePair)).sort((x, y) => order(x).localeCompare(order(y)));
  const last = massages[massages.length - 1] ?? null;
  const strokes = done.filter((e) => e.kind === "streicheln" && matches(e, strokePair) && (!last || order(e) > order(last)));
  return { count: strokes.length, target, due: strokes.length >= target, lastMassage: last?.day ?? null };
}

// ---- Kalender ------------------------------------------------------------------------------------------

export type CalKind = "termin" | "kinder" | "auszeit" | "ausschlafen" | "paarzeit" | "naehe" | "streicheln" | "massage" | "periode" | "extern";
export const CAL_KIND_LABEL: Record<CalKind, string> = {
  termin: "Termin",
  kinder: "Kinderzeit",
  auszeit: "Auszeit",
  ausschlafen: "Ausschlafen",
  paarzeit: "Paarzeit",
  naehe: "Nähe",
  streicheln: "Streicheln",
  massage: "Massage",
  periode: "Periode",
  extern: "Familienkalender",
};
/** Arten, die nur mit vollem Privat-Umfang sichtbar sind (nicht für „nur Familie“). */
export const INTIMATE_KINDS = new Set<CalKind>(["naehe", "streicheln", "massage", "periode", "paarzeit"]);

export type CalItem = {
  key: string;
  kind: CalKind;
  /** Privat-Eintrag, der hinter dem Kalendereintrag steht (zum Öffnen/Bearbeiten). */
  id?: string;
  day: string;
  /** Letzter Tag bei mehrtägigen Einträgen (Periode, ganztägige Kalendertermine). */
  endDay?: string;
  from?: string;
  to?: string;
  title: string;
  people: PartnerKey[];
  /** Fehlt bei Familienkalender und Periode (dort gibt es nichts zu planen). */
  status?: EntryStatus;
  href: string;
  /** Vorkommen einer Serie, noch ohne eigenen Eintrag. */
  virtual?: boolean;
  /** Vorkommen einer Serie bewusst ausgelassen (zählt nicht, Status „ausgefallen“). */
  skipped?: boolean;
  note?: string;
  calendar?: string;
  color?: string;
};

type Row<T> = { id: string; data: T };
export type ExternEvent = { id: string; title: string; day: string; endDay?: string | null; time?: string | null; calendar: string; color?: string | null };

export type CalendarInput = {
  names: { a: string; b: string };
  today: string;
  therapists?: { ads: string; paar: string };
  termine?: Row<AppointmentEntry>[];
  kinder?: Row<KidsEntry>[];
  auszeit?: Row<SleepEntry>[];
  ausschlafen?: Row<SleepEntry>[];
  paarzeit?: Row<DateEntry>[];
  naehe?: Row<IntimEntry>[];
  touches?: Row<TouchEntry>[];
  rituals?: Row<RitualEntry>[];
  periods?: Row<PeriodEntry>[];
  extern?: ExternEvent[];
};

const edit = (id: string) => `/privat/eintrag/${id}`;
const span = (e: { from?: string; to?: string }) => ({ ...(e.from ? { from: e.from } : {}), ...(e.to ? { to: e.to } : {}) });

/** Alle Einträge zwischen `from` und `to` (Tage), eine Liste ohne Duplikate. */
export function buildCalendarItems(input: CalendarInput, from: string, to: string): CalItem[] {
  const n = input.names;
  const inRange = (d: string) => d >= from && d <= to;
  const out: CalItem[] = [];

  for (const t of input.termine ?? []) {
    const e = t.data;
    if (!inRange(e.day)) continue;
    const base = e.title?.trim() || (e.with === "ads" ? input.therapists?.ads : e.with === "paar" ? input.therapists?.paar : e.with === "arzt" ? "Arzttermin" : e.with === "familie" ? "Familientermin" : "Privater Termin") || "Termin";
    const people: PartnerKey[] = e.person === "a" ? ["a"] : e.person === "b" ? ["b"] : ["a", "b"];
    out.push({ key: `termin:${t.id}`, kind: "termin", id: t.id, day: e.day, ...(e.time ? { from: e.time } : {}), ...(e.to ? { to: e.to } : {}), title: base, people, status: statusOf(e), href: edit(t.id), note: e.notes });
  }

  // Auszeit mit verknüpfter Kinderzeit (ein Vorgang): ein Kalendereintrag für beide Personen.
  const kidsByLink = new Map((input.kinder ?? []).filter((k) => k.data.linkId).map((k) => [k.data.linkId!, k]));
  const usedKids = new Set<string>();
  for (const a of input.auszeit ?? []) {
    const e = a.data;
    if (!inRange(e.day)) continue;
    const linked = e.linkId ? kidsByLink.get(e.linkId) : undefined;
    if (linked) usedKids.add(linked.id);
    out.push({
      key: `auszeit:${a.id}`,
      kind: "auszeit",
      id: a.id,
      day: e.day,
      ...span(e),
      title: linked ? `Auszeit ${n[e.person]} · Kinder bei ${n[linked.data.person]}` : `Auszeit ${n[e.person]}`,
      people: linked ? [e.person, linked.data.person] : [e.person],
      status: statusOf(e),
      href: edit(a.id),
      note: e.note,
    });
  }
  for (const k of input.kinder ?? []) {
    const e = k.data;
    if (!inRange(e.day) || usedKids.has(k.id)) continue;
    out.push({ key: `kinder:${k.id}`, kind: "kinder", id: k.id, day: e.day, ...span(e), title: `Kinderzeit ${n[e.person]}${e.what ? ` · ${e.what}` : ""}`, people: [e.person], status: statusOf(e), href: edit(k.id) });
  }
  for (const s of input.ausschlafen ?? []) {
    const e = s.data;
    if (!inRange(e.day)) continue;
    out.push({ key: `ausschlafen:${s.id}`, kind: "ausschlafen", id: s.id, day: e.day, ...span(e), title: `Ausschlafen ${n[e.person]}`, people: [e.person], status: statusOf(e), href: edit(s.id), note: e.note });
  }
  for (const p of input.paarzeit ?? []) {
    const e = p.data;
    if (!inRange(e.day)) continue;
    out.push({ key: `paarzeit:${p.id}`, kind: "paarzeit", id: p.id, day: e.day, ...span(e), title: `Paarzeit${e.what ? ` · ${e.what}` : ""}`, people: ["a", "b"], status: statusOf(e), href: edit(p.id), note: e.note });
  }
  for (const x of input.naehe ?? []) {
    const e = x.data;
    if (!inRange(e.day)) continue;
    out.push({ key: `naehe:${x.id}`, kind: "naehe", id: x.id, day: e.day, ...(e.time ? { from: e.time } : {}), title: "Nähe", people: ["a", "b"], status: "stattgefunden", href: edit(x.id) });
  }

  const touchTitle = (k: TouchKind, g: PartnerKey, r: PartnerKey) => (k === "massage" ? `${n[g]} massiert ${n[r]}` : `${n[g]} streichelt ${n[r]}`);
  const handled = new Set((input.touches ?? []).map((t) => t.data.occurrence).filter((o): o is string => Boolean(o)));
  for (const t of input.touches ?? []) {
    const e = t.data;
    if (!inRange(e.day)) continue;
    out.push({ key: `touch:${t.id}`, kind: e.kind, id: t.id, day: e.day, ...(e.time ? { from: e.time } : {}), title: touchTitle(e.kind, e.giver, e.receiver), people: [e.giver, e.receiver], status: statusOf(e), href: edit(t.id), note: e.note, ...(e.skipped ? { skipped: true } : {}) });
  }
  for (const r of input.rituals ?? []) {
    for (const o of ritualOccurrences(r.id, r.data, from, to, handled)) {
      out.push({
        key: `serie:${o.key}`,
        kind: o.slot.kind,
        day: o.day,
        ...(o.slot.time ? { from: o.slot.time } : {}),
        title: touchTitle(o.slot.kind, o.slot.giver, o.slot.receiver),
        people: [o.slot.giver, o.slot.receiver],
        status: "geplant",
        href: `/privat/eintrag/serie?vorkommen=${encodeURIComponent(o.key)}`,
        virtual: true,
      });
    }
  }

  for (const p of input.periods ?? []) {
    const e = p.data;
    const end = periodEnd(e, input.today);
    if (e.start > to || end < from) continue;
    out.push({ key: `periode:${p.id}`, kind: "periode", id: p.id, day: e.start, endDay: end, title: `Periode ${n[e.person]}${e.end ? "" : " (läuft)"}`, people: [e.person], href: edit(p.id), note: e.note });
  }

  for (const ev of input.extern ?? []) {
    const end = ev.endDay && ev.endDay > ev.day ? ev.endDay : undefined;
    if (ev.day > to || (end ?? ev.day) < from) continue;
    out.push({ key: `extern:${ev.id}`, kind: "extern", day: ev.day, ...(end ? { endDay: end } : {}), ...(ev.time ? { from: ev.time } : {}), title: ev.title, people: ["a", "b"], href: "", calendar: ev.calendar, color: ev.color ?? undefined });
  }
  return out;
}

export type CalFilter = { person?: PartnerKey | null; kinds?: Set<CalKind> | null };

export function filterItems(items: CalItem[], f: CalFilter): CalItem[] {
  return items.filter((i) => (!f.person || i.people.includes(f.person)) && (!f.kinds || f.kinds.size === 0 || f.kinds.has(i.kind)));
}

/** Einträge je Tag – mehrtägige (Periode, ganztägige Termine) an jedem ihrer Tage, mit Lage im Zeitraum. */
export type DayItem = CalItem & { part?: "start" | "mid" | "end" | "single" };
export function itemsByDay(items: CalItem[], from: string, to: string): Map<string, DayItem[]> {
  const map = new Map<string, DayItem[]>();
  const push = (d: string, i: DayItem) => map.set(d, [...(map.get(d) ?? []), i]);
  for (const i of items) {
    if (!i.endDay || i.endDay === i.day) {
      if (i.day >= from && i.day <= to) push(i.day, { ...i, part: "single" });
      continue;
    }
    for (let d = i.day < from ? from : i.day; d <= i.endDay && d <= to; d = addDays(d, 1)) push(d, { ...i, part: d === i.day ? "start" : d === i.endDay ? "end" : "mid" });
  }
  const rank: Record<CalKind, number> = { periode: 0, extern: 1, termin: 2, kinder: 3, auszeit: 3, ausschlafen: 3, paarzeit: 3, naehe: 4, streicheln: 5, massage: 5 };
  for (const list of map.values()) list.sort((x, y) => (x.endDay ? 0 : 1) - (y.endDay ? 0 : 1) || (x.from ?? "").localeCompare(y.from ?? "") || rank[x.kind] - rank[y.kind]);
  return map;
}

/** Montag–Sonntag der Woche, in der `day` liegt. */
export const weekDays = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));
