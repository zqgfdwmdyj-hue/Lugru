// ProfitGuard (ProfitPath) – Ist-Stand per Datei-Import („Export & Import“ in ProfitGuard, CSV/XLSX) und Datei für den
// Import zurück in ProfitGuard. Keine Schnittstelle, keine Browser-Sitzung: Spalten werden am Namen erkannt
// (englisch/deutsch, verschiedene Schreibweisen); unbekannte Spalten bleiben als Zusatzangaben erhalten und werden beim
// Export im selben Format wieder geschrieben. Reine Logik ohne Datenbank, damit testbar.

export const PG_MAERKTE = ["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE", "UK", "IE"] as const;
export type PgMarkt = (typeof PG_MAERKTE)[number];

export type PgZeile = {
  marktplatz: PgMarkt;
  sku: string;
  asin: string | null;
  titel: string | null;
  preis: number | null;
  min: number | null;
  max: number | null;
  strategie: string | null;
  /** true = ProfitGuard bepreist, false = nicht im Repricing/pausiert, null = keine Angabe in der Datei. */
  imRepricing: boolean | null;
  buyboxPreis: number | null;
  eigeneBuybox: boolean | null;
  /** Buy-Box-Anteil in % (0–100). */
  buyboxAnteil: number | null;
  bestand: number | null;
  zusatz: Record<string, string>;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9#%]/g, "");
export type Feld = "sku" | "asin" | "titel" | "markt" | "preis" | "min" | "max" | "strategie" | "aktiv" | "bbPreis" | "eigeneBb" | "bbAnteil" | "bestand";
const SPALTEN: Record<Feld, string[]> = {
  sku: ["sku", "sellersku", "msku", "merchantsku", "artikelnummer"],
  asin: ["asin"],
  titel: ["productname", "title", "itemname", "producttitle", "produktname", "titel", "name"],
  markt: ["marketplace", "country", "site", "marktplatz", "land", "region", "store", "channel"],
  preis: ["yourprice", "myprice", "currentprice", "price", "listingprice", "preis", "aktuellerpreis", "verkaufspreis"],
  min: ["minprice", "minimumprice", "min", "floorprice", "mindestpreis", "minpreis", "minimalpreis"],
  max: ["maxprice", "maximumprice", "max", "ceilingprice", "maximalpreis", "hochstpreis", "maxpreis"],
  strategie: ["strategy", "strategyname", "repricingstrategy", "rule", "rulename", "strategie", "regel", "profitguardstrategy"],
  // Reihenfolge = Vorrang: erst die Repricing-Spalte, erst danach ein allgemeines „Status“ (oft der Amazon-Angebotsstatus).
  aktiv: ["repricing", "repricingactive", "repricingstatus", "repricerstatus", "repricingaktiv", "profitguard", "active", "aktiv", "enabled", "status"],
  bbPreis: ["buyboxprice", "bbprice", "buyboxpreis", "featuredofferprice"],
  eigeneBb: ["isbuyboxwinner", "ownbuybox", "youownbuybox", "winningbuybox", "inbuybox", "buyboxwon", "buyboxowner", "buyboxwinner", "buybox"],
  bbAnteil: ["buyboxshare", "buybox%", "buyboxpercentage", "buyboxanteil", "featuredoffer%", "bbshare", "buyboxwinrate"],
  bestand: ["quantity", "inventory", "available", "stock", "qty", "fulfillablequantity", "bestand", "menge"],
};

/** Spalte je Feld: erst genaue Treffer in Alias-Reihenfolge, dann „enthält“ für eindeutige Wörter – jede Spalte höchstens einmal. */
export function spaltenZuordnung(headers: string[]): Partial<Record<Feld, number>> {
  const n = headers.map(norm);
  const out: Partial<Record<Feld, number>> = {};
  const used = new Set<number>();
  const take = (f: Feld, i: number) => {
    out[f] = i;
    used.add(i);
  };
  for (const f of Object.keys(SPALTEN) as Feld[]) {
    for (const alias of SPALTEN[f]) {
      const i = n.findIndex((h, j) => !used.has(j) && h === alias);
      if (i >= 0) {
        take(f, i);
        break;
      }
    }
  }
  const contains: [Feld, string[]][] = [
    ["min", ["minprice", "minimum", "mindestpreis"]],
    ["max", ["maxprice", "maximum", "maximalpreis"]],
    ["bbAnteil", ["buyboxshare", "buyboxanteil", "buyboxpercent"]],
    ["bbPreis", ["buyboxprice", "buyboxpreis"]],
    ["strategie", ["strategy", "strategie"]],
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
  let s = v.replace(/[€$£%\s]|EUR|GBP|PLN|SEK/gi, "").trim();
  if (!s || /^(-|n\/?a|none|null|–)$/i.test(s)) return null;
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

const MARKT_ALIAS: Record<string, PgMarkt> = {
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
export function marktAus(v: string | undefined): PgMarkt | null {
  if (!v) return null;
  const k = norm(v.trim().replace(/^(https?:\/\/)?(www\.)?/i, ""));
  return MARKT_ALIAS[k] ?? MARKT_ALIAS[k.replace(/^amazon/, "")] ?? null;
}

const jaNein = (v: string | undefined): boolean | null => {
  if (v === undefined || !v.trim()) return null;
  const s = norm(v);
  if (["yes", "ja", "true", "1", "y", "x", "won", "winner", "you", "me", "self", "on", "active", "aktiv", "enabled", "repricing"].includes(s)) return true;
  if (["no", "nein", "false", "0", "n", "lost", "-", "off", "paused", "pausiert", "inactive", "inaktiv", "disabled", "stopped", "aus"].includes(s)) return false;
  return null;
};

export type ImportErgebnis = { zeilen: PgZeile[]; erkannt: string[]; fehlt: string[]; ohneSku: number; ohneMarkt: number; spalten: Partial<Record<Feld, number>> };

/**
 * Export → Zeilen. `standardMarkt` gilt, wenn die Datei keine Marktplatz-Spalte hat. Pflicht ist nur die SKU; ohne
 * Min/Max-Spalte wird gewarnt. Ein allgemeines „Status“ mit „Inactive/Incomplete“ (Amazon-Angebotsstatus) gilt nicht als
 * „nicht im Repricing“.
 */
export function leseProfitguard(headers: string[], rows: string[][], standardMarkt: PgMarkt | null): ImportErgebnis {
  const sp = spaltenZuordnung(headers);
  const known = new Set(Object.values(sp));
  const get = (r: string[], f: Feld) => (sp[f] === undefined ? undefined : r[sp[f]!]?.trim());
  const aktivAllgemein = sp.aktiv !== undefined && ["status"].includes(norm(headers[sp.aktiv]));
  let ohneSku = 0;
  let ohneMarkt = 0;
  const zeilen: PgZeile[] = [];
  for (const r of rows) {
    const sku = get(r, "sku");
    if (!sku) {
      if (r.some((c) => c?.trim())) ohneSku++;
      continue;
    }
    // Steht in einer vorhandenen Marktplatz-Spalte ein unbekannter Wert, wird die Zeile nicht still dem Standardmarkt zugeordnet.
    const marktRoh = get(r, "markt");
    const markt = marktRoh ? marktAus(marktRoh) : standardMarkt;
    if (!markt) {
      ohneMarkt++;
      continue;
    }
    const asin = get(r, "asin")?.toUpperCase() || null;
    const aktivRoh = get(r, "aktiv");
    const aktiv = aktivAllgemein && aktivRoh && ["inactive", "incomplete", "outofstock", "suppressed"].includes(norm(aktivRoh)) ? null : jaNein(aktivRoh);
    const anteil = zahl(get(r, "bbAnteil"));
    zeilen.push({
      marktplatz: markt,
      sku,
      asin: asin && /^[A-Z0-9]{10}$/.test(asin) ? asin : null,
      titel: get(r, "titel")?.slice(0, 300) || null,
      preis: zahl(get(r, "preis")),
      min: zahl(get(r, "min")),
      max: zahl(get(r, "max")),
      strategie: get(r, "strategie") || null,
      imRepricing: aktiv,
      buyboxPreis: zahl(get(r, "bbPreis")),
      eigeneBuybox: jaNein(get(r, "eigeneBb")),
      buyboxAnteil: anteil === null ? null : anteil <= 1 && /[.,]/.test(get(r, "bbAnteil") ?? "") && !/%/.test(get(r, "bbAnteil") ?? "") ? Math.round(anteil * 10000) / 100 : anteil,
      bestand: zahl(get(r, "bestand")),
      zusatz: Object.fromEntries(headers.map((h, i) => [h, r[i]?.trim() ?? ""]).filter(([, v], i) => !known.has(i) && v)),
    });
  }
  const NAMEN: Record<Feld, string> = { sku: "SKU", asin: "ASIN", titel: "Titel", markt: "Marktplatz", preis: "Preis", min: "Mindestpreis", max: "Höchstpreis", strategie: "Strategie", aktiv: "im Repricing", bbPreis: "Buy-Box-Preis", eigeneBb: "eigene Buy Box", bbAnteil: "Buy-Box-Anteil", bestand: "Bestand" };
  return {
    zeilen,
    erkannt: (Object.keys(sp) as Feld[]).map((f) => `${NAMEN[f]} = „${headers[sp[f]!]}“`),
    fehlt: (["sku", "min", "max", "strategie"] as Feld[]).filter((f) => sp[f] === undefined).map((f) => NAMEN[f]),
    ohneSku,
    ohneMarkt,
    spalten: sp,
  };
}

/** Referral- und FBA-Gebühr aus Zusatzspalten (Betrag oder Satz), Kategorie für Preisstufen der Provision. */
export function gebuehrenAusListing(zusatz: Record<string, string>, preis: number | null): { fba: number | null; satz: number | null; kategorie: string | null } {
  let fba: number | null = null;
  let satz: number | null = null;
  let kategorie: string | null = null;
  for (const [h, v] of Object.entries(zusatz)) {
    const n = norm(h);
    const roh = (v ?? "").trim();
    if (!roh) continue;
    if (fba === null && /(fbafee|fulfil+mentfee|fbagebuhr|versandgebuhr|fulfil+ment(fee)?perunit)/.test(n) && !/rate|percent|%/.test(n)) fba = zahl(roh);
    else if (satz === null && /(referral|commission|verkaufsgebuhr|provision)/.test(n)) {
      const proz = /%/.test(roh) || /rate|percent|prozent|%/.test(h.toLowerCase());
      const x = zahl(roh.replace("%", ""));
      if (x === null) continue;
      if (proz) satz = x > 1 ? x / 100 : x;
      else if (preis && preis > 0) satz = x / preis;
    } else if (kategorie === null && /^(category|productgroup|kategorie|productcategory|produktgruppe)$/.test(n)) kategorie = roh.slice(0, 120);
  }
  return { fba: fba !== null && fba >= 0 ? fba : null, satz: satz !== null && satz > 0 && satz < 0.6 ? Math.round(satz * 10000) / 10000 : null, kategorie };
}

// ---- Auffälligkeiten: Seller-System (Soll) ↔ ProfitGuard (Ist) -----------------------------------------------------

export type Hinweis = "nicht_im_repricing" | "min_unter_soll" | "min_ueber_max" | "ohne_min" | "ohne_max" | "strategie_abweichend" | "preis_unter_min";
export const HINWEIS_TEXT: Record<Hinweis, string> = {
  nicht_im_repricing: "SKU mit Bestand nicht im ProfitGuard-Repricing",
  min_unter_soll: "ProfitGuard-Min unter dem Soll-Min des Seller-Systems (Marge je Altersstufe)",
  min_ueber_max: "Min über Max",
  ohne_min: "kein Min in ProfitGuard",
  ohne_max: "kein Max in ProfitGuard",
  strategie_abweichend: "Strategie in ProfitGuard weicht von der Soll-Strategie ab",
  preis_unter_min: "aktueller Preis unter dem ProfitGuard-Min",
};
/** Je schwerer, desto weiter vorn. */
export const HINWEIS_RANG: Hinweis[] = ["nicht_im_repricing", "min_unter_soll", "min_ueber_max", "ohne_min", "ohne_max", "strategie_abweichend", "preis_unter_min"];

/**
 * Prüft eine SKU/Land. `ist` = Zeile aus dem ProfitGuard-Export (null = nicht in ProfitGuard), `sollMin` = Soll-Min des
 * Seller-Systems (Marge je Altersstufe), `liquidationFrei` = freigegebene Liquidation (dann darf der Min darunter liegen),
 * `sollStrategie`/`istStrategie` = neutrale Strategie (Ist aus dem ProfitGuard-Namen abgebildet).
 */
export function pruefe(o: { ist: Pick<PgZeile, "min" | "max" | "preis" | "imRepricing"> | null; bestand: number; sollMin: number | null; liquidationFrei: boolean; sollStrategie?: string | null; istStrategie?: string | null }): Hinweis[] {
  const h: Hinweis[] = [];
  const ct = (x: number) => Math.round(x * 100);
  const z = o.ist;
  if (o.bestand > 0 && (!z || z.imRepricing === false)) h.push("nicht_im_repricing");
  if (z) {
    if (z.min === null) h.push("ohne_min");
    else if (o.sollMin !== null && !o.liquidationFrei && ct(z.min) < ct(o.sollMin)) h.push("min_unter_soll");
    if (z.max === null) h.push("ohne_max");
    if (z.min !== null && z.max !== null && ct(z.min) > ct(z.max)) h.push("min_ueber_max");
    if (z.preis !== null && z.min !== null && ct(z.preis) < ct(z.min)) h.push("preis_unter_min");
    if (o.sollStrategie && o.istStrategie && o.sollStrategie !== o.istStrategie) h.push("strategie_abweichend");
  }
  return HINWEIS_RANG.filter((x) => h.includes(x));
}

// ---- Datei für den Import in ProfitGuard ---------------------------------------------------------------------------

/**
 * Format der Importdatei, gelernt aus dem letzten ProfitGuard-Export (Kopfzeile, Trennzeichen, Dezimalzeichen,
 * Werte für „im Repricing“). Ohne gelerntes Format gilt ein schlichtes CSV – vor dem ersten Import in ProfitGuard
 * die Spalten mit der ProfitGuard-Vorlage abgleichen.
 */
export type PgFormat = {
  kopf: string[];
  trenner: "," | ";" | "\t";
  dezimal: "." | ",";
  spalten: Partial<Record<Feld, number>>;
  aktivWerte: { an: string; aus: string };
  /** Schreibweise des Marktplatzes je Land im Export (z. B. „Amazon.de“); fehlt = Länderkürzel. */
  marktWerte?: Record<string, string>;
  ausExport: boolean;
};
export const PG_FORMAT_STANDARD: PgFormat = {
  kopf: ["SKU", "Marketplace", "Min Price", "Max Price", "Strategy", "Repricing"],
  trenner: ",",
  dezimal: ".",
  spalten: { sku: 0, markt: 1, min: 2, max: 3, strategie: 4, aktiv: 5 },
  aktivWerte: { an: "1", aus: "0" },
  ausExport: false,
};

/** Gegenstück zu einem „an“-Wert in derselben Schreibweise (Ja → Nein, On → Off, Aktiv → Inaktiv, 1 → 0 …). */
function gegenstueck(an: string): string {
  const paare: Record<string, string> = { yes: "no", ja: "nein", true: "false", "1": "0", y: "n", on: "off", active: "inactive", aktiv: "inaktiv", enabled: "disabled", x: "" };
  const k = an.toLowerCase();
  const aus = paare[k];
  if (aus === undefined) return PG_FORMAT_STANDARD.aktivWerte.aus;
  if (an === an.toUpperCase() && an !== an.toLowerCase()) return aus.toUpperCase();
  if (an[0] === an[0].toUpperCase() && an[0] !== an[0].toLowerCase()) return aus.charAt(0).toUpperCase() + aus.slice(1);
  return aus;
}

/** Format aus einer eingelesenen Datei lernen (nur wenn SKU, Min und Max erkannt wurden). */
export function formatLernen(headers: string[], rows: string[][], spalten: Partial<Record<Feld, number>>, trenner: string): PgFormat | null {
  if (spalten.sku === undefined || spalten.min === undefined || spalten.max === undefined) return null;
  const minWerte = rows.map((r) => r[spalten.min!] ?? "").filter((v) => /\d/.test(v));
  const dezimal: "." | "," = minWerte.length && minWerte.filter((v) => /^\s*-?[\d.]*\d,\d{1,2}\s*$/.test(v)).length > minWerte.length / 2 ? "," : ".";
  const aktivRoh = spalten.aktiv !== undefined ? rows.map((r) => (r[spalten.aktiv!] ?? "").trim()).filter(Boolean) : [];
  const an = aktivRoh.find((v) => jaNein(v) === true) ?? PG_FORMAT_STANDARD.aktivWerte.an;
  const aus = aktivRoh.find((v) => jaNein(v) === false) ?? gegenstueck(an);
  const marktWerte: Record<string, string> = {};
  if (spalten.markt !== undefined) for (const r of rows) {
    const roh = (r[spalten.markt] ?? "").trim();
    const land = marktAus(roh);
    if (land && !marktWerte[land]) marktWerte[land] = roh;
  }
  return { kopf: [...headers], trenner: trenner === ";" ? ";" : trenner === "\t" ? "\t" : ",", dezimal, spalten: { ...spalten }, aktivWerte: { an, aus }, marktWerte, ausExport: true };
}

export type PgDateiZeile = { land: string; sku: string; strategieName: string; min: number; max: number; aktiv: boolean; /** Zeile aus dem letzten ProfitGuard-Export (für unveränderte Spalten). */ ist?: { zusatz: Record<string, string>; asin: string | null; titel: string | null; preis: number | null; bestand: number | null } | null };

const feldWert = (v: string, trenner: string) => (/["\r\n]/.test(v) || v.includes(trenner) ? `"${v.replace(/"/g, '""')}"` : v);

/** Importdatei (eine je Land oder alle Länder in einer) im gelernten ProfitGuard-Format. */
export function profitguardDatei(zeilen: PgDateiZeile[], f: PgFormat = PG_FORMAT_STANDARD): string {
  const z2 = (n: number) => (f.dezimal === "," ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  const index = new Map(Object.entries(f.spalten).map(([k, i]) => [i as number, k as Feld]));
  const body = zeilen.map((z) =>
    f.kopf
      .map((h, i) => {
        const feld = index.get(i);
        if (feld === "sku") return z.sku;
        if (feld === "markt") return f.marktWerte?.[z.land] ?? z.land;
        if (feld === "min") return z2(z.min);
        if (feld === "max") return z2(z.max);
        if (feld === "strategie") return z.strategieName;
        if (feld === "aktiv") return z.aktiv ? f.aktivWerte.an : f.aktivWerte.aus;
        if (feld === "asin") return z.ist?.asin ?? "";
        if (feld === "titel") return z.ist?.titel ?? "";
        if (feld === "preis") return z.ist?.preis !== null && z.ist?.preis !== undefined ? z2(z.ist.preis) : "";
        if (feld === "bestand") return z.ist?.bestand !== null && z.ist?.bestand !== undefined ? String(z.ist.bestand) : "";
        return z.ist?.zusatz?.[h] ?? "";
      })
      .map((v) => feldWert(v, f.trenner))
      .join(f.trenner),
  );
  return [f.kopf.map((h) => feldWert(h, f.trenner)).join(f.trenner), ...body].join("\r\n") + "\r\n";
}

// ---- Übersicht und Filter --------------------------------------------------------------------------------------

export type StrategieUebersicht = { strategie: string; gesamt: number; imRepricing: number; nichtIm: number; unbekannt: number; mitHinweis: number; laender: Record<string, number> };

/** Je Ist-Strategie (ProfitGuard-Name): wie viele SKUs, im Repricing ja/nein, mit Auffälligkeit, je Land. */
export function strategieUebersicht(zeilen: { istStrategie: string | null; imRepricing: boolean | null; land: string; hinweise?: Hinweis[] }[]): StrategieUebersicht[] {
  const m = new Map<string, StrategieUebersicht>();
  for (const z of zeilen) {
    const k = z.istStrategie?.trim() || "(ohne Strategie)";
    const r = m.get(k) ?? { strategie: k, gesamt: 0, imRepricing: 0, nichtIm: 0, unbekannt: 0, mitHinweis: 0, laender: {} };
    r.gesamt++;
    if (z.imRepricing === true) r.imRepricing++;
    else if (z.imRepricing === false) r.nichtIm++;
    else r.unbekannt++;
    if (z.hinweise?.length) r.mitHinweis++;
    r.laender[z.land] = (r.laender[z.land] ?? 0) + 1;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.gesamt - a.gesamt || a.strategie.localeCompare(b.strategie));
}

export type AbgleichFilter = { land?: string; strategie?: string; hinweis?: string; repricing?: string; q?: string; nurAuffaellig?: boolean };

export function filterAbgleich<T extends { land: string; sku: string; asin: string | null; titel: string | null; istStrategie: string | null; imRepricing: boolean | null; hinweise: Hinweis[] }>(zeilen: T[], f: AbgleichFilter): T[] {
  const q = f.q?.trim().toLowerCase();
  return zeilen
    .filter((z) => {
      if (f.nurAuffaellig && !z.hinweise.length) return false;
      if (f.land && z.land !== f.land) return false;
      if (f.strategie && (z.istStrategie?.trim() || "(ohne Strategie)") !== f.strategie) return false;
      if (f.hinweis && !z.hinweise.includes(f.hinweis as Hinweis)) return false;
      if (f.repricing === "ja" && z.imRepricing !== true) return false;
      if (f.repricing === "nein" && z.imRepricing !== false) return false;
      if (f.repricing === "unbekannt" && z.imRepricing !== null) return false;
      if (q && ![z.sku, z.asin ?? "", z.titel ?? ""].some((x) => x.toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => b.hinweise.length - a.hinweise.length || a.land.localeCompare(b.land) || a.sku.localeCompare(b.sku));
}
