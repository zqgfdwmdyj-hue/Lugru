// American Express: CSV aus dem Amex-Online-Konto lesen (reine Logik). Kopfzeile auswerten statt fester Spalten.
// Amex zeigt Belastungen positiv und Gutschriften/Zahlungen negativ – hier wie beim Bankkonto: Ausgaben negativ.

import { createHash } from "node:crypto";
import { parseAmount } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";

export type AmexUmsatz = { schluessel: string; buchungstag: string; betrag: number; beschreibung: string; referenz: string | null; karteninhaber: string | null; ort: string | null };
export type AmexAuszug = { umsaetze: AmexUmsatz[]; belastungen: number; gutschriften: number; von: string | null; bis: string | null };

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SPALTEN = {
  datum: /^(datum|date|transaktionsdatum|buchungsdatum)$/,
  beschreibung: /^(beschreibung|description|erscheint auf ihrer abrechnung als)$/,
  betrag: /^(betrag|amount|betrag eur)$/,
  referenz: /^(referenz|reference|betreff|referenznummer)$/,
  karteninhaber: /^(karteninhaber|card member|karteninhaber in)$/,
  ort: /^(stadt bundesland|ort|stadt)$/,
};

/** Datum aus dem Amex-Export: TT/MM/JJJJ (deutsch), TT.MM.JJJJ oder JJJJ-MM-TT. */
export function amexDatum(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const j = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]);
  const d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${j}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function leseAmex(bytes: Uint8Array): AmexAuszug {
  const t = readTable(bytes);
  const kopf = t.headers.map(norm);
  const c = Object.fromEntries(Object.entries(SPALTEN).map(([k, re]) => [k, kopf.findIndex((h) => re.test(h))])) as Record<keyof typeof SPALTEN, number>;
  // „Beschreibung“ vor „Erscheint auf … als“ bevorzugen.
  const besch = kopf.findIndex((h) => h === "beschreibung" || h === "description");
  if (besch >= 0) c.beschreibung = besch;
  if (c.datum < 0 || c.betrag < 0) throw new Error("Spalten „Datum“ und „Betrag“ nicht gefunden – bitte den CSV-Export aus dem Amex-Online-Konto verwenden.");
  const zelle = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const gezaehlt = new Map<string, number>();
  const umsaetze: AmexUmsatz[] = [];
  for (const r of t.rows) {
    const tag = amexDatum(zelle(r, c.datum));
    const roh = parseAmount(zelle(r, c.betrag));
    if (!tag || roh === null) continue;
    const betrag = Math.round(-roh * 100) / 100;
    const beschreibung = zelle(r, c.beschreibung).replace(/\s+/g, " ");
    const referenz = zelle(r, c.referenz).replace(/^'+|'+$/g, "") || null;
    const basis = [tag, betrag.toFixed(2), beschreibung, referenz ?? ""].join("|");
    const n = (gezaehlt.get(basis) ?? 0) + 1;
    gezaehlt.set(basis, n);
    umsaetze.push({
      schluessel: createHash("sha256").update(`amex|${basis}|${n}`).digest("hex").slice(0, 40),
      buchungstag: tag,
      betrag,
      beschreibung,
      referenz,
      karteninhaber: zelle(r, c.karteninhaber) || null,
      ort: zelle(r, c.ort) || null,
    });
  }
  const tage = umsaetze.map((u) => u.buchungstag).sort();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    umsaetze,
    belastungen: r2(umsaetze.filter((u) => u.betrag < 0).reduce((s, u) => s - u.betrag, 0)),
    gutschriften: r2(umsaetze.filter((u) => u.betrag > 0).reduce((s, u) => s + u.betrag, 0)),
    von: tage[0] ?? null,
    bis: tage[tage.length - 1] ?? null,
  };
}

/** Zeile auf dem Kartenkonto, die nur den Ausgleich per Lastschrift zeigt (kein Beleg nötig). */
export const istKartenausgleich = (text: string) => /zahlung erhalten|payment received|danke fuer ihre zahlung|vielen dank fuer ihre zahlung|lastschrift(einzug)? erhalten/i.test(text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ü/g, "ue"));
