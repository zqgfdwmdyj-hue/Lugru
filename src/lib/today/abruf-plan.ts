// Wann läuft welcher Hintergrund-Abruf? (B21.5) – rein, getestet in tests/calls-live.test.ts.
// „live“ = ausgelöst durch eingehende Nachrichten (Discord-Verbindung), sonst Zeitplan mit Abstand oder Uhrzeit.

export type AbrufPlan = { ausloeser: "live" | "zeitplan"; text: string; minuten?: number; taeglichUm?: string; /** B29: feste Uhrzeiten (Berlin) */ uhrzeiten?: string[] };

/** Uhrzeiten des Verkaufs-Abrufs (gleich wie SB_SLOTS.verkauf in sellerboard/budget-logic.ts – Test prüft das). */
const SB_VERKAUF = ["02:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"];

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
  "Deal-Wert: nachrechnen": { ausloeser: "zeitplan", text: "Zeitplan: alle 5 Min. (bis alle Deals einen Wert haben)", minuten: 5 },
  "Kauf vorbereitet: prüfen": { ausloeser: "zeitplan", text: "Zeitplan: stündlich (24 Std. nach dem Öffnen des Warenkorb-Links: sellerboard-SKU → gekauft, sonst Erinnerung)", minuten: 60 },
  "Lugru Deals: eigene Käufe": { ausloeser: "zeitplan", text: "Zeitplan: alle 6 Std. (sellerboard-SKUs, Chargen, Bestellungen)", minuten: 360 },
  "Amazon: Versandbestätigung": { ausloeser: "zeitplan", text: "Zeitplan: stündlich", minuten: 60 },
  "ArbitrageOne: Exporte abholen": { ausloeser: "zeitplan", text: "Auslöser: täglich 05:30 (Einkäufe, Lagerbestand, sellerboard-COG; montags Reimbursement; am 1. AccountOne COG – BQool entfällt, das Seller-System erzeugt die Datei)", taeglichUm: "05:30" },
  // B31.2: täglicher BQool-Kreislauf – Ist je Land, Upload nach Freigabe, Nachkontrolle 30 Min. danach.
  "BQool: Ist holen": { ausloeser: "zeitplan", text: "Zeitplan: täglich 06:00 (Export je Land DE/FR/IT/ES, danach Soll und Freigabe-Push)", taeglichUm: "06:00" },
  "BQool: Upload": { ausloeser: "zeitplan", text: "Auslöser: Freigabe (Push bzw. Repricer → BQool-Dateien) – automatisch nur, wenn eingeschaltet", taeglichUm: "06:00" },
  "BQool: Nachkontrolle": { ausloeser: "zeitplan", text: "Auslöser: 30 Min. nach dem Upload (Ist erneut holen, Min/Regel je SKU prüfen)", taeglichUm: "06:00" },
  "BQool: Berichte": { ausloeser: "zeitplan", text: "Auslöser: täglich 06:00 mit dem Ist (Listing Performance 7 Tage und Daily Sales je Land, wenn die Berichtsseiten eingetragen sind)", taeglichUm: "06:00" },
  "ArbitrageOne: fehlgeschlagene Importe nachverarbeiten": { ausloeser: "zeitplan", text: "Zeitplan: stündlich (je fehlgeschlagenem Import einmal)", minuten: 60 },
  // B29.1: sellerboard – feste Uhrzeiten mit Tagesbudget (vorher alle 30 Min./3 Std./4 Std. = über 125 Aufrufe am Tag).
  "sellerboard: Verkauf (Amazon + eBay)": { ausloeser: "zeitplan", text: "Zeitplan: alle 2 Std. 06–22 Uhr, nachts 02:00 (Vorrang im Tagesbudget)", uhrzeiten: SB_VERKAUF },
  "sellerboard: FBA-Bestand": { ausloeser: "zeitplan", text: "Zeitplan: 04:30 und 16:30", uhrzeiten: ["04:30", "16:30"] },
  "sellerboard: FBA-Sendungen": { ausloeser: "zeitplan", text: "Zeitplan: 04:30 und 16:30 (nur geänderte Sendungen)", uhrzeiten: ["04:30", "16:30"] },
  "sellerboard: Hebel-Aufgaben": { ausloeser: "zeitplan", text: "Zeitplan: nach den Tagesabrufen (ab 02:00) und nach dem Bestand (04:30, 16:30) – ohne sellerboard-Aufruf", uhrzeiten: ["02:00", "04:30", "16:30"] },
  "sellerboard: Ansprüche aus Sendungen": { ausloeser: "zeitplan", text: "Zeitplan: 04:30 und 16:30 (nach den Sendungen) – ohne sellerboard-Aufruf", uhrzeiten: ["04:30", "16:30"] },
  "sellerboard: Produkte & EK": { ausloeser: "zeitplan", text: "Zeitplan: täglich 02:00–03:30 (Tagesabrufe nacheinander)", uhrzeiten: ["02:00"] },
  "sellerboard: Monatswerte & Gewinn je SKU": { ausloeser: "zeitplan", text: "Zeitplan: täglich 02:00–03:30 (Tagesabrufe nacheinander; Vormonat nur bis zum 10.)", uhrzeiten: ["02:00"] },
  "sellerboard: Fixkosten": { ausloeser: "zeitplan", text: "Zeitplan: täglich 02:00–03:30 (Tagesabrufe nacheinander)", uhrzeiten: ["02:00"] },
  "sellerboard: Produkte 30 Tage (Hebel)": { ausloeser: "zeitplan", text: "Zeitplan: täglich 02:00–03:30 (Tagesabrufe nacheinander)", uhrzeiten: ["02:00"] },
  "sellerboard: Keepa Buy Box (Hebel)": { ausloeser: "zeitplan", text: "Zeitplan: täglich 02:00–03:30 (nach den Tagesabrufen) – ohne sellerboard-Aufruf", uhrzeiten: ["02:00"] },
  "sellerboard: Gewinn je Produkt und Tag": { ausloeser: "zeitplan", text: "Zeitplan: 04:00 und 13:00", uhrzeiten: ["04:00", "13:00"] },
  "sellerboard: Verlust-Stopp": { ausloeser: "zeitplan", text: "Zeitplan: 04:00 und 13:00 (nach „Gewinn je Produkt und Tag“) – ohne sellerboard-Aufruf", uhrzeiten: ["04:00", "13:00"] },
  "sellerboard: Tageslimit": { ausloeser: "zeitplan", text: "Auslöser: sellerboard meldet das Tageslimit (125 Aufrufe) – Pause bis 00:00 UTC, danach Nachholen" },
};

