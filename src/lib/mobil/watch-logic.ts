// Apple Watch (Bauauftrag Handy-Tesla §10): reine Logik für die Kurzantworten – höchstens 3 Zeilen und 160 Zeichen,
// keine Tabellen, keine Links; je Antwort „zeige“ (Display) und „sprich“ (Siri liest vor). Sprachbefehle lesen
// („Notiz VA …“, „Tefal 12 Stück“, „B0… für 19,99“, „Nummer 2“). Ohne Datenbank, damit testbar.

export const WATCH_MAX_ZEILEN = 3;
export const WATCH_MAX_ZEICHEN = 160;
export const PUSH_MAX_ZEICHEN = 120;
/** Daten älter als 30 Minuten bekommen „Stand HH:MM“. */
export const STAND_ALT_MS = 30 * 60_000;

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export const monatsname = (iso: string) => MONATE[Number(iso.slice(5, 7)) - 1] ?? "Monat";

/** Uhrzeit in Berlin („15:12“). */
export const uhrzeitBerlin = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** Ganze Euro: 2680 → „2.680 €“. */
export const euroVoll = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

/** Kurz in Tausend: 100.400 → „100 k€“, 4.512 → „4,5 k€“, 850 → „850 €“. */
export function euroK(n: number): string {
  const a = Math.abs(n);
  if (a < 1000) return euroVoll(n);
  const k = n / 1000;
  return `${(a >= 10_000 ? Math.round(k) : Math.round(k * 10) / 10).toLocaleString("de-DE")} k€`;
}

