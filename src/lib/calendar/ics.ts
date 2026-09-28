// iCalendar (RFC 5545): Termine schreiben und lesen – nur was für den Abgleich nötig ist.

const TZ = "Europe/Berlin";

export type OutEvent = {
  uid: string;
  title: string;
  /** Ganztägig am Datum (JJJJ-MM-TT). */
  date: string;
  description?: string;
  url?: string;
  /** Kategorie, erscheint in manchen Kalender-Apps. */
  category?: string;
  /** Erinnerung x Minuten nach Tagesbeginn, z. B. 540 = 9 Uhr am Fälligkeitstag. */
  alarmAtMinute?: number;
};

export type InEvent = {
  uid: string;
  title: string;
  /** Beginn als ISO-Zeitpunkt (UTC) bzw. Datum bei ganztägigen Terminen. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  recurrenceId: string | null;
  rrule: string | null;
  /** Ausgelassene Termine einer Serie (ISO wie start). */
  exdates: string[];
  /** Zeitzone des Beginns – Serien wiederholen sich zur gleichen Ortszeit. */
  tzid: string | null;
};

function escapeText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function unescapeText(s: string) {
  return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** Zeilen auf 75 Oktette falten (RFC 5545, 3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const l = Buffer.byteLength(ch, "utf8");
    if (len + l > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += l;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const addDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildEvent(e: OutEvent, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seller-System//Kalender//DE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compactDate(e.date)}`,
    `DTEND;VALUE=DATE:${compactDate(addDay(e.date))}`,
    `SUMMARY:${escapeText(e.title)}`,
    "TRANSP:TRANSPARENT",
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.category) lines.push(`CATEGORIES:${escapeText(e.category)}`);
  if (e.alarmAtMinute !== undefined) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:PT${e.alarmAtMinute}M`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter(Boolean);
}

function parseLine(line: string): Prop | null {
  // Name;PARAM=Wert;PARAM="Wert:mit:Doppelpunkt":Wert
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...rawParams] = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

/** Versatz einer Zeitzone zu UTC in Minuten zum gegebenen Zeitpunkt. */
function tzOffsetMinutes(timeZone: string, utc: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(utc);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - utc.getTime()) / 60000);
  } catch {
    return tzOffsetMinutes(TZ, utc);
  }
}

/** Ortszeit in einer Zeitzone → UTC. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const off1 = tzOffsetMinutes(timeZone, guess);
  const t = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(timeZone, t);
  return off1 === off2 ? t : new Date(guess.getTime() - off2 * 60000);
}

/** Wert einer DTSTART/DTEND-Zeile → { iso, allDay }. */
export function parseDateValue(value: string, params: Record<string, string>): { iso: string; allDay: boolean } | null {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || params.VALUE === "DATE") {
    m ??= /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (m[7]) return { iso: new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(), allDay: false };
  // Mit TZID in dieser Zone, ohne Angabe („floating") als deutsche Zeit.
  const tz = params.TZID?.replace(/^\/+/, "") || TZ;
  return { iso: zonedToUtc(y, mo, d, h, mi, s, tz).toISOString(), allDay: false };
}

export function parseEvents(ics: string): InEvent[] {
  const out: InEvent[] = [];
  let cur: Prop[] | null = null;
  let depth = 0; // Unterkomponenten (VALARM) überspringen
  for (const line of unfold(ics)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") {
      cur = [];
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (p.name === "BEGIN") {
      depth++;
      continue;
    }
    if (p.name === "END" && depth > 0) {
      depth--;
      continue;
    }
    if (p.name === "END" && p.value.toUpperCase() === "VEVENT") {
      const get = (n: string) => cur!.find((x) => x.name === n);
      const start = get("DTSTART") ? parseDateValue(get("DTSTART")!.value, get("DTSTART")!.params) : null;
      const endProp = get("DTEND");
      const end = endProp ? parseDateValue(endProp.value, endProp.params) : null;
      const rid = get("RECURRENCE-ID");
      if (start && get("UID")) {
        out.push({
          uid: get("UID")!.value.trim(),
          title: unescapeText(get("SUMMARY")?.value ?? "(ohne Titel)"),
          start: start.iso,
          end: end?.iso ?? null,
          allDay: start.allDay,
          location: get("LOCATION") ? unescapeText(get("LOCATION")!.value) : null,
          description: get("DESCRIPTION") ? unescapeText(get("DESCRIPTION")!.value) : null,
          recurrenceId: rid ? (parseDateValue(rid.value, rid.params)?.iso ?? rid.value) : null,
          rrule: get("RRULE")?.value ?? null,
          exdates: cur!
            .filter((x) => x.name === "EXDATE")
            .flatMap((x) => x.value.split(",").map((v) => parseDateValue(v, x.params)?.iso))
            .filter((v): v is string => Boolean(v)),
          tzid: get("DTSTART")!.params.TZID?.replace(/^\/+/, "") || (/Z$/.test(get("DTSTART")!.value.trim()) ? "UTC" : null),
        });
      }
      cur = null;
      continue;
    }
    if (depth === 0) cur.push(p);
  }
  return out;
}
