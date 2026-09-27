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
  smtp?: SmtpSettings;
}

export interface SmtpSettings {
  host?: string;
  port?: number;
  /** true = SSL/TLS ab Verbindungsbeginn (Port 465), false = STARTTLS (Port 587). */
  secure?: boolean;
  user?: string;
  pass?: string;
  /** Absenderadresse; ohne Angabe die Absender-E-Mail aus den Rechnungsdaten. */
  from?: string;
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
