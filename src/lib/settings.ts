import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ClaimType, TenantSettings } from "@/db/schema";

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  inbound_shortage: "Fehlt beim Wareneingang",
  lost_warehouse: "Im Lager verloren",
  damaged_warehouse: "Im Lager beschädigt",
  reimbursed_below_cost: "Unter EK erstattet",
  return_not_received: "Retoure erstattet, nie angekommen",
  disposed_without_order: "Entsorgt ohne Auftrag",
  removal_incomplete: "Remission unvollständig",
  removal_shipment_stuck: "Remission: Sendung hängt",
  return_damaged: "Retoure bei Amazon beschädigt",
  return_wrong_item: "Anderer Artikel zurück",
  return_condition: "Retoure leer/benutzt/beschädigt (geprüft)",
  refund_too_high: "Zu viel erstattet",
  fbm_safet: "SAFE-T (Händlerversand)",
  other: "Sonstiges",
};

/** Standardwerte. Fristen bitte mit den aktuellen Amazon-Richtlinien abgleichen. */
export const DEFAULT_SETTINGS = {
  vatRate: 0.19,
  importReminderDays: 7,
  claims: {
    dailyLimit: 15,
    resetHour: 14,
    minAmount: 1,
    problemCarriers: "TENDRON",
    windowDays: {
      inbound_shortage: 60,
      lost_warehouse: 60,
      damaged_warehouse: 60,
      reimbursed_below_cost: 60,
      return_not_received: 60,
      disposed_without_order: 60,
      removal_incomplete: 60,
      // Laut Amazon-Richtlinie: ab Tag 15 bis Tag 75 nach Erstellung des Remissionsauftrags.
      removal_shipment_stuck: 75,
      return_damaged: 60,
      return_wrong_item: 60,
      // Ab Rückgabedatum laut Kundenretouren-Bericht – bitte mit der aktuellen Amazon-Richtlinie abgleichen.
      return_condition: 60,
      refund_too_high: 60,
      fbm_safet: 60,
      other: 60,
    } as Record<ClaimType, number>,
  },
  shipper: {} as NonNullable<TenantSettings["shipper"]>,
  dhl: {
    sandbox: true,
    billingNumberPaket: "",
    billingNumberKleinpaket: "",
    productKleinpaket: "V62KP",
    labelFormat: "910-300-700",
    kleinpaketMaxKg: 1,
  },
  /** Prep Center: Standard „ich verschicke selbst“; Gebühren 0 = nicht hinterlegt (nur zählen, nicht rechnen). */
  prep: { name: "Prep Center", defaultShipper: "self" as "self" | "prep", feeShipment: 0, feeExtraItem: 0 },
  /** Warensendung (PPL 290, bis 1.000 g) – Preis ändert sich mit der Preisliste der Post; Format 1 = DIN A4 Normalpapier. */
  /** Fragefeld „Frag das Seller-System“: Claude Opus 5.5, Änderungen nur nach Bestätigung. */
  assistant: { enabled: true, model: "claude-opus-5-5", allowWrite: true },
  post: { productCode: 290, price: 2.7, pageFormatId: 1, pageFormatName: "", labelX: 1, labelY: 1, itemGrams: 300 },
  pricing: { referralRate: 0.15, minProfit: 1, maxPriceFactor: 2, defaultFbaFee: 3.5, storageFee: 0.1, minRoi: 0.2 },
  aging: { unsellableWarnDays: 30, noSaleWarnDays: 180 },
  drive: { folderId: "" },
  /** Wie im bisherigen Retouren-Tool: Rücksendefrist FBA 45 Tage, Amazon zahlt bis Tag 60, FBM 21 Tage. */
  returns: { graceFba: 45, claimFba: 60, graceFbm: 21, marketplace: "sellercentral.amazon.de" },
  /** Retouren-Station: Fall ab 15 € Erstattung, Fotos/Videos 180 Tage, Aktivierungswort aus. */
  retourenStation: { minBetrag: 15, aufbewahrungTage: 180, aktivierungswort: "Station", aktivierungAn: false },
  /** B2B-Deals: Firma bitte unter Einstellungen eintragen (Standard laut Bauauftrag: Wittmann & Grunert GmbH / AdelPrep). */
  b2b: {
    firma: { name: "", handelsname: "", strasse: "", plz: "", ort: "", land: "DE", ustId: "", email: "", telefon: "" },
    marktplaetze: ["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE"],
    minKundenRoi: 0.15,
    mengenFaktor: 1,
    maxKundenProAsin: 3,
    nurBezahlteBestellen: true,
    fehlmengenRegel: "anteilig" as "anteilig" | "zeitpunkt",
    prepGebuehr: 0,
    versandAnteil: 0,
    fastWegProzent: 0.8,
    ustSatz: 0.19,
    lieferadresse: "",
  },
  /** Palettenlager: 14 € je Stellplatz und Monat, die ersten 5 Tage kostenfrei. */
  pallets: {
    pricePerMonth: 14,
    freeDays: 5,
    mode: "monat" as "monat" | "anteilig",
    inFee: 0,
    outFee: 0,
    /** Stellplätze gesamt (0 = nicht angegeben). */
    capacity: 0,
    /** Aufgabe, wenn eine Palette so lange steht (0 = aus). */
    longStayDays: 90,
    /** Aufgabe am Vortag, wenn die freie Zeit endet. */
    remindFreeEnd: true,
    /** Meldungen zu Sendungen (Termin verschoben, angekommen …) auch per E-Mail an alle mit Paletten-Zugriff. */
    shipmentMail: false,
    services: [] as { name: string; price: number }[],
    locations: [] as string[],
    locationsSpec: "",
    lastInventory: null as null | { at: string; scanned: number; found: number; missing: number; unknown: number; duplicates?: number; confirmed?: number },
    /** Frühere Standard-Konditionen (gültig bis einschließlich Monat `until`). */
    rateHistory: [] as { until: string; pricePerMonth: number | null; freeDays: number | null; mode: "monat" | "anteilig" | null; inFee: number | null; outFee: number | null }[],
    /** Sind die Preise netto (zzgl. USt) oder brutto? Ändert nichts an der Rechnung, nur an der Anzeige. */
    pricesAre: "netto" as "netto" | "brutto",
  },
};

