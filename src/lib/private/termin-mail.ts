// Termin-Mails (Modul 6): Bestätigung, Erinnerung, Verschiebung, Absage von Doctolib, Praxen, Handwerkern, Ämtern
// und Schule/Kita erkennen. Solche Mails sind privat: Sie landen nur im Privatkalender, nie im geschäftlichen
// Posteingang. Reine Logik ohne Datenbank, damit mit Beispielmails testbar.

export type TerminDienst = "doctolib" | "arzt" | "handwerker" | "amt" | "schule";
export type TerminArt = "bestaetigung" | "erinnerung" | "verschoben" | "abgesagt";

export type TerminMail = {
  dienst: TerminDienst;
  art: TerminArt;
  /** Neuer bzw. bestätigter Termin. */
  tag: string;
  uhrzeit: string | null;
  /** Bei Verschiebung der bisherige Tag (wenn genannt). */
  alterTag: string | null;
  bei: string | null;
  adresse: string | null;
  person: string | null;
  mitbringen: string | null;
  /** Art im Privatkalender. */
  mit: "arzt" | "familie" | "sonst";
};

const MONATE: Record<string, number> = { januar: 1, jänner: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };

const ARZT = /doctolib|praxis|dr\.\s|zahnarzt|kinderarzt|hausarzt|facharzt|klinik|krankenhaus|physio|ergotherapie|logopädie|psychotherap|frauenarzt|augenarzt|orthopäd|dermatolog|impfung|vorsorgeuntersuchung|termin(e)?bestätigung.*(arzt|praxis)/i;
const HANDWERKER = /handwerker|monteur|techniker|installateur|heizungs?(wartung|ablesung)|ablesung|schornsteinfeger|reparatur(termin)?|wartungstermin|kundendienst(termin)?/i;
const AMT = /bürgeramt|bürgerbüro|zulassungsstelle|standesamt|ausländerbehörde|termin beim amt|terminvereinbarung.*(amt|behörde)|passamt/i;
const SCHULE = /elternabend|elternsprechtag|elterngespräch|schule|kita|kindergarten|hort|einschulung|schulfest/i;
const TERMIN = /termin|appointment|rendez-vous|besuch|elternabend|sprechtag/i;

const pad = (n: number) => String(n).padStart(2, "0");

/** Alle Datumsangaben im Text (ISO), in Reihenfolge: „3. November 2026“, „03.11.2026“, „3.11.“. */
export function datumsangaben(text: string, heute: string): { iso: string; pos: number }[] {
  const out: { iso: string; pos: number }[] = [];
  const jahrJetzt = Number(heute.slice(0, 4));
  const add = (jahr: number | null, m: number, d: number, pos: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    let iso = `${jahr ?? jahrJetzt}-${pad(m)}-${pad(d)}`;
    // Ohne Jahr genannt und schon vorbei → nächstes Jahr
    if (jahr === null && iso < heute) iso = `${jahrJetzt + 1}-${pad(m)}-${pad(d)}`;
    if (!Number.isNaN(Date.parse(iso)) && !out.some((o) => o.iso === iso && Math.abs(o.pos - pos) < 5)) out.push({ iso, pos });
  };
  for (const m of text.matchAll(/(\d{1,2})\.\s*(januar|jänner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(\d{4}))?/gi)) add(m[3] ? Number(m[3]) : null, MONATE[m[2].toLowerCase()], Number(m[1]), m.index ?? 0);
  for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?!\d)/g)) add(m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null, Number(m[2]), Number(m[1]), m.index ?? 0);
  return out.sort((a, b) => a.pos - b.pos);
}

/** Uhrzeit nach einer Position: „09:30“, „9.30 Uhr“, „um 14 Uhr“. */
export function uhrzeitNach(text: string, pos: number): string | null {
  let rest = text.slice(pos, pos + 140);
  // Das Datum selbst überspringen („05.11.2026“ ist keine Uhrzeit)
  const datum = /^\d{1,2}\.\s*(?:\d{1,2}\.(?:\d{2,4})?|[a-zäöü]+(?:\s+\d{4})?)/i.exec(rest);
  if (datum) rest = rest.slice(datum[0].length);
  const m =
    /(?<![\d.])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/.exec(rest) ??
    /(?<![\d.])([01]?\d|2[0-3])\.([0-5]\d)\s*(?:uhr|h)\b/i.exec(rest) ??
    /\bum\s+([01]?\d|2[0-3])\s*uhr\b/i.exec(rest);
  if (!m) return null;
  return `${pad(Number(m[1]))}:${m[2] && /^\d\d$/.test(m[2]) ? m[2] : "00"}`;
}

