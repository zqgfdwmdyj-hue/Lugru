// Datei-Import über den Claude-Konnektor – reine Logik (getestet in tests/datei-import.test.ts): Import-Arten,
// Prüfung der Einmal-Adresse, Land/Zeitraum aus dem Hinweis.

import type { UploadArt } from "@/lib/uploads/erkennen";

export const GUELTIG_MIN = 15;
export const MAX_MB = 50;
export const AUFBEWAHRUNG_TAGE = 90;

type ArtDef = { text: string; upload?: UploadArt; bericht?: string; endungen: string[] };

/** Import-Arten: `upload` = Art der zentralen Upload-Erkennung, `bericht` = Amazon-Berichtsart (Upload-Art „tabelle“). */
export const IMPORT_ARTEN = {
  amazon_transaktionen: { text: "Amazon-Transaktionsbericht (Zahlungen → Transaktionsansicht, CustomTransaction)", upload: "tabelle", bericht: "transactions", endungen: [".csv", ".txt"] },
  amazon_settlement: { text: "Amazon-Abrechnungsbericht (Flat File V2)", upload: "tabelle", bericht: "settlement", endungen: [".txt", ".csv", ".tsv"] },
  amazon_ledger: { text: "Bestandsprotokoll (Inventory Ledger)", upload: "tabelle", bericht: "ledger", endungen: [".csv", ".txt"] },
  amazon_inventory: { text: "FBA-Bestand (Manage Inventory)", upload: "tabelle", bericht: "inventory", endungen: [".csv", ".txt"] },
  amazon_customer_returns: { text: "FBA-Kundenrücksendungen", upload: "tabelle", bericht: "customerReturns", endungen: [".csv", ".txt"] },
  amazon_reimbursements: { text: "Erstattungen (Reimbursements)", upload: "tabelle", bericht: "reimbursements", endungen: [".csv", ".txt"] },
  amazon_removal_orders: { text: "Remissionsaufträge", upload: "tabelle", bericht: "removalOrders", endungen: [".csv", ".txt"] },
  amazon_removal_shipments: { text: "Remissionssendungen", upload: "tabelle", bericht: "removalShipments", endungen: [".csv", ".txt"] },
  amazon_lagergebuehren: { text: "Lagergebühren je Monat (Monthly Storage Fees)", upload: "tabelle", bericht: "storageFees", endungen: [".csv", ".txt"] },
  amazon_geschaeftsbericht: { text: "Geschäftsbericht – Verkäufe und Traffic je ASIN (mit B2B-Spalten)", endungen: [".csv"] },
  amazon_umsatzsteuer_transaktionen: { text: "Amazon-Umsatzsteuer-Transaktionsbericht (VAT Transactions)", upload: "ust_bericht", endungen: [".txt", ".csv", ".tsv"] },
  kontoauszug_sparkasse: { text: "Kontoauszug Sparkasse (CSV/CAMT/PDF)", upload: "kontoauszug", endungen: [".csv", ".xml", ".pdf"] },
  kontoauszug_amex: { text: "American Express (CSV/XLSX)", upload: "amex", endungen: [".csv", ".xlsx", ".xls"] },
  ek_liste: { text: "EK-Liste (ArbitrageOne/AccountOne)", upload: "ek_liste", endungen: [".xlsx", ".xls", ".csv"] },
  bqool_datei: { text: "BQool-Datei (Repricing-Export bzw. Manage Listings)", endungen: [".txt", ".csv", ".xlsx"] },
  preisliste: { text: "Lieferanten-Preisliste → Preislisten-Scanner", endungen: [".csv", ".xlsx", ".xls"] },
  sonstiges: { text: "Sonstiges – landet im Posteingang, keine Verarbeitung", endungen: [] },
} as const satisfies Record<string, ArtDef>;

export type ImportArt = keyof typeof IMPORT_ARTEN;
export const IMPORT_ART_KEYS = Object.keys(IMPORT_ARTEN) as [ImportArt, ...ImportArt[]];

