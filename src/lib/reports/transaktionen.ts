// Amazon-Transaktionsbericht (Zahlungen → Transaktionsansicht / Datumsbereichsbericht, „CustomTransaction“) – reine
// Logik: Auswertung für den Import (Zeitraum, Marktplätze, Summen je Typ, Auszahlungen) und abgeleitete
// Abrechnungszeilen für die Gewinn-Seite, solange der Abrechnungsbericht (Flat File V2) fehlt.
// „Übertrag“ = Auszahlung aufs Bankkonto: gehört in die Liquidität, nie in Umsatz oder Gewinn.

import { createHash } from "node:crypto";
import { parseAmount, parseDateTime } from "@/lib/numbers";
import { columnAccessor, type Table } from "@/lib/tabular";

const SP = {
  datum: ["datum/uhrzeit", "date/time"],
  abrechnung: ["abrechnungsnummer", "settlement-id", "settlement id"],
  typ: ["typ", "type"],
  bestellung: ["bestellnummer", "order-id", "order id"],
  sku: ["sku"],
  beschreibung: ["beschreibung", "description"],
  menge: ["menge", "quantity"],
  markt: ["marketplace", "marktplatz"],
  versand: ["versand", "fulfillment", "fulfilment"],
  umsatz: ["umsätze", "product sales"],
  umsatzSteuer: ["produktumsatzsteuer", "product sales tax"],
  versandGut: ["gutschrift für versandkosten", "shipping credits"],
  versandSteuer: ["steuer auf versandgutschrift", "shipping credits tax"],
  geschenk: ["gutschrift für geschenkverpackung", "gift wrap credits"],
  geschenkSteuer: ["steuer auf geschenkverpackungsgutschriften", "giftwrap credits tax"],
  rabatt: ["rabatte aus werbeaktionen", "promotional rebates"],
  rabattSteuer: ["steuer auf aktionsrabatte", "promotional rebates tax"],
  einbehalten: ["einbehaltene steuer auf marketplace", "marketplace withheld tax"],
  verkauf: ["verkaufsgebühren", "selling fees"],
  fba: ["gebühren zu versand durch amazon", "fba fees"],
  andereGeb: ["andere transaktionsgebühren", "other transaction fees"],
  andere: ["andere", "other"],
  gesamt: ["gesamt", "total"],
} as const;

const plain = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Typ „Übertrag“ / „Transfer“ = Auszahlung aufs Bankkonto. */
export const istUebertrag = (typ: string) => ["ubertrag", "transfer"].includes(plain(typ));
const istBestellung = (typ: string) => ["bestellung", "order"].includes(plain(typ));
const istErstattung = (typ: string) => ["erstattung", "refund"].includes(plain(typ));
/** „amazon.de“ und „Amazon.de“ sind derselbe Marktplatz. */
export const normMarktplatz = (m: string) => m.trim().toLowerCase();
const r2 = (n: number) => Math.round(n * 100) / 100;

export type TransaktionsAuswertung = {
  zeilen: number;
  abrechnungen: number;
  zeitraum: { von: string | null; bis: string | null };
  marktplaetze: string[];
  summenJeTyp: { typ: string; anzahl: number; summe: number }[];
  auszahlungen: { datum: string; betrag: number; abrechnung: string | null }[];
  warnungen: string[];
};

export function transaktionsAuswertung(table: Table): TransaktionsAuswertung {
  const a = columnAccessor(table.headers);
  const typen = new Map<string, { typ: string; anzahl: number; summe: number }>();
  const abr = new Set<string>();
  const maerkte = new Set<string>();
  const tage: string[] = [];
  const auszahlungen: TransaktionsAuswertung["auszahlungen"] = [];
  let zeilen = 0;
  for (const r of table.rows) {
    const typ = a.get(r, ...SP.typ);
    const gesamt = parseAmount(a.get(r, ...SP.gesamt));
    if (!typ && gesamt === null) continue;
    zeilen++;
    const d = parseDateTime(a.get(r, ...SP.datum));
    const tag = d ? d.toISOString().slice(0, 10) : null;
    if (tag) tage.push(tag);
    const nr = a.get(r, ...SP.abrechnung);
    if (nr) abr.add(nr);
    const m = normMarktplatz(a.get(r, ...SP.markt));
    if (m) maerkte.add(m);
    const k = typ.trim() || "(ohne Typ)";
    const t = typen.get(k) ?? { typ: k, anzahl: 0, summe: 0 };
    t.anzahl++;
    t.summe += gesamt ?? 0;
    typen.set(k, t);
    if (istUebertrag(typ) && tag && gesamt !== null) auszahlungen.push({ datum: tag, betrag: r2(-gesamt), abrechnung: nr || null });
  }
  tage.sort();
  const warnungen: string[] = [];
  if (maerkte.size === 1) warnungen.push(`Nur ein Marktplatz enthalten (${[...maerkte][0]}) – andere Länder fehlen in dieser Datei.`);
  if (auszahlungen.length) warnungen.push(`${auszahlungen.length} × „Übertrag“ als Auszahlung gebucht (Liquidität), nie als Umsatz.`);
  return {
    zeilen,
    abrechnungen: abr.size,
    zeitraum: { von: tage[0] ?? null, bis: tage[tage.length - 1] ?? null },
    marktplaetze: [...maerkte].sort(),
    summenJeTyp: [...typen.values()].map((t) => ({ ...t, summe: r2(t.summe) })).sort((x, y) => y.anzahl - x.anzahl),
    auszahlungen: auszahlungen.sort((x, y) => x.datum.localeCompare(y.datum)),
    warnungen,
  };
}

