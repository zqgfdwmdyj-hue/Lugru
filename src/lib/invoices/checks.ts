import { DOC_TYPES, type InvoiceChecks } from "@/db/tables/invoices";
import { parseDate } from "@/lib/numbers";

export { DOC_TYPES, type InvoiceChecks };

// Rechnungsprüfung: Datum robust erkennen (mit Unsicherheit statt stiller Vertauschung), Belegart erkennen
// und mögliche Duplikate finden. Reine Logik – nichts wird automatisch gelöscht oder zusammengeführt.

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  rechnung: "Rechnung",
  gutschrift: "Gutschrift",
  storno: "Storno",
  bestaetigung: "Auftragsbestätigung",
  lieferschein: "Lieferschein",
  mahnung: "Mahnung",
  quittung: "Quittung / Kassenbon",
  keinbeleg: "Kein Rechnungsbeleg (AGB, Garantie, Werbung …)",
  unbekannt: "nicht erkannt",
};

/** Belegarten, die kein eigener Buchungsbeleg sind (zählen nicht in die Summen). */
export const NOT_BOOKED: DocType[] = ["bestaetigung", "lieferschein", "mahnung", "keinbeleg"];
/** Belegarten, deren Betrag abgezogen wird. */
export const NEGATIVE: DocType[] = ["gutschrift", "storno"];

// ---- Datum ---------------------------------------------------------------------------------------

/** Etiketten in der Reihenfolge, in der sie zählen (nicht in der Reihenfolge im Text). */
const DATE_LABELS: RegExp[] = [
  /rechnungsdatum/i,
  /invoice\s*date/i,
  /datum\s+der\s+rechnung/i,
  /belegdatum/i,
  /ausstellungsdatum/i,
  /gutschriftsdatum/i,
  /(?<![a-zäöü])datum(?![a-zäöü])/i,
  /(?<![a-z])date(?![a-z])/i,
  /leistungsdatum|lieferdatum/i,
];
const DATE_VALUE = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\.?\s+[A-Za-zÄäéû]{3,}\.?\s+\d{4}|[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4})`;

const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${s}T12:00:00Z`);
  return t.getUTCMonth() + 1 === m ? s : null;
};
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
const de = (s: string) => s.split("-").reverse().join(".");

/**
 * Ein Datum aus dem Rechnungstext. Schrägstrich-Daten sind in Rechnungen meist europäisch (TT/MM/JJJJ);
 * amerikanisch nur, wenn die zweite Zahl > 12 ist. Sind beide ≤ 12, entscheidet das Datum aus dem
 * Dateinamen – sonst bleibt es unsicher (mit der anderen Lesart als Vorschlag).
 */
export function readDate(raw: string, hint: string | null): { date: string | null; uncertain?: string; suggestion?: string | null } {
  const s = raw.trim().replace(/\s+/g, " ");
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const eu = iso(y, b, a);
    const us = iso(y, a, b);
    if (a > 12 || !us) return { date: eu };
    if (b > 12 || !eu) return { date: us };
    if (eu === us) return { date: eu };
    if (hint === eu || hint === us) return { date: hint };
    return { date: eu, uncertain: `Tag und Monat nicht eindeutig („${s}“)`, suggestion: us };
  }
  return { date: parseDate(/^\d{1,2}\.\s?\d/.test(s) ? s.replace(/\.\s/g, ".") : s) };
}

export type DateResult = { date: string | null; source: "text" | "dateiname" | null; uncertain?: string; suggestion?: string | null };

