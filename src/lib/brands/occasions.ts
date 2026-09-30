// Anlässe für Themenboxen und Produkte: Datum je Jahr und wie lange vorher die Planung beginnt.
// Ohne Server-Abhängigkeiten.

export type Occasion = {
  key: string;
  name: string;
  /** Datum im Jahr (JJJJ-MM-TT). */
  date: (year: number) => string;
  /** Standard-Vorlauf in Wochen: ab dann „jetzt planen“. */
  leadWeeks: number;
  hint?: string;
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (dateIso: string, n: number) => {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (dateIso: string) => new Date(`${dateIso}T12:00:00Z`).getUTCDay();

/** Ostersonntag (Gauß/Meeus). */
export function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** n-ter Wochentag (0 = Sonntag) im Monat. */
export function nthWeekday(y: number, month: number, wd: number, n: number): string {
  let d = iso(y, month, 1);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

export const OCCASIONS: Occasion[] = [
  { key: "valentinstag", name: "Valentinstag", date: (y) => iso(y, 2, 14), leadWeeks: 8 },
  { key: "superbowl", name: "Super Bowl", date: (y) => nthWeekday(y, 2, 0, 2), leadWeeks: 6, hint: "US-Snacks & Süßigkeiten" },
  { key: "karneval", name: "Karneval / Fasching", date: (y) => addDays(easter(y), -48), leadWeeks: 6, hint: "Rosenmontag" },
  { key: "ostern", name: "Ostern", date: (y) => easter(y), leadWeeks: 10 },
  { key: "muttertag", name: "Muttertag", date: (y) => nthWeekday(y, 5, 0, 2), leadWeeks: 8 },
  { key: "vatertag", name: "Vatertag", date: (y) => addDays(easter(y), 39), leadWeeks: 8, hint: "Christi Himmelfahrt" },
  { key: "4th-july", name: "4th of July", date: (y) => iso(y, 7, 4), leadWeeks: 6, hint: "American-Candy-Aktionen" },
  { key: "einschulung", name: "Einschulung / Schulanfang", date: (y) => iso(y, 8, 15), leadWeeks: 20, hint: "je nach Bundesland Ende Juli bis Mitte September – Schultüten früh planen" },
  { key: "oktoberfest", name: "Oktoberfest", date: (y) => { let d = iso(y, 9, 16); while (weekday(d) !== 6) d = addDays(d, 1); return d; }, leadWeeks: 6 },
  { key: "halloween", name: "Halloween", date: (y) => iso(y, 10, 31), leadWeeks: 10 },
  { key: "singles-day", name: "Singles Day", date: (y) => iso(y, 11, 11), leadWeeks: 4 },
  { key: "thanksgiving", name: "Thanksgiving", date: (y) => nthWeekday(y, 11, 4, 4), leadWeeks: 6 },
  { key: "black-friday", name: "Black Friday / Cyber Week", date: (y) => addDays(nthWeekday(y, 11, 4, 4), 1), leadWeeks: 8 },
  { key: "advent", name: "Adventskalender (1. Advent)", date: (y) => { let d = iso(y, 12, 24); while (weekday(d) !== 0) d = addDays(d, -1); return addDays(d, -21); }, leadWeeks: 14 },
  { key: "nikolaus", name: "Nikolaus", date: (y) => iso(y, 12, 6), leadWeeks: 8 },
  { key: "weihnachten", name: "Weihnachten", date: (y) => iso(y, 12, 24), leadWeeks: 12 },
  { key: "silvester", name: "Silvester", date: (y) => iso(y, 12, 31), leadWeeks: 6 },
];

export const occasionByKey = (key: string) => OCCASIONS.find((o) => o.key === key);

export type UpcomingOccasion = { key: string; name: string; date: string; planFrom: string; leadWeeks: number; daysLeft: number; planning: boolean; hint?: string };

/**
 * Anlässe der nächsten `horizonDays` Tage. `leads` = Vorlauf je Anlass (Wochen); nur diese Anlässe,
 * wenn angegeben. `planning` = die Planungszeit hat begonnen.
 */
export function upcomingOccasions(today: string, leads?: Record<string, number>, horizonDays = 366): UpcomingOccasion[] {
  const y = Number(today.slice(0, 4));
  const out: UpcomingOccasion[] = [];
  for (const o of OCCASIONS) {
    if (leads && !(o.key in leads)) continue;
    const lead = leads?.[o.key] ?? o.leadWeeks;
    for (const year of [y, y + 1]) {
      const date = o.date(year);
      const daysLeft = Math.round((Date.parse(date) - Date.parse(today)) / 86400_000);
      if (daysLeft < 0 || daysLeft > horizonDays) continue;
      const planFrom = addDays(date, -lead * 7);
      out.push({ key: o.key, name: o.name, date, planFrom, leadWeeks: lead, daysLeft, planning: planFrom <= today, hint: o.hint });
      break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Vorschlag, welche Anlässe zu einer Marke passen (Vorbelegung beim Anlegen). */
export const DEFAULT_OCCASIONS: Record<string, Record<string, number>> = {
  kulu: { einschulung: 20, halloween: 10, advent: 14, nikolaus: 8, weihnachten: 12, valentinstag: 8, ostern: 10, muttertag: 8, vatertag: 6, superbowl: 6, "4th-july": 6, thanksgiving: 6, "black-friday": 8, karneval: 6 },
  zeitlux: { weihnachten: 12, "black-friday": 8, vatertag: 8, valentinstag: 6, muttertag: 6 },
};
