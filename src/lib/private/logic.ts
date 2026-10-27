// Bereich „Privat“: Datentypen und Auswertungen – ohne Datenbank, damit testbar.

export type PartnerKey = "a" | "b";
export type Ratings = 1 | 2 | 3 | 4 | 5;

export type PrivateSettings = {
  partners: { a: string; b: string };
  kids: string[];
  therapists: { ads: string; paar: string };
  /** Benutzer, deren Tagebuch die anderen mit Privat-Zugang lesen dürfen. */
  diaryShared: string[];
  /** Welcher Benutzer welcher Partner ist (für Vorbelegungen). */
  userPartner: Record<string, PartnerKey>;
  /** Übliche Aufstehzeit – Vorschlag für „von“ beim Ausschlafen. */
  wakeTime: string;
  /** Hinweis „mal wieder ein Date?“ nach so vielen Tagen ohne Paarzeit (0 = aus). */
  dateReminderDays: number;
  /**
   * Je Benutzer: was auf der geschäftlichen Startseite von „Privat“ erscheint – „aus“, nur der Link
   * (Standard, keine Inhalte) oder Hinweise (Tagebuch offen, Termin, Rezept …).
   */
  startHint: Record<string, StartHint>;
  /**
   * Ausdrücklicher Export einzelner privater Einträge in einen eigenen Kalender – nur neutral als „Privater
   * Termin“ (ganztägig, ohne Inhalt), nie Periode, Nähe, Streicheln/Massage. Standard: aus.
   */
  externSync: { enabled: boolean; calendar: string };
};
export type StartHint = "aus" | "link" | "hinweise";
export const DEFAULT_PRIVATE_SETTINGS: PrivateSettings = {
  partners: { a: "Ludwig", b: "Alexandra" },
  kids: [],
  therapists: { ads: "ADHS-Psychologin", paar: "Paartherapie" },
  diaryShared: [],
  userPartner: {},
  wakeTime: "06:30",
  dateReminderDays: 21,
  startHint: {},
  externSync: { enabled: false, calendar: "Privat" },
};

/**
 * Planung und Rückblick getrennt: geplant (zählt nirgends), stattgefunden (zählt in den Auswertungen),
 * ausgefallen (bleibt sichtbar, zählt nicht). Ältere Einträge ohne Status waren immer nachträglich erfasst
 * und gelten als stattgefunden.
 */
export type EntryStatus = "geplant" | "stattgefunden" | "ausgefallen";
export const STATUS_LABEL: Record<EntryStatus, string> = { geplant: "geplant", stattgefunden: "stattgefunden", ausgefallen: "ausgefallen" };
export const statusOf = (e: { status?: EntryStatus | string } | null | undefined): EntryStatus =>
  e?.status === "geplant" || e?.status === "ausgefallen" ? e.status : "stattgefunden";
/** Zählt in Auswertungen (Monatssummen, „als Nächstes dran“, Rückblick). */
export const happened = (e: { status?: EntryStatus | string } | null | undefined) => statusOf(e) === "stattgefunden";
/** Was in der Zukunft liegt, kann noch nicht stattgefunden haben. */
export function statusProblem(day: string, status: EntryStatus, today: string): string | null {
  if (status === "stattgefunden" && day > today) return "Was in der Zukunft liegt, kann noch nicht stattgefunden haben – bitte „geplant“ wählen.";
  return null;
}
/** Vorbelegung: Zukunft = geplant, sonst stattgefunden. */
export const defaultStatus = (day: string, today: string): EntryStatus => (day > today ? "geplant" : "stattgefunden");

export type IntimEntry = { day: string; time?: string; initiative?: PartnerKey | "beide"; closeness?: Ratings; note?: string };
/**
 * Zeit-Einträge (Kinderzeit, Ausschlafen, Auszeit, Paarzeit). `linkId`: gemeinsamer Vorgang – z. B. A allein
 * mit den Kindern, während B Auszeit hat. Jede Sicht zählt nur in ihrer eigenen Auswertung (nie doppelt).
 */
/** „beide“: zusammen mit den Kindern (z. B. Ausflug) – zählt nicht in „allein mit den Kindern“. */
export type KidsPerson = PartnerKey | "beide";
/** `fromEvent`: aus einem Familienkalender-Termin übernommen (Kennung des Termins, siehe eventRef). */
export type KidsEntry = { day: string; person: KidsPerson; from?: string; to?: string; hours?: number; what?: string; kids?: string[]; linkId?: string; editedAt?: string; status?: EntryStatus; extern?: boolean; fromEvent?: string };
export type TaskEntry = {
  title: string;
  source: "ads" | "paar" | "sonst";
  forWhom: PartnerKey | "beide";
  due?: string;
  repeat: "einmal" | "taeglich" | "woechentlich";
  done?: boolean;
  doneAt?: string;
  /** Erledigt an diesen Tagen (bei Wiederholung). */
  checks?: string[];
  notes?: string;
  reflection?: string;
};
/**
 * Privater Termin: Therapie/Arzt wie bisher, dazu Familien- und private Termine mit Titel. `person`: wen es
 * betrifft (für den Personenfilter), `extern`: ausdrücklich als neutraler „Privater Termin“ in den Apple-Kalender.
 */
