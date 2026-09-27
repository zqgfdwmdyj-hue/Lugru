export interface SettingsData {
  env: 'sandbox' | 'production';
  clientId?: string;
  clientSecret?: string;
  ruName?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
  vatPercentage?: number;
  feePercent?: number;
  feeFixed?: number;
  feeFixedAbove?: number;
  feeFixedThreshold?: number;
  shippingAssumption?: number;
  feeCategoryRates?: Record<string, number>;
  /** '***', wenn ein Schlüssel hinterlegt ist; leer sonst. */
  keepaApiKey?: string;
  locationAddressLine1: string;
  locationCity: string;
  locationPostalCode: string;
}

export interface StatusData {
  env: string;
  keysOk: boolean;
  connected: boolean;
  /** ISO-Zeitstempel, bis wann die eBay-Verbindung gilt — null, wenn nicht verbunden. */
  connectionExpiresAt: string | null;
  policiesOk: boolean;
  locationOk: boolean;
}

export interface PolicyLists {
  fulfillment: { id: string; name: string }[];
  payment: { id: string; name: string }[];
  return: { id: string; name: string }[];
}

/** Was das Grundgerüst an jeden Reiter durchreicht. */
export interface TabContext {
  s: SettingsData;
  status: StatusData | null;
  /** Ändert den lokalen Formularzustand, ohne zu speichern. */
  set: (patch: Partial<SettingsData>) => void;
  /** Führt eine Aktion aus, zeigt Erfolg oder Fehler an und lädt neu. */
  run: (fn: () => Promise<void>, success: string) => Promise<boolean>;
}
