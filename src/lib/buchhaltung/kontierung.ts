// Vorkontierung (SKR04) – reine Logik. Vorschlag für Konto, Steuerschlüssel (DATEV-BU) und Gegenkonto; gelernte
// Regeln je Lieferant gehen vor. Nur Vorschläge – die Bewertung bleibt beim Steuerberater (keine Steuerberatung).

import { namensTeile } from "./abgleich";

export type Kontenrahmen = "SKR04" | "SKR03";

/** Häufige SKR04-Konten (Bezeichnungen gekürzt). */
export const SKR04: Record<string, string> = {
  "1460": "Geldtransit",
  "1600": "Kasse",
  "1800": "Bank",
  "1820": "Kreditkarte (Amex)",
  "3300": "Verbindlichkeiten aus Lieferungen und Leistungen",
  "4400": "Erlöse 19 % USt",
  "5200": "Wareneingang",
  "5300": "Wareneingang 7 % Vorsteuer",
  "5400": "Wareneingang 19 % Vorsteuer",
  "5425": "Innergemeinschaftlicher Erwerb 19 % VSt/USt",
  "6300": "Sonstige betriebliche Aufwendungen",
  "6310": "Miete (unbewegliche Wirtschaftsgüter)",
  "6400": "Versicherungen",
  "6420": "Beiträge",
  "6520": "Kfz-Versicherungen",
  "6530": "Laufende Kfz-Betriebskosten",
  "6600": "Werbekosten",
  "6640": "Bewirtungskosten",
  "6670": "Reisekosten Unternehmer Fahrtkosten",
  "6680": "Reisekosten Unternehmer Übernachtung",
  "6710": "Verpackungsmaterial",
  "6740": "Ausgangsfrachten",
  "6770": "Verkaufsprovisionen",
  "6780": "Fremdarbeiten (Vertrieb)",
  "6800": "Porto",
  "6805": "Telefon",
  "6810": "Telefax und Internetkosten",
  "6815": "Bürobedarf",
  "6825": "Rechts- und Beratungskosten",
  "6830": "Buchführungskosten",
  "6837": "Lizenzen, Software-Abonnements",
  "6855": "Nebenkosten des Geldverkehrs",
};

/** Konten, auf denen DATEV die Vorsteuer selbst rechnet (Automatikkonten) – kein BU-Schlüssel nötig. */
export const AUTOMATIK = new Set(["5300", "5400", "5425"]);
/** DATEV-Steuerschlüssel (Vorsteuer) für Nicht-Automatikkonten. */
export const BU = { vst19: "9", vst7: "8" } as const;

export type Geldkonten = { bank: string; kreditkarte: string; transit: string; marktplatz: string };
export const GELDKONTEN_STANDARD: Geldkonten = { bank: "1800", kreditkarte: "1820", transit: "1460", marktplatz: "1460" };

type Regel = { muster: RegExp; konto: string; grund: string };
/** Reihenfolge = Vorrang. Wareneinkauf kommt über die Belegart (kind „goods“). */
const REGELN: Regel[] = [
  { muster: /\b(dhl|deutsche post|dpd|ups|hermes|gls|go express|internetmarke|sendcloud|shipcloud)\b/i, konto: "6740", grund: "Versanddienstleister" },
  { muster: /amazon (eu|services europe|payments).*?(geb[üu]hr|fee|seller|verk[äa]uf)|seller fees|verkaufsgeb[üu]hr|ebay.*geb[üu]hr|provision/i, konto: "6770", grund: "Marktplatz-Gebühren" },
  { muster: /amazon (online|advertising|ads)|google ads|meta platforms|facebook ads|tiktok ads|werbung|sponsored/i, konto: "6600", grund: "Werbung" },
  { muster: /sellerboard|keepa|helium|jungle scout|bqool|repricer|google workspace|microsoft|adobe|canva|notion|openai|anthropic|chatgpt|shopify|lexoffice|sevdesk|software|lizenz|abo\b|subscription/i, konto: "6837", grund: "Software/Abo" },
  { muster: /hetzner|ionos|strato|all-inkl|hosting|domain|vodafone.*internet|telekom.*internet|glasfaser/i, konto: "6810", grund: "Internet/Hosting" },
  { muster: /telekom|vodafone|o2|telefonica|1&1|congstar|mobilfunk/i, konto: "6805", grund: "Telefon" },
  { muster: /prep ?center|fulfillment|fba prep|lagerdienst/i, konto: "6780", grund: "Fremdleistung Vertrieb (Prep/Fulfillment)" },
  { muster: /verpackung|kartonage|karton|luftpolster|klebeband|ratioform|packmittel/i, konto: "6710", grund: "Verpackungsmaterial" },
  { muster: /steuerberat|steuerkanzlei|buchhaltung|buchführung/i, konto: "6830", grund: "Buchführung/Steuerberatung" },
  { muster: /rechtsanwalt|anwaltskanzlei|notar|beratung/i, konto: "6825", grund: "Rechts- und Beratungskosten" },
  { muster: /restaurant|gastst[äa]tte|bewirtung|caf[eé]|pizzeria|trattoria/i, konto: "6640", grund: "Bewirtung (nur 70 % abzugsfähig – Anlass notieren)" },
  { muster: /hotel|booking\.com|airbnb|übernachtung/i, konto: "6680", grund: "Übernachtung" },
  { muster: /deutsche bahn|\bdb\b fernverkehr|lufthansa|ryanair|eurowings|flixbus|taxi|uber/i, konto: "6670", grund: "Fahrtkosten" },
  { muster: /aral|shell|\besso\b|total(energies)?|jet tankstelle|tankstelle|werkstatt|reifen|kfz|tesla/i, konto: "6530", grund: "Kfz-Kosten" },
  { muster: /versicherung|allianz|axa|ergo|hdi|haftpflicht/i, konto: "6400", grund: "Versicherung" },
  { muster: /\bihk\b|handelskammer|beitrag|verband/i, konto: "6420", grund: "Beiträge" },
  { muster: /miete|lagermiete|pacht/i, konto: "6310", grund: "Miete" },
  { muster: /b[üu]robedarf|papier|toner|druckerpatrone|office/i, konto: "6815", grund: "Bürobedarf" },
  { muster: /porto|briefmarke/i, konto: "6800", grund: "Porto" },
];

