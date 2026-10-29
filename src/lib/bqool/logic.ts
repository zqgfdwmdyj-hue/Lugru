// BQool-Export („Manage Listings“) einlesen und prüfen. BQool hat keine offene Schnittstelle – der Export wird als
// CSV/XLSX hochgeladen. Spalten werden am Namen erkannt (englisch/deutsch, verschiedene Schreibweisen); unbekannte
// Spalten bleiben als Zusatzangaben erhalten. Reine Logik ohne Datenbank, damit testbar.

export const BQOOL_MAERKTE = ["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE", "UK", "IE"] as const;
export type BqoolMarkt = (typeof BQOOL_MAERKTE)[number];

export type BqoolZeile = {
  marktplatz: BqoolMarkt;
  sku: string;
  asin: string | null;
  titel: string | null;
  versand: "FBA" | "FBM" | null;
  preis: number | null;
  min: number | null;
  max: number | null;
  regel: string | null;
  /** aktiv = BQool bepreist; pausiert/aus = nicht; null = nicht im Export. */
  status: "aktiv" | "pausiert" | null;
  buyboxPreis: number | null;
  /** Wer hat die Buy Box laut Export (Text), eigeneBuybox = wir. */
  buyboxGewinner: string | null;
  eigeneBuybox: boolean | null;
  niedrigsterPreis: number | null;
  angebote: number | null;
  bestand: number | null;
  zusatz: Record<string, string>;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9#]/g, "");
type Feld = "sku" | "asin" | "titel" | "markt" | "versand" | "preis" | "min" | "max" | "regel" | "status" | "bbPreis" | "bbGewinner" | "eigeneBb" | "niedrigst" | "angebote" | "bestand";
const SPALTEN: Record<Feld, string[]> = {
  sku: ["sku", "sellersku", "msku", "merchantsku", "artikelnummer"],
  asin: ["asin"],
  titel: ["productname", "title", "itemname", "producttitle", "produktname", "titel", "name"],
  markt: ["marketplace", "country", "site", "amazonsite", "marktplatz", "land", "region", "store"],
  versand: ["fulfillment", "fulfillmentchannel", "fbafbm", "fulfilledby", "channel", "versand"],
  preis: ["yourprice", "myprice", "currentprice", "price", "listingprice", "preis", "aktuellerpreis", "saleprice"],
  min: ["minprice", "minimumprice", "min", "floorprice", "mindestpreis", "minpreis"],
  max: ["maxprice", "maximumprice", "max", "ceilingprice", "maximalpreis", "hochstpreis", "maxpreis"],
  regel: ["strategy", "strategyname", "repricingstrategy", "rule", "rulename", "repricingrule", "regel", "strategie"],
  status: ["repricingstatus", "status", "repricing", "reprice", "active", "repricerstatus", "aktiv"],
  bbPreis: ["buyboxprice", "bbprice", "buyboxpreis", "featuredofferprice"],
  bbGewinner: ["buyboxwinner", "buyboxowner", "buyboxseller", "buyboxeligibility", "buyboxgewinner", "buyboxinhaber"],
  eigeneBb: ["isbuyboxwinner", "ownbuybox", "youownbuybox", "winningbuybox", "inbuybox", "buyboxwon", "buybox"],
  niedrigst: ["lowestprice", "lowestofferprice", "lowestfbaprice", "lowestnewprice", "niedrigsterpreis"],
  angebote: ["numberofoffers", "offers", "#ofoffers", "offercount", "sellers", "numberofsellers", "anzahlangebote", "angebote"],
  bestand: ["quantity", "inventory", "available", "stock", "qty", "fulfillablequantity", "bestand", "menge"],
};

/** Spalte je Feld: erst genaue Treffer, dann „enthält“ – jede Spalte höchstens einmal. */
export function spaltenZuordnung(headers: string[]): Partial<Record<Feld, number>> {
  const n = headers.map(norm);
  const out: Partial<Record<Feld, number>> = {};
  const used = new Set<number>();
  const take = (f: Feld, i: number) => {
    out[f] = i;
    used.add(i);
  };
  for (const f of Object.keys(SPALTEN) as Feld[]) {
    const i = n.findIndex((h, j) => !used.has(j) && SPALTEN[f].includes(h));
    if (i >= 0) take(f, i);
  }
  // „enthält“ nur für eindeutige Wörter (nicht „price“/„min“/„max“ – sonst verwechselt man Min Price mit Price)
  const contains: [Feld, string[]][] = [
    ["min", ["minprice", "minimum"]],
    ["max", ["maxprice", "maximum"]],
    ["bbPreis", ["buyboxprice"]],
    ["bbGewinner", ["buyboxwinner", "buyboxowner", "buyboxseller"]],
    ["regel", ["strategy", "strategie", "rule", "regel"]],
    ["angebote", ["offers", "sellers"]],
    ["titel", ["productname", "title"]],
  ];
  for (const [f, words] of contains) {
    if (out[f] !== undefined) continue;
    const i = n.findIndex((h, j) => !used.has(j) && words.some((w) => h.includes(w)));
    if (i >= 0) take(f, i);
  }
  return out;
}

/** „€ 12,99“, „12.99“, „EUR 1.234,50“, „1,234.50“ → Zahl; leer/„-“/„N/A“ → null. */
export function zahl(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.replace(/[€$£\s]|EUR|GBP|PLN|SEK/gi, "").trim();
  if (!s || /^(-|n\/?a|none|null|–)$/i.test(s)) return null;
  // 1.234,50 / 12,99 → deutsch; 1.234.567 → Tausender; sonst Punkt = Dezimalzeichen (0.125, 12.99, 1,234.50).
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MARKT_ALIAS: Record<string, BqoolMarkt> = {
  de: "DE", germany: "DE", deutschland: "DE", amazonde: "DE",
  fr: "FR", france: "FR", frankreich: "FR", amazonfr: "FR",
  it: "IT", italy: "IT", italien: "IT", amazonit: "IT",
  es: "ES", spain: "ES", spanien: "ES", amazones: "ES",
  nl: "NL", netherlands: "NL", niederlande: "NL", amazonnl: "NL",
  be: "BE", belgium: "BE", belgien: "BE", amazoncombe: "BE", amazonbe: "BE",
  pl: "PL", poland: "PL", polen: "PL", amazonpl: "PL",
  se: "SE", sweden: "SE", schweden: "SE", amazonse: "SE",
  uk: "UK", gb: "UK", unitedkingdom: "UK", greatbritain: "UK", amazoncouk: "UK", grossbritannien: "UK",
  ie: "IE", ireland: "IE", irland: "IE", amazonie: "IE",
};
export function marktAus(v: string | undefined): BqoolMarkt | null {
  if (!v) return null;
  const k = norm(v.trim().replace(/^(https?:\/\/)?(www\.)?/i, ""));
  return MARKT_ALIAS[k] ?? MARKT_ALIAS[k.replace(/^amazon/, "")] ?? null;
}

const jaNein = (v: string | undefined): boolean | null => {
  if (v === undefined) return null;
  const s = norm(v);
  if (["yes", "ja", "true", "1", "y", "x", "won", "winner", "you", "me", "self"].includes(s)) return true;
  if (["no", "nein", "false", "0", "n", "lost", "-"].includes(s)) return false;
  return null;
};
const statusAus = (v: string | undefined): BqoolZeile["status"] => {
  if (v === undefined || !v.trim()) return null;
  const s = norm(v);
  if (["on", "active", "aktiv", "enabled", "yes", "ja", "true", "1", "repricing"].includes(s)) return "aktiv";
  if (["off", "paused", "pausiert", "inactive", "disabled", "stopped", "no", "nein", "false", "0", "aus"].includes(s)) return "pausiert";
  return null;
};

export type ImportErgebnis = { zeilen: BqoolZeile[]; erkannt: string[]; fehlt: string[]; ohneSku: number; ohneMarkt: number };

/**
 * Export → Zeilen. `standardMarkt` gilt, wenn die Datei keine Marktplatz-Spalte hat (BQool exportiert je Marktplatz).
 * Pflicht ist nur die SKU; ohne Min/Max-Spalte wird gewarnt.
 */
export function leseBqool(headers: string[], rows: string[][], standardMarkt: BqoolMarkt | null): ImportErgebnis {
  const sp = spaltenZuordnung(headers);
  const known = new Set(Object.values(sp));
  const get = (r: string[], f: Feld) => (sp[f] === undefined ? undefined : r[sp[f]!]?.trim());
  let ohneSku = 0;
  let ohneMarkt = 0;
  const zeilen: BqoolZeile[] = [];
  for (const r of rows) {
    const sku = get(r, "sku");
    if (!sku) {
      if (r.some((c) => c?.trim())) ohneSku++;
      continue;
    }
    const markt = marktAus(get(r, "markt")) ?? standardMarkt;
    if (!markt) {
      ohneMarkt++;
      continue;
    }
    const bbGewinner = get(r, "bbGewinner") || null;
    const versand = (get(r, "versand") ?? "").toUpperCase();
    const asin = get(r, "asin")?.toUpperCase() || null;
    zeilen.push({
      marktplatz: markt,
      sku,
      asin: asin && /^[A-Z0-9]{10}$/.test(asin) ? asin : null,
      titel: get(r, "titel")?.slice(0, 300) || null,
      versand: versand.includes("FBA") || versand.includes("AMAZON") || versand === "AFN" ? "FBA" : versand.includes("FBM") || versand.includes("MERCHANT") || versand === "MFN" ? "FBM" : null,
      preis: zahl(get(r, "preis")),
      min: zahl(get(r, "min")),
      max: zahl(get(r, "max")),
      regel: get(r, "regel") || null,
      status: statusAus(get(r, "status")),
      buyboxPreis: zahl(get(r, "bbPreis")),
      buyboxGewinner: bbGewinner,
      eigeneBuybox: jaNein(get(r, "eigeneBb")) ?? (bbGewinner && /^(you|me|yes|ja|own|eigene?)$/i.test(bbGewinner) ? true : null),
      niedrigsterPreis: zahl(get(r, "niedrigst")),
      angebote: zahl(get(r, "angebote")),
      bestand: zahl(get(r, "bestand")),
      zusatz: Object.fromEntries(headers.map((h, i) => [h, r[i]?.trim() ?? ""]).filter(([, v], i) => !known.has(i) && v)),
    });
  }
  const NAMEN: Partial<Record<Feld, string>> = { sku: "SKU", asin: "ASIN", markt: "Marktplatz", preis: "Preis", min: "Mindestpreis", max: "Höchstpreis", regel: "Regel/Strategie", status: "Status", bbPreis: "Buy-Box-Preis", bbGewinner: "Buy-Box-Gewinner", angebote: "Anzahl Angebote", bestand: "Bestand" };
  return {
    zeilen,
    erkannt: (Object.keys(sp) as Feld[]).map((f) => `${NAMEN[f] ?? f} = „${headers[sp[f]!]}“`),
    fehlt: (["sku", "min", "max", "regel"] as Feld[]).filter((f) => sp[f] === undefined).map((f) => NAMEN[f] ?? f),
    ohneSku,
    ohneMarkt,
  };
}

// ---- Prüfen --------------------------------------------------------------------------------------

export type Hinweis = "min_unter_untergrenze" | "ohne_min" | "ohne_max" | "pausiert" | "preis_unter_min" | "preis_ueber_max" | "buybox_verloren" | "ohne_regel" | "min_ueber_max";
export const HINWEIS_TEXT: Record<Hinweis, string> = {
  min_unter_untergrenze: "BQool-Mindestpreis liegt unter dem Mindestpreis des Seller-Systems (EK + Gebühren + Mindestgewinn) – zu wenig oder kein Gewinn möglich",
  ohne_min: "kein Mindestpreis in BQool",
  ohne_max: "kein Höchstpreis in BQool",
  min_ueber_max: "Mindestpreis über Höchstpreis",
  pausiert: "Bepreisung in BQool pausiert",
  preis_unter_min: "aktueller Preis unter dem Mindestpreis",
  preis_ueber_max: "aktueller Preis über dem Höchstpreis",
  buybox_verloren: "Buy Box gerade bei jemand anderem",
  ohne_regel: "keine Regel/Strategie zugeordnet",
};
/** Je schwerer, desto weiter vorn. */
export const HINWEIS_RANG: Hinweis[] = ["min_unter_untergrenze", "min_ueber_max", "preis_unter_min", "ohne_min", "pausiert", "buybox_verloren", "preis_ueber_max", "ohne_max", "ohne_regel"];

/** Prüft eine Zeile; `untergrenze` = Mindestpreis laut Seller-System (EK + Gebühren), null = unbekannt. */
export function pruefe(z: Pick<BqoolZeile, "min" | "max" | "preis" | "status" | "eigeneBuybox" | "regel">, untergrenze: number | null, regelSpalte: boolean): Hinweis[] {
  const h: Hinweis[] = [];
  // In Cent vergleichen – die Untergrenze des Seller-Systems ist ungerundet (z. B. 7,9037 → 7,90).
  const ct = (x: number) => Math.round(x * 100);
  if (z.min === null) h.push("ohne_min");
  else if (untergrenze !== null && ct(z.min) < ct(untergrenze)) h.push("min_unter_untergrenze");
  if (z.max === null) h.push("ohne_max");
  if (z.min !== null && z.max !== null && ct(z.min) > ct(z.max)) h.push("min_ueber_max");
  if (z.status === "pausiert") h.push("pausiert");
  if (z.preis !== null && z.min !== null && ct(z.preis) < ct(z.min)) h.push("preis_unter_min");
  if (z.preis !== null && z.max !== null && ct(z.preis) > ct(z.max)) h.push("preis_ueber_max");
  if (z.eigeneBuybox === false) h.push("buybox_verloren");
  if (regelSpalte && !z.regel) h.push("ohne_regel");
  return HINWEIS_RANG.filter((x) => h.includes(x));
}
