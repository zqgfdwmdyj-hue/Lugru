// BQool-Dateien je Land direkt aus dem Seller-System (statt BQool-Vorlage → ArbitrageOne → BQool). Reine Logik:
// Regel je SKU und Land, Mindestpreis = Break-even mit landeseigener USt, Höchstpreis, Datei im BQool-Format
// „repricing 1.2.5“ (Tab-getrennt, Dezimalpunkt), Vorlage einlesen (Format + Regeln/Untergrenzen übernehmen),
// Vergleich mit dem Ist-Stand und Warnungen für die Freigabe-Seite.

export const EXPORT_LAENDER = ["DE", "FR", "IT", "ES"] as const;
export type ExportLand = (typeof EXPORT_LAENDER)[number];
export const UST: Record<ExportLand, number> = { DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21 };

export const BQOOL_SPALTEN = ["Channel", "SellerSKU", "Cost", "Additional Cost", "Rule Name", "Min Price", "Max Price", "Shipping", "add-delete", "Group", "Enable Repricing"] as const;
export const BQOOL_ERSTE_ZEILE = "FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)";

/** Feste Teile der Datei. */
export type BqoolFormat = {
  channel: Record<ExportLand, string>;
  shipping: string;
  addDelete: string;
  group: string;
  /** Wert für „Enable Repricing“ bei neuen SKUs (bekannte SKUs behalten ihren Ist-Wert aus BQool). */
  enable: string;
  /** Tabs nach dem Text der ersten Zeile. */
  tabsErsteZeile: number;
  zeilenende: "\r\n" | "\n";
  bom: boolean;
  /** Endet die Datei mit einem Zeilenende? */
  schlussUmbruch: boolean;
  /** Aus einer hochgeladenen Vorlage gelernt (sonst Standard). */
  ausVorlage: boolean;
};

/**
 * Format wie die ArbitrageOne-Datei vom 30.10., die BQool angenommen hat: LF, 10 Tabs hinter Zeile 1, Channel
 * „Amazon DE“, Shipping „0.00“, add-delete und Group leer, Enable Repricing 1/0. (BQools eigene Vorlagen nutzen
 * CRLF und keine Tabs in Zeile 1 – beim Upload wird beides gelesen.)
 */
export const FORMAT_STANDARD: BqoolFormat = {
  channel: { DE: "Amazon DE", FR: "Amazon FR", IT: "Amazon IT", ES: "Amazon ES" },
  shipping: "0.00",
  addDelete: "",
  group: "",
  enable: "1",
  tabsErsteZeile: BQOOL_SPALTEN.length - 1,
  zeilenende: "\n",
  bom: false,
  schlussUmbruch: true,
  ausVorlage: false,
};
/** @deprecated alter Name */
export const FORMAT_ANNAHME = FORMAT_STANDARD;

/**
 * „Cost“ in BQool = EK netto × 1,19 in allen Ländern (so stehen die Werte in den Dateien vom 28./30.10.: deutscher
 * Brutto-EK, unabhängig vom Marktplatz). BQool rechnet bei Margen-Regeln den Mindestpreis selbst aus Cost + Marge.
 */
export function bqoolCost(ekNetto: number, costUst = 0.19): number {
  return Math.round(ekNetto * (1 + costUst) * 100) / 100;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const auf2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
/** Zahl mit Dezimalpunkt, ohne Tausendertrennzeichen, zwei Nachkommastellen. */
export const bqZahl = (n: number) => n.toFixed(2);

/** BQool-Unterregel je Altersstufe: Sales Booster (≤ Min → Min) bzw. Equalizer (≤ Min → Buy Box + 0,01 €, verliert bewusst die Buy Box). */
export type Unterregel = "Sales Booster" | "Equalizer";
/**
 * B33.3 Typ der Altersstufe: „marge“ = „Reset Min Price to Est. Profit Margin = x %“ (BQool setzt den Min täglich auf
 * P(x)); „lowest_price“ = „Lowest Price + x %“ und „sales_maximizer“ = Sales Maximizer – keine feste Marge
 * (Wettbewerbspreis), dafür wird keine Prozentzahl angezeigt und kein Min gerechnet.
 */
export type StufenTyp = "marge" | "lowest_price" | "sales_maximizer";
export type MargeStufe = {
  bisTage: number | null;
  /** Mindestmarge in % – nur bei typ „marge“ (Standard) maßgeblich. */
  marge: number;
  unterregel?: Unterregel;
  typ?: StufenTyp;
  /** „Lowest Price + x %“: x. */
  aufschlag?: number;
  /** Strategie-Name der Stufe in BQool, z. B. „Sales Maximizer“, „Profit Booster“. */
  strategie?: string;
  /** Bedingung der Stufe in BQool, z. B. „Available ≥ 1“, „Inbound ≥ 0“. */
  bedingung?: string;
};

export const stufenTyp = (s: MargeStufe | null | undefined): StufenTyp => s?.typ ?? "marge";
/** Stufe mit fester Marge (Margen-Reset)? */
export const hatFesteMarge = (s: MargeStufe | null | undefined) => !!s && stufenTyp(s) === "marge";

/** Altersbereich einer Stufe als Text: „0–30“, „31–60“, „> 365“. */
export function stufenBereich(stufen: MargeStufe[], i: number): string {
  const bis = stufen[i].bisTage;
  const von = i === 0 ? 0 : (stufen[i - 1].bisTage ?? 0) + 1;
  return bis === null ? `> ${von - 1}` : `${von}–${bis}`;
}

/** Marge/Typ einer Stufe als Text – Stufen ohne feste Marge tragen keine Prozentzahl (B33.3). */
export function stufenText(s: MargeStufe): string {
  const t = stufenTyp(s);
  const zus = [s.strategie && t === "marge" ? s.strategie : null, s.bedingung ? `(${s.bedingung})` : null].filter(Boolean).join(" ");
  if (t === "lowest_price") return `${s.strategie ? `${s.strategie} ` : ""}„Lowest Price + ${String(s.aufschlag ?? 0).replace(".", ",")} %“ – keine feste Marge${s.bedingung ? ` (${s.bedingung})` : ""}`;
  if (t === "sales_maximizer") return `Sales Maximizer – keine feste Marge${s.bedingung ? ` (${s.bedingung})` : ""}`;
  return `${String(s.marge).replace(".", ",")} %${zus ? ` ${zus}` : ""}`;
}

/**
 * Staffel als Eingabetext und zurück: „30:10 SB [Available ≥ 1], 60:8 EQ, 90:LP+6 SM, 180:1 PB, 270:SM, :0“.
 * Wert = Marge in % · „LP+x“ = Lowest Price + x % · „SM“ = Sales Maximizer. Kürzel danach: SB/EQ = Unterregel,
 * PB = Profit Booster, SM hinter LP = Strategie Sales Maximizer. Bedingung in eckigen Klammern.
 */
export function staffelAlsText(stufen: MargeStufe[] | null | undefined): string {
  return (stufen ?? [])
    .map((x) => {
      const t = stufenTyp(x);
      const wert = t === "lowest_price" ? `LP+${x.aufschlag ?? 0}` : t === "sales_maximizer" ? "SM" : String(x.marge);
      const kz = [x.unterregel ? (x.unterregel === "Equalizer" ? "EQ" : "SB") : null, x.strategie === "Profit Booster" ? "PB" : t === "lowest_price" && x.strategie === "Sales Maximizer" ? "SM" : null].filter(Boolean).join(" ");
      return `${x.bisTage ?? ""}:${wert}${kz ? ` ${kz}` : ""}${x.bedingung ? ` [${x.bedingung}]` : ""}`;
    })
    .join(", ");
}

export function staffelAusText(text: string): MargeStufe[] | null {
  const teile = text.split(/,(?![^[]*\])/).map((x) => x.trim()).filter(Boolean);
  if (!teile.length) return null;
  return teile.map((x) => {
    const bed = /\[([^\]]*)\]/.exec(x)?.[1]?.trim();
    const ohne = x.replace(/\[[^\]]*\]/, "").trim();
    const [bis, rest = "0"] = ohne.split(":").map((y) => y.trim());
    const tok = rest.split(/\s+/).filter(Boolean);
    const w = (tok.shift() ?? "0").toUpperCase();
    const kz = tok.map((t) => t.toUpperCase());
    const stufe: MargeStufe = { bisTage: bis ? Number(bis) : null, marge: 0 };
    if (/^LP\+?[\d.,]*$/.test(w)) {
      stufe.typ = "lowest_price";
      stufe.aufschlag = Number(w.replace(/^LP\+?/, "").replace(",", ".") || "0");
    } else if (w === "SM") stufe.typ = "sales_maximizer";
    else stufe.marge = Number(w.replace(",", "."));
    for (const k of kz) {
      if (k === "SB" || k === "SALES" || k === "BOOSTER") stufe.unterregel = "Sales Booster";
      else if (k === "EQ" || k === "EQUALIZER") stufe.unterregel = "Equalizer";
      else if (k === "PB") stufe.strategie = "Profit Booster";
      else if (k === "SM") stufe.strategie = "Sales Maximizer";
    }
    if (bed) stufe.bedingung = bed;
    return stufe;
  });
}

