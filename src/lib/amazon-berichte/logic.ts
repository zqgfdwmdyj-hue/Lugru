import { createHash } from "node:crypto";
import { parseAmount, parseDate } from "@/lib/numbers";
import { columnAccessor, type Table } from "@/lib/tabular";

// Amazon-Berichte 1–4 (Vorschlag vom 01.11.): Kontozustand, gestrandeter Bestand + gesperrte Angebote,
// Umsatzsteuer-Transaktionsbericht direkt per Schnittstelle, weitere Gebühren (Langzeitlager, Lagerlimit,
// fehlerhafte Inbound-Sendungen). Reine Logik ohne Datenbank – Spaltennamen englisch und deutsch, großzügig gelesen.

const r2 = (n: number) => Math.round(n * 100) / 100;
const orNull = (v: string) => (v === "" ? null : v);
const tag = (v: string) => {
  const d = parseDate(v);
  return d ?? (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
};

// ---- 1. Kontozustand (GET_V2_SELLER_PERFORMANCE_REPORT, JSON) ------------------------------------------------

export type Kennzahl = { rate: number | null; status: string | null; ziel: number | null };
export type Verstoss = { schluessel: string; text: string; anzahl: number; status: string | null };
export type KontoMarkt = {
  marktplatz: string;
  ahrStatus: string | null;
  ahrScore: number | null;
  werte: { odrFba: Kennzahl | null; odrFbm: Kennzahl | null; verspaetet: Kennzahl | null; storniert: Kennzahl | null; tracking: Kennzahl | null; puenktlich: Kennzahl | null; rechnung: Kennzahl | null };
  verstoesse: Verstoss[];
};

/** Deutsche Namen der Richtlinien-Kennzahlen (Seller Central → Kontozustand). */
export const VERSTOSS_TEXT: Record<string, string> = {
  receivedIntellectualPropertyComplaints: "Beschwerden wegen geistigen Eigentums",
  suspectedIntellectualPropertyViolations: "Verdacht auf Verletzung geistigen Eigentums",
  productAuthenticityCustomerComplaints: "Kundenbeschwerden zur Echtheit",
  productConditionCustomerComplaints: "Kundenbeschwerden zum Zustand",
  productSafetyCustomerComplaints: "Kundenbeschwerden zur Produktsicherheit",
  listingPolicyViolations: "Verstöße gegen Angebotsrichtlinien",
  restrictedProductPolicyViolations: "Verstöße gegen Richtlinien für eingeschränkte Produkte",
  customerProductReviewsPolicyViolations: "Verstöße gegen Richtlinien zu Kundenrezensionen",
  foodAndProductSafetyIssues: "Lebensmittel- und Produktsicherheit",
  otherPolicyViolations: "Sonstige Richtlinienverstöße",
  documentRequests: "Dokumentenanfragen",
  regulatoryCompliance: "Einhaltung gesetzlicher Vorschriften",
};
/** Verstöße, bei denen schon einer die Rechte oder das Konto gefährdet. */
const SCHWER = new Set(["receivedIntellectualPropertyComplaints", "suspectedIntellectualPropertyViolations", "productAuthenticityCustomerComplaints", "productSafetyCustomerComplaints", "foodAndProductSafetyIssues"]);

const zahl = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
function kennzahl(v: unknown): Kennzahl | null {
  const o = obj(v);
  if (!o) return null;
  const rate = zahl(o.rate);
  const status = typeof o.status === "string" ? o.status : null;
  if (rate === null && !status) return null;
  return { rate, status, ziel: zahl(o.targetValue) };
}

/** Leser für den Leistungsbericht des Verkäufers; unbekannte Felder werden übergangen. */
export function leseKontozustand(json: unknown): KontoMarkt[] {
  const wurzel = obj(json);
  const liste = Array.isArray(wurzel?.performanceMetrics) ? (wurzel!.performanceMetrics as unknown[]) : Array.isArray(json) ? (json as unknown[]) : wurzel ? [wurzel] : [];
  const out: KontoMarkt[] = [];
  for (const e of liste) {
    const m = obj(e);
    if (!m) continue;
    const ahr = obj(m.accountHealthRating);
    const odr = obj(m.orderDefectRate);
    const verstoesse: Verstoss[] = [];
    for (const [k, v] of Object.entries(m)) {
      const o = obj(v);
      const n = o ? zahl(o.defectsCount) : null;
      if (n === null) continue;
      verstoesse.push({ schluessel: k, text: VERSTOSS_TEXT[k] ?? k.replace(/([A-Z])/g, " $1").trim(), anzahl: n, status: typeof o!.status === "string" ? (o!.status as string) : null });
    }
    out.push({
      marktplatz: typeof m.marketplaceId === "string" ? m.marketplaceId : "",
      ahrStatus: typeof ahr?.ahrStatus === "string" ? (ahr.ahrStatus as string) : null,
      ahrScore: zahl(ahr?.ahrScore),
      werte: {
        odrFba: kennzahl(odr?.afn),
        odrFbm: kennzahl(odr?.mfn),
        verspaetet: kennzahl(m.lateShipmentRate),
        storniert: kennzahl(m.preFulfillmentCancellationRate),
        tracking: kennzahl(m.validTrackingRate),
        puenktlich: kennzahl(m.onTimeDeliveryRate),
        rechnung: kennzahl(m.invoiceDefectRate),
      },
      verstoesse: verstoesse.sort((a, b) => b.anzahl - a.anzahl),
    });
  }
  return out;
}

export type KontoStufe = "gut" | "warnung" | "kritisch";
const GUT = /^(GOOD|GREAT|HEALTHY|NONE|NO_DATA|)$/i;
const WERT_TEXT: Record<keyof KontoMarkt["werte"], string> = { odrFba: "Bestellmängelquote (FBA)", odrFbm: "Bestellmängelquote (Händlerversand)", verspaetet: "Verspätete Lieferungen", storniert: "Stornoquote vor Versand", tracking: "Gültige Sendungsverfolgung", puenktlich: "Pünktliche Zustellung", rechnung: "Rechnungsmängel" };
const pct = (v: number) => `${(Math.round(v * 10000) / 100).toLocaleString("de-DE")} %`;

/**
 * Bewertung eines Marktplatzes, mit Vergleich zum letzten Stand: kritisch = Kontozustand „gefährdet/kritisch“
 * (Wert unter 100 bzw. Status AT_RISK/CRITICAL) oder neue schwere Beschwerde (Marke, Echtheit, Sicherheit);
 * Warnung = Wert unter 200, Kennzahl außerhalb des Ziels oder offene Verstöße.
 */
export function kontoBewerten(neu: KontoMarkt, alt: KontoMarkt | null): { stufe: KontoStufe; gruende: string[]; neu: Verstoss[] } {
  const gruende: string[] = [];
  let stufe: KontoStufe = "gut";
  const hoch = (s: KontoStufe) => {
    if (s === "kritisch" || (s === "warnung" && stufe === "gut")) stufe = s;
  };
  const st = (neu.ahrStatus ?? "").toUpperCase();
  if (st === "CRITICAL" || st === "UNHEALTHY" || (neu.ahrScore !== null && neu.ahrScore < 100)) {
    hoch("kritisch");
    gruende.push(`Kontozustand kritisch${neu.ahrScore !== null ? ` (${neu.ahrScore})` : ""}`);
  } else if (st === "AT_RISK" || (neu.ahrScore !== null && neu.ahrScore < 200)) {
    hoch("kritisch");
    gruende.push(`Kontozustand gefährdet${neu.ahrScore !== null ? ` (${neu.ahrScore})` : ""}`);
  } else if (st === "FAIR") {
    hoch("warnung");
    gruende.push("Kontozustand nur „ausreichend“");
  }
  for (const [k, w] of Object.entries(neu.werte) as [keyof KontoMarkt["werte"], Kennzahl | null][]) {
    if (w && w.status && !GUT.test(w.status)) {
      hoch("warnung");
      gruende.push(`${WERT_TEXT[k]}${w.rate !== null ? ` ${pct(w.rate)}` : ""}${w.ziel !== null ? ` (Ziel ${pct(w.ziel)})` : ""}`);
    }
  }
  const vorher = new Map((alt?.verstoesse ?? []).map((v) => [v.schluessel, v.anzahl]));
  const neuDazu: Verstoss[] = [];
  for (const v of neu.verstoesse) {
    if (v.anzahl <= 0) continue;
    const mehr = v.anzahl - (vorher.get(v.schluessel) ?? 0);
    if (mehr > 0 && alt) neuDazu.push({ ...v, anzahl: mehr });
    if (SCHWER.has(v.schluessel) && mehr > 0) hoch("kritisch");
    else hoch("warnung");
    gruende.push(`${v.text}: ${v.anzahl}${mehr > 0 && alt ? ` (+${mehr} neu)` : ""}`);
  }
  return { stufe, gruende, neu: neuDazu };
}

// ---- 2. Gestrandeter Bestand + gesperrte Angebote -------------------------------------------------------------

export type GestrandetZeile = { sku: string; asin: string | null; fnsku: string | null; titel: string | null; grund: string | null; seit: string | null; autoEntfernung: string | null; menge: number; preis: number | null; aktion: string | null };

/** GET_STRANDED_INVENTORY_UI_DATA bzw. Seller Central → Bestand → „Gestrandeter Bestand“. */
export function leseGestrandet(t: Table): GestrandetZeile[] {
  const a = columnAccessor(t.headers);
  const out: GestrandetZeile[] = [];
  for (const r of t.rows) {
    const sku = a.get(r, "sku", "seller-sku", "händler-sku");
    if (!sku) continue;
    const n = (...k: string[]) => parseAmount(a.get(r, ...k)) ?? 0;
    out.push({
      sku,
      asin: orNull(a.get(r, "asin").toUpperCase()),
      fnsku: orNull(a.get(r, "fnsku")),
      titel: orNull(a.get(r, "product-name", "produktname", "titel")),
      grund: orNull(a.get(r, "stranded-reason", "grund", "status-primary", "error-message", "fehlermeldung")),
      seit: tag(a.get(r, "date-stranded", "datum-gestrandet", "gestrandet-seit")),
      autoEntfernung: tag(a.get(r, "date-to-take-auto-removal", "datum-automatische-entfernung")),
      menge: Math.round(n("fulfillable-qty", "verkäufliche-menge") + n("unfulfillable-qty", "nicht-verkäufliche-menge") + n("reserved-quantity", "reservierte-menge")),
      preis: parseAmount(a.get(r, "your-price", "ihr-preis")),
      aktion: orNull(a.get(r, "primary-action", "empfohlene-aktion")),
    });
  }
  return out;
}

export type GesperrtZeile = { sku: string; asin: string | null; titel: string | null; status: string | null; grund: string | null; seit: string | null };

/** GET_MERCHANTS_LISTINGS_FYP_REPORT („Unterdrückte/gesperrte Angebote“). */
export function leseGesperrt(t: Table): GesperrtZeile[] {
  const a = columnAccessor(t.headers);
  const out: GesperrtZeile[] = [];
  for (const r of t.rows) {
    const sku = a.get(r, "sku", "seller-sku");
    if (!sku) continue;
    const grund = [a.get(r, "reason", "grund"), a.get(r, "issue-description", "problembeschreibung")].filter(Boolean).join(" – ");
    out.push({ sku, asin: orNull(a.get(r, "asin").toUpperCase()), titel: orNull(a.get(r, "product-name", "produktname")), status: orNull(a.get(r, "status")), grund: orNull(grund), seit: tag(a.get(r, "status-change-date", "datum-der-statusänderung")) });
  }
  return out;
}

/** Gebundenes Kapital: Menge × EK (netto) je SKU; ohne EK zählt die Zeile nicht, wird aber gezählt. */
export function gebundenesKapital(zeilen: { sku: string; menge: number }[], ek: Map<string, number>): { summe: number; ohneEk: number; stueck: number } {
  let summe = 0;
  let ohneEk = 0;
  let stueck = 0;
  for (const z of zeilen) {
    stueck += z.menge;
    const e = ek.get(z.sku);
    if (e && e > 0) summe += e * z.menge;
    else if (z.menge > 0) ohneEk++;
  }
  return { summe: r2(summe), ohneEk, stueck };
}

/** Automatische Entfernung innerhalb von `tage` Tagen? */
export const entfernungBald = (autoEntfernung: string | null, heute: string, tage = 7) => Boolean(autoEntfernung && autoEntfernung >= heute && Math.round((Date.parse(`${autoEntfernung}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 86_400_000) <= tage);

// ---- 4. Weitere Gebühren -------------------------------------------------------------------------------------

export type GebuehrArt = "langzeitlager" | "lagerlimit" | "inbound_mangel" | "inbound_platzierung";
export const GEBUEHR_TEXT: Record<GebuehrArt, string> = {
  langzeitlager: "Langzeit-Lagergebühr / Zuschlag für Altbestand",
  lagerlimit: "Überschreitung des Lagerlimits / Lagerauslastung",
  inbound_mangel: "Fehlerhafte Sendungen ans Lager (Inbound-Mängel)",
  inbound_platzierung: "Inbound-Platzierung",
};

/** Art einer Gebühr aus Typ/Beschreibung (Transaktionsbericht, Abrechnung). */
export function gebuehrArt(text: string | null | undefined): GebuehrArt | null {
  const t = text ?? "";
  if (/long[\s-]*term[\s-]*storage|langzeit[\s-]*lager|aged[\s-]*inventory[\s-]*surcharge|altbestand/i.test(t)) return "langzeitlager";
  if (/(capacity|storage)[\s-]*(limit[\s-]*)?(overage|excess)|lager(limit|kapazit)[\w-]*\s*(überschreit|ueberschreit)|überschreitung\s+des\s+lager|storage[\s-]*utili[sz]ation|lagerauslastung|lagernutzung/i.test(t)) return "lagerlimit";
  if (/inbound[\s-]*(defect|non[\s-]*complian)|unplanned[\s-]*(prep[\s-]*)?service|fehlerhafte\s+(sendung|lieferung)|nichteinhaltung|inbound[\s-]*problem|label(l)?ing[\s-]*fee|prep[\s-]*fee|etikettier/i.test(t)) return "inbound_mangel";
  if (/inbound[\s-]*placement|platzierungs?(gebühr|service)|inbound[\s-]*convenience/i.test(t)) return "inbound_platzierung";
  return null;
}

export type ZusatzZeile = { art: GebuehrArt; rowKey: string; monat: string; datum: string | null; sku: string | null; asin: string | null; fnsku: string | null; sendung: string | null; titel: string | null; menge: number | null; betrag: number; waehrung: string; land: string | null; text: string | null };

const schluessel = (teile: (string | number | null)[]) => createHash("sha1").update(teile.map((x) => x ?? "").join("\u0001")).digest("hex");

/** GET_FBA_FBA_LONGTERM_STORAGE_FEE_CHARGES_DATA (Langzeit-Lagergebühren / Zuschlag Altbestand). */
export function leseLangzeitlager(t: Table): ZusatzZeile[] {
  const a = columnAccessor(t.headers);
  const out: ZusatzZeile[] = [];
  for (const r of t.rows) {
    const datum = tag(a.get(r, "snapshot-date", "stichtag", "datum"));
    const sku = orNull(a.get(r, "sku"));
    const asin = orNull(a.get(r, "asin").toUpperCase());
    if (!datum || (!sku && !asin)) continue;
    const n = (...k: string[]) => parseAmount(a.get(r, ...k));
    const direkt = n("amount-charged", "berechneter-betrag");
    const summe = direkt ?? (n("12-mo-long-terms-storage-fee", "12-mo-long-term-storage-fee") ?? 0) + (n("6-mo-long-terms-storage-fee", "6-mo-long-term-storage-fee") ?? 0);
    if (!summe) continue;
    const menge = n("qty-charged", "berechnete-menge") ?? (n("qty-charged-12-mo-long-term-storage-fee") ?? 0) + (n("qty-charged-6-mo-long-term-storage-fee") ?? 0);
    const land = orNull(a.get(r, "country", "land", "marketplace").toUpperCase());
    out.push({ art: "langzeitlager", rowKey: schluessel(["ltsf", datum, sku, asin, a.get(r, "fnsku"), land, a.get(r, "surcharge-age-tier")]), monat: datum.slice(0, 7), datum, sku, asin, fnsku: orNull(a.get(r, "fnsku")), sendung: null, titel: orNull(a.get(r, "product-name")), menge: menge ? Math.round(menge) : null, betrag: r2(summe), waehrung: a.get(r, "currency", "währung") || "EUR", land, text: orNull(a.get(r, "surcharge-age-tier")) });
  }
  return out;
}

/** GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA (Inbound-Leistung: Probleme je Sendung mit Gebühr). */
export function leseInboundMaengel(t: Table, heute: string): ZusatzZeile[] {
  const a = columnAccessor(t.headers);
  const out: ZusatzZeile[] = [];
  for (const r of t.rows) {
    const sendung = orNull(a.get(r, "shipment-id", "sendungsnummer", "sendung"));
    const problem = a.get(r, "problem-type", "problemtyp", "issue-type");
    if (!sendung && !problem) continue;
    const betrag = parseAmount(a.get(r, "fee-total", "total-fee", "fee-amount", "gebühr-gesamt", "gebühr"));
    const datum = tag(a.get(r, "date", "problem-date", "created-date", "datum")) ?? heute;
    const sku = orNull(a.get(r, "merchant-sku", "sku", "seller-sku"));
    out.push({ art: "inbound_mangel", rowKey: schluessel(["inbound", sendung, sku, a.get(r, "fnsku"), problem, datum]), monat: datum.slice(0, 7), datum, sku, asin: orNull(a.get(r, "asin").toUpperCase()), fnsku: orNull(a.get(r, "fnsku", "fulfillment-network-sku")), sendung, titel: orNull(a.get(r, "product-name")), menge: Math.round(parseAmount(a.get(r, "problem-quantity", "problemmenge")) ?? 0) || null, betrag: r2(betrag ?? 0), waehrung: a.get(r, "currency", "währung") || "EUR", land: null, text: orNull([problem, a.get(r, "fee-type", "gebührenart")].filter(Boolean).join(" – ")) });
  }
  return out;
}

/** Monatssummen je Art; Berichtszeilen gehen vor, Transaktionen nur für Arten/Monate ohne Bericht. */
export function weitereJeMonat(bericht: { art: GebuehrArt; monat: string; betrag: number }[], transaktionen: { art: GebuehrArt; monat: string; betrag: number }[]): { monat: string; art: GebuehrArt; betrag: number; quelle: "bericht" | "transaktionen" }[] {
  const key = (x: { art: string; monat: string }) => `${x.monat}|${x.art}`;
  const m = new Map<string, { monat: string; art: GebuehrArt; betrag: number; quelle: "bericht" | "transaktionen" }>();
  for (const b of bericht) {
    const e = m.get(key(b)) ?? { monat: b.monat, art: b.art, betrag: 0, quelle: "bericht" as const };
    e.betrag = r2(e.betrag + Math.abs(b.betrag));
    m.set(key(b), e);
  }
  for (const t of transaktionen) {
    const k = key(t);
    if (m.get(k)?.quelle === "bericht") continue;
    const e = m.get(k) ?? { monat: t.monat, art: t.art, betrag: 0, quelle: "transaktionen" as const };
    e.betrag = r2(e.betrag + Math.abs(t.betrag));
    m.set(k, e);
  }
  return [...m.values()].sort((x, y) => y.monat.localeCompare(x.monat) || x.art.localeCompare(y.art));
}