export type UploadFehler = { status: number; code: "unbekannt" | "abgelaufen" | "benutzt" | "zu_gross" | "leer"; fehler: string };

/** Darf die Datei an diese Einmal-Adresse? null = ja. Keine Antwort verrät, ob es eine Adresse gibt (außer Ablauf). */
export function uploadPruefen(a: { gueltigBis: Date; benutztAm: Date | null } | null, o: { jetzt?: Date; groesse: number | null }): UploadFehler | null {
  const jetzt = o.jetzt ?? new Date();
  if (!a) return { status: 404, code: "unbekannt", fehler: "Upload-Adresse unbekannt." };
  if (a.benutztAm) return { status: 410, code: "benutzt", fehler: "Diese Upload-Adresse wurde schon benutzt – bitte mit import_link eine neue anfordern." };
  if (a.gueltigBis.getTime() < jetzt.getTime()) return { status: 410, code: "abgelaufen", fehler: `Upload-Adresse abgelaufen (gültig ${GUELTIG_MIN} Minuten) – bitte mit import_link eine neue anfordern.` };
  if (o.groesse !== null && o.groesse > MAX_MB * 1024 * 1024) return { status: 413, code: "zu_gross", fehler: `Datei zu groß (höchstens ${MAX_MB} MB).` };
  if (o.groesse === 0) return { status: 400, code: "leer", fehler: "Die Datei ist leer." };
  return null;
}

const LAENDER = ["DE", "FR", "IT", "ES", "NL", "PL", "SE", "BE", "AT", "IE", "UK"] as const;
const MONAT_NAMEN: Record<string, number> = { jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const letzterTag = (j: number, m: number) => new Date(Date.UTC(j, m, 0)).getUTCDate();

/** Land und Zeitraum aus einem Hinweis wie „DE, 01.10.–31.10.2026“, „Marktplatz DE, Jan–Okt 2026“ oder „FR 2026-09“. */
export function landUndZeitraumAus(hinweis: string | null | undefined): { land: string | null; von: string | null; bis: string | null } {
  const h = (hinweis ?? "").trim();
  const land = LAENDER.find((l) => new RegExp(`(^|[^A-Za-z])${l}([^A-Za-z]|$)`).test(h)) ?? null;
  let m = /(\d{4}-\d{2}-\d{2})\s*(?:–|-|bis)\s*(\d{4}-\d{2}-\d{2})/.exec(h);
  if (m) return { land, von: m[1], bis: m[2] };
  m = /(\d{1,2})\.(\d{1,2})\.(\d{4})?\s*(?:–|-|bis)\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(h);
  if (m) {
    const j2 = Number(m[6]);
    const j1 = m[3] ? Number(m[3]) : j2;
    return { land, von: `${j1}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`, bis: `${j2}-${pad(Number(m[5]))}-${pad(Number(m[4]))}` };
  }
  m = /([A-Za-zä]{3})[a-zä]*\.?\s*(?:–|-|bis)\s*([A-Za-zä]{3})[a-zä]*\.?\s*(\d{4})/.exec(h);
  if (m && MONAT_NAMEN[m[1].toLowerCase()] && MONAT_NAMEN[m[2].toLowerCase()]) {
    const j = Number(m[3]);
    const m1 = MONAT_NAMEN[m[1].toLowerCase()];
    const m2 = MONAT_NAMEN[m[2].toLowerCase()];
    return { land, von: `${j}-${pad(m1)}-01`, bis: `${j}-${pad(m2)}-${pad(letzterTag(j, m2))}` };
  }
  m = /(\d{4})-(\d{2})(?!-\d)/.exec(h);
  if (m) return { land, von: `${m[1]}-${m[2]}-01`, bis: `${m[1]}-${m[2]}-${pad(letzterTag(Number(m[1]), Number(m[2])))}` };
  return { land, von: null, bis: null };
}

/** Dateiname für Ablage und Anzeige: ohne Pfad, höchstens 200 Zeichen. */
export const sichererName = (n: string) => n.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "datei";