// ---- B33.1 BQool-Formel (aus 20 SKUs belegt) -------------------------------------------------------------------------
// Est. Profit = P/(1+v) − r·P − F − C/(1+v); Marge = Est. Profit / P; Preis für Marge m: P(m) = (F + C/(1+v)) / (1/(1+v) − r − m).
// v = USt des Landes, C = Cost in BQool (Brutto-EK wie in der Datei), r = Provision vom Brutto-Preis (je Kategorie, teils
// in Preisstufen), F = FBA-Gebühr des Landes. „Additional Cost“ und Fixgebühr gehen nicht ein.

/** Provision mit Preisstufen (z. B. Beauty: bis 10 € 8 %, darüber 15 %); `bis` = Preis brutto inklusive. */
export type ProvisionStufe = { bis: number | null; satz: number };
export type Provision = number | ProvisionStufe[];
/** Bekannte Amazon-Preisstufen je Kategorie (erkannt an der Kategorie aus Gebührenvorschau bzw. BQool-Liste). */
export type ProvisionStaffel = { name: string; erkennen: string[]; stufen: ProvisionStufe[] };
export const PROVISION_STAFFELN_STANDARD: ProvisionStaffel[] = [
  { name: "Beauty, Drogerie, Gesundheit, Lebensmittel", erkennen: ["beauty", "drugstore", "health", "personal care", "grocery", "drogerie", "kosmetik", "gesundheit", "lebensmittel"], stufen: [{ bis: 10, satz: 0.08 }, { bis: null, satz: 0.15 }] },
  { name: "Bekleidung", erkennen: ["apparel", "clothing", "bekleidung"], stufen: [{ bis: 15, satz: 0.05 }, { bis: 20, satz: 0.1 }, { bis: null, satz: 0.15 }] },
];

/** Provisionssatz aus Betrag/Preis: auf 0,5-%-Schritte, wenn höchstens 0,15 Prozentpunkte daneben (Cent-Rundung), sonst 4 Stellen. */
export function satzRunden(r: number): number {
  const stufe = Math.round(r * 200) / 200;
  return Math.abs(stufe - r) <= 0.0015 ? stufe : Math.round(r * 10000) / 10000;
}

export function satzBeiPreis(preis: number, provision: Provision): number {
  if (typeof provision === "number") return provision;
  for (const s of provision) if (s.bis === null || preis <= s.bis + 1e-9) return s.satz;
  return provision[provision.length - 1]?.satz ?? 0;
}

/**
 * Kleinster Preis mit Marge ≥ m für Zähler K (Kosten ohne Provision, netto): P = K / (1/(1+v) − r − m). Mit Preisstufen
 * wird je Stufe gerechnet und der kleinste Preis genommen, der in seiner Stufe liegt (so setzt BQool den Min).
 */
function preisFuerMarge(k: number, ust: number, provision: Provision, m: number): number | null {
  const stufen = typeof provision === "number" ? [{ bis: null, satz: provision }] : provision;
  let unten = 0;
  for (const s of stufen) {
    const nenner = 1 / (1 + ust) - s.satz - m;
    const p = nenner > 0 ? k / nenner : null;
    if (p !== null) {
      // Marge schon an der Untergrenze der Stufe erreicht → knapp darüber; sonst liegt p in der Stufe?
      if (p <= unten + 1e-9) return unten + 0.01;
      if (s.bis === null || p <= s.bis + 1e-9) return p;
    }
    unten = s.bis ?? unten;
  }
  return null;
}

/** P(m) laut BQool, auf den Cent gerundet (BQool rundet kaufmännisch). null, wenn Provision + Marge zu hoch. */
export function bqoolPreisFuerMarge(o: { cost: number; fba: number; ust: number; provision: Provision; margeProzent: number }): number | null {
  const p = preisFuerMarge(o.fba + o.cost / (1 + o.ust), o.ust, o.provision, o.margeProzent / 100);
  return p === null ? null : r2(p);
}

/** Est. Profit Margin laut BQool in % (zwei Nachkommastellen). */
export function bqoolMarge(o: { preis: number; cost: number; fba: number; ust: number; provision: Provision }): number | null {
  if (!(o.preis > 0)) return null;
  const r = satzBeiPreis(o.preis, o.provision);
  const gewinn = o.preis / (1 + o.ust) - r * o.preis - o.fba - o.cost / (1 + o.ust);
  return Math.round((gewinn / o.preis) * 10000) / 100;
}

/**
 * Preisstufen einer Kategorie – nur, wenn der beobachtete Satz zum Preis der Beobachtung passt (sonst gilt der
 * beobachtete Satz pauschal, z. B. Elektronik 7 %).
 */
export function provisionFuer(o: { satz: number; preis: number | null; kategorie: string | null; staffeln?: ProvisionStaffel[] }): Provision {
  const kat = (o.kategorie ?? "").toLowerCase();
  if (!kat) return o.satz;
  const st = (o.staffeln ?? PROVISION_STAFFELN_STANDARD).find((x) => x.erkennen.some((e) => kat.includes(e.toLowerCase())));
  if (!st) return o.satz;
  if (o.preis !== null && o.preis > 0 && Math.abs(satzBeiPreis(o.preis, st.stufen) - o.satz) > 0.0025) return o.satz;
  return st.stufen;
}

export type GebuehrenQuelle = "bqool" | "amazon" | "produkt";
export type LandGebuehren = { fba: number; provision: Provision; satz: number; quelle: GebuehrenQuelle; geschaetzt: boolean; kategorie: string | null };
export type GebuehrenBeobachtung = { fba: number | null; satz: number | null; preis: number | null; kategorie: string | null };