export type AppointmentEntry = { day: string; time?: string; to?: string; with: "ads" | "paar" | "arzt" | "familie" | "privat" | "sonst"; title?: string; person?: PartnerKey | "beide"; notes?: string; status?: EntryStatus; extern?: boolean; fromEvent?: string };
/** Paarzeit: zu zweit unterwegs (Date), Kinder bei Babysitterin/Oma … */
export type DateEntry = { day: string; from?: string; to?: string; hours?: number; what?: string; sitter?: string; costEur?: number; rating?: Ratings; note?: string; editedAt?: string; status?: EntryStatus; extern?: boolean; fromEvent?: string };
/** Ausschlafen: wer durfte wann wie lange länger schlafen (der andere übernimmt die Kinder). */
/** `kidsBy`: bei Auszeit – wer die Kinder übernimmt, wenn es nicht der Partner ist (dann ohne Kinderzeit-Eintrag). */
export type SleepEntry = { day: string; person: PartnerKey; from?: string; to?: string; hours?: number; note?: string; linkId?: string; editedAt?: string; status?: EntryStatus; extern?: boolean; kidsBy?: string; fromEvent?: string };
export type TalkEntry = { day: string; appreciationsA?: string; appreciationsB?: string; topic?: string; agreed?: string };
export type DiaryEntry = {
  day: string;
  med?: string;
  doseMg?: number;
  takenAt?: string;
  /** Alle Einnahmen des Tages (Uhrzeiten), z. B. bei zwei Gaben. */
  intakes?: string[];
  /** Ausdrücklich nicht eingenommen (Anzahl geplanter Einnahmen) – anders als „nicht dokumentiert“. */
  notTaken?: number;
  /** Stück je Einnahme zum Zeitpunkt der Einnahme (Planänderungen wirken nicht rückwirkend). */
  pieces?: number;
  onset?: string;
  wearOff?: string;
  focus?: Ratings;
  mood?: Ratings;
  calm?: Ratings;
  energy?: Ratings;
  sleepHours?: number;
  sleepQuality?: Ratings;
  appetite?: Ratings;
  pulse?: number;
  bpSys?: number;
  bpDia?: number;
  weightKg?: number;
  caffeine?: number;
  sideEffects?: string[];
  /** Ausdrücklich „keine Nebenwirkungen“ – anders als eine leere Auswahl („nicht dokumentiert“). */
  noSideEffects?: boolean;
  good?: string;
  hard?: string;
  note?: string;
};
export type ObservationEntry = { day: string; aboutUserId: string; text: string };

export const SIDE_EFFECTS = [
  "Kopfschmerzen",
  "wenig Appetit",
  "Einschlafprobleme",
  "Herzklopfen / Herzrasen",
  "Bauchschmerzen / Übelkeit",
  "Mundtrockenheit",
  "Reizbarkeit",
  "Nervosität / Unruhe",
  "gedrückte Stimmung",
  "Müdigkeit / Tief beim Nachlassen",
  "Schwindel",
  "Schwitzen",
  "Zähneknirschen / Kieferspannung",
  "Tics",
] as const;

export const RATING_FIELDS = [
  { key: "focus", label: "Konzentration", low: "zerstreut", high: "fokussiert" },
  { key: "mood", label: "Stimmung", low: "schlecht", high: "gut" },
  { key: "calm", label: "Innere Ruhe", low: "getrieben / impulsiv", high: "ruhig" },
  { key: "energy", label: "Energie", low: "erschöpft", high: "voller Energie" },
  { key: "sleepQuality", label: "Schlaf letzte Nacht", low: "schlecht", high: "erholsam" },
  { key: "appetite", label: "Appetit", low: "kaum", high: "normal" },
] as const;
export type RatingKey = (typeof RATING_FIELDS)[number]["key"];

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Montag der Woche (ISO). */
export function weekStart(iso: string): string {
  const wd = (new Date(ms(iso)).getUTCDay() + 6) % 7;
  return addDays(iso, -wd);
}

/** Monatsraster ab Montag (6 Wochen max, nur so viele wie nötig). */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = weekStart(first);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const end = addDays(weekStart(last), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function shiftMonth(m: string, delta: number): string {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

// ---- Paar ------------------------------------------------------------------------------------------

/** Anzahl im Monat, Tage seit dem letzten Mal, mittlerer Abstand (letzte 90 Tage), je Woche. */
export function intimStats(entries: Pick<IntimEntry, "day">[], month: string, today: string) {
  const days = [...new Set(entries.map((e) => e.day))].filter((d) => d <= today).sort();
  const inMonth = entries.filter((e) => e.day.startsWith(month)).length;
  const last = days[days.length - 1] ?? null;
  const recent = days.filter((d) => d >= addDays(today, -90));
  const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i], d));
  return {
    inMonth,
    last,
    daysSinceLast: last ? daysBetween(last, today) : null,
    avgGapDays: gaps.length ? round1(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
    last90: recent.length,
  };
}

