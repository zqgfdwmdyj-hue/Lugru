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
export type MargeStufe = { bisTage: number | null; marge: number; unterregel?: Unterregel };
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
 * Break-even-Mindestpreis brutto je Land: P = (FBA + Fixgebühr + EK + Zusatzkosten) / (1/(1+USt) − Provision − Zielmarge).
 * Aufgerundet auf den Cent. null, wenn der Nenner ≤ 0 ist (Provision + Marge zu hoch).
 */
export function breakEvenMin(o: { ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: number; margeProzent: number }): number | null {
  const nenner = 1 / (1 + o.ust) - o.provision - o.margeProzent / 100;
  if (nenner <= 0) return null;
  return auf2((o.fba + o.fix + o.ek + o.zusatz) / nenner);
}

/** Höchstpreis: max(Ø Buy Box 90 Tage × Faktor; Listenpreis); ohne beides Mindestpreis × Ersatzfaktor. Nie unter Min. */
export function maxPreis(o: { min: number; bb90: number | null; faktor: number; listenpreis: number | null; ersatzFaktor: number }): number {
  const kandidaten = [o.bb90 !== null && o.bb90 > 0 ? o.bb90 * o.faktor : null, o.listenpreis !== null && o.listenpreis > 0 ? o.listenpreis : null].filter((x): x is number => x !== null);
  const roh = kandidaten.length ? Math.max(...kandidaten) : o.min * o.ersatzFaktor;
  return r2(Math.max(roh, o.min));
}

export type Zuweisung = { regel: string; untergrenze: number | null; quelle: "vorlage" | "hand" | "kapital" };
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

