/** Absender- und Ablaufeinstellungen der Rechnungsstellung. Global, nicht je eBay-Umgebung. */
export interface InvoiceSettings {
  companyName?: string;
  /** Inhaber bzw. Geschäftsführer — optional, erscheint im Fuß. */
  ownerName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
  /** Steuernummer vom Finanzamt. Eine von beiden (oder beide) ist Pflicht. */
  taxNumber?: string;
  /** USt-Identifikationsnummer. */
  vatId?: string;
  /** Kleinunternehmer nach §19 UStG: keine Umsatzsteuer ausweisen. */
  kleinunternehmer?: boolean;
  /** Umsatzsteuersatz in Prozent; ohne Angabe gilt der Satz aus der Kalkulation, sonst 19. */
  vatRate?: number;
  /** Präfix der Rechnungsnummer, z.B. „RE-" → RE-2026-0001. */
  prefix?: string;
  /** Übernommenes Format (statt Präfix), z.B. „{JJJJ}-{NR:4}“ – siehe numbering.ts. */
  numberFormat?: string;
  /** Für B2B-Rechnungen: Bankverbindung (erscheint auf der Rechnung und in der E-Rechnung). */
  iban?: string;
  bic?: string;
  bankName?: string;
  /** Zahlungsziel in Tagen für B2B-Rechnungen (Vorgabe 14). */
  paymentDays?: number;
  /** Erste Nummer im Jahr `startNumberYear` — für den Umstieg von einem anderen Programm. */
  startNumber?: number;
  startNumberYear?: number;
  /** Freitext im Fuß, z.B. Bankverbindung oder Handelsregister. */
  footerText?: string;
  /** Neue bezahlte Bestellungen automatisch abrechnen. */
  autoCreate?: boolean;
  /** Automatisch erstellte Rechnungen gleich per E-Mail verschicken. */
  autoSend?: boolean;
  /** Nur Bestellungen ab diesem Zeitpunkt (ISO) abrechnen — gesetzt beim Einschalten der Automatik. */
  startDate?: string;
  emailSubject?: string;
  emailText?: string;
  /** Postfach des Hauptsystems, über das Rechnungen verschickt werden (leer = Standard-Absender). */
  senderMailboxId?: string;
  /** Früher eigener SMTP-Zugang im eBay-Tool – wird beim nächsten Speichern entfernt. */
  smtp?: unknown;
}

export interface Address {
  name: string;
  lines: string[];
}

/** Eine eBay-Bestellung, reduziert auf das, was eine Rechnung braucht. */
export interface OrderForInvoice {
  orderId: string;
  createdAt: string;
  paidAt?: string;
  paid: boolean;
  cancelled: boolean;
  buyerUsername?: string;
  buyer: Address;
  buyerEmail?: string;
  currency: string;
  items: { title: string; sku?: string; itemId?: string; quantity: number; totalGross: number }[];
  shippingGross: number;
  /** Rabatt als positiver Betrag. */
  discountGross: number;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitGross: number;
  totalGross: number;
}

/**
 * Der eingefrorene Inhalt einer Rechnung. Wird beim Erstellen gespeichert und
 * danach nie verändert — die PDF entsteht jedes Mal genau hieraus.
 */
export interface InvoiceData {
  kind: 'invoice' | 'storno';
  number: string;
  date: string;
  /** Bei Stornos: die Nummer der stornierten Rechnung. */
  cancels?: string;
  orderId: string;
  orderDate: string;
  paidAt?: string;
  buyerUsername?: string;
  seller: {
    companyName: string;
    ownerName?: string;
    addressLines: string[];
    email?: string;
    phone?: string;
    taxNumber?: string;
    vatId?: string;
    footerText?: string;
  };
  buyer: Address;
  /** Für den E-Mail-Versand; steht nicht auf der Rechnung. */
  buyerEmail?: string;
  currency: string;
  lines: InvoiceLine[];
  kleinunternehmer: boolean;
  vatRate: number;
  totalGross: number;
  totalNet: number;
  totalVat: number;
  /** Nur bei B2B-Rechnungen (aus der WaWi geschrieben). */
  b2b?: B2bDetails;
}

/** Steuerfall einer B2B-Rechnung. */
export type TaxCase = 'domestic' | 'eu_supply' | 'reverse_charge' | 'export';

export interface B2bLine {
  description: string;
  quantity: number;
  /** Einheit, z.B. „Stk“. */
  unit: string;
  unitNet: number;
  vatRate: number;
  totalNet: number;
  /** Ware nach § 13b Abs. 2 Nr. 10 UStG (Handy, Tablet, Spielekonsole, integrierter Schaltkreis). */
  device?: boolean;
  /** Für diese Zeile schuldet der Kunde die Steuer (Reverse Charge, 0 %). */
  rc?: boolean;
}

/** Zusatzangaben einer frei geschriebenen Rechnung an Firmenkunden (Preise netto). */
export interface B2bDetails {
  taxCase: TaxCase;
  /** Liefer-/Leistungsdatum (YYYY-MM-DD), ggf. Zeitraum bis `serviceDateTo`. */
  serviceDate: string;
  serviceDateTo?: string;
  dueDate: string;
  paymentDays: number;
  reference?: string;
  customerNumber?: string;
  buyerVatId?: string;
  /** ISO-Ländercode des Kunden. */
  buyerCountry: string;
  /** Anschrift einzeln (für die E-Rechnung). */
  buyerAddress?: { street: string; zip: string; city: string; contact?: string };
  buyerEmail?: string;
  note?: string;
  lines: B2bLine[];
  /** Umsatzsteuer je Satz – Grundlage aller Summen. `rc`: Anteil mit Steuerschuld beim Kunden (§ 13b). */
  vat: { rate: number; net: number; vat: number; rc?: boolean }[];
  /** § 13b Abs. 2 Nr. 10 im Inland angewendet (Handys/Tablets/Konsolen/Chips ab 5.000 €). */
  domesticRc?: boolean;
  bank?: { iban?: string; bic?: string; bankName?: string };
}

export interface InvoiceRecord {
  id: number;
  env: string;
  number: string;
  kind: 'invoice' | 'storno';
  orderId: string;
  cancelsId?: number;
  cancelledById?: number;
  data: InvoiceData;
  createdAt: string;
  emailedAt?: string;
  emailTo?: string;
  emailError?: string;
}
