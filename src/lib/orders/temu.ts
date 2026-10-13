import { createHash } from "node:crypto";
import type { Address } from "@/db/tables/core";
import { splitStreet } from "@/lib/shipping/countries";

// Temu Open API (Seller Center für lokale Händler): Signatur, Bestellstatus, Lieferadresse,
// Versanddienstleister und verständliche Fehlertexte. Reine Logik ohne Server-Abhängigkeiten.

export const TEMU_HOSTS = {
  eu: "https://openapi-b-eu.temu.com/openapi/router",
  us: "https://openapi-b-us.temu.com/openapi/router",
  global: "https://openapi-b-global.temu.com/openapi/router",
} as const;
export type TemuRegion = keyof typeof TEMU_HOSTS;
export const TEMU_REGION_LABEL: Record<TemuRegion, string> = { eu: "Europa", us: "USA", global: "Global" };

/** Schnittstellen, die die App bei Temu freigeschaltet haben muss. */
export const TEMU_APIS = [
  { type: "bg.order.list.v2.get", label: "Bestellungen lesen" },
  { type: "bg.order.decryptshippinginfo.get", label: "Lieferadressen" },
  { type: "bg.logistics.companies.get", label: "Versanddienstleister" },
  { type: "bg.logistics.shipment.v2.confirm", label: "Versand melden" },
] as const;

const signValue = (v: unknown) => (typeof v === "string" ? JSON.stringify(v).replace(/^"+|"+$/g, "") : JSON.stringify(v));

/**
 * Signatur einer Anfrage: alle Parameter außer „sign“ nach Namen sortiert, Name und Wert ohne
 * Trenner aneinander (Listen/Objekte als JSON), App-Secret davor und dahinter, MD5 in Großbuchstaben.
 */
export function temuSign(params: Record<string, unknown>, secret: string): string {
  const body = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => k + signValue(params[k]))
    .join("");
  return createHash("md5").update(secret + body + secret, "utf8").digest("hex").toUpperCase();
}

export type TemuLine = {
  orderSn: string;
  goodsId: number;
  skuId: number;
  goodsName?: string;
  spec?: string;
  quantity: number;
  orderStatus?: number;
  isCancelledDuringPending?: boolean;
  productList?: { extCode?: string; productSkuId?: number }[];
};
export type TemuParent = {
  parentOrderSn: string;
  parentOrderStatus: number;
  parentOrderTime?: number;
  updateTime?: number;
  expectShipLatestTime?: number;
  regionId?: number;
};
export type TemuPageItem = { parentOrderMap: TemuParent; orderList?: TemuLine[] };

/** Bestellstatus bei Temu (parentOrderStatus). */
export const TEMU_STATUS: Record<number, string> = {
  1: "Wartend",
  2: "Nicht versandt",
  3: "Storniert",
  4: "Versandt",
  5: "Zugestellt",
  41: "Teilweise storniert",
  51: "Teilweise zugestellt",
};

/** Positionen, die noch gelten (ohne vor dem Versand stornierte). */
export const temuActiveLines = (lines: TemuLine[] | undefined) => (lines ?? []).filter((l) => !l.isCancelledDuringPending && l.orderStatus !== 3);

/**
 * Was unser Auftrag daraus macht. „Wartend“ wird noch nicht übernommen: Solange kann der Käufer
 * Adresse und Menge ändern – Temu empfiehlt, erst ab „Nicht versandt“ zu bearbeiten.
 */
export function temuOrderState(it: TemuPageItem): "pending" | "open" | "cancelled" | "shipped" | "delivered" | null {
  const code = Number(it.parentOrderMap.parentOrderStatus);
  if (code === 3 || ((it.orderList?.length ?? 0) > 0 && temuActiveLines(it.orderList).length === 0)) return "cancelled";
  if (code === 1) return "pending";
  if (code === 2 || code === 41) return "open";
  if (code === 4) return "shipped";
  if (code === 5 || code === 51) return "delivered";
  return null;
}

/** Positionen für unseren Auftrag: Bestellnummer der Position, SKU aus dem Temu-Angebot, Name mit Variante. */
export function temuItems(lines: TemuLine[] | undefined) {
  return temuActiveLines(lines).map((l) => ({
    externalItemId: String(l.orderSn),
    sku: l.productList?.find((p) => p.extCode)?.extCode?.trim() || null,
    title: [l.goodsName, l.spec ? `(${l.spec})` : ""].filter(Boolean).join(" ") || null,
    quantity: Math.max(1, Number(l.quantity) || 1),
  }));
}

// Temu-Regionen (regionId) → Länderkürzel.
const REGION_COUNTRY: Record<number, string> = {
  13: "AT", 20: "BE", 32: "BG", 50: "HR", 52: "CY", 53: "CZ", 54: "DK", 64: "EE", 68: "FI", 69: "FR", 76: "DE", 79: "GR",
  90: "HU", 96: "IE", 98: "IT", 108: "LV", 113: "LT", 114: "LU", 122: "MT", 141: "NL", 151: "NO", 162: "PL", 163: "PT",
  167: "RO", 180: "SK", 181: "SI", 186: "ES", 191: "SE", 192: "CH", 210: "GB", 211: "US",
};
export const temuCountry = (regionId: number | undefined, name?: string) => (regionId && REGION_COUNTRY[regionId]) || name?.trim() || "DE";