/**
 * Gebühren je Land (B33.1: F je Land, nicht aus DE): BQool-Listing-Zeile (Referral, FBA) → Amazon-Gebührenvorschau des
 * Landes → Werte am Produkt (DE). Außerhalb DE ist der Produktwert nur eine Schätzung.
 */
export function gebuehrenFuerLand(o: { land: ExportLand; bqool?: GebuehrenBeobachtung | null; amazon?: GebuehrenBeobachtung | null; produkt: { fba: number; satz: number; geschaetzt?: boolean }; staffeln?: ProvisionStaffel[] }): LandGebuehren {
  const kategorie = o.bqool?.kategorie ?? o.amazon?.kategorie ?? null;
  const prov = (satz: number, preis: number | null) => provisionFuer({ satz, preis, kategorie, staffeln: o.staffeln });
  const quellen: [GebuehrenQuelle, GebuehrenBeobachtung | null | undefined][] = [["bqool", o.bqool], ["amazon", o.amazon]];
  const fbaQ = quellen.find(([, b]) => b?.fba !== null && b?.fba !== undefined);
  const satzQ = quellen.find(([, b]) => b?.satz !== null && b?.satz !== undefined);
  const fba = fbaQ ? fbaQ[1]!.fba! : o.produkt.fba;
  const satz = satzQ ? satzQ[1]!.satz! : o.produkt.satz;
  const quelle: GebuehrenQuelle = fbaQ?.[0] ?? satzQ?.[0] ?? "produkt";
  const geschaetzt = !fbaQ || !satzQ ? o.land !== "DE" || !!o.produkt.geschaetzt : false;
  return { fba, satz, provision: prov(satz, satzQ ? satzQ[1]!.preis : null), quelle, geschaetzt, kategorie };
}
/** Regel „ia“: Mindestmarge nach Lagerdauer 10/8/7/5/3/1/0 % (Stufen änderbar in den Einstellungen). */
export const MARGE_NACH_ALTER: MargeStufe[] = [
  { bisTage: 30, marge: 10, unterregel: "Sales Booster" },
  { bisTage: 60, marge: 8, unterregel: "Equalizer" },
  { bisTage: 90, marge: 7, unterregel: "Equalizer" },
  { bisTage: 180, marge: 5, unterregel: "Equalizer" },
  { bisTage: 270, marge: 3, unterregel: "Sales Booster" },
  { bisTage: 365, marge: 1, unterregel: "Sales Booster" },
  { bisTage: null, marge: 0, unterregel: "Sales Booster" },
];

export function stufeNachAlter(tage: number | null, stufen: MargeStufe[] = MARGE_NACH_ALTER): MargeStufe | null {
  const t = tage ?? 0;
  for (const s of stufen) if (s.bisTage === null || t <= s.bisTage) return s;
  return null;
}

export function margeNachAlter(tage: number | null, stufen: MargeStufe[] = MARGE_NACH_ALTER): number {
  return stufeNachAlter(tage, stufen)?.marge ?? 0;
}

/**
 * Break-even-Mindestpreis brutto je Land (eigene Kosten): P = (FBA + Fixgebühr + EK netto + Zusatzkosten) /
 * (1/(1+USt) − Provision − Zielmarge). Aufgerundet auf den Cent. null, wenn der Nenner ≤ 0 ist (Provision + Marge zu hoch).
 * Provision auch mit Preisstufen (kleinster Preis, der die Marge erreicht).
 */
export function breakEvenMin(o: { ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: Provision; margeProzent: number }): number | null {
  const p = preisFuerMarge(o.fba + o.fix + o.ek + o.zusatz, o.ust, o.provision, o.margeProzent / 100);
  return p === null ? null : auf2(p);
}

/** Höchstpreis: max(Ø Buy Box 90 Tage × Faktor; Listenpreis); ohne beides Mindestpreis × Ersatzfaktor. Nie unter Min. */
export function maxPreis(o: { min: number; bb90: number | null; faktor: number; listenpreis: number | null; ersatzFaktor: number }): number {
  const kandidaten = [o.bb90 !== null && o.bb90 > 0 ? o.bb90 * o.faktor : null, o.listenpreis !== null && o.listenpreis > 0 ? o.listenpreis : null].filter((x): x is number => x !== null);
  const roh = kandidaten.length ? Math.max(...kandidaten) : o.min * o.ersatzFaktor;
  return r2(Math.max(roh, o.min));
}

export type Zuweisung = { regel: string; untergrenze: number | null; quelle: "vorlage" | "hand" | "kapital" | "leiter" };
export type MarkenRegel = { marke: string; land: ExportLand | null; regel: string };

/** Marke als ganzes Wort im Titel (Produkte haben kein eigenes Markenfeld). */
export function titelHatMarke(titel: string | null, marke: string): boolean {
  const m = marke.trim();
  if (!titel || !m) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(titel);
}

/** Ausnahme-Regel trifft: ASIN genau (z. B. „B0…“) oder Marke/Produktname als Wort im Titel. */
export function ausnahmeTrifft(r: MarkenRegel, asin: string | null, titel: string | null): boolean {
  const m = r.marke.trim();
  return /^B0[A-Z0-9]{8}$/i.test(m) ? (asin ?? "").toUpperCase() === m.toUpperCase() : titelHatMarke(titel, m);
}

/**
 * Regel je SKU und Land. Reihenfolge: feste Zuweisung (Vorlage, von Hand, freigegebener Kapital-Vorschlag) →
 * Liquidation laut letztem BQool-Ist (Min als feste Untergrenze) → Markenregel (z. B. Philips DE) → Abverkaufs-Liste →
 * andere Nicht-Standard-Regel laut BQool-Ist (z. B. „Abverkauf DE“) → Standard „ia“. Der Regelname wird zum Schluss
 * auf den Namen gebracht, den es im Land laut Katalog gibt (DE „Abverkauf DE“, FR/IT/ES „Abverkauf“).
 */
export function regelFuer(o: {
  land: ExportLand;
  titel: string | null;
  asin?: string | null;
  zuweisung: Zuweisung | null;
  markenRegeln: MarkenRegel[];
  aufAbverkaufsListe: boolean;
  abverkaufRegel: { DE: string; sonst: string };
  standard: string;
  /** Letzter BQool-Ist-Stand der SKU im Land. */
  ist?: { regel: string | null; min: number | null } | null;
  katalog?: KatalogRegel[];
}): { regel: string; quelle: "zuweisung" | "ist" | "marke" | "abverkauf" | "standard"; untergrenze: number | null } {
  const name = (r: string) => (o.katalog ? regelNameFuerLand(r, o.land, o.katalog) : r);
  if (o.zuweisung) return { regel: name(o.zuweisung.regel), quelle: "zuweisung", untergrenze: o.zuweisung.untergrenze };
  const istKat = o.katalog && o.ist?.regel ? katalogRegel(o.katalog, o.ist.regel) : null;
  if (istKat?.festeUntergrenze) return { regel: istKat.name, quelle: "ist", untergrenze: o.ist?.min ?? null };
  const mr = o.markenRegeln.find((r) => (r.land === null || r.land === o.land) && ausnahmeTrifft(r, o.asin ?? null, o.titel));
  if (mr) return { regel: name(mr.regel), quelle: "marke", untergrenze: null };
  if (o.aufAbverkaufsListe) return { regel: name(o.land === "DE" ? o.abverkaufRegel.DE : o.abverkaufRegel.sonst), quelle: "abverkauf", untergrenze: null };
  if (istKat && !istKat.risiko && istKat.name.trim().toLowerCase() !== o.standard.trim().toLowerCase()) return { regel: name(istKat.name), quelle: "ist", untergrenze: null };
  return { regel: o.standard, quelle: "standard", untergrenze: null };
}