/** Rechnungsdatum aus Text und Dateiname (Invoice Fetcher: „2026-01-12-shop-….pdf“). */
export function extractInvoiceDate(text: string, fileNameDate: string | null, today?: string): DateResult {
  const t = text.replace(/ /g, " ");
  let found: { date: string | null; uncertain?: string; suggestion?: string | null } | null = null;
  for (const label of DATE_LABELS) {
    const re = new RegExp(`(?:${label.source})[:\\s]*(?:vom\\s*)?${DATE_VALUE}`, "i");
    const m = re.exec(t);
    if (!m) continue;
    const r = readDate(m[1], fileNameDate);
    if (r.date) {
      found = r;
      break;
    }
  }
  let out: DateResult;
  if (!found?.date) {
    out = fileNameDate ? { date: fileNameDate, source: "dateiname" } : { date: null, source: null, uncertain: "Kein Rechnungsdatum erkannt" };
  } else if (fileNameDate && found.date !== fileNameDate && daysApart(found.date, fileNameDate) > 7) {
    // Tag/Monat vertauscht? Dann gilt der Dateiname (sichere Lesart).
    const [y, m, d] = found.date.split("-").map(Number);
    const swapped = iso(y, d, m);
    out = swapped === fileNameDate ? { date: fileNameDate, source: "dateiname" } : { date: found.date, source: "text", uncertain: `Datum im Beleg (${de(found.date)}) weicht vom Dateinamen (${de(fileNameDate)}) ab`, suggestion: fileNameDate };
  } else {
    out = { date: found.date, source: "text", ...(found.uncertain ? { uncertain: found.uncertain, suggestion: found.suggestion } : {}) };
  }
  if (out.date && today && !out.uncertain) {
    if (out.date > addDays(today, 3)) out = { ...out, uncertain: `Datum liegt in der Zukunft (${de(out.date)})`, suggestion: fileNameDate && fileNameDate <= today ? fileNameDate : null };
    else if (out.date < "2015-01-01") out = { ...out, uncertain: `Datum unplausibel alt (${de(out.date)})`, suggestion: fileNameDate };
  }
  return out;
}

const addDays = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---- Belegart ------------------------------------------------------------------------------------

const DOC_RULES: [DocType, RegExp][] = [
  ["storno", /\b(storno(?:rechnung)?|stornierung(?:srechnung)?|cancell?ation invoice)\b/i],
  ["gutschrift", /\b(gutschrift|rechnungskorrektur|credit\s*note|korrekturrechnung)\b/i],
  ["mahnung", /\b(mahnung|zahlungserinnerung|payment reminder)\b/i],
  ["bestaetigung", /\b(auftragsbestätigung|bestellbestätigung|bestellbestaetigung|order confirmation|ihre bestellung bei)\b/i],
  ["lieferschein", /\b(lieferschein|packing slip|delivery note)\b/i],
  ["quittung", /\b(kassenbon|quittung|kassenbeleg|bon-?nr)\b/i],
  ["rechnung", /\b(rechnung|invoice|faktura|factura|facture|fattura)\b/i],
];

/** Dokumente, die keine Rechnung sind, aber oft „Rechnung“ erwähnen (AGB, Garantie, Widerruf, Werbung …). */
const NOT_INVOICE: [string, RegExp][] = [
  ["AGB", /\b(allgemeine\s+geschäftsbedingungen|allgemeine\s+verkaufsbedingungen|agb|terms\s+(and|&)\s+conditions)\b/i],
  ["Garantie", /\b(garantiebedingungen|garantieerklärung|garantiekarte|garantieschein|herstellergarantie|warranty\s+(card|terms|conditions))\b/i],
  ["Widerrufsbelehrung", /\b(widerrufsbelehrung|muster-?widerrufsformular|widerrufsformular)\b/i],
  ["Datenschutz", /\b(datenschutzerklärung|datenschutzhinweise|privacy\s+policy)\b/i],
  ["Werbung", /\b(newsletter|prospekt|katalog|sonderangebot|jetzt\s+bestellen|angebot\s+gültig|rabattcode|gutscheincode|unsubscribe|abmelden)\b/i],
  ["Anleitung", /\b(bedienungsanleitung|gebrauchsanweisung|sicherheitshinweise|konformitätserklärung|user\s+manual)\b/i],
];

