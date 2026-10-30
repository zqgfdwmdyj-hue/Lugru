// Zentrale Uploads – reine Erkennung: Welche Art Datei ist das? Nach Endung, Inhalt (Kopfzeile, Text) und Name.
// Die Verarbeitung macht derselbe Code wie im jeweiligen Bereich (Service).

import type { AreaKey } from "@/lib/auth/areas";
import { spaltenZuordnung } from "@/lib/bqool/logic";

export type UploadArt =
  | "kontoauszug"
  | "amex"
  | "ust_bericht"
  | "bqool"
  | "amazon_business"
  | "call_archiv"
  | "call"
  | "beleg"
  | "zip"
  | "tabelle";

export const UPLOAD_ART: Record<UploadArt, { text: string; bereich: AreaKey; link: string }> = {
  kontoauszug: { text: "Kontoauszug (Sparkasse)", bereich: "geld", link: "/buchhaltung" },
  amex: { text: "American Express", bereich: "geld", link: "/buchhaltung" },
  ust_bericht: { text: "Amazon-Umsatzsteuerbericht", bereich: "geld", link: "/buchhaltung" },
  bqool: { text: "BQool-Export (Repricer)", bereich: "buchhaltung", link: "/repricer" },
  amazon_business: { text: "Amazon-Business-Bericht", bereich: "amazon", link: "/amazon-business" },
  call_archiv: { text: "Call-Archiv (JSON-Export)", bereich: "amazon", link: "/calls" },
  call: { text: "Call-Transkript", bereich: "amazon", link: "/calls" },
  beleg: { text: "Rechnung/Beleg", bereich: "buchhaltung", link: "/rechnungen" },
  zip: { text: "ZIP-Archiv", bereich: "start", link: "/uploads" },
  tabelle: { text: "Bericht/Tabelle (Amazon, Arbitrage One, Vorlagen)", bereich: "wawi", link: "/import" },
};

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

export const endung = (name: string) => /\.[A-Za-z0-9]{2,5}$/.exec(name)?.[0].toLowerCase() ?? "";
export const istPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
export const istZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const BILD = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"];

/** Tabelle (CSV/XLSX) nach Kopfzeile einordnen. `null` = keine bekannte Sonderart → allgemeiner Import. */
export function tabellenArt(headers: string[], dateiname: string): UploadArt | null {
  const h = headers.map(norm);
  const hat = (...x: string[]) => x.some((k) => h.includes(k));
  const roh = headers.map((x) => x.trim().toUpperCase());
  if (roh.includes("TRANSACTION_TYPE") && (roh.includes("TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL") || roh.includes("PRICE_OF_ITEMS_AMT_VAT_EXCL"))) return "ust_bericht";
  if (hat("buchungstag", "buchungsdatum") && hat("betrag", "umsatz", "betrag eur") && hat("auftragskonto", "verwendungszweck", "beguenstigter zahlungspflichtiger", "name zahlungsbeteiligter", "buchungstext", "iban auftragskonto")) return "kontoauszug";
  if (hat("datum", "date") && hat("beschreibung", "description") && hat("betrag", "amount") && (hat("karteninhaber", "konto #", "card member", "erscheint auf ihrer abrechnung als") || /amex|american.?express/i.test(dateiname) || h.length <= 4)) return "amex";
  const bq = spaltenZuordnung(headers);
  if (bq.sku !== undefined && bq.min !== undefined && bq.max !== undefined && [bq.regel, bq.status, bq.bbPreis, bq.bbGewinner, bq.angebote, bq.markt].some((x) => x !== undefined)) return "bqool";
  if (h.some((x) => x.includes("b2b")) && hat("untergeordnete asin", "child asin", "asin untergeordnet", "asin")) return "amazon_business";
  return null;
}

/** JSON: Call-Archiv-Export (Liste von Calls mit Zusammenfassung/Transkript). */
export function jsonArt(daten: unknown): UploadArt | null {
  const liste = Array.isArray(daten) ? daten : daten && typeof daten === "object" && Array.isArray((daten as { calls?: unknown }).calls) ? (daten as { calls: unknown[] }).calls : daten && typeof daten === "object" ? [daten] : [];
  const callig = (x: unknown) => !!x && typeof x === "object" && ["transcript", "transkript", "summary", "zusammenfassung", "sourceDocId", "participants", "teilnehmer"].some((k) => k in (x as object));
  return liste.length && liste.slice(0, 5).some(callig) ? "call_archiv" : null;
}

/** Text eines PDFs grob einordnen: Kontoauszug, Call-Transkript oder Beleg (Standard). */
export function pdfArt(text: string): UploadArt {
  const t = text.slice(0, 20_000);
  const buchungen = (t.match(/^\d{2}\.\d{2}\.(\d{2,4})?\s.*\d,\d{2}\s*[-+SH]?$/gm) ?? []).length;
  if (/(kontoauszug|kontostand am|alter kontostand|neuer kontostand)/i.test(t) && buchungen >= 1) return "kontoauszug";
  const sprecher = (t.match(/^(\[?\d{1,2}:\d{2}(:\d{2})?\]?\s+)?[A-ZÄÖÜ][\wäöüß.-]+(\s[A-ZÄÖÜ][\wäöüß.-]+)?:\s/gm) ?? []).length;
  if (sprecher >= 15 && !/(rechnung|invoice|ust-?id|mwst|umsatzsteuer)/i.test(t)) return "call";
  return "beleg";
}

/** Grobe Einordnung ohne Inhalt (für Endungen, die eindeutig sind). */
export function artNachEndung(name: string): UploadArt | null {
  const e = endung(name);
  if (BILD.includes(e)) return "beleg";
  if ([".vtt", ".srt", ".docx", ".odt"].includes(e)) return "call";
  if (e === ".xml") return "kontoauszug";
  return null;
}