/** Termin aus einer Mail – null, wenn es keine (private) Termin-Mail ist. */
export function terminAusMail(m: { from: string; subject: string; body: string }, heute: string): TerminMail | null {
  const text = `${m.subject}\n${m.body}`.slice(0, 6000);
  const dienst: TerminDienst | null = /doctolib/i.test(m.from) || /doctolib/i.test(text) ? "doctolib" : ARZT.test(text) ? "arzt" : SCHULE.test(m.subject) ? "schule" : AMT.test(text) ? "amt" : HANDWERKER.test(text) ? "handwerker" : null;
  if (!dienst || !TERMIN.test(text)) return null;
  const daten = datumsangaben(text, heute);
  if (!daten.length) return null;
  const art: TerminArt = /abgesagt|storniert|absage|cancel|annul|wurde gelöscht|findet nicht statt/i.test(text) ? "abgesagt" : /verschoben|verlegt|neuer termin|termin(e)?änderung|geändert|umgebucht/i.test(text) ? "verschoben" : /erinnerung|reminder|denken sie an|morgen ist ihr/i.test(m.subject) ? "erinnerung" : "bestaetigung";
  // Bei Verschiebung: der letzte genannte Tag ist der neue, der erste der alte.
  const neu = art === "verschoben" ? daten[daten.length - 1] : daten[0];
  const alt = art === "verschoben" && daten.length > 1 ? daten[0].iso : null;
  const bei =
    /\b(Dr\.\s*(?:med\.\s*)?[A-ZÄÖÜ][\wäöüß-]+(?:\s+[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(text)?.[1] ??
    /\b(Praxis\s+[^\n,.]{2,50})/.exec(text)?.[1]?.trim() ??
    /\bbei\s+([A-ZÄÖÜ][^\n,.]{2,50})/.exec(text)?.[1]?.trim() ??
    null;
  const adresse = /\b([A-ZÄÖÜ][\wäöüß.-]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer)\s*\d+[a-z]?(?:,?\s*\d{5}\s+[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(text)?.[1] ?? null;
  const person = /(?:patient(?:in)?|für|name)\s*:\s*([A-ZÄÖÜ][\wäöüß-]+)/i.exec(text)?.[1] ?? /\bfür\s+([A-ZÄÖÜ][\wäöüß-]+)\b(?!\s+(?:die|den|das|Ihre|ihren))/.exec(m.body)?.[1] ?? null;
  const mitbringen = /(?:bitte\s+(?:bringen sie|mitbringen|denken sie an)|mitzubringen(?: sind)?)\s*:?\s*([^\n]{3,200})/i.exec(text)?.[1]?.trim() ?? null;
  return {
    dienst,
    art,
    tag: neu.iso,
    uhrzeit: uhrzeitNach(text, neu.pos),
    alterTag: alt,
    bei,
    adresse,
    person,
    mitbringen,
    mit: dienst === "doctolib" || dienst === "arzt" ? "arzt" : dienst === "schule" ? "familie" : "sonst",
  };
}

const DIENST_TITEL: Record<TerminDienst, string> = { doctolib: "Arzttermin", arzt: "Arzttermin", handwerker: "Handwerker", amt: "Termin beim Amt", schule: "Schule/Kita" };

/** Titel für den Privatkalender: „Arzttermin – Dr. Muster“. */
export const terminTitel = (t: Pick<TerminMail, "dienst" | "bei">) => `${DIENST_TITEL[t.dienst]}${t.bei ? ` – ${t.bei}` : ""}`.slice(0, 120);

/** Abfahrt: Uhrzeit minus Vorlauf in Minuten („09:30“, 30 → „09:00“). */
export function abfahrt(uhrzeit: string, vorherMin: number): string {
  const [h, m] = uhrzeit.split(":").map(Number);
  const t = Math.max(0, h * 60 + m - Math.max(0, Math.round(vorherMin)));
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/**
 * Überschneidung mit einem anderen Termin am selben Tag (innerhalb von 90 Minuten; ohne Uhrzeit: jeder Termin
 * am Tag mit Uhrzeit zählt nicht) – liefert den Titel des ersten Treffers.
 */
export function konfliktMit(andere: { day: string; time?: string; title?: string }[], tag: string, uhrzeit: string | null): string | null {
  if (!uhrzeit) return null;
  const min = (u: string) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3, 5));
  const x = andere.find((e) => e.day === tag && e.time && Math.abs(min(e.time) - min(uhrzeit)) < 90);
  return x ? (x.title || "Termin") : null;
}

/** Passt ein vorhandener Privat-Termin zu dieser Mail? Gleicher Titel-Kern (Praxis/Dienst) und Tag. */
export function passtZu(e: { day: string; title?: string }, t: Pick<TerminMail, "dienst" | "bei">, tag: string): boolean {
  if (e.day !== tag) return false;
  const titel = (e.title ?? "").toLowerCase();
  return t.bei ? titel.includes(t.bei.toLowerCase()) : titel.startsWith(DIENST_TITEL[t.dienst].toLowerCase());
}
