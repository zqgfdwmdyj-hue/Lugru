import { KATALOG_STANDARD, type BqoolFormat, type ExportLand, type MarkenRegel } from "@/lib/bqool/export-logic";
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ClaimType, TenantSettings } from "@/db/schema";
import { GELDKONTEN_STANDARD } from "@/lib/buchhaltung/kontierung";
import { DEAL_AMPEL_STANDARD } from "@/lib/deal-ampel/logic";
import { STANDARD_EXTERN, type Regel } from "@/lib/delegieren/logic";
import { ARBEITSZEIT_STANDARD, type Arbeitszeit } from "@/lib/tagesplan/logic";
import type { PrepPosten } from "@/lib/shipping/prep";

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
  prep: { name: "Prep Center", defaultShipper: "self" as "self" | "prep", feeShipment: 0, feeExtraItem: 0, preisliste: [] as PrepPosten[] },
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
    minMarge: 0.1,
  },
  /** Kapital-Ampel: Ziel 30 % Jahresrendite auf gebundenes Kapital, gering < 5 %, grün ≤ 60 Tage Reichweite, rot > 120. */
  kapital: { zielRendite: 0.3, geringRendite: 0.05, gruenReichweite: 60, rotReichweite: 120 },
  /** Deal-Ampel: 15 % Zielmarge, Abverkauf ≤ 45 Tage, ab 15 Angeboten rot, Amazon ≥ 50 % gelb, Preisverfall ≥ 10 % gelb. */
  dealAmpel: DEAL_AMPEL_STANDARD,
  /**
   * Deal-Eingang (WhatsApp teilen → prüfen): Ziel-ROI für den max. EK, Reichweite der empfohlenen Menge, Löschfrist,
   * ab wie vielen Zeilen es eine Preisliste ist, Mail-Adresse für Weiterleitungen, iCloud-Link des Kurzbefehls.
   */
  /**
   * BQool-Dateien aus dem System: Standardregel „ia“, Regel-Katalog (spiegelt BQool), Abverkauf-Regelnamen je Land,
   * Markenregeln (z. B. Philips in DE → „Abverkauf“), Max = Ø Buy Box 90 T × Faktor, Fix- und Zusatzkosten je Stück,
   * Format aus Ludwigs Vorlage (null = Annahme bis zur Vorlage).
   */
  bqool: {
    standardRegel: "ia",
    /** Regel-Katalog, der BQool spiegelt (Repricer → Regeln). */
    katalog: KATALOG_STANDARD,
    abverkaufRegel: { DE: "Abverkauf DE", sonst: "Abverkauf" },
    /** „Cost“ = EK netto × (1 + costUst) – so stehen die Werte in den bisherigen BQool-Dateien. */
    costUst: 0.19,
    /** Ausnahmen je Land: ASIN oder Marke/Produktname im Titel → Regel (Stand Bauauftrag 30.10.). */
    markenRegeln: [
      { marke: "B0DT6N95XH", land: "DE", regel: "Abverkauf" },
      ...(["FR", "IT"] as const).flatMap((land) => ["Philips i9000", "Galaxy Watch Ultra", "PS5 Access Controller", "Angelcare"].map((marke) => ({ marke, land, regel: "Abverkauf" }))),
    ] as MarkenRegel[],
    /** Teure Elektronik → „Abverkauf“ in diesen Ländern. */
    elektronikMarken: ["Zyxel", "JBL", "MSI", "Garmin", "DJI", "Gardena"] as string[],
    elektronikLaender: ["FR", "IT", "ES"] as ExportLand[],
    maxFaktor: 1.3,
    fixGebuehr: 0,
    zusatzkosten: 0,
    laender: ["DE", "FR", "IT", "ES"] as ExportLand[],
    format: null as BqoolFormat | null,
  },
  /** Verlust-Stopp: Kosten ohne Verkauf (Lagergebühr, Erstattungskosten) erst ab 5 € je SKU und Woche als Hinweis. */
  verlust: { kostenOhneVerkaufSchwelle: 5 },
  /** VA über Discord: Zeitzone, Ruhezeiten, überfällig täglich erinnern, Einkaufsrechnungen automatisch schicken. */
  va: { zeitzone: "Europe/Berlin", ruheVon: "20:00", ruheBis: "08:00", erinnerungUeberfaellig: true, darfEinkaufsrechnungen: true },
  faelle: { fristen: {} as Record<string, number>, nachfassenTage: 7, betragSchwelle: 200, zustaendig: "va" as "va" | "ludwig" },
  dealEingang: { zielRoi: 20, maxReichweiteTage: 60, aufbewahrungMonate: 12, preislisteAbZeilen: 15, mailAdresse: "", kurzbefehlLink: "" },
  /** Delegieren: externe Zuständige (nur Name), Regeln Aufgabentyp → Person, Ausnahmen („mache ich selbst“). */
  delegieren: { extern: STANDARD_EXTERN, regeln: [] as Regel[], ausnahmen: [] as string[] },
  /** Buchhaltung je Firma (nur LuGru/WiGru – nicht AdelPrep): SKR04, DATEV-Nummern vom Steuerberater, Geldkonten. */
  buchhaltung: { firmen: ["LuGru", "WiGru"], kontenrahmen: "SKR04" as "SKR04" | "SKR03", datev: {} as Record<string, { beraternummer?: string; mandantennummer?: string }>, geldkonten: GELDKONTEN_STANDARD, wjBeginnMonat: 1, ustva: { rhythmus: "aus", dauerfrist: false } as { rhythmus: "monatlich" | "quartal" | "aus"; dauerfrist: boolean } },
  /** Tagesplan: Arbeitszeit je Wochentag (Mo–Fr 9–17 Uhr), je Person abweichend; Aufgaben der nächsten 2 Tage vorziehen. */
  tagesplan: { arbeitszeit: ARBEITSZEIT_STANDARD, personen: {} as Record<string, Arbeitszeit>, vorziehen: 2 },
  amazonBusiness: { stufen: [3, 10, 25], rabatte: [3, 5, 8], minGewinn: 1 },
  /** Liquidität: 5.000 € Reserve, Bestellvorschläge einrechnen, Lieferantenrechnungen ohne Zahlungsziel = sofort bezahlt. */
  liquiditaet: { reserve: 5000, steuern: [] as { name: string; betrag: number; monate: number[]; tag: number }[], kreditkarte: {} as { tag?: number; betrag?: number }, ignoriert: [] as string[], bestellvorschlaege: true, vorschlaegeEinrechnen: false, zahlungszielStandard: 0 },
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
    kapital: { ...d.kapital, ...(s.kapital ?? {}) },
    dealAmpel: { ...d.dealAmpel, ...(s.dealAmpel ?? {}) },
    faelle: { ...d.faelle, ...(s.faelle ?? {}), fristen: { ...d.faelle.fristen, ...(s.faelle?.fristen ?? {}) } },
    dealEingang: { ...d.dealEingang, ...(s.dealEingang ?? {}) },
    va: { ...d.va, ...(s.va ?? {}) },
    verlust: { ...d.verlust, ...(s.verlust ?? {}) },
    bqool: { ...d.bqool, ...(s.bqool ?? {}), abverkaufRegel: { ...d.bqool.abverkaufRegel, ...(s.bqool?.abverkaufRegel ?? {}) } } as typeof d.bqool,
    delegieren: { ...d.delegieren, ...(s.delegieren ?? {}) },
    buchhaltung: { ...d.buchhaltung, ...(s.buchhaltung ?? {}), geldkonten: { ...d.buchhaltung.geldkonten, ...(s.buchhaltung?.geldkonten ?? {}) }, datev: { ...(s.buchhaltung?.datev ?? {}) } },
    tagesplan: { ...d.tagesplan, ...(s.tagesplan ?? {}), arbeitszeit: { ...d.tagesplan.arbeitszeit, ...(s.tagesplan?.arbeitszeit ?? {}) } },
    amazonBusiness: { ...d.amazonBusiness, ...(s.amazonBusiness ?? {}) },
    liquiditaet: { ...d.liquiditaet, ...(s.liquiditaet ?? {}) },
    b2b: { ...d.b2b, ...(s.b2b ?? {}), firma: { ...d.b2b.firma, ...(s.b2b?.firma ?? {}) } },
    pallets: { ...d.pallets, ...(s.pallets ?? {}) },
    assistant: { ...d.assistant, ...(s.assistant ?? {}) },
  };
}

export async function getSettings(tenantId: string): Promise<ResolvedSettings> {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return resolveSettings(t?.settings ?? {});
}