/** Merkmale einer echten Rechnung: Nummer mit Ziffern, Gesamtbetrag, Umsatzsteuersatz. */
export function invoiceSignals(text: string): number {
  const number = /(rechnungs(?:-|\s)?(?:nummer|nr\.?)|invoice\s*(?:no\.?|number|#))[:\s#]*[A-Za-z]{0,6}[-/]?\d/i.test(text);
  const amount = /(gesamtbetrag|rechnungsbetrag|endbetrag|zu zahlen|gesamtsumme|summe brutto|bruttobetrag|total)[^\n\d-]{0,40}\d/i.test(text);
  const vat = /\b(mwst|ust|umsatzsteuer|vat)\b[^\n]{0,40}\d{1,2}([.,]\d+)?\s*%/i.test(text);
  return Number(number) + Number(amount) + Number(vat);
}

/**
 * Kein Rechnungsbeleg? Nur wenn der Kopf (Dateiname + erste ~600 Zeichen) klar nach AGB, Garantie, Werbung …
 * aussieht UND kaum Rechnungsmerkmale da sind – eine echte Rechnung mit AGB im Anhang bleibt Rechnung.
 */
export function notInvoiceReason(text: string, fileName = ""): string | null {
  const head = `${fileName} ${text.slice(0, 600)}`;
  const hit = NOT_INVOICE.find(([, re]) => re.test(head));
  if (!hit) return null;
  return invoiceSignals(text) <= 1 ? `${hit[0]} erkannt, keine Rechnungsmerkmale (Nummer, Gesamtbetrag, USt-Satz)` : null;
}

/**
 * Belegart: das Wort im Kopf (erste ~600 Zeichen) zählt mehr als irgendwo im Text. Eine „Rechnung“, die
 * eine Gutschrift ist, heißt fast immer im Kopf so. AGB, Garantie, Werbung ohne Rechnungsmerkmale →
 * „kein Rechnungsbeleg“. Nicht erkannt → „unbekannt“ (unsicher).
 */
export function detectDocType(text: string, fileName = ""): { type: DocType; uncertain?: string; notInvoice?: string } {
  const not = notInvoiceReason(text, fileName);
  if (not) return { type: "keinbeleg", notInvoice: not };
  const head = `${fileName} ${text.slice(0, 600)}`;
  // Im Kopf gewinnt das Wort, das zuerst steht („Rechnung … Lieferschein liegt bei“ bleibt Rechnung).
  const first = DOC_RULES.map(([type, re]) => ({ type, at: head.search(re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)[0];
  if (first) return { type: first.type };
  for (const [type, re] of DOC_RULES) {
    if (!re.test(text)) continue;
    // Nur „Rechnung“ irgendwo (z. B. „Rechnungsadresse“) ist zu schwach, bleibt aber die wahrscheinlichste Art.
    return type === "rechnung" ? { type } : { type, uncertain: `„${DOC_TYPE_LABEL[type]}“ nur im Text, nicht im Kopf gefunden` };
  }
  return text.trim() ? { type: "unbekannt", uncertain: "Belegart nicht erkannt" } : { type: "unbekannt", uncertain: "Kein Text im PDF (Scan?) – Belegart und Datum bitte prüfen" };
}

// ---- Duplikate -----------------------------------------------------------------------------------

export type DupRow = { id: string; invoiceNumber: string | null; invoiceDate: string | null; totalGross: number | null; sourceKey: string | null; supplierId: string | null; vendor: string | null; docType: string };

const normNo = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sameIssuer = (a: DupRow, b: DupRow) =>
  (a.sourceKey && a.sourceKey === b.sourceKey) || (a.supplierId && a.supplierId === b.supplierId) || (a.vendor && b.vendor && a.vendor.toLowerCase() === b.vendor.toLowerCase());
const sameAmount = (a: DupRow, b: DupRow) => a.totalGross !== null && b.totalGross !== null && Math.abs(a.totalGross - b.totalGross) < 0.01;

/**
 * Mögliche Duplikate einer Rechnung: gleiche Rechnungsnummer (beim selben Aussteller oder mit gleichem Betrag)
 * oder – ohne Nummer – gleicher Aussteller, gleiches Datum und gleicher Betrag. Nur Hinweise.
 */
export function findDuplicates(inv: DupRow, others: DupRow[]): { id: string; reason: string }[] {
  const out: { id: string; reason: string }[] = [];
  const no = normNo(inv.invoiceNumber);
  for (const o of others) {
    if (o.id === inv.id || o.docType !== inv.docType) continue;
    const ono = normNo(o.invoiceNumber);
    if (no.length >= 4 && no === ono && (sameIssuer(inv, o) || sameAmount(inv, o))) {
      out.push({ id: o.id, reason: `gleiche Rechnungsnummer ${inv.invoiceNumber}` });
    } else if ((!no || !ono) && sameIssuer(inv, o) && inv.invoiceDate && inv.invoiceDate === o.invoiceDate && sameAmount(inv, o)) {
      out.push({ id: o.id, reason: "gleicher Aussteller, gleiches Datum und gleicher Betrag" });
    }
  }
  return out;
}

/** Betrag für Summen: Gutschrift/Storno abziehen, Bestätigungen/Lieferscheine/Mahnungen nicht zählen. */
export function bookedAmount(docType: string, totalGross: number | null): number {
  if (totalGross === null || NOT_BOOKED.includes(docType as DocType)) return 0;
  return NEGATIVE.includes(docType as DocType) ? -Math.abs(totalGross) : totalGross;
}