/** B27.5: Abrufe, die durch neuere ersetzt sind – nie „veraltet“, nicht unter „nur Probleme“. */
export const ABGELOESTE_ABRUFE: Record<string, string> = {
  "Call-Archiv (Discord)": "abgelöst durch „Call-Archiv (Discord live)“ und „Call-Archiv (Discord, Sicherheitsnetz)“ (täglich 06:00)",
};

/** B25.12: Text für einen Abstand in Minuten (Hintergrund-Takt alle 5 Min.: 4 → 5, 59 → 60, 1435 → täglich). */
export function intervallText(minuten: number): string {
  const m = Math.max(5, Math.ceil(minuten / 5) * 5);
  if (m >= 1380) return "täglich";
  if (m === 60) return "stündlich";
  if (m > 60 && m % 60 === 0) return `alle ${m / 60} Std.`;
  return `alle ${m} Min.`;
}

/** Zeitplan, wie ihn der Hintergrund-Takt meldet: Abstand in Minuten bzw. täglich um. */
export function planAusTakt(o: { minuten?: number; taeglichUm?: string }): AbrufPlan {
  if (o.taeglichUm) return { ausloeser: "zeitplan", text: `Zeitplan: täglich ${o.taeglichUm}`, taeglichUm: o.taeglichUm };
  const roh = Math.max(5, Math.ceil((o.minuten ?? 5) / 5) * 5);
  const m = roh >= 1380 ? 1440 : roh;
  return { ausloeser: "zeitplan", text: `Zeitplan: ${intervallText(m)}`, minuten: m };
}

