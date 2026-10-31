// Kontoauszug als PDF (Sparkasse u. a.) – reine Logik auf dem Text des PDFs. Eine Buchung beginnt mit
// „TT.MM.(JJJJ)“ (Buchungstag, optional Wert), der Betrag steht am Zeilenende (−/+ vorne oder hinten, S/H);
// die Folgezeilen sind Name und Verwendungszweck. Alter/neuer Kontostand für die Saldo-Kontrolle.

import { createHash } from "node:crypto";
import type { Auszug, Umsatz } from "./logic";

const BETRAG = String.raw`([+-]?\s?\d{1,3}(?:\.\d{3})*,\d{2}|[+-]?\s?\d+,\d{2})\s*([+-]|S|H)?`;
const START = new RegExp(String.raw`^(\d{2}\.\d{2}\.(?:\d{2,4})?)\s+(?:(\d{2}\.\d{2}\.(?:\d{2,4})?)\s+)?(.*?)(?:\s+${BETRAG})?\s*$`);
const NUR_BETRAG = new RegExp(String.raw`^(.*?)\s*${BETRAG}\s*$`);
const SALDO = new RegExp(String.raw`(alter kontostand|neuer kontostand|kontostand am\s+(\d{2}\.\d{2}\.\d{4})|anfangssaldo|endsaldo|saldo alt|saldo neu)[^\n]*?${BETRAG}\s*$`, "i");
/** Kopf-/Fußzeilen, die nie zum Verwendungszweck gehören. */
const RAUSCHEN = /^(seite \d|kontoauszug|buchungstag|datum\s+(wert|erläuterung)|erläuterung|betrag|iban|bic|sparkasse\b.*\b(blz|bic)\b|übertrag|zwischensumme|bitte beachten|rechnungsabschluss|wir bitten|seite\s*\d+\s*(von|\/)\s*\d+)/i;

const zahl = (s: string, vz?: string): number => {
  const roh = s.replace(/\s/g, "");
  const n = Number(roh.replace(/[+-]/g, "").replace(/\./g, "").replace(",", "."));
  const neg = roh.startsWith("-") || vz === "-" || vz === "S";
  return Math.round((neg ? -n : n) * 100) / 100;
};
const unsigniert = (s: string, vz?: string) => !/[+-]/.test(s) && !vz;

/** Jahr aus „Kontoauszug 10/2026“, „Kontostand am 30.09.2026“ o. Ä. */
function jahrAus(text: string): number | null {
  const m = /kontoauszug\s*(?:nr\.?\s*)?\d{1,2}\s*\/\s*(\d{4})/i.exec(text) ?? /\b\d{2}\.\d{2}\.(20\d{2})\b/.exec(text);
  return m ? Number(m[1]) : null;
}
function iso(tt: string, jahr: number | null): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{2,4})?$/.exec(tt);
  if (!m) return null;
  const j = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : jahr;
  if (!j) return null;
  return `${j}-${m[2]}-${m[1]}`;
}
/** Vorzeichen aus der Buchungsart, wenn der Betrag keins trägt. */
function vorzeichenAus(art: string): -1 | 1 | 0 {
  if (/gutschrift|eingang|zahlungseingang|überweisung von|einzahlung|zinsgutschrift|habenzins|rückbuchung|rücklastschrift erhalten/i.test(art)) return 1;
  if (/lastschrift|überweisung|dauerauftrag|kartenzahlung|kartenumsatz|entgelt|abschluss|auszahlung|geldautomat|bargeld|sepa-basis|folgelastschrift|erstlastschrift/i.test(art)) return -1;
  return 0;
}

export type PdfAuszug = Auszug & { anfang: { datum: string | null; saldo: number } | null; ende: { datum: string | null; saldo: number } | null; kontrolle: { summe: number; differenz: number | null }; unsicher: number };