/** Vergleich mit dem Ist-Stand (BQool-Export bzw. letzter eigener Export). Cent-genau. */
export function vergleiche(neu: ExportZeile[], ist: Map<string, IstStand>): Aenderung[] {
  return neu.map((z) => {
    const a = ist.get(z.sku);
    if (!a) return { sku: z.sku, art: "neu", regelWechsel: false, minAlt: null, minNeu: z.min, minDiff: null };
    const regelWechsel = (a.regel ?? "").trim().toLowerCase() !== z.regel.trim().toLowerCase();
    const costGleich = a.cost === undefined || (a.cost !== null && Math.abs(a.cost - z.cost) < 0.005);
    const gleich = !regelWechsel && costGleich && a.min !== null && Math.abs(a.min - z.min) < 0.005 && a.max !== null && Math.abs(a.max - z.max) < 0.005;
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
  /** Min Price je SKU und Land maßgeblich (Liquidation). */
  festeUntergrenze: boolean;
  /** Im Abgleich als Risiko melden (z. B. „mbb“ ohne Untergrenze). */
  risiko: boolean;
  hinweis: string;
};

/** Startwerte laut Bauauftrag – einmal mit BQool abgleichen (Altersstufen der Abverkauf-Regeln prüfen). */
export const KATALOG_STANDARD: KatalogRegel[] = [
  { name: "ia", laender: null, strategie: "Strategie nach FBA-Lageralter (BQool-ID 37)", staffel: MARGE_NACH_ALTER, festeUntergrenze: false, risiko: false, hinweis: "Standard; 0–30 T nur wenn ≥ 1 Stück verfügbar" },
  {
    name: "Abverkauf DE",
    laender: ["DE"],
    strategie: "wie ia, niedrigere Margen (BQool-ID 47)",
    staffel: [
      { bisTage: 30, marge: 7, unterregel: "Equalizer" },
      { bisTage: 60, marge: 5, unterregel: "Equalizer" },
      { bisTage: 90, marge: 3, unterregel: "Equalizer" },
      { bisTage: 180, marge: 1, unterregel: "Equalizer" },
      { bisTage: 270, marge: 0, unterregel: "Sales Booster" },
      { bisTage: 365, marge: 0, unterregel: "Sales Booster" },
      { bisTage: null, marge: 0, unterregel: "Sales Booster" },
    ],
    festeUntergrenze: false,
    risiko: false,
    hinweis: "271–365 T in BQool noch 1 % – Ludwig stellt auf 0 %",
  },
  // Soll laut Ludwig (30.10.): je Land eigene Regel (BQool-ID FR 48 · IT 50 · ES 49), alle Stufen AI Win Sales Booster,
  // Mindestmarge 0–30 T 4 % (nur mit ≥ 1 Stück verfügbar) · 31–60 T 3 % · 61–90 T 2 % · 91–180 T 1 % · ab 181 T 0 %.
  {
    name: "Abverkauf",
    // In BQool DE gibt es nur „Abverkauf DE“.
    laender: ["FR", "IT", "ES"],
    strategie: "AI Win Sales Booster je Land (BQool-ID FR 48 · IT 50 · ES 49)",
    staffel: [
      { bisTage: 30, marge: 4, unterregel: "Sales Booster" },
      { bisTage: 60, marge: 3, unterregel: "Sales Booster" },
      { bisTage: 90, marge: 2, unterregel: "Sales Booster" },
      { bisTage: 180, marge: 1, unterregel: "Sales Booster" },
      { bisTage: null, marge: 0, unterregel: "Sales Booster" },
    ],
    festeUntergrenze: false,
    risiko: false,
    hinweis: "Soll 4/3/2/1/0 % (0–30 T nur mit ≥ 1 verfügbar). Ist 30.10.: 7/5/3/1/0/1/0 %, Strategien gemischt (z. T. „Tiefstpreis + x %“) – Ludwig stellt in BQool um; das Seller-System rechnet mit dem Soll und meldet abweichende Regeln je SKU nach dem nächsten BQool-Export.",
  },
  { name: "Liquidation", aliase: ["AI Win Sales Booster"], laender: null, strategie: "AI Win Sales Booster, fester Min aus Upload (BQool-ID 43)", staffel: null, festeUntergrenze: true, risiko: false, hinweis: "Min Price je SKU und Land maßgeblich" },
  { name: "mbb", laender: null, strategie: "Match Buy Box (BQool-ID 33)", staffel: null, festeUntergrenze: false, risiko: true, hinweis: "nur hochgeladener Min, keine Marge – Ziel: auf ia umstellen" },
];

export const katalogRegel = (katalog: KatalogRegel[], name: string | null | undefined) => {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return katalog.find((k) => k.name.trim().toLowerCase() === n || (k.aliase ?? []).some((a) => a.trim().toLowerCase() === n)) ?? null;
};

/**
 * Mindestpreis für die Datei: Liquidation = feste Untergrenze; Margen-Regeln = Break-even ohne Marge als
 * Sicherheitsnetz (BQool rechnet den eigentlichen Mindestpreis selbst aus Cost + Mindestmarge der Regel).
 */
export function dateiMin(o: { regel: KatalogRegel | null; untergrenze: number | null; breakEven: number | null }): number | null {
  if (o.regel?.festeUntergrenze || o.untergrenze !== null) return o.untergrenze ?? o.breakEven;
  return o.breakEven;
}

/**
 * Effektiver Mindestpreis je SKU/Land, wie BQool ihn ansetzt: EK + Gebühren + Mindestmarge der Regel in der
 * Altersstufe (amazon_lageralter); Liquidation = Untergrenze; Regel ohne Untergrenze (mbb) = Break-even + Risiko.
 */
export function effektiverMin(o: { regel: KatalogRegel | null; untergrenze: number | null; ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: number; alterTage: number | null }): { min: number | null; marge: number | null; unterregel: Unterregel | null; art: "untergrenze" | "marge" | "ohne_untergrenze" | "unbekannte_regel" } {
  // Annahme bis zum Nachrechnen an einer echten SKU: BQools „geschätzte Gewinnmarge“ bezieht sich auf den
  // Brutto-Verkaufspreis (wie die Zielmarge im Break-even oben). Bei Abweichung hier anpassen.
  const be = (marge: number) => breakEvenMin({ ek: o.ek, fba: o.fba, fix: o.fix, zusatz: o.zusatz, ust: o.ust, provision: o.provision, margeProzent: marge });
  if (o.regel?.festeUntergrenze) return { min: o.untergrenze, marge: null, unterregel: "Sales Booster", art: "untergrenze" };
  if (!o.regel) return { min: be(0), marge: 0, unterregel: null, art: "unbekannte_regel" };
  if (!o.regel.staffel) return { min: be(0), marge: 0, unterregel: null, art: "ohne_untergrenze" };
  const stufe = stufeNachAlter(o.alterTage, o.regel.staffel);
  const marge = stufe?.marge ?? 0;
  return { min: be(marge), marge, unterregel: stufe?.unterregel ?? null, art: "marge" };
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
