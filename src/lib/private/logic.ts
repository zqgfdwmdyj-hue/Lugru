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
};
export const DEFAULT_PRIVATE_SETTINGS: PrivateSettings = {
  partners: { a: "Ludwig", b: "Alexandra" },
  kids: [],
  therapists: { ads: "ADHS-Psychologin", paar: "Paartherapie" },
  diaryShared: [],
  userPartner: {},
  wakeTime: "06:30",
  dateReminderDays: 21,
};

export type IntimEntry = { day: string; time?: string; initiative?: PartnerKey | "beide"; closeness?: Ratings; note?: string };
export type KidsEntry = { day: string; person: PartnerKey; from?: string; to?: string; hours?: number; what?: string; kids?: string[] };
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
export type AppointmentEntry = { day: string; time?: string; with: "ads" | "paar" | "arzt" | "sonst"; notes?: string };
/** Paarzeit: zu zweit unterwegs (Date), Kinder bei Babysitterin/Oma … */
export type DateEntry = { day: string; from?: string; to?: string; hours?: number; what?: string; sitter?: string; costEur?: number; rating?: Ratings; note?: string };
/** Ausschlafen: wer durfte wann wie lange länger schlafen (der andere übernimmt die Kinder). */
export type SleepEntry = { day: string; person: PartnerKey; from?: string; to?: string; hours?: number; note?: string };
export type TalkEntry = { day: string; appreciationsA?: string; appreciationsB?: string; topic?: string; agreed?: string };
export type DiaryEntry = {
  day: string;
  med?: string;
  doseMg?: number;
  takenAt?: string;
  /** Alle Einnahmen des Tages (Uhrzeiten), z. B. bei zwei Gaben. */
  intakes?: string[];
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

/** Bei diesen Einträgen gleich auf den Hinweis „ärztlich abklären“ zeigen. */
export const URGENT_SIDE_EFFECTS = new Set(["Herzklopfen / Herzrasen", "Tics", "gedrückte Stimmung"]);

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
export function dateStats(entries: DateEntry[], month: string, today: string) {
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

// ---- Kinderzeit ------------------------------------------------------------------------------------

/** Dauer in Stunden: aus von–bis (auch über Mitternacht) oder der Angabe „Stunden“. */
export function kidsHours(e: Pick<KidsEntry, "from" | "to" | "hours">): number {
  if (e.from && e.to && /^\d{1,2}:\d{2}$/.test(e.from) && /^\d{1,2}:\d{2}$/.test(e.to)) {
    const [h1, m1] = e.from.split(":").map(Number);
    const [h2, m2] = e.to.split(":").map(Number);
    let mins = h2 * 60 + m2 - (h1 * 60 + m1);
    if (mins < 0) mins += 24 * 60;
    return round1(mins / 60);
  }
  return e.hours && e.hours > 0 ? round1(e.hours) : 0;
}

/** Je Person: Anzahl, Stunden; und je Tag beide Spalten nebeneinander. */
export function kidsOverview<E extends KidsEntry>(entries: E[], month: string) {
  const list = entries.filter((e) => e.day.startsWith(month)).sort((x, y) => x.day.localeCompare(y.day) || (x.from ?? "").localeCompare(y.from ?? ""));
  const totals = { a: { count: 0, hours: 0 }, b: { count: 0, hours: 0 } };
  const byDay = new Map<string, { a: E[]; b: E[] }>();
  for (const e of list) {
    totals[e.person].count++;
    totals[e.person].hours = round1(totals[e.person].hours + kidsHours(e));
    const row = byDay.get(e.day) ?? { a: [], b: [] };
    row[e.person].push(e);
    byDay.set(e.day, row);
  }
  const sum = totals.a.hours + totals.b.hours;
  return { totals, shareA: sum ? Math.round((totals.a.hours / sum) * 100) : null, days: [...byDay.entries()].map(([day, r]) => ({ day, ...r })) };
}

// ---- Ausschlafen -----------------------------------------------------------------------------------

/**
 * Wer ist als Nächstes mit Ausschlafen dran? Wer im Monat deutlich weniger hatte (mind. 2× weniger),
 * sonst abwechselnd: der andere als beim letzten Mal. Ohne Einträge: null.
 */
export function nextSleeper(entries: (Pick<SleepEntry, "day" | "person"> & { at?: number })[], month: string): PartnerKey | null {
  if (!entries.length) return null;
  const inMonth = entries.filter((e) => e.day.startsWith(month));
  const a = inMonth.filter((e) => e.person === "a").length;
  const b = inMonth.filter((e) => e.person === "b").length;
  if (a - b >= 2) return "b";
  if (b - a >= 2) return "a";
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

/** Zeitraum-Auswertung fürs Arztgespräch: Dosis-Phasen, Mittelwerte, Nebenwirkungen, Messwerte. */
export function diaryReport(entries: DiaryEntry[], from: string, to: string) {
  const list = entries.filter((e) => e.day >= from && e.day <= to).sort((a, b) => a.day.localeCompare(b.day));
  const avg = (key: keyof DiaryEntry) => {
    const v = list.map((e) => e[key]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  // Dosis-Phasen: zusammenhängende Tage mit gleichem Mittel + Dosis
  const phases: { med: string; doseMg: number | null; from: string; to: string; days: number; focus: number | null; mood: number | null; sideEffects: number }[] = [];
  for (const e of list) {
    const med = e.med?.trim() || "–";
    const dose = typeof e.doseMg === "number" ? e.doseMg : null;
    const p = phases[phases.length - 1];
    if (p && p.med === med && p.doseMg === dose) {
      p.to = e.day;
      p.days++;
    } else phases.push({ med, doseMg: dose, from: e.day, to: e.day, days: 1, focus: null, mood: null, sideEffects: 0 });
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
  }
  const effects = new Map<string, number>();
  for (const e of list) for (const s of e.sideEffects ?? []) effects.set(s, (effects.get(s) ?? 0) + 1);
  const vitals = list.filter((e) => e.pulse || e.bpSys || e.weightKg).map((e) => ({ day: e.day, pulse: e.pulse ?? null, bp: e.bpSys && e.bpDia ? `${e.bpSys}/${e.bpDia}` : null, weightKg: e.weightKg ?? null, doseMg: e.doseMg ?? null }));
  const weights = list.filter((e) => typeof e.weightKg === "number");
  return {
    days: list.length,
    entries: list,
    phases,
    averages: { focus: avg("focus"), mood: avg("mood"), calm: avg("calm"), energy: avg("energy"), sleepQuality: avg("sleepQuality"), appetite: avg("appetite"), sleepHours: avg("sleepHours"), pulse: avg("pulse") },
    sideEffects: [...effects.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
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
  const kids = input.kids.filter((e) => e.day >= since && e.day <= today);
  const hours = { a: 0, b: 0 };
  for (const e of kids) hours[e.person] = round1(hours[e.person] + kidsHours(e));
  const done = input.tasks.filter((t) => (t.repeat === "einmal" ? t.done && (t.doneAt ?? "") >= since : (t.checks ?? []).some((d) => d >= since)));
  return {
    days: daysBetween(since, today),
    intim: input.intim.filter((e) => e.day >= since && e.day <= today).length,
    dates: (input.dates ?? []).filter((e) => e.day >= since && e.day <= today).length,
    sleepIn: {
      a: (input.sleep ?? []).filter((e) => e.person === "a" && e.day >= since && e.day <= today).length,
      b: (input.sleep ?? []).filter((e) => e.person === "b" && e.day >= since && e.day <= today).length,
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
export type MedPlan = {
  med: string;
  doseMg?: number;
  piecesPerIntake: number;
  intakesPerDay: number;
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
export function medStock(plan: MedPlan, diary: Pick<DiaryEntry, "day" | "takenAt" | "intakes">[]) {
  if (!plan.stock) return null;
  const since = plan.stock.asOf.slice(0, 16);
  let taken = 0;
  let sameMinute = 0;
  for (const e of diary) {
    const times = e.intakes?.length ? e.intakes : e.takenAt ? [e.takenAt] : [];
    for (const t of times) {
      const s = stamp(e.day, t);
      if (s > since) taken++;
      else if (s === since) sameMinute++;
    }
  }
  // Einnahmen in genau der Minute des Zählens: nur die, die erst danach dazukamen.
  taken += Math.max(0, sameMinute - (plan.stock.atAsOf ?? 0));
  const remaining = Math.max(0, Math.round((plan.stock.count - taken * plan.piecesPerIntake) * 10) / 10);
  const perDay = Math.max(0.1, plan.piecesPerIntake * plan.intakesPerDay);
  const daysLeft = Math.floor(remaining / perDay);
  return { remaining, daysLeft, low: daysLeft <= plan.warnDays, taken };
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