export function leseKontoauszugPdfText(text: string): PdfAuszug {
  const jahr = jahrAus(text);
  const zeilen = text.split(/\r?\n/).map((z) => z.replace(/\s+/g, " ").trim()).filter(Boolean);
  const iban = /\bIBAN:?\s*(DE\d{2}(?:\s?\d{4}){4}\s?\d{2})/i.exec(text)?.[1]?.replace(/\s/g, "") ?? null;
  type Roh = { tag: string; valuta: string | null; art: string; betrag: number | null; unsigniert: boolean; folgen: string[] };
  const roh: Roh[] = [];
  const salden: { datum: string | null; saldo: number; art: "anfang" | "ende" }[] = [];
  let akt: Roh | null = null;
  for (const z of zeilen) {
    const s = SALDO.exec(z);
    if (s) {
      const datum = s[2] ? iso(s[2], jahr) : null;
      const art = /alt|anfang/i.test(s[1]) ? "anfang" : /neu|end/i.test(s[1]) ? "ende" : salden.length ? "ende" : "anfang";
      salden.push({ datum, saldo: zahl(s[3], s[4]), art });
      akt = null;
      continue;
    }
    const st = START.exec(z);
    if (st && iso(st[1], jahr)) {
      akt = { tag: iso(st[1], jahr)!, valuta: st[2] ? iso(st[2], jahr) : null, art: st[3] ?? "", betrag: st[4] ? zahl(st[4], st[5]) : null, unsigniert: st[4] ? unsigniert(st[4], st[5]) : false, folgen: [] };
      roh.push(akt);
      continue;
    }
    if (!akt || RAUSCHEN.test(z)) continue;
    if (akt.betrag === null) {
      const b = NUR_BETRAG.exec(z);
      if (b && b[2]) {
        if (b[1]) akt.folgen.push(b[1]);
        akt.betrag = zahl(b[2], b[3]);
        akt.unsigniert = unsigniert(b[2], b[3]);
        continue;
      }
    }
    if (akt.folgen.length < 8) akt.folgen.push(z);
  }
  let unsicher = 0;
  const umsaetze: Umsatz[] = [];
  const gezaehlt = new Map<string, number>();
  for (const r of roh) {
    if (r.betrag === null) continue;
    let betrag = r.betrag;
    if (r.unsigniert) {
      const v = vorzeichenAus(r.art);
      if (v === 0) unsicher++;
      betrag = v === -1 ? -Math.abs(betrag) : Math.abs(betrag);
    }
    const gegenpartei = r.folgen[0] ?? "";
    const zweck = r.folgen.slice(1).join(" ").slice(0, 1000);
    const basis = [iban ?? "", r.tag, betrag.toFixed(2), r.art, gegenpartei, zweck].join("|");
    const n = (gezaehlt.get(basis) ?? 0) + 1;
    gezaehlt.set(basis, n);
    umsaetze.push({
      schluessel: createHash("sha256").update(`pdf|${basis}|${n}`).digest("hex").slice(0, 40),
      konto: iban,
      buchungstag: r.tag,
      valuta: r.valuta,
      betrag,
      waehrung: "EUR",
      gegenpartei,
      iban: /\bDE\d{20}\b/.exec(zweck.replace(/\s/g, ""))?.[0] ?? null,
      zweck,
      buchungstext: r.art || null,
      glaeubigerId: /\b(DE\d{2}ZZZ\d{8,11})\b/.exec(zweck)?.[1] ?? null,
      mandat: /mandat(?:sref(?:erenz)?)?[:.\s]+([A-Za-z0-9-]{3,35})/i.exec(zweck)?.[1] ?? null,
      saldoDanach: null,
    });
  }
  const anfang = salden.find((s) => s.art === "anfang") ?? null;
  const ende = [...salden].reverse().find((s) => s.art === "ende") ?? null;
  const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
  const diff = () => (anfang && ende ? r2(ende.saldo - anfang.saldo - umsaetze.reduce((n, u) => n + u.betrag, 0)) : null);
  // Unsichere Vorzeichen: wenn genau das Umdrehen einer Buchung die Saldo-Kontrolle aufgehen lässt, so übernehmen.
  const d0 = diff();
  if (d0 !== null && Math.abs(d0) >= 0.01 && unsicher > 0) {
    const kandidat = umsaetze.find((u, i) => roh.filter((r) => r.betrag !== null)[i]?.unsigniert && vorzeichenAus(roh.filter((r) => r.betrag !== null)[i].art) === 0 && Math.abs(r2(d0 + 2 * u.betrag)) < 0.01);
    if (kandidat) {
      kandidat.betrag = -kandidat.betrag;
      unsicher--;
    }
  }
  const summe = r2(umsaetze.reduce((n, u) => n + u.betrag, 0));
  const differenz = diff();
  const tage = umsaetze.map((u) => u.buchungstag).sort();
  const endeDatum = ende?.datum ?? tage[tage.length - 1] ?? null;
  return {
    format: "pdf",
    konto: iban,
    umsaetze,
    // Für den Kontostand: Endsaldo am letzten Tag (nur wenn die Kontrolle aufgeht).
    salden: ende && endeDatum && (differenz === null || Math.abs(differenz) < 0.01) ? [{ datum: endeDatum, saldo: ende.saldo }] : [],
    anfang: anfang ? { datum: anfang.datum, saldo: anfang.saldo } : null,
    ende: ende ? { datum: endeDatum, saldo: ende.saldo } : null,
    kontrolle: { summe, differenz },
    unsicher,
  };
}