/**
 * Regelname, den es im Land laut Katalog gibt: „Abverkauf“ in DE → „Abverkauf DE“ (wenn im Katalog), „Abverkauf DE“ in
 * FR/IT/ES → „Abverkauf“. Unbekannte Namen bleiben, wie sie sind (der Abgleich meldet sie).
 */
export function regelNameFuerLand(regel: string, land: ExportLand, katalog: KatalogRegel[]): string {
  const gilt = (k: KatalogRegel | null) => !!k && (!k.laender || k.laender.includes(land));
  const basis = regel.trim().replace(/\s+(DE|FR|IT|ES)$/i, "");
  const eigene = katalogRegel(katalog, `${basis} ${land}`);
  if (gilt(eigene)) return eigene!.name;
  const k = katalogRegel(katalog, regel);
  if (gilt(k)) return k!.name;
  const grund = katalogRegel(katalog, basis);
  if (gilt(grund)) return grund!.name;
  return k?.name ?? regel.trim();
}

export type ExportZeile = { land: ExportLand; sku: string; cost: number; zusatz: number; regel: string; min: number; max: number; /** „1“/„0“ – Ist-Wert aus BQool, neue SKUs Standard. */ enable?: string };

/** Datei je Land im BQool-Format (Tab-getrennt, Dezimalpunkt). */
export function bqoolDatei(land: ExportLand, zeilen: ExportZeile[], f: BqoolFormat = FORMAT_STANDARD): string {
  const n = f.zeilenende;
  const kopf = [BQOOL_ERSTE_ZEILE + "\t".repeat(f.tabsErsteZeile), BQOOL_SPALTEN.join("\t")];
  const body = zeilen.map((z) => [f.channel[land], z.sku, bqZahl(z.cost), z.zusatz ? bqZahl(z.zusatz) : "", z.regel, bqZahl(z.min), bqZahl(z.max), f.shipping, f.addDelete, f.group, z.enable ?? f.enable].join("\t"));
  return (f.bom ? "﻿" : "") + [...kopf, ...body].join(n) + (f.schlussUmbruch ? n : "");
}

export type VorlageZeile = { channel: string; sku: string; cost: number | null; zusatz: number | null; regel: string; min: number | null; max: number | null; shipping: string; addDelete: string; group: string; enable: string };

