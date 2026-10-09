// Kundenstamm für B2B-Rechnungen – Prüfung und Kundennummer-Vorschlag, ohne Datenbank.
import { deriveNumbering, formatNumber } from "@/lib/ebay/invoices/numbering";

export type CustomerInput = {
  name: string;
  contact?: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  vatId?: string;
  email?: string;
  customerNumber?: string;
};

const VAT_ID = /^[A-Z]{2}[A-Z0-9+*.]{2,13}$/;

/** Bereinigt (Leerzeichen, Großschreibung) und prüft – leere Liste heißt: speicherbar. */
export function normalizeCustomer(c: CustomerInput): { value: CustomerInput; problems: string[] } {
  const v: CustomerInput = {
    name: c.name.trim(),
    contact: c.contact?.trim() || undefined,
    street: c.street.trim(),
    zip: c.zip.trim(),
    city: c.city.trim(),
    country: (c.country.trim() || "DE").toUpperCase(),
    vatId: c.vatId?.replace(/\s+/g, "").toUpperCase() || undefined,
    email: c.email?.trim().toLowerCase() || undefined,
    customerNumber: c.customerNumber?.trim() || undefined,
  };
  const p: string[] = [];
  if (!v.name) p.push("Firmenname fehlt.");
  if (!v.street || !v.zip || !v.city) p.push("Anschrift unvollständig (Straße, PLZ, Ort).");
  if (!/^[A-Z]{2}$/.test(v.country)) p.push("Land bitte als Länderkürzel (z. B. DE, AT, NL).");
  if (v.vatId && !VAT_ID.test(v.vatId)) p.push("USt-IdNr. sieht nicht gültig aus (z. B. DE123456789).");
  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) p.push("E-Mail-Adresse ungültig.");
  return { value: v, problems: p };
}

/** Nächste Kundennummer nach dem Muster der zuletzt vergebenen (K-1007 → K-1008); ohne Muster keine. */
export function suggestCustomerNumber(lastNumbers: string[], year = new Date().getFullYear()): string | null {
  for (const last of lastNumbers) {
    const d = deriveNumbering(last);
    if (d) return formatNumber({ numberFormat: d.numberFormat }, year, d.nextNumber);
  }
  return null;
}