/** Paarzeit: Anzahl und Stunden im Monat, zuletzt, Ø Abstand (90 Tage), Babysitter-Kosten im Monat. */
export function dateStats(all: DateEntry[], month: string, today: string) {
  // Nur was stattgefunden hat – geplante oder ausgefallene Dates zählen nicht.
  const entries = all.filter(happened);
  const inMonth = entries.filter((e) => e.day.startsWith(month));
  const days = [...new Set(entries.map((e) => e.day))].filter((d) => d <= today).sort();
  const last = days[days.length - 1] ?? null;
  const recent = days.filter((d) => d >= addDays(today, -90));
  const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i], d));
  return {
    inMonth: inMonth.length,
    hoursInMonth: round1(inMonth.reduce((s, e) => s + kidsHours(e), 0)),
    costInMonth: Math.round(inMonth.reduce((s, e) => s + (e.costEur ?? 0), 0) * 100) / 100,
    costInYear: Math.round(entries.filter((e) => e.day.startsWith(month.slice(0, 4))).reduce((s, e) => s + (e.costEur ?? 0), 0) * 100) / 100,
    last,
    daysSinceLast: last ? daysBetween(last, today) : null,
    avgGapDays: gaps.length ? round1(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
    last90: recent.length,
  };
}

// ---- Zeitumstellung (Europe/Berlin) ----------------------------------------------------------------