const BERLIN = "Europe/Berlin";
export const tagBerlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN }).format(d);
export const zeitBerlin = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** Offset Berlin ↔ UTC (Minuten) an einem Zeitpunkt. */
function berlinOffset(d: Date): number {
  const teile = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const w = (t: string) => Number(teile.find((p) => p.type === t)?.value);
  const lokal = Date.UTC(w("year"), w("month") - 1, w("day"), w("hour") % 24, w("minute"));
  return Math.round((lokal - d.getTime()) / 60_000);
}

/** Zeitpunkt „Tag HH:MM“ in Berlin als Date. */
export function berlinZeitpunkt(tag: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const roh = new Date(`${tag}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  return new Date(roh.getTime() - berlinOffset(roh) * 60_000);
}

/** Nächster Lauf: live → null (sofort bei Eingang); Abstand → letzter + Abstand (frühestens jetzt); Uhrzeit → nächste. */
export function naechsterLauf(plan: AbrufPlan | undefined, letzter: Date | null, jetzt = new Date()): Date | null {
  if (!plan || plan.ausloeser === "live") return null;
  if (plan.uhrzeiten?.length) {
    // B29: nächste feste Uhrzeit nach jetzt (übersprungene Läufe werden nach der Rücksetzung nachgeholt).
    const tage = [0, 1, 2].map((i) => tagBerlin(new Date(jetzt.getTime() + i * 86_400_000)));
    const kommend = tage.flatMap((t) => plan.uhrzeiten!.map((u) => berlinZeitpunkt(t, u))).filter((d) => d > jetzt);
    return kommend.length ? new Date(Math.min(...kommend.map((d) => d.getTime()))) : null;
  }
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
  if (!plan) return "nach dem ersten Lauf bekannt";
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

/** B25.12: welche Hintergrund-Abrufe zu welcher Anbindung gehören (für das Intervall je Anbindung). */
export const ABRUFE_JE_ANBINDUNG: Record<string, string[]> = {
  amazon_sp: ["Amazon-Bestellungen", "Amazon-Reports abholen", "Amazon-Reports anfordern", "Abrechnungen"],
  temu: ["Temu-Bestellungen", "Temu-Angebote", "Temu-Produkte verknüpfen"],
  apple_calendar: ["Kalender"],
  google_drive: ["Rechnungen"],
  lexoffice: ["B2B-Zahlungen (Lexoffice)"],
  keepa: ["Keepa-Abgleich Lieferanten", "Eigene Produkte (Keepa)"],
  stotax: ["Rechnungen an Stotax", "Belege an Stotax"],
  arbitrageone_web: ["ArbitrageOne: Exporte abholen"],
  bqool_web: ["BQool: Ist holen", "BQool: Berichte", "BQool: Upload", "BQool: Nachkontrolle"],
  discord_calls: ["Call-Kanal (Discord live): empfangen", "Call-Archiv (Discord, Sicherheitsnetz)"],
  discord_va: ["VA (Discord)"],
  discord_profitpath: ["ProfitPath (Discord)"],
  lugru_deals: ["Lugru Deals (Discord)", "Lugru Deals: History", "Lugru Deals: eigene Käufe"],
  asana: ["Rechtsfälle (Asana)"],
  discord_wissen: ["Gruppen-Kanäle (Discord)"],
  tesla: ["Tesla: Fahrtenbuch", "Tesla: Vorheizen", "Tesla: Verspätung"],
  twilio: ["SMS: Frist morgen"],
};
