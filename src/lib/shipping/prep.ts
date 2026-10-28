// Prep Center: wer verschickt eine Sendung, und was hat das Prep Center in einem Monat für mich verschickt
// (zum Abgleich mit seiner Rechnung). Reine Logik, testbar.

export type ShipperKey = "self" | "prep";
export const SHIPPER_LABEL: Record<ShipperKey, string> = { self: "ich selbst", prep: "Prep Center" };

/**
 * Vorgabe für einen Auftrag: Liegt jeder Artikel laut Festlegung im Prep Center → Prep Center; liegt einer bei
 * mir → ich (das Prep Center hat ihn nicht); sonst die Vorgabe aus den Einstellungen.
 */
export function decideShipper(items: { shipFrom: ShipperKey | null }[], fallback: ShipperKey): ShipperKey {
  const set = items.map((i) => i.shipFrom).filter((x): x is ShipperKey => x !== null);
  if (!set.length) return fallback;
  if (set.includes("self")) return "self";
  return set.length === items.length ? "prep" : fallback;
}

export type PrepRow = {
  orderId: string;
  externalId: string;
  channel: string;
  /** Tag der Sendung (versendet, sonst Label erstellt) als ISO-Datum. */
  day: string;
  name: string;
  place: string;
  units: number;
  items: string;
  /** Versandart, z. B. „DHL Paket“, „Warensendung“. */
  product: string;
  tracking: string | null;
  status: string;
};

export type PrepFees = { feeShipment: number; feeExtraItem: number };
export type PrepSummary = { shipments: number; units: number; byProduct: { product: string; shipments: number; units: number }[]; expected: number | null };

/** Summen je Monat; erwartete Kosten nur, wenn Gebühren hinterlegt sind (je Sendung + je weiteres Stück). */
export function prepSummary(rows: PrepRow[], fees: PrepFees): PrepSummary {
  const by = new Map<string, { product: string; shipments: number; units: number }>();
  for (const r of rows) {
    const e = by.get(r.product) ?? { product: r.product, shipments: 0, units: 0 };
    e.shipments++;
    e.units += r.units;
    by.set(r.product, e);
  }
  const units = rows.reduce((n, r) => n + r.units, 0);
  const hasFees = fees.feeShipment > 0 || fees.feeExtraItem > 0;
  const extra = rows.reduce((n, r) => n + Math.max(0, r.units - 1), 0);
  const expected = hasFees ? Math.round((rows.length * fees.feeShipment + extra * fees.feeExtraItem) * 100) / 100 : null;
  return { shipments: rows.length, units, byProduct: [...by.values()].sort((a, b) => b.shipments - a.shipments), expected };
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (Semikolon, mit BOM für Excel) – eine Zeile je Sendung, zum Abhaken gegen die Rechnung. */
export function prepCsv(rows: PrepRow[]): string {
  const head = ["Datum", "Kanal", "Bestellnummer", "Empfänger", "PLZ/Ort", "Stück", "Artikel", "Versandart", "Sendungsnummer", "Status"];
  const lines = rows.map((r) => [r.day.split("-").reverse().join("."), r.channel, r.externalId, r.name, r.place, r.units, r.items, r.product, r.tracking ?? "", r.status].map(cell).join(";"));
  return `\uFEFF${[head.join(";"), ...lines].join("\r\n")}\r\n`;
}

/** „2026-10“ prüfen, sonst aktueller Monat (Berlin). */
export function parseMonthParam(v: string | undefined, today: string): string {
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7);
}
