// DATEV-Export (Buchungsstapel, Format EXTF 700, Kategorie 21) – reine Logik. Kodierung Windows-1252,
// Trennzeichen Semikolon, Texte in Anführungszeichen. Konto = Sachkonto, Gegenkonto = Geldkonto; S/H bezieht
// sich auf das Konto. Belegdatum TTMM (Jahr aus dem Kopf). Testlauf in einem DATEV-Testmandanten empfohlen.

export type DatevKopf = { beraternummer: string; mandantennummer: string; wjBeginn: string; von: string; bis: string; bezeichnung: string; kontenrahmen: "SKR04" | "SKR03"; festschreibung: boolean; erzeugt?: Date };
export type DatevZeile = { betrag: number; sollHaben: "S" | "H"; konto: string; gegenkonto: string; bu: string | null; datum: string; belegfeld1: string; belegfeld2?: string; text: string; leistungsdatum?: string | null };

/** Spaltenköpfe Buchungsstapel (Formatversion 13, die ersten 116 Felder). */
export const DATEV_SPALTEN = [
  "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum",
  "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext", "Postensperre", "Diverse Adressnummer", "Geschäftspartnerbank", "Sachverhalt", "Zinssperre", "Beleglink",
  ...Array.from({ length: 8 }, (_, i) => [`Beleginfo - Art ${i + 1}`, `Beleginfo - Inhalt ${i + 1}`]).flat(),
  "KOST1 - Kostenstelle", "KOST2 - Kostenstelle", "Kost-Menge", "EU-Land u. UStID (Bestimmung)", "EU-Steuersatz (Bestimmung)", "Abw. Versteuerungsart", "Sachverhalt L+L", "Funktionsergänzung L+L", "BU 49 Hauptfunktionstyp", "BU 49 Hauptfunktionsnummer", "BU 49 Funktionsergänzung",
  ...Array.from({ length: 20 }, (_, i) => [`Zusatzinformation - Art ${i + 1}`, `Zusatzinformation- Inhalt ${i + 1}`]).flat(),
  "Stück", "Gewicht", "Zahlweise", "Forderungsart", "Veranlagungsjahr", "Zugeordnete Fälligkeit", "Skontotyp", "Auftragsnummer", "Buchungstyp", "USt-Schlüssel (Anzahlungen)",
  "EU-Mitgliedstaat (Anzahlungen)", "Sachverhalt L+L (Anzahlungen)", "EU-Steuersatz (Anzahlungen)", "Erlöskonto (Anzahlungen)", "Herkunft-Kz", "Buchungs GUID", "KOST-Datum", "SEPA-Mandatsreferenz", "Skontosperre", "Gesellschaftername",
  "Beteiligtennummer", "Identifikationsnummer", "Zeichnernummer", "Postensperre bis", "Bezeichnung SoBil-Sachverhalt", "Kennzeichen SoBil-Buchung", "Festschreibung", "Leistungsdatum", "Datum Zuord. Steuerperiode",
];

const ymd = (iso: string) => iso.replace(/-/g, "");
const ttmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const ttmmjjjj = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const zahl = (n: number) => n.toFixed(2).replace(".", ",");
/** Unzulässige Zeichen (Zeilenumbruch, Semikolon in Belegfeldern) entfernen; Länge begrenzen. */
const sauber = (s: string, max: number) => s.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
/** Belegfeld 1: nur Buchstaben, Ziffern und $ & % * + - / (DATEV-Regel), max. 36 Zeichen. */
export const belegfeld = (s: string) => s.replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36);

function zeitstempel(d: Date) {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
}

export function datevKopfzeile(k: DatevKopf): string {
  const f = [
    q("EXTF"), "700", "21", q("Buchungsstapel"), "13", zeitstempel(k.erzeugt ?? new Date()), "", q("RE"), q(""), q(""),
    k.beraternummer || "", k.mandantennummer || "", ymd(k.wjBeginn), "4", ymd(k.von), ymd(k.bis), q(sauber(k.bezeichnung, 30)), q(""), "1", "0",
    k.festschreibung ? "1" : "0", q("EUR"), "", q(""), "", "", q(k.kontenrahmen === "SKR04" ? "04" : "03"), "", "", q(""), q(""),
  ];
  return f.join(";");
}

export function datevZeile(z: DatevZeile): string {
  const felder = new Array<string>(DATEV_SPALTEN.length).fill("");
  felder[0] = zahl(Math.abs(z.betrag));
  felder[1] = q(z.sollHaben);
  felder[2] = q("EUR");
  felder[6] = z.konto;
  felder[7] = z.gegenkonto;
  felder[8] = z.bu ? q(z.bu) : "";
  felder[9] = ttmm(z.datum);
  felder[10] = q(belegfeld(z.belegfeld1));
  felder[11] = z.belegfeld2 ? q(belegfeld(z.belegfeld2).slice(0, 12)) : "";
  felder[13] = q(sauber(z.text, 60));
  felder[113] = "";
  if (z.leistungsdatum) felder[114] = ttmmjjjj(z.leistungsdatum);
  return felder.join(";");
}

/** Komplette Datei als Text (Zeilenende CRLF). */
export function datevBuchungsstapel(k: DatevKopf, zeilen: DatevZeile[]): string {
  return [datevKopfzeile(k), DATEV_SPALTEN.join(";"), ...zeilen.map(datevZeile)].join("\r\n") + "\r\n";
}

const CP1252: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "™": 0x99 };
/** Windows-1252 (DATEV erwartet ANSI); unbekannte Zeichen werden „?“. */
export function alsCp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let i = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out[i++] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : (CP1252[ch] ?? 0x3f);
  }
  return out.slice(0, i);
}