export type TemuShipping = {
  receiptName?: string;
  mobile?: string;
  mail?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  postCode?: string;
  regionName1?: string;
  regionName2?: string;
  regionName3?: string;
  regionName4?: string;
  addressExtra?: { firstName?: string; lastName?: string };
};

/** Hinweis am Auftrag, solange Temu die Adresse nur unkenntlich liefert. */
export const TEMU_MASKED_NOTE =
  "Temu hat die Lieferadresse nur unkenntlich geliefert – im Seller Center die Freigabe „Lieferadressen“ (bg.order.decryptshippinginfo.get) erteilen und den neuen Token eintragen. Bis dahin die Adresse aus dem Seller Center übernehmen.";

const txt = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

/** Lieferadresse in unserem Format. „masked“: Temu hat sie nur unkenntlich (mit *) geliefert. */
export function temuAddress(s: TemuShipping, regionId?: number): { address: Address; masked: boolean } {
  const name = [txt(s.addressExtra?.firstName), txt(s.addressExtra?.lastName)].filter(Boolean).join(" ") || txt(s.receiptName);
  const line1 = txt(s.addressLine1);
  const { street, houseNo } = splitStreet(line1);
  const extra = [txt(s.addressLine2), txt(s.addressLine3)].filter(Boolean).join(", ");
  const phone = txt(s.mobile);
  const masked = !line1 || /\*/.test(line1 + name + phone);
  return {
    address: {
      name1: name || undefined,
      name2: extra || undefined,
      street,
      houseNo,
      zip: txt(s.postCode) || undefined,
      city: txt(s.regionName3) || txt(s.regionName4) || undefined,
      country: temuCountry(regionId, txt(s.regionName1)),
      phone: phone && !/\*/.test(phone) ? phone : undefined,
      email: txt(s.mail) || undefined,
    },
    masked,
  };
}