/** Text ohne Links, Tabellenzeichen und Markdown – eine Zeile. */
export function watchZeile(t: string): string {
  return t
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(^|\s)\/[a-z][a-z0-9-]*(\/\S*)?/gi, "$1")
    .replace(/[|*_`#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Auf n Zeichen kürzen, an einer Wortgrenze, mit „…“. */
export function kuerzenAuf(t: string, n: number): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const schnitt = s.slice(0, n - 1);
  const wort = schnitt.lastIndexOf(" ");
  return `${(wort > n * 0.6 ? schnitt.slice(0, wort) : schnitt).replace(/[\s·,:;–-]+$/, "")}…`;
}

/** Zum Vorlesen: Zeichen und Abkürzungen, die Siri sonst falsch liest. */
export function sprechbar(t: string): string {
  return t
    .replace(/(\d+(?:,\d+)?)\s*k€/g, "$1 tausend Euro")
    .replace(/€\/Stk/g, "Euro pro Stück")
    .replace(/€/g, "Euro")
    .replace(/\s*%/g, " Prozent")
    .replace(/\bStk\b\.?/g, "Stück")
    .replace(/\bROI\b/g, "R O I")
    .replace(/\bVA\b/g, "V A")
    .replace(/[🟢🟡🔴⚪❗✅⚠️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type WatchAntwort = { zeige: string; sprich: string; zeilen: string[]; stand: string | null };

/**
 * Antwort für die Watch: höchstens 3 Zeilen und 160 Zeichen (gekürzt von hinten), ohne Links/Tabellen.
 * Sind die Daten älter als 30 Minuten, steht „Stand HH:MM“ vorne in der ersten Zeile.
 */
export function watchAntwort(zeilenIn: (string | null | undefined | false)[], o: { stand?: Date | null; jetzt?: Date } = {}): WatchAntwort {
  const jetzt = o.jetzt ?? new Date();
  const alt = o.stand && jetzt.getTime() - o.stand.getTime() > STAND_ALT_MS ? `Stand ${uhrzeitBerlin(o.stand)}` : null;
  let zeilen = zeilenIn.filter((z): z is string => typeof z === "string" && z.trim().length > 0).map(watchZeile).filter(Boolean).slice(0, WATCH_MAX_ZEILEN);
  if (!zeilen.length) zeilen = ["Keine Daten."];
  if (alt) zeilen[0] = `${alt}: ${zeilen[0]}`;
  // Zu lang: hintere Zeilen kürzen bzw. weglassen, bis alles in 160 Zeichen passt (Zeilenumbrüche zählen mit).
  const laenge = (z: string[]) => z.join("\n").length;
  while (laenge(zeilen) > WATCH_MAX_ZEICHEN) {
    const rest = WATCH_MAX_ZEICHEN - laenge(zeilen.slice(0, -1)) - (zeilen.length > 1 ? 1 : 0);
    if (rest >= 12) zeilen[zeilen.length - 1] = kuerzenAuf(zeilen[zeilen.length - 1], rest);
    else if (zeilen.length > 1) zeilen = zeilen.slice(0, -1);
    else zeilen[0] = kuerzenAuf(zeilen[0], WATCH_MAX_ZEICHEN);
  }
  const zeige = zeilen.join("\n");
  return { zeige, sprich: sprechbar(zeilen.join(" ")), zeilen, stand: alt };
}

/** Push für Watch/Sperrbildschirm: Titel höchstens 60, Text höchstens 120 Zeichen (Zeilen mit „ · “ verbunden). */
export function pushKurz(m: { titel: string; text: string }): { titel: string; text: string } {
  const text = m.text
    .split("\n")
    .map((z) => z.trim())
    .filter(Boolean)
    .join(" · ");
  return { titel: kuerzenAuf(m.titel, 60), text: kuerzenAuf(text, PUSH_MAX_ZEICHEN) };
}

// ---- Stand ------------------------------------------------------------------------------------------------

export type StandDaten = {
  heute: string;
  umsatzHeute: number | null;
  umsatzMonat: number | null;
  gewinnMonat: number | null;
  roteFaelle: number;
  termin: { tag: "heute" | "morgen"; von: string; titel: string } | null;
};

/** „Heute 2.680 €, Oktober 100 k€, Gewinn 4,5 k€. / 2 rote Fälle. / 15:00 Termin außer Haus.“ */
export function standZeilen(d: StandDaten): string[] {
  const geld = [
    d.umsatzHeute !== null ? `Heute ${euroVoll(d.umsatzHeute)}` : "Heute keine Umsatzdaten",
    d.umsatzMonat !== null ? `${monatsname(d.heute)} ${euroK(d.umsatzMonat)}` : null,
    d.gewinnMonat !== null ? `Gewinn ${euroK(d.gewinnMonat)}` : null,
  ].filter(Boolean);
  const faelle = d.roteFaelle === 0 ? "Keine roten Fälle." : `${d.roteFaelle} ${d.roteFaelle === 1 ? "roter Fall" : "rote Fälle"}.`;
  const termin = d.termin ? `${d.termin.tag === "morgen" ? "Morgen " : ""}${d.termin.von} ${d.termin.titel}.` : "Kein Termin mehr heute.";
  return [`${geld.join(", ")}.`, faelle, termin];
}

// ---- Dringend ---------------------------------------------------------------------------------------------

/** Frist kurz: „überfällig“, „heute“, „morgen“, „Mi“, „05.11.“. */
export function fristKurz(iso: string | null, heute: string): string {
  if (!iso) return "ohne Frist";
  const d = iso.slice(0, 10);
  if (d < heute) return "überfällig";
  if (d === heute) return "heute";
  const diff = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 86_400_000);
  if (diff === 1) return "morgen";
  if (diff < 7) return `bis ${new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)).replace(".", "")}`;
  return `bis ${d.slice(8, 10)}.${d.slice(5, 7)}.`;
}

export type DringendPunkt = { text: string; frist: string };

/** Je Punkt eine Zeile „Text – Frist“; der Text wird gekürzt, damit drei Zeilen in 160 Zeichen passen. */
export function dringendZeilen(punkte: DringendPunkt[]): string[] {
  if (!punkte.length) return ["Nichts Dringendes."];
  const top = punkte.slice(0, 3);
  const jeZeile = Math.floor((WATCH_MAX_ZEICHEN - (top.length - 1)) / top.length);
  return top.map((p) => {
    const ende = ` – ${p.frist}`;
    return `${kuerzenAuf(p.text, Math.max(12, jeZeile - ende.length))}${ende}`;
  });
}

// ---- Sprachbefehle ----------------------------------------------------------------------------------------

/** „Nummer 2“, „2“, „die zweite“, „zwei“ → 2 (1–9). */
export function auswahlNummer(text: string): number | null {
  const t = text.toLowerCase().replace(/[.!?,]/g, " ").trim();
  const z = /^(?:nummer|nr|die|den|das)?\s*(\d)\s*$/.exec(t) ?? /^(?:erledigt|bestand|kaufen)?\s*(?:nummer|nr)\s*(\d)\b/.exec(t);
  if (z) return Number(z[1]) || null;
  const WORT: Record<string, number> = { eins: 1, erste: 1, ersten: 1, erster: 1, zwei: 2, zweite: 2, zweiten: 2, drei: 3, dritte: 3, dritten: 3 };
  const w = /^(?:nummer\s+|die\s+|den\s+|das\s+)?(eins|erste[nr]?|zwei(?:te[n]?)?|drei|dritte[n]?)$/.exec(t);
  return w ? (WORT[w[1]] ?? null) : null;
}

export type NotizArt = "va" | "privat" | "aufgabe";

/** „Notiz VA bitte Rechnung Tefal prüfen“ → VA; „privat Blumen kaufen“ → privat; sonst Aufgabe. */
export function notizLesen(textIn: string): { art: NotizArt; text: string } {
  let t = textIn.replace(/\s+/g, " ").trim();
  t = t.replace(/^(hey siri[,]?\s*)?(notiz|notier|merke?)\s*[:,]?\s*/i, "");
  const va = /^(?:an\s+(?:die|den)\s+)?(?:va|v\.\s?a\.|assistenz)\b\s*[:,]?\s*/i.exec(t);
  if (va) return { art: "va", text: t.slice(va[0].length).trim() };
  const pr = /^privat\b\s*[:,]?\s*/i.exec(t);
  if (pr) return { art: "privat", text: t.slice(pr[0].length).trim() };
  return { art: "aufgabe", text: t };
}

/** Preis aus Diktat: „19,99“, „19.99 €“, „19 Euro 99“, „für 12“. */
export function preisAus(text: string): number | null {
  const euroCent = /(\d{1,5})\s*(?:euro|eur|€)\s*(\d{1,2})\b/i.exec(text);
  if (euroCent) return Number(euroCent[1]) + Number(euroCent[2].padEnd(2, "0")) / 100;
  const alle = [...text.matchAll(/(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?/gi)].map((m) => m[1]);
  const p = alle.at(-1);
  if (!p) return null;
  const n = Number(p.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** „Deal prüfen B0ABC12345 19,99“ / „4006381333931 für 12,50“ / „Tefal Pfanne 24,90“. */
export function dealLesen(textIn: string): { code: string | null; name: string | null; preis: number | null } {
  const t = textIn.replace(/^\s*(deal\s+pr[üu]fen|deal|pr[üu]fe?)\s*[:,]?\s*/i, "").trim();
  const asin = /\b(B0[A-Z0-9]{8})\b/i.exec(t)?.[1]?.toUpperCase() ?? null;
  const ean = asin ? null : (/\b(\d{8}|\d{12,14})\b/.exec(t.replace(/(\d)\s+(?=\d{3,}\b)/g, "$1"))?.[1] ?? null);
  const ohneCode = (asin ? t.replace(new RegExp(asin, "i"), " ") : ean ? t.replace(/\d[\d\s]{7,}\d/, " ") : t).trim();
  const preis = preisAus(ohneCode);
  const name = asin || ean ? null : ohneCode.replace(/(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?(\s*\d{1,2})?\s*$/i, "").replace(/\b(für|zu|um|preis|ek)\s*$/i, "").trim() || null;
  return { code: asin ?? ean, name, preis };
}

/** „Bestand Tefal 12 Stück“ → { suche: "Tefal", menge: 12 }. Ohne Menge: nur nachsehen. */
export function bestandLesen(textIn: string): { suche: string; menge: number | null } {
  const t = textIn.replace(/^\s*(bestand|lager|z[äa]hl(e|ung)?)\s*[:,]?\s*/i, "").trim();
  const m = /(?:^|\s)(?:auf\s+)?(\d{1,6})\s*(?:stück|stk\.?|x|mal)?\s*$/i.exec(t);
  const menge = m ? Number(m[1]) : null;
  const suche = (m ? t.slice(0, m.index) : t).replace(/\b(auf|ist|sind|hat|haben|setzen|zählen)\s*$/i, "").trim();
  return { suche, menge };
}

/** Deal-Ampel in einer Zeile: „Grün, ROI 28 %, 14,96 €/Stk, Empfehlung 3 Stück.“ */
export function dealZeile(r: { ampel: string; roi: number | null; gewinn: number | null; menge: number | null; grund?: string | null; land?: string | null }): string {
  const AMPEL: Record<string, string> = { gruen: "Grün", gelb: "Gelb", rot: "Rot" };
  const teile = [AMPEL[r.ampel] ?? r.ampel];
  if (r.land && r.land !== "DE") teile.push(r.land);
  if (r.roi !== null) teile.push(`ROI ${Math.round(r.roi)} %`);
  if (r.gewinn !== null) teile.push(`${r.gewinn.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/Stk`);
  if (r.ampel === "rot" && r.grund) teile.push(r.grund.replace(/[.]$/, ""));
  else if (r.menge) teile.push(`Empfehlung ${r.menge} Stück`);
  return `${teile.join(", ")}.`;
}

// ---- Ein Kurzbefehl für alles („Hey Siri, Seller“ → diktieren → watch/frage) ---------------------------------

export type WatchBefehl = "stand" | "dringend" | "tesla" | "deal" | "erledigt" | "notiz" | "bestand" | "kaufen" | "nummer";
/** Befehle, die etwas ändern – nur per POST und nicht mit Nur-ansehen-Konten. */
export const WATCH_AENDERND: readonly WatchBefehl[] = ["erledigt", "notiz", "bestand", "kaufen", "nummer"];
export const WATCH_HILFE = "Sag z. B.: Wie läuft's? · Was ist dringend? · Erledigt · Notiz … · Bestand Tefal 12 Stück · Deal B0… für 19,99 · Tesla · Kaufen 17";

/**
 * Freies Diktat einem Watch-Befehl zuordnen. Reihenfolge: Rückfrage-Nummer, ändernde Befehle mit klarem Anfang,
 * dann Bestand/Deal (Zahlen), Tesla, Dringend, Stand. Unklar → null (dann Hilfe-Antwort).
 */
export function watchBefehl(textIn: string): { befehl: WatchBefehl | null; text: string } {
  const t = (textIn ?? "").replace(/\s+/g, " ").trim().replace(/^hey siri[,]?\s*/i, "").replace(/^(seller|lugru)\b\s*[,:]?\s*/i, "").replace(/[?!.]+$/, "").trim();
  const l = t.toLowerCase();
  if (!l) return { befehl: null, text: t };
  if (auswahlNummer(l) !== null) return { befehl: "nummer", text: t };
  if (/^(erledigt|fertig|abgehakt|abhaken|done)\b/.test(l)) return { befehl: "erledigt", text: t };
  if (/^(notiz|notier|merke?|merk dir|va\b|v\.\s?a\.|an die va|assistenz|privat\b)/.test(l)) return { befehl: "notiz", text: t };
  if (/^kauf(en)?\b/.test(l)) return { befehl: "kaufen", text: t };
  if (/^(bestand|lager|z[äa]hl)/.test(l) || /\b\d{1,6}\s*(stück|stk\.?)\s*$/.test(l)) return { befehl: "bestand", text: t };
  if (/^(deal|pr[üu]f)/.test(l) || /\bB0[A-Z0-9]{8}\b/i.test(t) || /\b\d{12,14}\b/.test(t)) return { befehl: "deal", text: t };
  if (/\b(tesla|auto|akku|ladestand|reichweite|klima)\b/.test(l)) return { befehl: "tesla", text: t };
  if (/(dringend|was (steht|liegt)( heute| noch)? an|was ist (heute )?(los|zu tun|wichtig)|aufgaben|to-?dos?)/.test(l)) return { befehl: "dringend", text: t };
  if (/(wie l[äa]uft|wie lauft|stand|umsatz|gewinn|zahlen|[üu]berblick|bilanz)/.test(l)) return { befehl: "stand", text: t };
  return { befehl: null, text: t };
}
