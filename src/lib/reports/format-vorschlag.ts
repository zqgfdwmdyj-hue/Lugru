// Unbekanntes Dateiformat: welche bekannte Art kommt am nächsten? (rein, getestet in tests/format-vorschlag.test.ts)
// Ergebnis für die Meldung „Format nicht erkannt – sieht aus wie … (x von y typischen Spalten, es fehlen: …)“.

import { normHeader } from "@/lib/tabular";

/** Typische Spalten je Art (vereinheitlicht wie `normHeader`). */
export const FORMAT_SIGNATUREN: Record<string, { text: string; importArt?: string; spalten: string[] }> = {
  storageFees: { text: "Monatliche Lagergebühren (Monthly Storage Fees)", importArt: "amazon_lagergebuehren", spalten: ["asin", "fnsku", "product-name", "fulfillment-center", "country-code", "product-size-tier", "average-quantity-on-hand", "month-of-charge", "estimated-monthly-storage-fee", "currency"] },
  ledger: { text: "Bestandsprotokoll (Inventory Ledger)", importArt: "amazon_ledger", spalten: ["date", "fnsku", "asin", "msku", "title", "event-type", "reference-id", "quantity", "fulfillment-center", "disposition"] },
  reimbursements: { text: "Erstattungen (Reimbursements)", importArt: "amazon_reimbursements", spalten: ["approval-date", "reimbursement-id", "case-id", "amazon-order-id", "reason", "sku", "fnsku", "asin", "amount-per-unit", "amount-total"] },
  customerReturns: { text: "FBA-Kundenrücksendungen", importArt: "amazon_customer_returns", spalten: ["return-date", "order-id", "sku", "asin", "fnsku", "product-name", "quantity", "fulfillment-center-id", "detailed-disposition", "reason", "license-plate-number"] },
  removalOrders: { text: "Remissionsaufträge", importArt: "amazon_removal_orders", spalten: ["request-date", "order-id", "order-type", "order-status", "sku", "fnsku", "disposition", "requested-quantity", "cancelled-quantity", "disposed-quantity", "shipped-quantity"] },
  removalShipments: { text: "Remissionssendungen", importArt: "amazon_removal_shipments", spalten: ["request-date", "order-id", "shipment-date", "sku", "fnsku", "disposition", "shipped-quantity", "carrier", "tracking-number", "removal-order-type"] },
  inventory: { text: "FBA-Bestand (Manage Inventory)", importArt: "amazon_inventory", spalten: ["sku", "fnsku", "asin", "product-name", "condition", "your-price", "afn-fulfillable-quantity", "afn-reserved-quantity", "afn-inbound-shipped-quantity", "afn-total-quantity"] },
  settlement: { text: "Abrechnung (Settlement Flat File V2)", importArt: "amazon_settlement", spalten: ["settlement-id", "settlement-start-date", "settlement-end-date", "transaction-type", "order-id", "amount-type", "amount-description", "amount", "posted-date", "sku"] },
  transactions: { text: "Transaktionsbericht (Zahlungen → Transaktionsansicht)", importArt: "amazon_transaktionen", spalten: ["datum/uhrzeit", "abrechnungsnummer", "typ", "bestellnummer", "sku", "beschreibung", "menge", "marketplace", "versand", "gesamt"] },
  ust: { text: "Umsatzsteuer-Transaktionsbericht (VAT Transactions)", importArt: "amazon_umsatzsteuer_transaktionen", spalten: ["unique-account-identifier", "activity-period", "sales-channel", "marketplace", "program-type", "transaction-type", "transaction-event-id", "taxable-jurisdiction", "tax-reporting-scheme", "total-activity-value-amt-vat-incl"] },
  orders: { text: "Alle Bestellungen", spalten: ["amazon-order-id", "merchant-order-id", "purchase-date", "order-status", "fulfillment-channel", "sales-channel", "sku", "asin", "quantity", "item-price"] },
  geschaeftsbericht: { text: "Geschäftsbericht (Verkäufe und Traffic je ASIN)", importArt: "amazon_geschaeftsbericht", spalten: ["parent-asin", "child-asin", "title", "sessions", "page-views", "buy-box-percentage", "units-ordered", "ordered-product-sales", "total-order-items"] },
};

export type FormatVorschlag = { art: string; text: string; importArt?: string; treffer: number; von: number; fehlen: string[] };

/** Nächstliegende bekannte Art (ab 40 % der typischen Spalten), sonst null. */
export function formatVorschlag(headers: string[]): FormatVorschlag | null {
  const da = new Set(headers.map(normHeader));
  let best: FormatVorschlag | null = null;
  for (const [art, sig] of Object.entries(FORMAT_SIGNATUREN)) {
    const treffer = sig.spalten.filter((s) => da.has(s)).length;
    if (!best || treffer / sig.spalten.length > best.treffer / best.von) best = { art, text: sig.text, importArt: sig.importArt, treffer, von: sig.spalten.length, fehlen: sig.spalten.filter((s) => !da.has(s)) };
  }
  return best && best.treffer / best.von >= 0.4 ? best : null;
}

/** Text für die Meldung bei „Format nicht erkannt“. */
export function vorschlagText(v: FormatVorschlag | null): string | null {
  if (!v) return null;
  return `Sieht aus wie „${v.text}“ (${v.treffer} von ${v.von} typischen Spalten${v.fehlen.length ? `; es fehlen: ${v.fehlen.slice(0, 6).join(", ")}` : ""})${v.importArt ? ` – als diese Art importieren: Datei aus Seller Central neu herunterladen (alle Spalten) oder mit Claude „import_link art=${v.importArt}“` : ""}.`;
}

/** Spaltenliste fürs Protokoll unbekannter Formate (vollständig, bis 80 Spalten). */
export const spaltenProtokoll = (headers: string[]) => `Spalten in der Datei (${headers.length}): ${headers.slice(0, 80).map(normHeader).join(", ")}${headers.length > 80 ? " …" : ""}`;
