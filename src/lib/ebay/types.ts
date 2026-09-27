export type Env = 'sandbox' | 'production';

export type Condition = 'NEW' | 'NEW_OTHER' | 'USED_VERY_GOOD' | 'USED_GOOD' | 'USED_ACCEPTABLE';

export type AttemptStatus = 'draft' | 'no_catalog_match' | 'no_images' | 'published' | 'publish_failed';

export interface CompanyContact {
  companyName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  email?: string;
  phone?: string;
  contactUrl?: string;
}

export interface Gpsr {
  manufacturer: CompanyContact;
  responsiblePersons: CompanyContact[];
  sourceItemId: string;
}

export interface CatalogMatch {
  /** Quellen-spezifischer Schlüssel zum Neuladen (bei der Browse-Quelle die Item-ID). */
  ref: string;
  epid?: string;
  title: string;
  imageUrl?: string;
}

export interface CatalogProduct {
  /**
   * Woher Titel und Merkmale stammen: `'catalog'` aus dem eBay-Katalog
   * (product-Block oder ePID-Referenz), `'listing'` allein aus den Fakten des
   * Angebots (Merkmale, Marke, Kategorie) — dann gibt es keinen Katalogbezug,
   * und der Titel muss aus diesen Fakten entstehen oder eingegeben werden.
   */
  origin: 'catalog' | 'listing';
  epid?: string;
  title: string;
  description?: string;
  imageUrls: string[];
  aspects: Record<string, string[]>;
  brand?: string;
  categoryId?: string;
}

/** Ergebnis der EAN-Recherche über eine Produktdatenquelle (aktuell: Browse API). */
export interface EanLookupResult {
  matches: CatalogMatch[];
  product: CatalogProduct | null;
  gpsr: Gpsr | null;
}

export interface ListingAttempt {
  id: number;
  ean: string;
  price: number;
  quantity: number;
  condition: Condition;
  status: AttemptStatus;
  epid?: string;
  catalogMatches?: CatalogMatch[];
  sku?: string;
  offerId?: string;
  listingId?: string;
  title?: string;
  description?: string;
  imageUrls?: string[];
  aspects?: Record<string, string[]>;
  categoryId?: string;
  gpsr?: Gpsr | null;
  warnings?: string[];
  errorMessage?: string;
  /** Gekaufte Einheiten — unabhängig von `quantity`, der Angebots-Stückzahl. */
  purchasedUnits?: number;
  /** Einkaufspreis pro Stück, netto. */
  purchasePrice?: number;
  /**
   * Woran der Einkaufspreis gemessen ist. `'net'` schreibt jeder Speichervorgang
   * seit der Netto-Umstellung; fehlt der Wert, stammt der Preis aus der Zeit
   * davor und ist unbestätigt — damals wurde der gezahlte Betrag eingetragen,
   * also eher brutto. Der Nutzer entscheidet, ob umgerechnet wird.
   */
  purchasePriceBasis?: 'net';
  /** Einkaufsquelle als Rohtext; Link und Händler werden beim Lesen abgeleitet. */
  purchaseSource?: string;
  /** Angedachter Verkaufspreis; belegt beim Anlegen `price` vor. */
  targetPrice?: number;
  /** Artikelzuordnung, einmalig beim Anlegen gesetzt. */
  articleKey?: string;
  /**
   * Versandprofil nur für dieses Angebot. Fehlt es, gilt das Standard-Versandprofil
   * aus den Einstellungen.
   */
  fulfillmentPolicyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  env: Env;
  clientId?: string;
  clientSecret?: string;
  ruName?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
  /**
   * USt-Satz in Prozent — geht ins eBay-Angebot und in die Gewinnrechnung.
   * Gilt wie die Gebühren für beide Umgebungen.
   */
  vatPercentage?: number;
  /** Fallback-Satz, wenn zur Kategorie kein Eintrag existiert. */
  feePercent?: number;
  /** Fixbetrag je Bestellung bis zur Schwelle. */
  feeFixed?: number;
  /** Fixbetrag je Bestellung oberhalb der Schwelle. */
  feeFixedAbove?: number;
  /** Bestellwert, ab dem der höhere Fixbetrag gilt. */
  feeFixedThreshold?: number;
  /** Eigene Sätze je eBay-Kategorie-ID, in Prozent. */
  feeCategoryRates?: Record<string, number>;
  /** Pauschale Versandkosten für die Bemessungsgrundlage. */
  shippingAssumption?: number;
  /** API-Schlüssel für Keepa — Quelle der Amazon-Produktbilder. */
  keepaApiKey?: string;
}