const TZ = "Europe/Berlin";
const tzParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Abstand der Berliner Uhr zu UTC in Minuten (60 im Winter, 120 im Sommer) zu einem Zeitpunkt. */
function berlinOffset(utcMs: number): number {
  const p = Object.fromEntries(tzParts.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((asUtc - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

/**
 * Uhrzeit an einem Tag (Berliner Uhr) → Zeitpunkt. Wie eine echte Uhr: Die doppelte Stunde im Oktober
 * (2–3 Uhr) gilt als die erste, eine Zeit in der übersprungenen Stunde im März als eine Stunde später.
 */
export function berlinInstant(day: string, hhmm: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = [...new Set([berlinOffset(naive - DAY), berlinOffset(naive + DAY)])].sort((a, b) => b - a);
  for (const o of offsets) if (berlinOffset(naive - o * 60_000) === o) return naive - o * 60_000;
  return naive - Math.min(...offsets) * 60_000;
}

/**
 * Uhr-Umstellung in der Nacht vor diesem Tag: +60 = Uhr zurückgestellt (Oktober, Nacht eine Stunde länger),
 * −60 = vorgestellt (März, eine Stunde kürzer), 0 = keine.
 */
export function clockChangeOn(day: string): number {
  return berlinOffset(ms(addDays(day, -1))) - berlinOffset(ms(day));
}

/** Nächste Zeitumstellung ab heute innerhalb von `withinDays` Tagen (Tag und Richtung) – oder null. */
export function upcomingClockChange(today: string, withinDays = 7): { day: string; change: number } | null {
  for (let i = 0; i <= withinDays; i++) {
    const day = addDays(today, i);
    const change = clockChangeOn(day);
    if (change) return { day, change };
  }
  return null;
}

/** Minuten zwischen von und bis an einem Tag (über Mitternacht: bis am Folgetag) – nach Uhr und tatsächlich vergangen. */
function spanMinutes(day: string, from: string, to: string): { wall: number; real: number } {
  const toMin = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  let wall = toMin(to) - toMin(from);
  if (wall < 0) wall += 24 * 60;
  if (!isDay(day)) return { wall, real: wall };
  const endDay = toMin(to) < toMin(from) ? addDays(day, 1) : day;
  const real = Math.round((berlinInstant(endDay, to) - berlinInstant(day, from)) / 60_000);
  return { wall, real: real > 0 ? real : wall };
}

/**
 * Stunden, um die die Zeitumstellung eine von–bis-Spanne verlängert (+1) oder verkürzt (−1) – 0, wenn die
 * Spanne nicht über die Umstellung (2–3 Uhr nachts) geht.
 */
export function clockShiftHours(e: Pick<KidsEntry, "from" | "to"> & { day?: string }): number {
  if (!e.day || !e.from || !e.to || !TIME_RE.test(e.from) || !TIME_RE.test(e.to)) return 0;
  const { wall, real } = spanMinutes(e.day, e.from, e.to);
  return round1((real - wall) / 60);
}

// ---- Kinderzeit ------------------------------------------------------------------------------------

const TIME_RE = /^\d{1,2}:\d{2}$/;

/**
 * Dauer in Stunden: aus von–bis (auch über Mitternacht) oder der Angabe „Stunden“. Mit Tag zählt die
 * tatsächlich vergangene Zeit – über die Zeitumstellung hinweg also eine Stunde mehr (Oktober) bzw. weniger (März).
 */
export function kidsHours(e: Pick<KidsEntry, "from" | "to" | "hours"> & { day?: string }): number {
  if (e.from && e.to && TIME_RE.test(e.from) && TIME_RE.test(e.to)) {
    const { wall, real } = spanMinutes(e.day ?? "", e.from, e.to);
    return round1((e.day ? real : wall) / 60);
  }
  return e.hours && e.hours > 0 ? round1(e.hours) : 0;
}

/** Über Mitternacht? (bis früher als von) */
export const overnight = (e: Pick<KidsEntry, "from" | "to">) => Boolean(e.from && e.to && e.to < e.from);

/**
 * Dauer aus der Eingabe prüfen: von–bis (auch über Mitternacht, dann zählt der Tag des Beginns) oder
 * Stunden. Widersprüchliche Angaben (von–bis und abweichende Stunden), gleiche Zeiten oder nur eine Seite
 * werden mit verständlicher Meldung abgelehnt, statt still eine davon zu nehmen.
 */
export function durationOf(e: { day?: string; from?: string; to?: string; hours?: number }, maxHours = 16): { hours: number; overnight: boolean; clockShift: number } | { error: string } {
  if ((e.from && !e.to) || (!e.from && e.to)) {
    if (e.hours && e.hours > 0) return { error: "Bitte entweder von–bis vollständig oder nur die Stunden angeben." };
    return { error: e.from ? "Bitte auch „bis“ angeben – oder die Stunden." : "Bitte auch „von“ angeben – oder die Stunden." };
  }
  if (e.from && e.to) {
    if (e.from === e.to) return { error: "„von“ und „bis“ sind gleich – bitte prüfen." };
    const h = kidsHours({ day: e.day, from: e.from, to: e.to });
    if (e.hours !== undefined && e.hours > 0 && Math.abs(e.hours - h) > 0.25) {
      return { error: `von–bis ergibt ${String(h).replace(".", ",")} Std., angegeben sind ${String(e.hours).replace(".", ",")} Std. – bitte angleichen oder nur eins angeben.` };
    }
    if (h > maxHours) return { error: `${e.from}–${e.to} wären ${String(h).replace(".", ",")} Std.${overnight(e) ? " (über Mitternacht)" : ""} – bitte die Uhrzeiten prüfen.` };
    return { hours: h, overnight: overnight(e), clockShift: clockShiftHours(e) };
  }
  if (e.hours !== undefined && e.hours > 0) {
    if (e.hours > maxHours) return { error: `Mehr als ${maxHours} Std. – bitte prüfen.` };
    return { hours: round1(e.hours), overnight: false, clockShift: 0 };
  }
  return { error: "Bitte von–bis oder die Stunden angeben." };
}

/**
 * Je Person: Anzahl, Stunden (nur stattgefunden); je Tag beide Spalten nebeneinander (alle Einträge, auch
 * geplante und ausgefallene – die Liste zeigt den Status). `planned`: geplante Einträge im Monat.
 */
export function kidsOverview<E extends KidsEntry>(entries: E[], month: string) {
  const list = entries.filter((e) => e.day.startsWith(month)).sort((x, y) => x.day.localeCompare(y.day) || (x.from ?? "").localeCompare(y.from ?? ""));
  const totals = { a: { count: 0, hours: 0 }, b: { count: 0, hours: 0 } };
  /** Zusammen mit den Kindern – eigene Summe, nicht im Anteil „allein“. */
  const together = { count: 0, hours: 0 };
  const planned = { a: 0, b: 0 };
  const byDay = new Map<string, { a: E[]; b: E[]; both: E[] }>();
  for (const e of list) {
    const row = byDay.get(e.day) ?? { a: [], b: [], both: [] };
    byDay.set(e.day, row);
    if (e.person === "beide") {
      if (happened(e)) {
        together.count++;
        together.hours = round1(together.hours + kidsHours(e));
      }
      row.both.push(e);
      continue;
    }
    if (statusOf(e) === "geplant") planned[e.person]++;
    if (happened(e)) {
      totals[e.person].count++;
      totals[e.person].hours = round1(totals[e.person].hours + kidsHours(e));
    }
    row[e.person].push(e);
  }
  const sum = totals.a.hours + totals.b.hours;
  return { totals, together, planned, shareA: sum ? Math.round((totals.a.hours / sum) * 100) : null, days: [...byDay.entries()].map(([day, r]) => ({ day, ...r })) };
}

// ---- Ausschlafen -----------------------------------------------------------------------------------

/**
 * Im Wechsel: wer als Nächstes dran wäre – der andere als beim letzten Eintrag. Bewusst ohne
 * Ausgleich nach gezählten Stunden (das wäre eine Bewertung, die die Zahlen nicht hergeben). Ohne Einträge: null.
 */
export function nextSleeper(all: (Pick<SleepEntry, "day" | "person" | "status"> & { at?: number })[], _month?: string): PartnerKey | null {
  // Nur tatsächlich genommene Zeit: ein geplanter Morgen macht noch niemanden „dran gewesen“.
  const entries = all.filter(happened);
  if (!entries.length) return null;
  // gleicher Tag: was zuletzt eingetragen wurde
  const last = [...entries].sort((x, y) => x.day.localeCompare(y.day) || (x.at ?? 0) - (y.at ?? 0)).pop()!;
  return last.person === "a" ? "b" : "a";
}

// ---- Aufgaben --------------------------------------------------------------------------------------

/** Stand einer Aufgabe heute: offen/erledigt, bei Wiederholung „heute / diese Woche erledigt“ und die letzten 7 Tage. */
export function taskState(t: TaskEntry, today: string) {
  const checks = new Set(t.checks ?? []);
  if (t.repeat === "taeglich") {
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => ({ day: d, done: checks.has(d) }));
    let streak = 0;
    for (let d = checks.has(today) ? today : addDays(today, -1); checks.has(d); d = addDays(d, -1)) streak++;
    return { open: !checks.has(today) && !t.done, doneNow: checks.has(today), last7, streak, label: checks.has(today) ? "heute erledigt" : "heute noch offen" };
  }
  if (t.repeat === "woechentlich") {
    const ws = weekStart(today);
    const doneNow = [...checks].some((d) => d >= ws && d <= addDays(ws, 6));
    const weeks = Array.from({ length: 6 }, (_, i) => addDays(ws, (i - 5) * 7)).map((w) => ({ day: w, done: [...checks].some((d) => d >= w && d <= addDays(w, 6)) }));
    return { open: !doneNow && !t.done, doneNow, last7: weeks, streak: 0, label: doneNow ? "diese Woche erledigt" : "diese Woche noch offen" };
  }
  const overdue = !t.done && Boolean(t.due && t.due < today);
  return { open: !t.done, doneNow: Boolean(t.done), last7: [], streak: 0, label: t.done ? "erledigt" : overdue ? "überfällig" : "offen" };
}

// ---- Tagebuch --------------------------------------------------------------------------------------

/** Nebenwirkungen eines Tages: erfasst, ausdrücklich keine oder nicht dokumentiert. */
export type SideEffectState = "erfasst" | "keine" | "nicht dokumentiert";
export function sideEffectState(e: Pick<DiaryEntry, "sideEffects" | "noSideEffects"> | undefined): SideEffectState {
  if (e?.sideEffects?.length) return "erfasst";
  if (e?.noSideEffects) return "keine";
  return "nicht dokumentiert";
}

/** Zeitraum-Auswertung fürs Arztgespräch: Dosis-Phasen, Mittelwerte, Nebenwirkungen, Messwerte. */
/**
 * Auswertung für den Arztbericht. `vitals: false` (Messwerte abgewählt) entfernt Puls, Blutdruck und Gewicht
 * schon hier – aus Durchschnitt, Messwert-Tabelle und den Einzeltagen –, damit nichts davon in Vorschau
 * oder Ausdruck/PDF gelangen kann.
 */
export function diaryReport(entries: DiaryEntry[], from: string, to: string, opts: { vitals?: boolean } = {}) {
  const withVitals = opts.vitals !== false;
  const list = entries
    .filter((e) => e.day >= from && e.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((e) => {
      if (withVitals) return e;
      const { pulse: _p, bpSys: _s, bpDia: _d, weightKg: _w, ...rest } = e;
      return rest as DiaryEntry;
    });
  const avg = (key: keyof DiaryEntry) => {
    const v = list.map((e) => e[key]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  // Dosis-Phasen: zusammenhängende Tage mit gleichem Mittel + Dosis
  const phases: { med: string; doseMg: number | null; from: string; to: string; days: number; focus: number | null; mood: number | null; sideEffects: number; noEffectDays: number; undocumentedDays: number }[] = [];
  for (const e of list) {
    const med = e.med?.trim() || "–";
    const dose = typeof e.doseMg === "number" ? e.doseMg : null;
    const p = phases[phases.length - 1];
    if (p && p.med === med && p.doseMg === dose) {
      p.to = e.day;
      p.days++;
    } else phases.push({ med, doseMg: dose, from: e.day, to: e.day, days: 1, focus: null, mood: null, sideEffects: 0, noEffectDays: 0, undocumentedDays: 0 });
  }
  for (const p of phases) {
    const inP = list.filter((e) => e.day >= p.from && e.day <= p.to && (e.med?.trim() || "–") === p.med && (typeof e.doseMg === "number" ? e.doseMg : null) === p.doseMg);
    const mean = (k: "focus" | "mood") => {
      const v = inP.map((e) => e[k]).filter((x): x is Ratings => typeof x === "number");
      return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null;
    };
    p.focus = mean("focus");
    p.mood = mean("mood");
    p.sideEffects = inP.reduce((s, e) => s + (e.sideEffects?.length ?? 0), 0);
    p.noEffectDays = inP.filter((e) => sideEffectState(e) === "keine").length;
    p.undocumentedDays = inP.filter((e) => sideEffectState(e) === "nicht dokumentiert").length;
  }
  const effects = new Map<string, number>();
  for (const e of list) for (const s of e.sideEffects ?? []) effects.set(s, (effects.get(s) ?? 0) + 1);
  const vitals = list.filter((e) => e.pulse || e.bpSys || e.weightKg).map((e) => ({ day: e.day, pulse: e.pulse ?? null, bp: e.bpSys && e.bpDia ? `${e.bpSys}/${e.bpDia}` : null, weightKg: e.weightKg ?? null, doseMg: e.doseMg ?? null }));
  const weights = list.filter((e) => typeof e.weightKg === "number");
  return {
    days: list.length,
    entries: list,
    phases,
    averages: { focus: avg("focus"), mood: avg("mood"), calm: avg("calm"), energy: avg("energy"), sleepQuality: avg("sleepQuality"), appetite: avg("appetite"), sleepHours: avg("sleepHours"), ...(withVitals ? { pulse: avg("pulse") } : {}) } as Record<"focus" | "mood" | "calm" | "energy" | "sleepQuality" | "appetite" | "sleepHours", number | null> & { pulse?: number | null },
    sideEffects: [...effects.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    sideEffectDays: { erfasst: list.filter((e) => sideEffectState(e) === "erfasst").length, keine: list.filter((e) => sideEffectState(e) === "keine").length, offen: list.filter((e) => sideEffectState(e) === "nicht dokumentiert").length },
    vitals,
    weightChange: weights.length >= 2 ? round1(weights[weights.length - 1].weightKg! - weights[0].weightKg!) : null,
  };
}

/** Werte eines Merkmals für die letzten n Tage (fehlende Tage = null), für die kleinen Diagramme. */
export function diarySeries(entries: DiaryEntry[], key: RatingKey, today: string, n = 30) {
  const byDay = new Map(entries.map((e) => [e.day, e]));
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1)).map((day) => {
    const e = byDay.get(day);
    const v = e?.[key];
    return { day, value: typeof v === "number" ? v : null, doseMg: e?.doseMg ?? null };
  });
}

/** Für die nächste Sitzung: was seit dem letzten Termin passiert ist. */
export function sinceSummary(input: { since: string; today: string; intim: IntimEntry[]; kids: KidsEntry[]; tasks: TaskEntry[]; dates?: DateEntry[]; sleep?: SleepEntry[] }) {
  const { since, today } = input;
  // Nur „allein mit den Kindern“ – gemeinsame Zeit (beide) zählt hier nicht.
  const kids = input.kids.filter((e) => happened(e) && e.day >= since && e.day <= today && e.person !== "beide");
  const hours = { a: 0, b: 0 };
  for (const e of kids) if (e.person !== "beide") hours[e.person] = round1(hours[e.person] + kidsHours(e));
  const done = input.tasks.filter((t) => (t.repeat === "einmal" ? t.done && (t.doneAt ?? "") >= since : (t.checks ?? []).some((d) => d >= since)));
  return {
    days: daysBetween(since, today),
    intim: input.intim.filter((e) => e.day >= since && e.day <= today).length,
    dates: (input.dates ?? []).filter((e) => happened(e) && e.day >= since && e.day <= today).length,
    sleepIn: {
      a: (input.sleep ?? []).filter((e) => happened(e) && e.person === "a" && e.day >= since && e.day <= today).length,
      b: (input.sleep ?? []).filter((e) => happened(e) && e.person === "b" && e.day >= since && e.day <= today).length,
    },
    kidsHours: hours,
    kidsCount: { a: kids.filter((e) => e.person === "a").length, b: kids.filter((e) => e.person === "b").length },
    tasksDone: done.length,
    tasksOpen: input.tasks.filter((t) => taskState(t, today).open).length,
  };
}

// ---- Eingaben prüfen ---------------------------------------------------------------------------------

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);
export function rating(v: unknown): Ratings | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as Ratings) : undefined;
}
export function num(v: unknown, min: number, max: number): number | undefined {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : undefined;
}
export const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || undefined;

// ---- Medikament: Einnahme und Vorrat ---------------------------------------------------------------

/** Je Person: Medikament, Dosis, Stück je Einnahme, Einnahmen am Tag, Vorrat (Stand mit Zeitpunkt). */
export type MedPlanVersion = { from: string; to: string; med: string; doseMg?: number; piecesPerIntake: number; intakesPerDay: number };
export type MedPlan = {
  med: string;
  doseMg?: number;
  piecesPerIntake: number;
  intakesPerDay: number;
  /** Gültig ab (Tag der letzten Planänderung). */
  validFrom?: string;
  /** Frühere Fassungen – damit Planänderungen alte Tage nicht umdeuten. */
  history?: MedPlanVersion[];
  /** `atAsOf`: Einnahmen, die beim Zählen schon in derselben Minute eingetragen waren. */
  stock?: { count: number; asOf: string; atAsOf?: number };
  /** Warnen, wenn der Vorrat nur noch so viele Tage reicht. */
  warnDays: number;
};
export const DEFAULT_MED_PLAN: MedPlan = { med: "", piecesPerIntake: 1, intakesPerDay: 1, warnDays: 10 };

/** Zeitpunkt „Tag + Uhrzeit“ als vergleichbare Zeichenkette. */
const stamp = (day: string, time = "00:00") => `${day}T${time.padStart(5, "0")}`;

/**
 * Vorrat: Bestand beim letzten Stand minus Einnahmen danach. Reicht noch … Tage; „knapp“, wenn das
 * höchstens `warnDays` sind.
 */
export function medStock(plan: MedPlan, diary: Pick<DiaryEntry, "day" | "takenAt" | "intakes" | "pieces">[]) {
  if (!plan.stock) return null;
  const since = plan.stock.asOf.slice(0, 16);
  let taken = 0;
  let pieces = 0;
  let sameMinute = 0;
  let samePieces = plan.piecesPerIntake;
  for (const e of diary) {
    const times = e.intakes?.length ? e.intakes : e.takenAt ? [e.takenAt] : [];
    for (const t of times) {
      const s = stamp(e.day, t);
      if (s > since) {
        taken++;
        pieces += e.pieces ?? planFor(plan, e.day).piecesPerIntake;
      } else if (s === since) {
        sameMinute++;
        samePieces = e.pieces ?? planFor(plan, e.day).piecesPerIntake;
      }
    }
  }
  // Einnahmen in genau der Minute des Zählens: nur die, die erst danach dazukamen.
  const extra = Math.max(0, sameMinute - (plan.stock.atAsOf ?? 0));
  taken += extra;
  pieces += extra * samePieces;
  const remaining = Math.max(0, Math.round((plan.stock.count - pieces) * 10) / 10);
  const perDay = Math.max(0.1, plan.piecesPerIntake * plan.intakesPerDay);
  const daysLeft = Math.floor(remaining / perDay);
  return { remaining, daysLeft, low: daysLeft <= plan.warnDays, taken };
}

/** Plan, der an diesem Tag galt (aktuelle Fassung oder eine frühere aus dem Verlauf). */
export function planFor(plan: MedPlan, day: string): Omit<MedPlanVersion, "from" | "to"> {
  const old = (plan.history ?? []).find((h) => day >= h.from && day <= h.to);
  if (old && (!plan.validFrom || day < plan.validFrom)) return old;
  return { med: plan.med, doseMg: plan.doseMg, piecesPerIntake: plan.piecesPerIntake, intakesPerDay: plan.intakesPerDay };
}

/**
 * Plan ändern: Änderungen an Mittel, Dosis, Stück oder Einnahmen/Tag gelten ab heute; die bisherige
 * Fassung wandert in den Verlauf (bis gestern). Tagebuch-Einträge bleiben, wie sie sind.
 */
export function changePlan(plan: MedPlan, next: Pick<MedPlan, "med" | "doseMg" | "piecesPerIntake" | "intakesPerDay" | "warnDays">, today: string, hadPlan: boolean): MedPlan {
  const changed = plan.med !== next.med || plan.doseMg !== next.doseMg || plan.piecesPerIntake !== next.piecesPerIntake || plan.intakesPerDay !== next.intakesPerDay;
  if (!hadPlan || !changed) return { ...plan, ...next, validFrom: plan.validFrom ?? today };
  const from = plan.validFrom ?? "2000-01-01";
  const history = [...(plan.history ?? [])];
  // Mehrfach am selben Tag geändert: die heutige Zwischenfassung nicht aufheben.
  if (from < today) history.push({ from, to: addDays(today, -1), med: plan.med, doseMg: plan.doseMg, piecesPerIntake: plan.piecesPerIntake, intakesPerDay: plan.intakesPerDay });
  return { ...plan, ...next, validFrom: today, history: history.slice(-50) };
}

/** Einnahmen eines Tages: genommen, ausdrücklich nicht genommen, nicht dokumentiert. */
export function intakeStatus(e: Pick<DiaryEntry, "intakes" | "takenAt" | "notTaken"> | undefined, perDay: number) {
  const times = e?.intakes?.length ? e.intakes : e?.takenAt ? [e.takenAt] : [];
  const notTaken = Math.max(0, e?.notTaken ?? 0);
  const undocumented = Math.max(0, perDay - times.length - notTaken);
  // perDay 0 = kein Einnahmeplan: dann gibt es nichts „Geplantes“ und nichts „nicht Dokumentiertes“.
  const label = !times.length && !notTaken
    ? perDay === 0
      ? "kein Einnahmeplan eingerichtet"
      : "nicht dokumentiert"
    : [times.length ? `genommen ${times.join(", ")}` : "", notTaken ? `${notTaken}× bewusst nicht genommen` : "", undocumented ? `${undocumented} nicht dokumentiert` : ""].filter(Boolean).join(" · ");
  return { times, notTaken, undocumented, complete: undocumented === 0, label };
}

/** Uhrzeiten aus einer Eingabe wie „08:00, 13:30“ (sortiert, ohne Doppelte). */
export function parseTimes(v: unknown): string[] | null {
  const parts = String(v ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(p);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    out.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  return [...new Set(out)].sort();
}

/** Wie viele Einnahmen genau zu diesem Zeitpunkt (Minute) eingetragen sind – für den Vorrats-Stand. */
export function intakesAt(diary: Pick<DiaryEntry, "day" | "takenAt" | "intakes">[], asOf: string) {
  const at = asOf.slice(0, 16);
  let n = 0;
  for (const e of diary) for (const t of e.intakes?.length ? e.intakes : e.takenAt ? [e.takenAt] : []) if (stamp(e.day, t) === at) n++;
  return n;
}

// ---- Routinen ---------------------------------------------------------------------------------------

export type Routine = { title: string; items: string[]; checks?: Record<string, string[]> };

/** Heute abgehakt, komplett?, Serie kompletter Tage, letzte 7 Tage. */
export function routineState(r: Routine, today: string) {
  const checks = r.checks ?? {};
  const complete = (d: string) => r.items.length > 0 && r.items.every((it) => (checks[d] ?? []).includes(it));
  let streak = 0;
  for (let d = complete(today) ? today : addDays(today, -1); complete(d); d = addDays(d, -1)) streak++;
  return {
    today: checks[today] ?? [],
    doneToday: complete(today),
    streak,
    last7: Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => ({ day: d, done: complete(d), some: (checks[d] ?? []).length > 0 })),
  };
}

// ---- Wertschätzung & Paar-Stimmung --------------------------------------------------------------------

/** Was jemand am anderen geschätzt hat (`from` = wer schreibt). */
export type ThanksEntry = { day: string; from: PartnerKey; text: string };
/** Wie geht es uns als Paar? Je Person ein Wert am Tag. */
export type MoodEntry = { day: string; person: PartnerKey; value: Ratings; note?: string };

/** Wertschätzungen seit einem Tag, getrennt nach Schreiber – für das Paar-Gespräch. */
export function thanksSince(entries: ThanksEntry[], since: string | null) {
  const list = entries.filter((e) => !since || e.day > since).sort((a, b) => a.day.localeCompare(b.day));
  return { a: list.filter((e) => e.from === "a").map((e) => e.text), b: list.filter((e) => e.from === "b").map((e) => e.text) };
}

/** Stimmung je Person über die letzten n Tage. */
export function moodSeries(entries: MoodEntry[], person: PartnerKey, today: string, n = 30) {
  const byDay = new Map(entries.filter((e) => e.person === person).map((e) => [e.day, e.value]));
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1)).map((day) => ({ day, value: byDay.get(day) ?? null, doseMg: null }));
}
export const avgOf = (vals: (number | null | undefined)[]) => {
  const v = vals.filter((x): x is number => typeof x === "number");
  return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null;
};