export type ResolvedSettings = typeof DEFAULT_SETTINGS;

export function resolveSettings(s: TenantSettings): ResolvedSettings {
  const d = DEFAULT_SETTINGS;
  return {
    vatRate: s.vatRate ?? d.vatRate,
    importReminderDays: s.importReminderDays ?? d.importReminderDays,
    claims: {
      dailyLimit: s.claims?.dailyLimit ?? d.claims.dailyLimit,
      resetHour: s.claims?.resetHour ?? d.claims.resetHour,
      minAmount: s.claims?.minAmount ?? d.claims.minAmount,
      problemCarriers: s.claims?.problemCarriers ?? d.claims.problemCarriers,
      windowDays: { ...d.claims.windowDays, ...(s.claims?.windowDays ?? {}) },
    },
    shipper: { ...d.shipper, ...(s.shipper ?? {}) },
    dhl: { ...d.dhl, ...(s.dhl ?? {}) },
    post: { ...d.post, ...(s.post ?? {}) },
    prep: { ...d.prep, ...(s.prep ?? {}) },
    pricing: { ...d.pricing, ...(s.pricing ?? {}) },
    aging: { ...d.aging, ...(s.aging ?? {}) },
    drive: { ...d.drive, ...(s.drive ?? {}) },
    returns: { ...d.returns, ...(s.returns ?? {}) },
    retourenStation: { ...d.retourenStation, ...(s.retourenStation ?? {}) },
    b2b: { ...d.b2b, ...(s.b2b ?? {}), firma: { ...d.b2b.firma, ...(s.b2b?.firma ?? {}) } },
    pallets: { ...d.pallets, ...(s.pallets ?? {}) },
    assistant: { ...d.assistant, ...(s.assistant ?? {}) },
  };
}

export async function getSettings(tenantId: string): Promise<ResolvedSettings> {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return resolveSettings(t?.settings ?? {});
}