const zahlPunkt = (v: string | undefined): number | null => {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Land aus Dateiname („Liquidation_FR.txt“, „Abverkauf DE.txt“) oder Channel („Amazon.fr“). */
export function landAus(name: string, channel?: string): ExportLand | null {
  const n = /(?:^|[_\s.-])(DE|FR|IT|ES)(?:[_\s.-]|$)/i.exec(name.replace(/\.[a-z]+$/i, "."))?.[1];
  if (n) return n.toUpperCase() as ExportLand;
  const c = /\.(de|fr|it|es)\b|\b(DE|FR|IT|ES)\b/i.exec(channel ?? "");
  const x = (c?.[1] ?? c?.[2])?.toUpperCase();
  return x && (EXPORT_LAENDER as readonly string[]).includes(x) ? (x as ExportLand) : null;
}

/**
 * Eine BQool-Datei (Vorlage vom 28.10. oder eigener Export) lesen: Format (Tabs in Zeile 1, Zeilenende, BOM,
 * feste Spaltenwerte) und Zeilen. Wirft einen Fehler, wenn die erste Zeile nicht „FileType = repricing“ ist.
 */
export function liesBqoolDatei(text: string, dateiname: string): { land: ExportLand | null; format: Omit<BqoolFormat, "channel" | "ausVorlage"> & { channel: string | null }; zeilen: VorlageZeile[] } {
  const bom = text.startsWith("﻿");
  const t = bom ? text.slice(1) : text;
  const zeilenende = t.includes("\r\n") ? "\r\n" : "\n";
  const roh = t.split(/\r?\n/);
  const schlussUmbruch = roh.length > 1 && roh[roh.length - 1] === "";
  const zeilen = schlussUmbruch ? roh.slice(0, -1) : roh;
  if (!/^FileType\s*=\s*repricing/i.test(zeilen[0] ?? "")) throw new Error("Keine BQool-Repricing-Datei (erste Zeile „FileType = repricing …“ fehlt).");
  const tabsErsteZeile = /\t*$/.exec(zeilen[0])![0].length;
  const kopf = (zeilen[1] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => kopf.indexOf(name.toLowerCase());
  const sp = Object.fromEntries(BQOOL_SPALTEN.map((s) => [s, idx(s)])) as Record<(typeof BQOOL_SPALTEN)[number], number>;
  if (sp.SellerSKU < 0) throw new Error("Spalte „SellerSKU“ fehlt in der BQool-Datei.");
  const get = (r: string[], s: (typeof BQOOL_SPALTEN)[number]) => (sp[s] >= 0 ? (r[sp[s]] ?? "") : "");
  const daten: VorlageZeile[] = zeilen
    .slice(2)
    .map((z) => z.split("\t"))
    .filter((r) => get(r, "SellerSKU").trim())
    .map((r) => ({ channel: get(r, "Channel"), sku: get(r, "SellerSKU").trim(), cost: zahlPunkt(get(r, "Cost")), zusatz: zahlPunkt(get(r, "Additional Cost")), regel: get(r, "Rule Name").trim(), min: zahlPunkt(get(r, "Min Price")), max: zahlPunkt(get(r, "Max Price")), shipping: get(r, "Shipping"), addDelete: get(r, "add-delete"), group: get(r, "Group"), enable: get(r, "Enable Repricing") }));
  const erste = daten[0];
  const land = landAus(dateiname, erste?.channel);
  return {
    land,
    format: { channel: erste?.channel ?? null, shipping: erste?.shipping ?? "", addDelete: erste?.addDelete ?? "", group: erste?.group ?? "", enable: erste?.enable || "Y", tabsErsteZeile, zeilenende, bom, schlussUmbruch },
    zeilen: daten,
  };
}

export type IstStand = { regel: string | null; min: number | null; max: number | null; cost?: number | null };
export type Aenderung = { sku: string; art: "neu" | "geaendert" | "gleich"; regelWechsel: boolean; minAlt: number | null; minNeu: number; minDiff: number | null };

/**
 * Vergleich mit dem Ist-Stand (BQool-Export bzw. letzter eigener Export). Cent-genau. `minZaehlt` = false (B33.2: Regel
 * mit Margen-Reset, gleiche Regel): eine reine Min-Abweichung ist keine Änderung – BQool setzt den Min ohnehin täglich
 * auf P(Marge); fehlt in BQool ein Min, zählt sie trotzdem.
 */
export function vergleiche(neu: ExportZeile[], ist: Map<string, IstStand>, o: { minZaehlt?: (z: ExportZeile) => boolean } = {}): Aenderung[] {
  return neu.map((z) => {
    const a = ist.get(z.sku);
    if (!a) return { sku: z.sku, art: "neu", regelWechsel: false, minAlt: null, minNeu: z.min, minDiff: null };
    const regelWechsel = (a.regel ?? "").trim().toLowerCase() !== z.regel.trim().toLowerCase();
    const costGleich = a.cost === undefined || (a.cost !== null && Math.abs(a.cost - z.cost) < 0.005);
    const minEgal = !regelWechsel && a.min !== null && a.min > 0 && o.minZaehlt !== undefined && !o.minZaehlt(z);
    const gleich = !regelWechsel && costGleich && a.min !== null && (minEgal || Math.abs(a.min - z.min) < 0.005) && a.max !== null && Math.abs(a.max - z.max) < 0.005;
    return { sku: z.sku, art: gleich ? "gleich" : "geaendert", regelWechsel, minAlt: a.min, minNeu: z.min, minDiff: a.min !== null ? r2(z.min - a.min) : null };
  });
}

/** Warnungen je Zeile: Min über Buy Box × 1,2 (verliert die Buy Box), Min unter Break-even (Liquidation). */
export function warnungen(z: Pick<ExportZeile, "min" | "max">, o: { buybox: number | null; breakEven: number | null; bbFaktor?: number }): string[] {
  const w: string[] = [];
  const f = o.bbFaktor ?? 1.2;
  if (o.buybox !== null && o.buybox > 0 && z.min > o.buybox * f) w.push(`Min ${bqZahl(z.min)} über Buy Box ${bqZahl(o.buybox)} × ${String(f).replace(".", ",")} – verliert die Buy Box`);
  if (o.breakEven !== null && z.min < o.breakEven - 0.005) w.push(`Min ${bqZahl(z.min)} unter Break-even ${bqZahl(o.breakEven)}`);
  if (z.max < z.min) w.push("Max unter Min");
  return w;
}

/**
 * Min aus dem letzten BQool-Upload liegt über der Buy Box, der effektive Min aber darunter: der alte Upload blockiert
 * die Buy Box (B17).
 */
export function minBlockiertBuybox(o: { istMin: number | null; effMin: number | null; buybox: number | null }): string | null {
  if (o.istMin === null || o.effMin === null || o.buybox === null) return null;
  if (!(o.istMin > o.buybox + 0.005 && o.effMin < o.istMin - 0.005)) return null;
  const f = (n: number) => n.toFixed(2).replace(".", ",");
  return `Min aus Upload blockiert Buy Box – neuer Upload mit Min = effektiver Min empfohlen (Min ${f(o.istMin)} > Buy Box ${f(o.buybox)}; effektiver Min ${f(o.effMin)})`;
}

/** Kapital-Ampel-Vorschlag: Rot und Reichweite über der Grenze → „Abverkauf“ (gilt erst nach Freigabe). */
export function abverkaufVorschlagen(k: { ampel: "gruen" | "gelb" | "rot"; reichweite: number | null } | null, rotReichweite: number): boolean {
  return !!k && k.ampel === "rot" && k.reichweite !== null && k.reichweite > rotReichweite;
}

// ---- Regel-Katalog (spiegelt BQool; die Logik der Regeln steht nur in BQool) -------------------------------------

export type KatalogRegel = {
  /** Weitere Namen, unter denen BQool die Regel exportiert (B19.8: „AI Win Sales Booster“ = Liquidation). */
  aliase?: string[];
  /** Name exakt wie in BQool. */
  name: string;
  /** null = alle Länder. */
  laender: ExportLand[] | null;
  strategie: string;
  /** Mindestmarge nach Lagerdauer (Margen-Regel); null = keine Margen-Untergrenze. */
  staffel: MargeStufe[] | null;
  /** B33.3: Stufen je Land, wie BQool sie zeigt (sonst gilt `staffel`). */
  staffelJeLand?: Partial<Record<ExportLand, MargeStufe[]>>;
  /**
   * B33.2: BQool setzt den Min einmal täglich auf P(Marge der Stufe) zurück („Rule + Min Price“ mit „Reset Min Price to
   * Est. Profit Margin“) – Datei-Min wirkt höchstens bis zum nächsten Reset. Ohne Angabe: Margen-Regeln (Staffel, keine
   * feste Untergrenze) setzen zurück.
   */
  minReset?: boolean;
  /** Regel-ID in BQool je Land (nur zur Anzeige). */
  bqoolIds?: Partial<Record<ExportLand, number>>;
  /** Min Price je SKU und Land maßgeblich (Liquidation). */
  festeUntergrenze: boolean;
  /** Im Abgleich als Risiko melden (z. B. „mbb“ ohne Untergrenze). */
  risiko: boolean;
  hinweis: string;
};

/** B33.2: Überschreibt BQool den Min dieser Regel täglich (Margen-Reset)? */
export function setztMinZurueck(k: KatalogRegel | null | undefined): boolean {
  if (!k) return false;
  return k.minReset ?? (!!k.staffel && !k.festeUntergrenze && !k.risiko);
}

/** Stufen der Regel im Land (B33.3), sonst die allgemeine Staffel. */
export function staffelFuer(k: KatalogRegel | null | undefined, land: ExportLand | null | undefined): MargeStufe[] | null {
  if (!k) return null;
  return (land ? k.staffelJeLand?.[land] : undefined) ?? k.staffel;
}

/**
 * B20.9: „AI Win Sales Booster“ als eigene Strategie im Katalog – BQool-KI, die den Preis so setzt, dass die Buy Box
 * gewonnen und der Abverkauf beschleunigt wird; sie geht bis zum Min Price herunter, nie darunter.
 */
export const AI_WIN_SALES_BOOSTER: KatalogRegel = {
  name: "AI Win Sales Booster",
  laender: null,
  strategie: "BQool-KI: Buy Box gewinnen und Abverkauf beschleunigen (Basis der Liquidation, BQool-ID 2)",
  staffel: null,
  minReset: false,
  festeUntergrenze: true,
  risiko: false,
  hinweis: "Die KI senkt den Preis Schritt für Schritt bis zum Min Price, wenn die Buy Box fehlt oder sich nichts verkauft, und hebt ihn wieder, sobald es läuft. Der Min Price je SKU und Land ist die feste Untergrenze – deshalb Min = Break-even bzw. Liquidationspreis bewusst setzen.",
};

// B33.3 Stufen laut BQool (08.11., aus der Feldreihenfolge abgeleitet – einmal gegen Screenshot prüfen).
// Reihenfolge hier 0–30, 31–60, 61–90, 91–180, 181–270, 271–365, > 365.
const st = (bisTage: number | null, marge: number, x: Omit<MargeStufe, "bisTage" | "marge"> = {}): MargeStufe => ({ bisTage, marge, ...x });
const lp = (bisTage: number | null, aufschlag: number, x: Omit<MargeStufe, "bisTage" | "marge" | "typ" | "aufschlag"> = {}): MargeStufe => ({ bisTage, marge: 0, typ: "lowest_price", aufschlag, ...x });
const sm = (bisTage: number | null, x: Omit<MargeStufe, "bisTage" | "marge" | "typ"> = {}): MargeStufe => ({ bisTage, marge: 0, typ: "sales_maximizer", ...x });
const SB = { unterregel: "Sales Booster" as const };
const EQ = { unterregel: "Equalizer" as const };
export const IA_JE_LAND: Record<ExportLand, MargeStufe[]> = {
  DE: [st(30, 10, { ...SB, bedingung: "Available ≥ 1" }), st(60, 8, EQ), st(90, 7, EQ), st(180, 5, EQ), st(270, 3, SB), st(365, 1, SB), st(null, 0, SB)],
  FR: [st(30, 11, { ...SB, bedingung: "Inbound ≥ 0" }), st(60, 8, EQ), lp(90, 6, { strategie: "Sales Maximizer" }), st(180, 4, EQ), st(270, 3, SB), st(365, 1, SB), st(null, 0, SB)],
  IT: [lp(30, 11, { bedingung: "Inbound ≥ 0" }), st(60, 8, EQ), st(90, 6, EQ), st(180, 4, EQ), st(270, 3, SB), st(365, 1, SB), st(null, 0, SB)],
  ES: [st(30, 11, { ...SB, bedingung: "Available ≥ 1" }), st(60, 8, EQ), st(90, 5, EQ), st(180, 4, EQ), st(270, 3, SB), st(365, 1, SB), st(null, 0, SB)],
};
export const ABVERKAUF_JE_LAND: Record<ExportLand, MargeStufe[]> = {
  DE: [st(30, 5, EQ), st(60, 4, EQ), st(90, 3, EQ), st(180, 1, EQ), st(270, 0, SB), st(365, 1, SB), st(null, 0, SB)],
  FR: [st(30, 5, SB), st(60, 4, SB), lp(90, 3), st(180, 1, { ...SB, strategie: "Profit Booster" }), sm(270), st(365, 1, SB), st(null, 0, SB)],
  IT: [st(30, 5, SB), st(60, 4, SB), st(90, 3, SB), st(180, 1, SB), sm(270), st(365, 1, SB), st(null, 0, SB)],
  ES: [st(30, 5, SB), st(60, 4, SB), st(90, 3, SB), st(180, 1, SB), sm(270), st(365, 1, SB), st(null, 0, SB)],
};
const HINWEIS_B33 = "Stufen laut BQool 08.11. (Zuordnung aus der Feldreihenfolge abgeleitet – einmal gegen Screenshot prüfen).";

/** Stand B33 (BQool 08.11.) – Margen-Regeln setzen den Min täglich zurück, Liquidation/mbb nicht. */
export const KATALOG_STANDARD: KatalogRegel[] = [
  { name: "ia", laender: null, strategie: "Strategie nach FBA-Lageralter, „Rule + Min Price“ mit Margen-Reset (BQool-ID DE 37 · FR 39 · IT 40 · ES 38)", staffel: MARGE_NACH_ALTER, staffelJeLand: IA_JE_LAND, minReset: true, bqoolIds: { DE: 37, FR: 39, IT: 40, ES: 38 }, festeUntergrenze: false, risiko: false, hinweis: `Standard. ${HINWEIS_B33}` },
  { name: "Abverkauf DE", laender: ["DE"], strategie: "wie ia, niedrigere Margen, Margen-Reset (BQool-ID 47)", staffel: ABVERKAUF_JE_LAND.DE, staffelJeLand: { DE: ABVERKAUF_JE_LAND.DE }, minReset: true, bqoolIds: { DE: 47 }, festeUntergrenze: false, risiko: false, hinweis: HINWEIS_B33 },
  // In BQool DE gibt es nur „Abverkauf DE“.
  { name: "Abverkauf", laender: ["FR", "IT", "ES"], strategie: "Abverkauf je Land, Margen-Reset (BQool-ID FR 48 · IT 50 · ES 49)", staffel: ABVERKAUF_JE_LAND.IT, staffelJeLand: { FR: ABVERKAUF_JE_LAND.FR, IT: ABVERKAUF_JE_LAND.IT, ES: ABVERKAUF_JE_LAND.ES }, minReset: true, bqoolIds: { FR: 48, IT: 50, ES: 49 }, festeUntergrenze: false, risiko: false, hinweis: HINWEIS_B33 },
  { name: "Liquidation", aliase: ["AI Win Sales Booster"], laender: null, strategie: "AI Win Sales Booster, fester Min aus Upload, kein Reset (BQool-ID DE 43 · ES 44 · FR 45 · IT 46)", staffel: null, minReset: false, bqoolIds: { DE: 43, ES: 44, FR: 45, IT: 46 }, festeUntergrenze: true, risiko: false, hinweis: "Min Price je SKU und Land maßgeblich (feste Untergrenze); gebrauchte Ware: AI Repricing. Zählt gegen das AI+CR-Kontingent – vor großen Wechseln prüfen." },
  { name: "mbb", laender: null, strategie: "Match Buy Box, kein Reset (BQool-ID 33)", staffel: null, minReset: false, bqoolIds: { DE: 33 }, festeUntergrenze: false, risiko: true, hinweis: "nur hochgeladener Min, keine Marge – Ziel: auf ia umstellen" },
  AI_WIN_SALES_BOOSTER,
];

/**
 * B33.5 Variante 2: BQool-Regel „Schnelldreher“ = Kopie von ia mit allen Stufen auf der Boden-Marge (7 %), Margen-Reset auf
 * 7 %. Ludwig legt sie in BQool an; das System ordnet SKUs über den Rule Name zu. Variante 3 (Modus „Rule“ statt „Rule +
 * Min Price“, kein Reset) = dieselbe Regel mit Min-Reset aus – erst mit einer Test-SKU prüfen.
 */
export function schnelldreherRegel(name: string, margeProzent: number, minReset = true): KatalogRegel {
  const stufen = MARGE_NACH_ALTER.map((x) => ({ bisTage: x.bisTage, marge: margeProzent, unterregel: "Sales Booster" as const }));
  return { name, laender: null, strategie: `Kopie von ia, alle Stufen ${margeProzent} %${minReset ? " (Reset auf die Marge)" : ", Modus „Rule“ ohne Min-Reset – ungeprüft"}`, staffel: stufen, minReset, festeUntergrenze: false, risiko: false, hinweis: `B33.5 Variante ${minReset ? 2 : 3}: in BQool je Land anlegen (von Ludwig), das System ordnet Schnelldreher über den Rule Name zu.` };
}

export const katalogRegel = (katalog: KatalogRegel[], name: string | null | undefined) => {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  // Exakter Name vor Alias („AI Win Sales Booster“ ist eigene Strategie und zugleich Alias der Liquidation).
  return katalog.find((k) => k.name.trim().toLowerCase() === n) ?? katalog.find((k) => (k.aliase ?? []).some((a) => a.trim().toLowerCase() === n)) ?? null;
};

/**
 * Mindestpreis für die Datei: Liquidation = feste Untergrenze. Margen-Regeln (B31.3):
 * - „effektiv“ (Standard): effektiver Min = Break-even mit der Mindestmarge der Altersstufe – harte Untergrenze. Sicher
 *   in beiden Fällen: nimmt BQool den Dateiwert als harten Min, verkauft es nie unter Break-even + Marge; rechnet BQool
 *   den Min selbst aus Cost + Marge, ist er gleich hoch (bei gleichen Gebühren).
 * - „sicherheitsnetz“: Break-even ohne Marge (bisher) – nur richtig, wenn BQool bei Margen-Regeln den Min selbst
 *   rechnet und den Dateiwert nur als unterste Grenze nimmt. Erst nach dem Nachsehen in BQool umstellen.
 * Regeln ohne Staffel (mbb) und unbekannte Regeln: Break-even.
 */
export function dateiMin(o: { regel: KatalogRegel | null; untergrenze: number | null; breakEven: number | null; effMin?: number | null; modus?: "effektiv" | "sicherheitsnetz" }): number | null {
  if (o.regel?.festeUntergrenze || o.untergrenze !== null) return o.untergrenze ?? o.breakEven;
  if ((o.modus ?? "effektiv") === "effektiv" && o.regel?.staffel && o.effMin !== null && o.effMin !== undefined) return o.breakEven !== null ? Math.max(o.effMin, o.breakEven) : o.effMin;
  return o.breakEven;
}

export type EffMin = {
  min: number | null;
  marge: number | null;
  unterregel: Unterregel | null;
  /** wettbewerb = Stufe ohne feste Marge („Lowest Price + x %“, Sales Maximizer) – kein Min gerechnet. */
  art: "untergrenze" | "marge" | "wettbewerb" | "ohne_untergrenze" | "unbekannte_regel";
  stufe: MargeStufe | null;
  /** B33.2: BQool überschreibt den Min täglich mit P(Marge). */
  minReset: boolean;
};

export const KEINE_FESTE_MARGE = "keine feste Marge (Wettbewerbspreis)";

/**
 * Effektiver Mindestpreis je SKU/Land, wie BQool ihn ansetzt (B33.1): P(m) mit der Marge der Altersstufe der Regel im
 * Land, Cost (brutto wie in der Datei), FBA-Gebühr und Provision des Landes. Liquidation = Untergrenze aus dem Upload;
 * Stufe ohne feste Marge = kein Min („keine feste Marge (Wettbewerbspreis)“); Regel ohne Staffel (mbb) bzw. unbekannte
 * Regel = P(0 %).
 */
export function effektiverMin(o: { regel: KatalogRegel | null; land?: ExportLand | null; untergrenze: number | null; cost: number; fba: number; ust: number; provision: Provision; alterTage: number | null }): EffMin {
  const p = (marge: number) => bqoolPreisFuerMarge({ cost: o.cost, fba: o.fba, ust: o.ust, provision: o.provision, margeProzent: marge });
  if (o.regel?.festeUntergrenze) return { min: o.untergrenze, marge: null, unterregel: "Sales Booster", art: "untergrenze", stufe: null, minReset: false };
  if (!o.regel) return { min: p(0), marge: 0, unterregel: null, art: "unbekannte_regel", stufe: null, minReset: false };
  const staffel = staffelFuer(o.regel, o.land);
  if (!staffel) return { min: p(0), marge: 0, unterregel: null, art: "ohne_untergrenze", stufe: null, minReset: setztMinZurueck(o.regel) };
  const stufe = stufeNachAlter(o.alterTage, staffel);
  const reset = setztMinZurueck(o.regel);
  if (stufe && !hatFesteMarge(stufe)) return { min: null, marge: null, unterregel: stufe.unterregel ?? null, art: "wettbewerb", stufe, minReset: false };
  const marge = stufe?.marge ?? 0;
  return { min: p(marge), marge, unterregel: stufe?.unterregel ?? null, art: "marge", stufe, minReset: reset };
}

/**
 * Warum hat BQool die Buy Box nicht? Liegt die Buy Box unter dem effektiven Min: Equalizer → steht bewusst 1 Cent
 * über der Buy Box (Marge geschützt); Sales Booster → steht auf dem Mindestpreis.
 */
export function buyboxErklaerung(o: { buybox: number | null; effMin: number | null; unterregel: Unterregel | null }): string | null {
  if (o.buybox === null || o.effMin === null || o.buybox >= o.effMin) return null;
  if (o.unterregel === "Equalizer") return `Buy Box ${o.buybox.toFixed(2)} liegt unter dem effektiven Min ${o.effMin.toFixed(2)} – steht bewusst 1 Cent über Buy Box (Marge geschützt).`;
  return `Buy Box ${o.buybox.toFixed(2)} liegt unter dem effektiven Min ${o.effMin.toFixed(2)} – BQool steht auf dem Mindestpreis.`;
}

export type AbgleichFall = { land: ExportLand; sku: string; art: "unbekannte_regel" | "ohne_regel" | "risiko_regel" | "liquidation_soll" | "liquidation_ist"; text: string };

/** Ist (BQool-Export) gegen Soll (System) und Katalog: unbekannte Regeln, SKUs ohne Regel, Liquidation-Abweichungen. */
export function abgleich(ist: { land: ExportLand; sku: string; regel: string | null }[], soll: Map<string, string>, katalog: KatalogRegel[]): AbgleichFall[] {
  const out: AbgleichFall[] = [];
  for (const z of ist) {
    const k = katalogRegel(katalog, z.regel);
    const s = soll.get(`${z.land}|${z.sku}`) ?? null;
    if (!z.regel) out.push({ land: z.land, sku: z.sku, art: "ohne_regel", text: `${z.land} ${z.sku}: keine Regel in BQool` });
    else if (!k) out.push({ land: z.land, sku: z.sku, art: "unbekannte_regel", text: `${z.land} ${z.sku}: Regel „${z.regel}“ steht nicht im Katalog` });
    else if (k.risiko) out.push({ land: z.land, sku: z.sku, art: "risiko_regel", text: `${z.land} ${z.sku}: Regel „${z.regel}“ (${k.hinweis})` });
    const liqIst = !!k?.festeUntergrenze;
    const liqSoll = !!katalogRegel(katalog, s)?.festeUntergrenze;
    if (s && liqSoll && !liqIst) out.push({ land: z.land, sku: z.sku, art: "liquidation_soll", text: `${z.land} ${z.sku}: Soll „${s}“, in BQool „${z.regel ?? "–"}“` });
    if (s && liqIst && !liqSoll) out.push({ land: z.land, sku: z.sku, art: "liquidation_ist", text: `${z.land} ${z.sku}: in BQool „${z.regel}“, Soll „${s}“` });
  }
  return out;
}

// ---- B31.6 Min unter Mindestmarge nur mit Regel „Liquidation“ --------------------------------------------------------
// BQool setzt bei Margen-Regeln (ia, Abverkauf …) einen Min unter dem effektiven Min bei der nächsten Preisberechnung auf
// den Margen-Wert zurück. Nur „Liquidation“ nimmt den hochgeladenen Min als feste Untergrenze. Deshalb: gewünschter Min
// unter dem effektiven Min → Regel „Liquidation“ mit festem Min, aber nie unter Break-even ohne ausdrückliche Freigabe.

/** Buy Box so viel über dem effektiven Min der ursprünglichen Regel … */
export const RUECKKEHR_AUFSCHLAG = 0.03;
/** … und so viele Tage am Stück → Vorschlag „zurück auf die ursprüngliche Regel“. */
export const RUECKKEHR_TAGE = 14;
/** Liquidation gilt als „stehen geblieben“, wenn ein BQool-Ist mindestens so viele Stunden nach dem ersten Treffer sie noch zeigt. */
export const TEST_STUNDEN = 12;

/** Name der Liquidations-Regel im Katalog (feste Untergrenze), sonst „Liquidation“. */
export function liquidationsName(katalog: KatalogRegel[]): string {
  return katalog.find((k) => k.festeUntergrenze)?.name ?? "Liquidation";
}

/** Marge in % vom Brutto-Preis bei diesem Preis – Umkehrung von breakEvenMin (eine Nachkommastelle). */
export function margeBeiPreis(o: { preis: number; ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: Provision }): number | null {
  if (!(o.preis > 0)) return null;
  const netto = o.preis * (1 / (1 + o.ust) - satzBeiPreis(o.preis, o.provision));
  return Math.round(((netto - (o.fba + o.fix + o.ek + o.zusatz)) / o.preis) * 1000) / 10;
}

export type MinEntscheidung = {
  regel: string;
  min: number | null;
  /** marge = Margen-Regel, Min ≥ effektiver Min · liquidation_neu = wegen Min unter Marge auf Liquidation · liquidation = Regel ist schon Liquidation · sonst = Regel ohne Staffel/unbekannt. */
  art: "marge" | "liquidation_neu" | "liquidation" | "sonst";
  regelVorher: string | null;
  /** Gewünschter Min lag unter Break-even und wurde ohne Freigabe auf Break-even angehoben. */
  angehoben: boolean;
  unterBreakEven: boolean;
  /** Min unter Break-even ist als „Abverkauf mit Verlust“ freigegeben (Verlust je Stück bis verlustBis). */
  verlustFreigegeben: boolean;
  /** Gewünschter Min unter dem effektiven Min, aber kein Regelwechsel: Buy Box liegt darüber bzw. unbekannt, oder Schnelldreher. */
  keinWechsel: null | "buybox_ueber" | "buybox_unbekannt" | "schnelldreher";
};

/**
 * Min und Regel für die Datei (B31.6):
 * 1. Gewünschter Min ≥ effektiver Min der Margen-Regel → Regel bleibt, Min als Sicherheitsnetz (ohne Wunsch: effektiver Min).
 * 2. Gewünschter Min < effektiver Min → Regel „Liquidation“, Min fest; Untergrenze Break-even (EK + FBA + Provision, ohne
 *    Mindestgewinn), darunter nur mit Freigabe „Verlust akzeptiert bis x €“ je Stück.
 * Regel ist schon Liquidation → Min = gewünschter Min (Untergrenze), sonst Break-even; unter Break-even nur warnen.
 */
export function minEntscheidung(o: { regelName: string; regel: KatalogRegel | null; gewuenscht: number | null; effMin: number | null; breakEven: number | null; verlustBis?: number | null; liquidation: string; /** B31.6b: Regelwechsel nur, wenn die Buy Box unter dem effektiven Min liegt. */ buybox?: number | null; /** B31.8: Schnelldreher – Margen-Boden (Break-even + 7 %), kein Wechsel auf Liquidation. */ boden?: number | null; schnelldreher?: boolean; /** B31.6a: laufende Liquidation – bis „Liquidation bis“ bleiben Regel und fester Min stehen. */ laeuft?: boolean }): MinEntscheidung {
  const be = o.breakEven;
  const vb = o.verlustBis !== null && o.verlustBis !== undefined && o.verlustBis > 0 ? o.verlustBis : null;
  const unter = (m: number | null) => m !== null && be !== null && m < be - 0.005;
  const freigegeben = (m: number | null) => unter(m) && vb !== null && be !== null && m! >= r2(be - vb) - 0.005;
  const boden = o.boden ?? null;
  const mitBoden = (m: number | null) => (m !== null && boden !== null ? Math.max(m, boden) : m);
  const leer = { regelVorher: null, angehoben: false, keinWechsel: null } as const;
  if (o.regel?.festeUntergrenze) {
    // B33.5 Variante 1: Schnelldreher mit Liquidation ohne festen Min → Min = Boden P(7 %)
    const min = o.gewuenscht ?? (o.schnelldreher && boden !== null ? boden : be);
    return { ...leer, regel: o.regelName, min, art: "liquidation", unterBreakEven: unter(min), verlustFreigegeben: freigegeben(min) };
  }
  if (o.regel?.staffel) {
    const basis = o.effMin !== null ? (be !== null ? Math.max(o.effMin, be) : o.effMin) : be;
    if (o.gewuenscht !== null && o.effMin !== null && o.gewuenscht < o.effMin - 0.005) {
      const bb = o.buybox ?? null;
      const keinWechsel = o.schnelldreher ? "schnelldreher" : o.laeuft ? null : bb === null ? "buybox_unbekannt" : bb >= o.effMin - 0.005 ? "buybox_ueber" : null;
      if (!keinWechsel) {
        const unten = be === null ? null : vb !== null ? r2(be - vb) : be;
        const min = unten !== null ? Math.max(o.gewuenscht, unten) : o.gewuenscht;
        return { regel: o.liquidation, min: r2(min), art: "liquidation_neu", regelVorher: o.regelName, angehoben: unten !== null && o.gewuenscht < unten - 0.005, unterBreakEven: unter(min), verlustFreigegeben: freigegeben(min), keinWechsel: null };
      }
      // Kein Regelwechsel: Min-Korrektur auf den effektiven Min genügt (BQool hält ihn), Schnelldreher mit Boden.
      return { ...leer, regel: o.regelName, min: mitBoden(basis), art: "marge", unterBreakEven: false, verlustFreigegeben: false, keinWechsel };
    }
    const min = o.gewuenscht !== null ? (basis !== null ? Math.max(o.gewuenscht, basis) : o.gewuenscht) : basis;
    return { ...leer, regel: o.regelName, min: mitBoden(min), art: "marge", unterBreakEven: false, verlustFreigegeben: false };
  }
  const min = mitBoden(o.gewuenscht ?? be);
  return { ...leer, regel: o.regelName, min, art: "sonst", unterBreakEven: unter(min), verlustFreigegeben: freigegeben(min) };
}

const tageSeit = (von: string, bis: string) => Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);

/**
 * Rückkehr nach Liquidation (B31.6 Punkt 3): Buy Box über effektivem Min der ursprünglichen Regel + 3 %, 14 Tage am
 * Stück → Vorschlag. Ohne Buy Box heute bleibt der Zähler stehen (kein Datenpunkt), darunter fängt er neu an.
 */
export function rueckkehrStand(o: { buybox: number | null; effMinVorher: number | null; ueberSeit: string | null; heute: string; aufschlag?: number; tage?: number }): { ueberSeit: string | null; tage: number; vorschlagen: boolean; schwelle: number | null } {
  if (o.effMinVorher === null) return { ueberSeit: o.ueberSeit, tage: 0, vorschlagen: false, schwelle: null };
  const schwelle = r2(o.effMinVorher * (1 + (o.aufschlag ?? RUECKKEHR_AUFSCHLAG)));
  if (o.buybox === null) return { ueberSeit: o.ueberSeit, tage: o.ueberSeit ? tageSeit(o.ueberSeit, o.heute) : 0, vorschlagen: false, schwelle };
  if (o.buybox <= schwelle) return { ueberSeit: null, tage: 0, vorschlagen: false, schwelle };
  const seit = o.ueberSeit ?? o.heute;
  const tage = tageSeit(seit, o.heute);
  return { ueberSeit: seit, tage, vorschlagen: tage >= (o.tage ?? RUECKKEHR_TAGE), schwelle };
}

/** Test vor dem ersten Regelwechsel: Liquidation + Min stehen nach dem nächsten BQool-Lauf (≥ 12 Std. später) noch. */
export function liquidationStehtNoch(o: { aktivSeit: Date | null; istAm: Date; istRegelFest: boolean; istMin: number | null; minGesetzt: number | null }): boolean {
  if (!o.aktivSeit || !o.istRegelFest || o.istMin === null || o.minGesetzt === null) return false;
  return Math.abs(o.istMin - o.minGesetzt) < 0.01 && o.istAm.getTime() - o.aktivSeit.getTime() >= TEST_STUNDEN * 3_600_000;
}

/** Zeile für Kapital-Ampel und Morgenbericht: „3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even“. */
export function liquidationsZeile(st: { anzahl: number; unterBreakEven: number }): string | null {
  if (!st.anzahl) return null;
  return `${st.anzahl} SKU${st.anzahl === 1 ? "" : "s"} auf Liquidation (Min unter Marge), davon ${st.unterBreakEven} unter Break-even`;
}