// ---- Wer kümmert sich (Mental Load) -----------------------------------------------------------------

export type CareOwner = PartnerKey | "beide" | "offen";
export type CareTask = {
  title: string;
  owner: CareOwner;
  repeat: "einmal" | "woechentlich" | "monatlich" | "jaehrlich" | "laufend";
  next?: string;
  notes?: string;
  /** Erledigt: Tag und von wem. */
  done?: { day: string; by: PartnerKey }[];
};
export const CARE_SUGGESTIONS = [
  "Kinderarzt & Vorsorge-Termine",
  "Impfungen im Blick",
  "Kita/Schule: Infos, Elternabende, Formulare",
  "Geburtstage & Geschenke",
  "Kleidung & Schuhe für die Kinder",
  "Wocheneinkauf",
  "Kochen / Essensplan",
  "Wäsche",
  "Putzen / Ordnung",
  "Babysitter organisieren",
  "Urlaub & Ausflüge planen",
  "Rechnungen & Verträge",
  "Hobbys & Kurse der Kinder",
  "Termine im Familienkalender pflegen",
] as const;

/** Verteilung: Zuständigkeiten je Person und erledigt in den letzten 30 Tagen. */
export function careOverview(tasks: CareTask[], today: string) {
  const from = addDays(today, -29);
  const owned = { a: 0, b: 0, beide: 0, offen: 0 };
  const doneBy = { a: 0, b: 0 };
  for (const t of tasks) {
    owned[t.owner]++;
    for (const d of t.done ?? []) if (d.day >= from && d.day <= today) doneBy[d.by]++;
  }
  const due = tasks.filter((t) => t.next && t.next <= addDays(today, 7)).sort((x, y) => x.next!.localeCompare(y.next!));
  const sum = doneBy.a + doneBy.b;
  return { owned, doneBy, shareA: sum ? Math.round((doneBy.a / sum) * 100) : null, due };
}

