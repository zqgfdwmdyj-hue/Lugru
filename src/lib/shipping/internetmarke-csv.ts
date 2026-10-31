// Adressdatei für den Internetmarke-Shop der Deutschen Post (Porto mit Anschrift ohne Schnittstelle):
// Vorgaben laut „Vorgaben für die CSV-Musterdatei“ der Post – Zeichensatz CP1252, Trenner Semikolon, feste
// Kopfzeile, erste Zeile unter der Kopfzeile = Absender, LAND als ISO-3, höchstens 999 Adressen je Warenkorb.
// Das Produkt (z. B. Warensendung) wird im Shop gewählt, nicht in der Datei. Reine Logik, testbar.

import type { Address } from "@/db/tables/core";
import { splitStreet, toIso3 } from "./countries";

export const IM_CSV_HEADER = ["NAME", "ZUSATZ", "STRASSE", "NUMMER", "PLZ", "STADT", "LAND", "ADRESS_TYP"] as const;
export const IM_CSV_MAX = 999;

/** Feld bereinigen: keine Semikolons, keine Zeilenumbrüche, gekürzt auf die erlaubte Länge. */
const field = (v: string | undefined | null, max: number) => (v ?? "").replace(/[\r\n;]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Eine Adresse als CSV-Zeile: Haus-, Packstations- oder Postfachadresse. */
export function imCsvRow(a: Address): string[] {
  const country = toIso3(a.country);
  const domestic = country === "DEU";
  const zip = field(a.zip, domestic ? 5 : 10);
  const city = field(a.city, 50);
  const name = field(a.name1, 140);
  const street = (a.street ?? "").trim();
  // Packstation: Postnummer als Zusatz, Packstations-Nummer als Nummer, Straße leer.
  const packstation = /^packstation\b/i.exec(street);
  if (packstation) {
    const no = (a.houseNo || street.match(/\d+/)?.[0] || "").replace(/\D/g, "").slice(0, 4);
    return [name, field((a.name2 ?? "").replace(/\D/g, ""), 20), "", no, zip, city, country, "PACKSTATION"];
  }
  const pobox = /^postfach\b/i.exec(street);
  if (pobox) {
    const no = (a.houseNo || street.match(/\d+/)?.[0] || "").replace(/\D/g, "").slice(0, 10);
    return [name, field(a.name2, 50), "", no, zip, city, country, "POBOX"];
  }
  // Hausnummer fehlt im Feld, steht aber in der Straße („Hauptstr. 5“) → trennen.
  const split = a.houseNo ? { street, houseNo: a.houseNo } : splitStreet(street);
  return [name, field(a.name2, 50), field(split.street, 35), field(split.houseNo.replace(/\s+/g, ""), 7), zip, city, country, "HOUSE"];
}

/** Was in der Datei fehlen würde – vor dem Erstellen zeigen statt eine abgewiesene Datei zu liefern. */
export function imCsvProblem(a: Address): string | null {
  if (!a.name1?.trim()) return "Name fehlt";
  if (!a.zip?.trim() || !a.city?.trim()) return "PLZ/Ort fehlt";
  const row = imCsvRow(a);
  if (row[7] === "HOUSE" && (!row[2] || !row[3])) return "Straße oder Hausnummer fehlt";
  if (row[7] === "PACKSTATION" && (!row[1] || row[3].length < 3)) return "Postnummer oder Packstations-Nummer fehlt";
  if (row[6] === "DEU" && !/^\d{5}$/.test(row[4])) return "PLZ muss fünfstellig sein";
  return null;
}

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Buchstaben ohne zerlegbaren Akzent (polnisch, kroatisch, türkisch). */
const TRANSLIT: Record<string, string> = { ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i", ħ: "h", ŧ: "t" };

/** Text → CP1252-Bytes; Zeichen außerhalb (z. B. „ł“) ohne Akzent bzw. als „?“. */
export function toCp1252(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252[c] !== undefined) out.push(CP1252[c]);
    else {
      const base = (TRANSLIT[ch] ?? ch).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const b = base.codePointAt(0) ?? 0x3f;
      out.push(base.length === 1 && (b < 0x80 || (b >= 0xa0 && b <= 0xff)) ? b : 0x3f);
    }
  }
  return Buffer.from(out);
}

/** Komplette Datei: Kopfzeile, Absender, Empfänger (Reihenfolge wie übergeben), CRLF, CP1252. */
export function internetmarkeCsv(sender: Address, recipients: Address[]): Buffer {
  if (recipients.length > IM_CSV_MAX - 1) throw new Error(`Höchstens ${IM_CSV_MAX - 1} Empfänger je Datei.`);
  const lines = [IM_CSV_HEADER.join(";"), imCsvRow(sender).join(";"), ...recipients.map((r) => imCsvRow(r).join(";"))];
  return toCp1252(`${lines.join("\r\n")}\r\n`);
}