export type TemuCarrier = { logisticsServiceProviderId: number; logisticsServiceProviderName?: string; logisticsBrandName?: string };

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Versanddienstleister bei Temu zu unserem Namen („DHL“, „Deutsche Post“, „DPD“ …). */
export function temuCarrierId(list: TemuCarrier[], carrier: string | null | undefined): number | null {
  let want = norm(carrier || "DHL");
  if (/warenpost|kleinpaket|dhlpaket/.test(want)) want = "dhl";
  if (want === "post") want = "deutschepost";
  let best: { id: number; score: number } | null = null;
  for (const c of list) {
    const names = [c.logisticsServiceProviderName, c.logisticsBrandName].filter((n): n is string => Boolean(n)).map(norm);
    let score = 0;
    for (const n of names) {
      if (n === want) score = Math.max(score, 100);
      else if (n.includes(want)) {
        let s = 50;
        if (/deutschland|germany|de$|paket|parcel/.test(n)) s += 10;
        if (/express/.test(n) && !want.includes("express")) s -= 30;
        score = Math.max(score, s);
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { id: Number(c.logisticsServiceProviderId), score };
  }
  return best?.id ?? null;
}

export const temuCarrierNames = (list: TemuCarrier[]) =>
  [...new Set(list.map((c) => c.logisticsServiceProviderName || c.logisticsBrandName).filter(Boolean))] as string[];

/** Anfrage „Versand melden“: alle noch gültigen Positionen in ein Paket mit dieser Sendungsnummer. */
export function temuShipment(parentOrderSn: string, lines: TemuLine[] | undefined, carrierId: number, trackingNumber: string, warehouseId?: string) {
  return {
    sendType: 0,
    sendRequestList: [
      {
        carrierId,
        trackingNumber: trackingNumber.replace(/\s+/g, ""),
        ...(warehouseId ? { selfShippingWarehouseId: warehouseId } : {}),
        orderSendInfoList: temuActiveLines(lines).map((l) => ({ orderSn: l.orderSn, parentOrderSn, goodsId: l.goodsId, skuId: l.skuId, quantity: l.quantity })),
      },
    ],
  };
}

/** Fehler, bei denen die Region (Server) wohl die falsche ist bzw. der Token dort unbekannt ist. */
export const TEMU_REGION_CODES = new Set([3000020, 3000026, 3000031, 3000033, 5000000, 120011072]);
/** Fehler, die nur im Seller Center / Partner-Portal behoben werden können. */
export const TEMU_ACCESS_CODES = new Set([3000020, 3000022, 3000026, 3000028, 3000031, 3000032, 3000033, 3000034, 5000000, 5000003, 140020001]);

const PARTNER = "Temu-Partner-Portal (partner-eu.temu.com)";
const SELLER = "Seller Center (seller-eu.temu.com → Open Platform → Client-Verwaltung)";

/** Verständlicher Text zu einem Temu-Fehlercode. */
export function temuErrorText(code: number, msg: string, type?: string): string {
  const api = type ? ` (${type})` : "";
  switch (code) {
    case 3000001:
      return "Temu: Signatur ungültig – das App-Secret stimmt nicht. Bitte genau so kopieren, wie es im Partner-Portal steht.";
    case 3000011:
    case 3000012:
      return "Temu: Zeitstempel abgelehnt – die Uhrzeit des Servers weicht ab.";
    case 3000019:
    case 3000020:
    case 3000025:
    case 3000026:
      return `Temu kennt den App-Key nicht. Bitte aus dem ${PARTNER} kopieren und ggf. die Region prüfen.`;
    case 3000021:
    case 3000027:
      return `Die App darf diese Schnittstelle${api} nicht nutzen – im ${PARTNER} bei der App beantragen.`;
    case 3000022:
    case 3000028:
      return "Die App ist bei Temu gesperrt – bitte den Temu-Partner-Support (partner@temu.com) fragen.";
    case 3000030:
    case 3000031:
      return `Temu kennt den Access-Token nicht. Im ${SELLER} die App autorisieren und den neuen Token hier eintragen (Region prüfen).`;
    case 3000032:
      return `Der Access-Token hat keine Freigabe für diese Schnittstelle${api}. Im ${SELLER} die App neu autorisieren (Bestellungen, Lieferadressen und Versand anhaken) und den neuen Token hier eintragen.`;
    case 3000033:
      return "Access-Token und App-Key gehören nicht zusammen – beide aus derselben App nehmen.";
    case 3000034:
      return `Der Access-Token ist abgelaufen oder wurde ersetzt. Im ${SELLER} neu autorisieren und den neuen Token hier eintragen.`;
    case 4000004:
      return "Temu: zu viele Anfragen – gleich noch einmal versuchen.";
    case 5000000:
      return `Temu verweigert den Zugriff (Shop nicht autorisiert). Im ${SELLER} die App autorisieren und den neuen Token eintragen.`;
    case 5000003:
      return `Temu lehnt die Server-Adresse ab: Die IP-Adresse des Servers steht nicht auf der Freigabeliste der App. Im ${PARTNER} bei der App → „Compliance and security assessment“ → Frage 5 die öffentliche IP-Adresse deines Servers eintragen.`;
    case 140020001:
      return "Diese Schnittstelle gibt es nur für lokale Shops (Seller Center seller-eu.temu.com), nicht für Cross-Border-Shops.";
    case 180020001:
      return "Temu gibt für dieses Land keine Lieferadressen heraus.";
    case 180020008:
      return "Temu gibt Lieferadressen erst heraus, wenn im Seller Center die Datenschutzvereinbarung (DPA) unterschrieben ist.";
    case 120012004:
      return "Die Bestellung ist bei Temu schon als versandt gemeldet.";
    case 120014001:
      return "Temu: keine Sendungsnummer angegeben.";
    case 120014020:
      return "Temu kann die Sendungsnummer nicht lesen – ohne Leer- und Sonderzeichen eintragen.";
    case 120014005:
    case 120014008:
    case 120014023:
      return "Temu erkennt die Sendungsnummer für diesen Versanddienstleister nicht – beides prüfen.";
    case 120014022:
      return "Sendungsnummer und Versanddienstleister passen laut Temu nicht zusammen.";
    case 120014003:
    case 120014004:
      return "Diese Sendungsnummer wurde bei Temu schon verwendet.";
    case 120014019:
      return "Temu-eigene Sendungsnummern können so nicht gemeldet werden.";
    case 120012023:
      return "Der Käufer will die Lieferadresse ändern – erst im Seller Center bearbeiten, dann erneut melden.";
    case 120012030:
    case 120017007:
      return "Der Käufer will stornieren – erst im Seller Center beantworten.";
    case 120012031:
      return "Bei Temu läuft für diese Bestellung eine Risikoprüfung – im Seller Center nachsehen.";
    case 120011065:
      return "Temu hat für diese Bestellung noch keine Lieferadresse.";
    case 120012034:
    case 120012035:
    case 120012076:
    case 120011123:
      return "Temu erlaubt diesem Shop gerade keine eigenen Sendungsnummern – Versandlabel bitte über Temu im Seller Center kaufen.";
    case 120011086:
      return "Im Seller Center zuerst Lagerart und Lagermarke ausfüllen (Versandeinstellungen), dann erneut melden.";
    case 120011031:
      return "Im Seller Center ist noch eine Vereinbarung des Versanddienstleisters zu unterschreiben (Startseite).";
    case 120011072:
      return "Falsche Region – unter Anbindungen → Temu die Region prüfen.";
    case 120012007:
    case 120012016:
      return "Temu kennt die Bestellung bzw. Position so nicht (inzwischen geändert?) – im Seller Center prüfen.";
    default:
      return `Temu${api}: ${msg || "unbekannter Fehler"} (Code ${code})`;
  }
}

/** Zeitpunkt aus Temu (Sekunden, manchmal Millisekunden). */
export const temuDate = (v: number | undefined | null) => (v ? new Date(v > 1e12 ? v : v * 1000) : null);