/** Nach dem Erledigen: nächster Termin je nach Wiederholung. */
export function nextCareDate(t: Pick<CareTask, "repeat" | "next">, doneDay: string): string | undefined {
  const base = t.next && t.next > doneDay ? t.next : doneDay;
  const d = new Date(`${base}T12:00:00Z`);
  if (t.repeat === "woechentlich") return addDays(base, 7);
  if (t.repeat === "monatlich") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (t.repeat === "jaehrlich") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else return undefined;
  return d.toISOString().slice(0, 10);
}

// ---- Date-Ideen -------------------------------------------------------------------------------------

export type DateIdea = { text: string; done?: boolean };

/** „Mal wieder ein Date?“ – wenn das letzte länger her ist als eingestellt. */
export function dateReminder(lastDay: string | null, today: string, days: number): number | null {
  if (!days || !lastDay) return null;
  const since = daysBetween(lastDay, today);
  return since >= days ? since : null;
}

/**
 * Eindeutige Anzeigenamen für Konten mit Privat-Zugang. Ähnliche Namen („Ludwig“ / „Ludwig Grunert“)
 * bekommen die Anmeldung als Zusatz – die Konten bleiben getrennt, es wird nie nach Namen zusammengeführt.
 */
export function memberLabels(members: { userId: string; name: string | null; login: string }[]): Map<string, string> {
  const norm = (s: string) => s.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
  const base = members.map((m) => ({ id: m.userId, name: (m.name ?? "").trim(), login: m.login }));
  const similar = (a: string, b: string) => {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `) || x.split(" ")[0] === y.split(" ")[0];
  };
  const out = new Map<string, string>();
  for (const m of base) {
    if (!m.name) { out.set(m.id, m.login); continue; }
    const clash = base.some((o) => o.id !== m.id && o.name && similar(o.name, m.name));
    out.set(m.id, clash ? `${m.name} (Anmeldung: ${m.login})` : m.name);
  }
  return out;
}

/**
 * Wer hält welche Partner-Rolle (außer dem eigenen Konto)? Eine Rolle gehört genau einem Konto mit
 * Privat-Zugang – ein zweites Konto wird nicht stillschweigend derselben Person zugeordnet.
 */
export function partnerHolders(userPartner: Record<string, PartnerKey>, members: { userId: string; name: string | null; login: string }[], self: string): Partial<Record<PartnerKey, string>> {
  const labels = memberLabels(members);
  const out: Partial<Record<PartnerKey, string>> = {};
  for (const m of members) {
    const k = userPartner[m.userId];
    if (m.userId !== self && k && !out[k]) out[k] = labels.get(m.userId);
  }
  return out;
}