export type KontierungEingabe = {
  lieferant: string | null;
  text: string;
  /** goods = Wareneinkauf, expense = Kosten, unknown. */
  kind: "goods" | "expense" | "unknown";
  /** USt-Satz des Belegs (0,19 / 0,07 / 0), null = unbekannt. */
  ustSatz: number | null;
  /** Lieferant aus dem EU-Ausland mit USt-IdNr. (innergemeinschaftlich / Reverse Charge). */
  eu?: boolean;
};
export type KontoVorschlag = { konto: string; bu: string | null; grund: string; sicherheit: "hoch" | "mittel" | "niedrig"; hinweis?: string };

/** Schlüssel einer gelernten Regel: Lieferant ohne Rechtsform, klein. */
export const regelSchluessel = (lieferant: string | null | undefined) => namensTeile(lieferant).join(" ") || null;

const buFuer = (konto: string, ust: number | null) => (AUTOMATIK.has(konto) || ust === null || ust === 0 ? null : Math.abs(ust - 0.07) < 0.001 ? BU.vst7 : Math.abs(ust - 0.19) < 0.001 ? BU.vst19 : null);

export function kontoVorschlag(e: KontierungEingabe, gelernt: Map<string, { konto: string; bu: string | null }>): KontoVorschlag {
  const s = regelSchluessel(e.lieferant);
  const g = s ? gelernt.get(s) : undefined;
  if (g) return { konto: g.konto, bu: g.bu, grund: `gelernt für „${e.lieferant}“`, sicherheit: "hoch" };
  const rc = e.eu && (e.ustSatz === 0 || e.ustSatz === null) ? "Reverse Charge/innergemeinschaftlich – Steuerschlüssel mit dem Steuerberater festlegen" : undefined;
  if (e.kind === "goods") {
    if (e.eu && (e.ustSatz === 0 || e.ustSatz === null)) return { konto: "5425", bu: null, grund: "Wareneinkauf EU-Lieferant", sicherheit: "mittel", hinweis: "Innergemeinschaftlicher Erwerb – mit dem Steuerberater abstimmen" };
    const konto = e.ustSatz !== null && Math.abs(e.ustSatz - 0.07) < 0.001 ? "5300" : e.ustSatz === 0 ? "5200" : "5400";
    return { konto, bu: null, grund: "Wareneinkauf", sicherheit: e.ustSatz === null ? "mittel" : "hoch" };
  }
  const text = `${e.lieferant ?? ""} ${e.text}`;
  const r = REGELN.find((x) => x.muster.test(text));
  if (r) return { konto: r.konto, bu: rc ? null : buFuer(r.konto, e.ustSatz ?? 0.19), grund: r.grund, sicherheit: "mittel", ...(rc ? { hinweis: rc } : {}) };
  return { konto: "6300", bu: rc ? null : buFuer("6300", e.ustSatz ?? 0.19), grund: "keine Regel – sonstiger Aufwand", sicherheit: "niedrig", ...(rc ? { hinweis: rc } : {}) };
}

/** USt-Satz aus Netto/Brutto (gerundet auf 0, 7 oder 19 %), sonst null. */
export function ustSatzAus(netto: number | null, brutto: number | null): number | null {
  if (netto === null || brutto === null || brutto === 0) return null;
  if (Math.abs(netto - brutto) < 0.01) return 0;
  const s = brutto / netto - 1;
  if (Math.abs(s - 0.19) < 0.006) return 0.19;
  if (Math.abs(s - 0.07) < 0.006) return 0.07;
  return null;
}

const EU = /\b(luxembourg|luxemburg|s\.?\s?[àa]\.?\s?r\.?\s?l|ireland|irland|limited|b\.?v\.?|netherlands|niederlande|france|frankreich|italia|italien|españa|spanien|polska|polen|sp\. z o\.o\.|s\.r\.l\.|s\.l\.|sas\b)/i;
/** EU-Ausland grob am Namen/Text erkennen (Amazon EU S.à r.l. Luxemburg u. a.). */
export const wirktEu = (lieferant: string | null, text: string) => EU.test(`${lieferant ?? ""} ${text.slice(0, 2000)}`);
