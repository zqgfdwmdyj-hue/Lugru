// Wann läuft welcher Hintergrund-Abruf? (B21.5) – rein, getestet in tests/calls-live.test.ts.
// „live“ = ausgelöst durch eingehende Nachrichten (Discord-Verbindung), sonst Zeitplan mit Abstand oder Uhrzeit.

export type AbrufPlan = { ausloeser: "live" | "zeitplan"; text: string; minuten?: number; taeglichUm?: string };

export const ABRUF_PLAN: Record<string, AbrufPlan> = {
  "Discord live-Verbindung": { ausloeser: "live", text: "Auslöser: live (Discord)" },
  "Call-Archiv (Discord live)": { ausloeser: "live", text: "Auslöser: live (Discord) – sofort beim Hochladen" },
  "Call-Kanal (Discord live): empfangen": { ausloeser: "live", text: "Auslöser: live (Discord)" },
  "Call-Archiv (Discord, Sicherheitsnetz)": { ausloeser: "zeitplan", text: "Zeitplan: täglich 06:00 (letzte 7 Tage)", taeglichUm: "06:00" },
  "Call-Auswertung": { ausloeser: "zeitplan", text: "Zeitplan: alle 30 Min. (übrige offene Calls)", minuten: 30 },
  "VA (Discord)": { ausloeser: "zeitplan", text: "Zeitplan: alle 30 Sek. (ab der zuletzt gelesenen Nachricht)", minuten: 0.5 },
  "Lugru Deals (Discord)": { ausloeser: "zeitplan", text: "Zeitplan: jede Minute (ab der zuletzt gelesenen Nachricht)", minuten: 1 },
  "ProfitPath (Discord)": { ausloeser: "zeitplan", text: "Zeitplan: jede Minute", minuten: 1 },
  "Gruppen-Kanäle (Discord)": { ausloeser: "zeitplan", text: "Zeitplan: stündlich (ab der zuletzt gelesenen Nachricht)", minuten: 60 },
  "Discord-Kanäle: Nachlese 06:00": { ausloeser: "zeitplan", text: "Zeitplan: täglich 06:00 (VA, Gruppen, Lugru)", taeglichUm: "06:00" },
  "Rechtsfälle (Asana)": { ausloeser: "zeitplan", text: "Zeitplan: alle 30 Min.", minuten: 30 },
  "Lugru Deals: History": { ausloeser: "zeitplan", text: "Zeitplan: alle 5 Min. (bis fertig)", minuten: 5 },
  "Lugru Deals: History → Deal-Eingang": { ausloeser: "zeitplan", text: "Zeitplan: alle 5 Min. (bis fertig)", minuten: 5 },
  "Deal-Wert: 👍/👎 aus Discord": { ausloeser: "zeitplan", text: "Zeitplan: alle 15 Min.", minuten: 15 },
  "Amazon: Versandbestätigung": { ausloeser: "zeitplan", text: "Zeitplan: stündlich", minuten: 60 },
};

const BERLIN = "Europe/Berlin";
const tagBerlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN }).format(d);
const zeitBerlin = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** Offset Berlin ↔ UTC (Minuten) an einem Zeitpunkt. */
function berlinOffset(d: Date): number {
  const teile = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const w = (t: string) => Number(teile.find((p) => p.type === t)?.value);
  const lokal = Date.UTC(w("year"), w("month") - 1, w("day"), w("hour") % 24, w("minute"));
  return Math.round((lokal - d.getTime()) / 60_000);
}

/** Zeitpunkt „Tag HH:MM“ in Berlin als Date. */
function berlinZeitpunkt(tag: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const roh = new Date(`${tag}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  return new Date(roh.getTime() - berlinOffset(roh) * 60_000);
}

/** Nächster Lauf: live → null (sofort bei Eingang); Abstand → letzter + Abstand (frühestens jetzt); Uhrzeit → nächste. */
export function naechsterLauf(plan: AbrufPlan | undefined, letzter: Date | null, jetzt = new Date()): Date | null {
  if (!plan || plan.ausloeser === "live") return null;
  if (plan.taeglichUm) {
    const heute = berlinZeitpunkt(tagBerlin(jetzt), plan.taeglichUm);
    const schonHeute = letzter && tagBerlin(letzter) === tagBerlin(jetzt) && letzter >= heute;
    if (jetzt < heute && !schonHeute) return heute;
    if (!schonHeute && jetzt >= heute) return jetzt;
    const morgen = new Date(heute.getTime() + 26 * 3600_000);
    return berlinZeitpunkt(tagBerlin(morgen), plan.taeglichUm);
  }
  if (plan.minuten) {
    if (!letzter) return jetzt;
    const n = new Date(letzter.getTime() + plan.minuten * 60_000);
    return n < jetzt ? jetzt : n;
  }
  return null;
}

/** Text für „nächster Lauf“. */
export function naechsterText(plan: AbrufPlan | undefined, letzter: Date | null, jetzt = new Date()): string {
  if (!plan) return "laut Plan";
  if (plan.ausloeser === "live") return "sofort bei Eingang";
  const n = naechsterLauf(plan, letzter, jetzt);
  if (!n) return "–";
  if (n.getTime() - jetzt.getTime() < 60_000) return "jetzt fällig";
  return tagBerlin(n) === tagBerlin(jetzt) ? `heute ${zeitBerlin(n)}` : `${tagBerlin(n).slice(8, 10)}.${tagBerlin(n).slice(5, 7)}. ${zeitBerlin(n)}`;
}

/** Läuft ein „täglich um“-Abruf jetzt? (Berlin-Uhrzeit erreicht und heute noch nicht gelaufen.) */
export function taeglichFaellig(hhmm: string, letzter: Date | null, jetzt = new Date()): boolean {
  if (jetzt < berlinZeitpunkt(tagBerlin(jetzt), hhmm)) return false;
  return !letzter || tagBerlin(letzter) !== tagBerlin(jetzt) || letzter < berlinZeitpunkt(tagBerlin(jetzt), hhmm);
}
