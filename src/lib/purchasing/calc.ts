// Einkauf: SKU für neue Chargen, Netto-EK und Bestellvorschläge – ohne Server-Abhängigkeiten.

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Kürzel für die SKU: nur Großbuchstaben und Ziffern. */
export function supplierCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

/**
 * SKU einer neuen Charge nach Schema C (mit Jahr, wie Arbitrage One):
 * SHOP_TTMONJJ_ASIN_EKBRUTTO_VK, z. B. AMZFR_24SEP26_B0TEST0008_305.99_470.00
 */
export function buildSku(code: string, dateIso: string, asin: string, costGross: number, targetPrice: number | null): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = `${String(d).padStart(2, "0")}${MON[m - 1]}${String(y % 100).padStart(2, "0")}`;
  return [supplierCode(code), date, asin.toUpperCase(), costGross.toFixed(2), (targetPrice ?? 0).toFixed(2)].join("_");
}

export function netFromGross(gross: number, vatRate: number): number {
  return Math.round((gross / (1 + vatRate / 100)) * 10000) / 10000;
}

export type SuggestInput = {
  sold30: number;
  sold90: number;
  /** Verfügbar: FBA verkäuflich + reserviert + unterwegs zu Amazon + eigenes Lager. */
  stock: number;
  /** Schon bestellt, aber noch nicht eingegangen. */
  onOrder: number;
  leadDays: number;
  coverDays: number;
};

export type Suggestion = { daily: number; daysLeft: number | null; need: number };

/**
 * Wie viel nachkaufen? Tagesabsatz aus 30 und 90 Tagen gewichtet (jüngere Verkäufe zählen mehr),
 * Bedarf = Absatz über Lieferzeit + gewünschte Reichweite, abzüglich Bestand und offener Bestellungen.
 */
export function suggest(i: SuggestInput): Suggestion {
  const daily = 0.6 * (i.sold30 / 30) + 0.4 * (i.sold90 / 90);
  if (daily <= 0) return { daily: 0, daysLeft: null, need: 0 };
  const need = Math.max(0, Math.ceil(daily * (i.leadDays + i.coverDays) - i.stock - i.onOrder));
  return { daily: Math.round(daily * 100) / 100, daysLeft: Math.floor((i.stock + i.onOrder) / daily), need };
}

export const PO_STATUS_LABEL: Record<string, [string, string]> = {
  draft: ["Entwurf", "tag-neutral"],
  ordered: ["Bestellt", "tag-info"],
  shipped: ["Unterwegs", "tag-info"],
  partial: ["Teilweise da", "tag-warn"],
  received: ["Eingegangen", "tag-ok"],
  cancelled: ["Storniert", "tag-neutral"],
};

/** Status nach dem Wareneingang. */
export function statusAfterReceipt(items: { quantity: number; received: number }[], current: string): string {
  const got = items.reduce((s, i) => s + i.received, 0);
  if (got === 0) return current;
  return items.every((i) => i.received >= i.quantity) ? "received" : "partial";
}