export type AbgeleiteteZeile = {
  settlementId: string;
  rowHash: string;
  transactionType: string;
  orderId: string | null;
  marketplace: string | null;
  fulfillmentId: string | null;
  amountType: string;
  amountDescription: string;
  amount: number;
  postedDate: string | null;
  sku: string | null;
  quantity: number | null;
  quelle: "transaktionen";
};
export type AbgeleiteteAbrechnung = { settlementId: string; startDate: Date | null; endDate: Date | null; depositDate: Date | null; totalAmount: number | null; currency: string };

/**
 * Abrechnungszeilen im Format des Abrechnungsberichts (ItemPrice/Principal, ItemFees/Commission …) aus den
 * Transaktionszeilen – je Zeile so aufgeteilt, dass die Summe genau „Gesamt“ ergibt. „Übertrag“ wird keine Zeile,
 * sondern Auszahlungsdatum und -betrag der Abrechnung.
 */
export function abrechnungAusTransaktionen(table: Table, reimb: (typ: string, beschreibung: string) => boolean): { abrechnungen: AbgeleiteteAbrechnung[]; zeilen: AbgeleiteteZeile[] } {
  const a = columnAccessor(table.headers);
  const gesehen = new Map<string, number>();
  const kopf = new Map<string, AbgeleiteteAbrechnung>();
  const zeilen: AbgeleiteteZeile[] = [];
  for (const r of table.rows) {
    const typ = a.get(r, ...SP.typ);
    const gesamt = parseAmount(a.get(r, ...SP.gesamt));
    const nr = a.get(r, ...SP.abrechnung);
    if (!typ || gesamt === null || !nr) continue;
    const zeit = parseDateTime(a.get(r, ...SP.datum));
    const k = kopf.get(nr) ?? { settlementId: nr, startDate: null, endDate: null, depositDate: null, totalAmount: null, currency: "EUR" };
    if (zeit && (!k.startDate || zeit < k.startDate)) k.startDate = zeit;
    if (zeit && (!k.endDate || zeit > k.endDate)) k.endDate = zeit;
    kopf.set(nr, k);
    if (istUebertrag(typ)) {
      k.depositDate = zeit;
      k.totalAmount = r2((k.totalAmount ?? 0) - gesamt);
      continue;
    }
    const basis = `txab\u0001${r.join("\u0001")}`;
    const n = (gesehen.get(basis) ?? 0) + 1;
    gesehen.set(basis, n);
    const hash = (teil: string) => createHash("sha1").update(`${basis}\u0002${n}\u0002${teil}`).digest("hex");
    const tag = zeit ? zeit.toISOString().slice(0, 10) : null;
    const sku = a.get(r, ...SP.sku) || null;
    const menge = parseAmount(a.get(r, ...SP.menge));
    const versand = plain(a.get(r, ...SP.versand));
    const gemein = { settlementId: nr, orderId: a.get(r, ...SP.bestellung) || null, marketplace: normMarktplatz(a.get(r, ...SP.markt)) || null, fulfillmentId: versand.includes("amazon") ? "AFN" : versand ? "MFN" : null, postedDate: tag, sku, quelle: "transaktionen" as const };
    const beschreibung = a.get(r, ...SP.beschreibung);
    if (istBestellung(typ) || istErstattung(typ)) {
      const tt = istBestellung(typ) ? "Order" : "Refund";
      const teile: [string, string, readonly string[], boolean][] = [
        ["ItemPrice", "Principal", SP.umsatz, true],
        ["ItemPrice", "Tax", SP.umsatzSteuer, false],
        ["ItemPrice", "Shipping", SP.versandGut, false],
        ["ItemPrice", "ShippingTax", SP.versandSteuer, false],
        ["ItemPrice", "GiftWrap", SP.geschenk, false],
        ["ItemPrice", "GiftWrapTax", SP.geschenkSteuer, false],
        ["Promotion", "Principal", SP.rabatt, false],
        ["Promotion", "TaxDiscount", SP.rabattSteuer, false],
        ["ItemWithheldTax", "MarketplaceFacilitatorTax-Principal", SP.einbehalten, false],
        ["ItemFees", "Commission", SP.verkauf, false],
        ["ItemFees", "FBAPerUnitFulfillmentFee", SP.fba, false],
        ["ItemFees", "OtherTransactionFee", SP.andereGeb, false],
        ["Other", "Other", SP.andere, false],
      ];
      let summe = 0;
      for (const [typA, desc, spalte, immer] of teile) {
        const betrag = parseAmount(a.get(r, ...spalte));
        if (betrag === null || (!immer && betrag === 0)) continue;
        summe += betrag;
        zeilen.push({ ...gemein, rowHash: hash(`${typA}/${desc}`), transactionType: tt, amountType: typA, amountDescription: desc, amount: r2(betrag), quantity: desc === "Principal" && typA === "ItemPrice" && menge !== null ? Math.abs(Math.round(menge)) : null });
      }
      const rest = r2(gesamt - summe);
      if (Math.abs(rest) >= 0.01) zeilen.push({ ...gemein, rowHash: hash("Other/Rest"), transactionType: tt, amountType: "Other", amountDescription: "Differenz zu Gesamt", amount: rest, quantity: null });
      continue;
    }
    // Übrige Typen (Servicegebühr, Anpassung, Lagergebühren …): eine Zeile mit „Gesamt“; Entschädigungen erkennbar.
    zeilen.push({ ...gemein, rowHash: hash("Other/Gesamt"), transactionType: typ.trim(), amountType: "Other", amountDescription: (reimb(typ, beschreibung) ? `Reimbursement – ${beschreibung || typ}` : beschreibung || typ).slice(0, 200), amount: r2(gesamt), quantity: menge !== null ? Math.abs(Math.round(menge)) : null });
  }
  return { abrechnungen: [...kopf.values()], zeilen };
}
