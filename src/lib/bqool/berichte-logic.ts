// B31.5 BQool-Berichte „Listing Performance“ (je SKU, Zeitraum 7/30 Tage) und „Daily Sales“ (je Tag) – reine Logik:
// Erkennung an der Kopfzeile, deutsche Zahlen, SKU aus der Produktspalte, doppelte Zeilen je SKU zusammenfassen,
// Land ableiten (Regelnamen, Abgleich mit dem letzten Ist je Land, Summen), Auswertungslisten. Ohne Datenbank.

export const BERICHT_LAENDER = ["DE", "FR", "IT", "ES"] as const;
export type BerichtLand = (typeof BERICHT_LAENDER)[number];
export type BerichtArt = "listing_performance" | "daily_sales";
export const BERICHT_TEXT: Record<BerichtArt, string> = { listing_performance: "Listing Performance", daily_sales: "Daily Sales" };
export const istBerichtLand = (x: unknown): x is BerichtLand => typeof x === "string" && (BERICHT_LAENDER as readonly string[]).includes(x);

/** Kopfzeile vergleichbar machen: „Buy Box Lost FBM %“ → „buy box lost fbm pct“, „Sales (FBA)“ → „sales fba“. */
export const kopf = (h: string) =>
  h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Welcher BQool-Bericht? `null` = keiner von beiden. */
export function berichtArt(headers: string[]): BerichtArt | null {
  const h = headers.map(kopf).filter(Boolean);
  const hat = (...k: string[]) => k.some((x) => h.includes(x));
  const bb = hat("buy box wins", "buy box wins pct", "buy box win pct");
  if (!bb) return null;
  if ((h[0] === "products" || h[0] === "product") && hat("below min pct", "at min pct", "at max pct")) return "listing_performance";
  if (h[0] === "date" && hat("sales") && hat("sales fba", "sales fbm")) return "daily_sales";
  return null;
}

/** Deutsche Zahl aus BQool: „1.919,12 €“, „97,35%“, „-278,00 €“, „(12,00)“; „-“/leer = null. */
export function zahlDe(roh: string | number | null | undefined): number | null {
  if (roh === null || roh === undefined) return null;
  if (typeof roh === "number") return Number.isFinite(roh) ? roh : null;
  let s = roh.replace(/[  \s]/g, "").replace(/EUR|€|%|\$|£/gi, "");
  if (!s || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^[−–—]/, "-");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const komma = s.lastIndexOf(",");
  const punkt = s.lastIndexOf(".");
  if (komma >= 0 && punkt >= 0) s = komma > punkt ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (komma >= 0) s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (punkt >= 0 && /^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const ASIN = /\b(B0[0-9A-Z]{8})\b/;

/** SKU, ASIN und Titel aus der Spalte „Products“ (BQool schreibt Titel, ASIN und SKU in eine Zelle). */
export function produktTeile(text: string, bekannte?: ReadonlySet<string>): { sku: string | null; asin: string | null; titel: string | null } {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return { sku: null, asin: null, titel: null };
  const asin = (/asin\s*[:#]?\s*([A-Z0-9]{10})\b/i.exec(t)?.[1] ?? ASIN.exec(t)?.[1] ?? null)?.toUpperCase() ?? null;
  const zeilen = t.split(/\n|\s+\|\s+/).map((x) => x.trim()).filter(Boolean);
  let sku = /(?:^|[\s|(\[])(?:seller\s*)?sku\s*[:#]\s*([^\s|,;)\]]+)/i.exec(t)?.[1] ?? /(?:^|\n)\s*(?:seller\s*)?sku\s+([^\s|,;]+)/i.exec(t)?.[1] ?? null;
  if (!sku && bekannte?.size) {
    if (bekannte.has(t)) sku = t;
    else sku = t.split(/[\s|,;()[\]]+/).find((w) => w.length > 2 && bekannte.has(w)) ?? null;
  }
  if (!sku && !/\s/.test(t) && t.toUpperCase() !== asin) sku = t;
  if (!sku && zeilen.length > 1) sku = zeilen.find((z) => !/\s/.test(z) && z.toUpperCase() !== asin && !/^asin/i.test(z)) ?? null;
  const titel = zeilen.find((z) => /\s/.test(z) && !/^(seller\s*)?sku\b|^asin\b/i.test(z)) ?? null;
  return { sku, asin, titel };
}

type Feld =
  | "produkt" | "sku" | "asin" | "titel" | "regel" | "sales" | "orders" | "units" | "profit" | "bbWins" | "lowestWin" | "atMin" | "atMax" | "belowMin"
  | "avgOffers" | "avgPosition" | "reprice" | "priceUp" | "priceDown" | "priceChanges" | "competeAmazon" | "bbLostAmazon" | "bbLostFba" | "bbLostFbm"
  | "datum" | "salesFba" | "salesFbm";
const ALIAS: Record<Feld, string[]> = {
  produkt: ["products", "product"],
  sku: ["sku", "seller sku", "msku", "merchant sku"],
  asin: ["asin"],
  titel: ["title", "product name", "item name"],
  regel: ["rules", "rule", "rule name", "strategy"],
  sales: ["sales"],
  orders: ["orders"],
  units: ["units ordered", "units"],
  profit: ["est profit", "estimated profit", "profit"],
  bbWins: ["buy box wins", "buy box wins pct", "buy box win pct"],
  lowestWin: ["lowest price win pct", "lowest price win"],
  atMin: ["at min pct", "at min"],
  atMax: ["at max pct", "at max"],
  belowMin: ["below min pct", "below min"],
  avgOffers: ["avg offers", "average offers"],
  avgPosition: ["avg position", "average position"],
  reprice: ["reprice", "reprices"],
  priceUp: ["price up"],
  priceDown: ["price down"],
  priceChanges: ["price changes", "price change"],
  competeAmazon: ["compete amazon pct", "compete amazon"],
  bbLostAmazon: ["buy box lost amazon pct", "buy box lost amazon"],
  bbLostFba: ["buy box lost fba pct", "buy box lost fba"],
  bbLostFbm: ["buy box lost fbm pct", "buy box lost fbm"],
  datum: ["date", "datum"],
  salesFba: ["sales fba"],
  salesFbm: ["sales fbm"],
};
function spalten(headers: string[]): Partial<Record<Feld, number>> {
  const h = headers.map(kopf);
  const out: Partial<Record<Feld, number>> = {};
  for (const f of Object.keys(ALIAS) as Feld[]) {
    for (const a of ALIAS[f]) {
      const i = h.indexOf(a);
      if (i >= 0) {
        out[f] = i;
        break;
      }
    }
  }
  return out;
}

export type LeistungZeile = {
  sku: string;
  asin: string | null;
  titel: string | null;
  regel: string | null;
  sales: number | null;
  orders: number | null;
  units: number | null;
  profit: number | null;
  bbWins: number | null;
  lowestWin: number | null;
  atMin: number | null;
  atMax: number | null;
  belowMin: number | null;
  avgOffers: number | null;
  avgPosition: number | null;
  reprice: number | null;
  priceUp: number | null;
  priceDown: number | null;
  priceChanges: number | null;
  bbLostAmazon: number | null;
  bbLostFba: number | null;
  bbLostFbm: number | null;
  zusatz: Record<string, string>;
};
const ZAHLEN = ["sales", "orders", "units", "profit", "bbWins", "lowestWin", "atMin", "atMax", "belowMin", "avgOffers", "avgPosition", "reprice", "priceUp", "priceDown", "priceChanges", "bbLostAmazon", "bbLostFba", "bbLostFbm"] as const;
const SUMMIEREN = ["sales", "orders", "units", "profit", "reprice", "priceUp", "priceDown", "priceChanges"] as const;
const hatDaten = (z: LeistungZeile) => ZAHLEN.some((k) => z[k] !== null);
const gewicht = (z: LeistungZeile) => (z.units ?? 0) * 1e6 + Math.abs(z.sales ?? 0) + (hatDaten(z) ? 1 : 0);
const SUMME_ZEILE = /^(total|totals|gesamt|summe|summary|all products|alle)$/i;

/**
 * Listing Performance lesen. Zwei Zeilen derselben SKU (z. B. Regel „ia“ und „Abverkauf“ im Zeitraum) werden zu einer:
 * Regel und Prozentwerte der Zeile mit Daten (bei beiden die mit mehr Stück), Mengen/Beträge addiert.
 */
export function leseListingPerformance(headers: string[], rows: string[][], bekannte?: ReadonlySet<string>) {
  const s = spalten(headers);
  const genutzt = new Set(Object.values(s));
  const je = new Map<string, LeistungZeile>();
  let ohneSku = 0;
  let doppelt = 0;
  let summe: LeistungZeile | null = null;
  for (const r of rows) {
    if (!r.some((x) => (x ?? "").trim())) continue;
    const zelle = (f: Feld) => (s[f] === undefined ? "" : (r[s[f]!] ?? "").trim());
    const produkt = zelle("produkt");
    const teile = zelle("sku") ? { sku: zelle("sku"), asin: zelle("asin") || null, titel: zelle("titel") || null } : produktTeile(produkt, bekannte);
    const zusatz: Record<string, string> = {};
    headers.forEach((h, i) => {
      const v = (r[i] ?? "").trim();
      if (!genutzt.has(i) && v && v !== "-") zusatz[h.replace(/^﻿/, "").trim()] = v.slice(0, 200);
    });
    const z: LeistungZeile = { sku: teile.sku ?? "", asin: teile.asin ?? (zelle("asin") || null), titel: teile.titel ?? (zelle("titel") || null), regel: zelle("regel") && zelle("regel") !== "-" ? zelle("regel") : null, zusatz } as LeistungZeile;
    for (const k of ZAHLEN) z[k] = zahlDe(zelle(k));
    if (SUMME_ZEILE.test(produkt)) {
      summe = { ...z, sku: "" };
      continue;
    }
    if (!z.sku) {
      ohneSku++;
      continue;
    }
    const alt = je.get(z.sku);
    if (!alt) {
      je.set(z.sku, z);
      continue;
    }
    doppelt++;
    const [haupt, neben] = gewicht(z) > gewicht(alt) ? [z, alt] : [alt, z];
    const zus: LeistungZeile = { ...haupt, zusatz: { ...neben.zusatz, ...haupt.zusatz } };
    if (hatDaten(neben)) for (const k of SUMMIEREN) zus[k] = haupt[k] === null && neben[k] === null ? null : Math.round(((haupt[k] ?? 0) + (neben[k] ?? 0)) * 100) / 100;
    const regeln = [...new Set([alt.regel, z.regel].filter(Boolean))];
    if (regeln.length > 1) zus.zusatz = { ...zus.zusatz, Regeln: regeln.join(", ") };
    je.set(z.sku, zus);
  }
  return { zeilen: [...je.values()], ohneSku, doppelt, summe, fehlt: (["regel", "sales", "profit", "bbWins", "belowMin"] as Feld[]).filter((f) => s[f] === undefined).map((f) => ALIAS[f][0]) };
}

export type Tageswert = { tag: string; sales: number | null; salesFba: number | null; salesFbm: number | null; orders: number | null; units: number | null; profit: number | null; bbWins: number | null; zusatz: Record<string, string> };

const MONATE: Record<string, number> = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const gueltig = (j: number, m: number, t: number) => {
  if (m < 1 || m > 12 || t < 1 || t > 31) return null;
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCMonth() === m - 1 ? `${j}-${pad(m)}-${pad(t)}` : null;
};
const jahr = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
/** Datum lesen; bei „a/b/jjjj“ beide Lesarten (Tag/Monat und Monat/Tag). */
function datumLesen(roh: string): { fest: string | null; dm: string | null; md: string | null } {
  const s = roh.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { fest: gueltig(+m[1], +m[2], +m[3]), dm: null, md: null };
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (m) return { fest: gueltig(jahr(m[3]), +m[2], +m[1]), dm: null, md: null };
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) return { fest: null, dm: gueltig(jahr(m[3]), +m[2], +m[1]), md: gueltig(jahr(m[3]), +m[1], +m[2]) };
  m = /^([A-Za-zä]{3})[a-zä]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONATE[m[1].toLowerCase()]) return { fest: gueltig(+m[3], MONATE[m[1].toLowerCase()], +m[2]), dm: null, md: null };
  m = /^(\d{1,2})\.?\s+([A-Za-zä]{3})[a-zä]*\.?\s+(\d{4})/.exec(s);
  if (m && MONATE[m[2].toLowerCase()]) return { fest: gueltig(+m[3], MONATE[m[2].toLowerCase()], +m[1]), dm: null, md: null };
  return { fest: null, dm: null, md: null };
}
const folgeTage = (tage: string[]) => {
  const t = [...tage].sort();
  let n = 0;
  for (let i = 1; i < t.length; i++) if (Date.parse(`${t[i]}T00:00:00Z`) - Date.parse(`${t[i - 1]}T00:00:00Z`) === 86_400_000) n++;
  return n;
};

/** Daily Sales lesen. Zeilen ohne lesbares Datum (z. B. „Total“) zählen als ungültig. */
export function leseDailySales(headers: string[], rows: string[][]) {
  const s = spalten(headers);
  const genutzt = new Set(Object.values(s));
  const roh = rows.filter((r) => r.some((x) => (x ?? "").trim()));
  const daten = roh.map((r) => datumLesen(r[s.datum ?? 0] ?? ""));
  // a/b/jjjj: die Lesart, bei der alle Daten gültig sind und die meisten aufeinanderfolgen (Tagesbericht).
  const dmOk = daten.every((d) => d.fest || d.dm || (!d.dm && !d.md));
  const mdOk = daten.every((d) => d.fest || d.md || (!d.dm && !d.md));
  const dm = daten.map((d) => d.fest ?? d.dm).filter((x): x is string => !!x);
  const md = daten.map((d) => d.fest ?? d.md).filter((x): x is string => !!x);
  const nimmMd = !dmOk || (mdOk && folgeTage(md) > folgeTage(dm));
  const tage: Tageswert[] = [];
  let ungueltig = 0;
  roh.forEach((r, i) => {
    const tag = daten[i].fest ?? (nimmMd ? daten[i].md : daten[i].dm);
    if (!tag) {
      ungueltig++;
      return;
    }
    const zelle = (f: Feld) => (s[f] === undefined ? "" : (r[s[f]!] ?? "").trim());
    const zusatz: Record<string, string> = {};
    headers.forEach((h, j) => {
      const v = (r[j] ?? "").trim();
      if (!genutzt.has(j) && v && v !== "-") zusatz[h.replace(/^﻿/, "").trim()] = v.slice(0, 200);
    });
    tage.push({ tag, sales: zahlDe(zelle("sales")), salesFba: zahlDe(zelle("salesFba")), salesFbm: zahlDe(zelle("salesFbm")), orders: zahlDe(zelle("orders")), units: zahlDe(zelle("units")), profit: zahlDe(zelle("profit")), bbWins: zahlDe(zelle("bbWins")), zusatz });
  });
  const je = new Map(tage.map((t) => [t.tag, t]));
  return { tage: [...je.values()].sort((a, b) => a.tag.localeCompare(b.tag)), ungueltig };
}

/** Land aus Regelnamen: „Abverkauf DE“ → DE; „Abverkauf“ (Regel der übrigen Länder) schließt DE aus. */
export function landAusRegeln(regeln: (string | null)[], abverkauf: { DE?: string; sonst?: string } = { DE: "Abverkauf DE", sonst: "Abverkauf" }): { land: BerichtLand | null; moeglich: BerichtLand[] } {
  const namen = [...new Set(regeln.filter((r): r is string => !!r).map((r) => r.trim()))];
  const genannt = new Set<BerichtLand>();
  for (const n of namen) for (const l of BERICHT_LAENDER) if (new RegExp(`(^|[^A-Za-z])${l}([^A-Za-z]|$)`).test(n)) genannt.add(l);
  if (abverkauf.DE && namen.some((n) => n.toLowerCase() === abverkauf.DE!.toLowerCase())) genannt.add("DE");
  if (genannt.size === 1) return { land: [...genannt][0], moeglich: [...genannt] };
  const sonst = abverkauf.sonst && abverkauf.sonst.toLowerCase() !== abverkauf.DE?.toLowerCase() && namen.some((n) => n.toLowerCase() === abverkauf.sonst!.toLowerCase());
  const moeglich = BERICHT_LAENDER.filter((l) => (sonst ? l !== "DE" : true) && (genannt.size ? genannt.has(l) : true));
  return { land: moeglich.length === 1 ? moeglich[0] : null, moeglich };
}

export type LandPunkte = { land: BerichtLand; gemeinsam: number; jaccard: number; regelGleich: number; punkte: number };
export type LandErgebnis = { land: BerichtLand | null; sicher: boolean; vorschlag: BerichtLand | null; begruendung: string; punkte: LandPunkte[] };

/**
 * Land einer Listing Performance: (1) Regelnamen, (2) Abgleich mit dem letzten Ist je Land (SKU-Überlappung als
 * Jaccard, dazu gleiche Regel je SKU), (3) sonst Rückfrage mit Vorschlag.
 */
export function landVorschlag(zeilen: { sku: string; regel: string | null }[], ist: Partial<Record<BerichtLand, Map<string, string | null>>>, abverkauf?: { DE?: string; sonst?: string }): LandErgebnis {
  const hinweis = landAusRegeln(zeilen.map((z) => z.regel), abverkauf);
  const n = zeilen.length;
  const punkte: LandPunkte[] = hinweis.moeglich.map((land) => {
    const liste = ist[land] ?? new Map<string, string | null>();
    let gemeinsam = 0;
    let regelGleich = 0;
    for (const z of zeilen) {
      if (!liste.has(z.sku)) continue;
      gemeinsam++;
      const r = liste.get(z.sku);
      if (r && z.regel && r.toLowerCase() === z.regel.toLowerCase()) regelGleich++;
    }
    const jaccard = n + liste.size - gemeinsam > 0 ? gemeinsam / (n + liste.size - gemeinsam) : 0;
    return { land, gemeinsam, jaccard: Math.round(jaccard * 1000) / 1000, regelGleich, punkte: Math.round((jaccard + (gemeinsam ? regelGleich / gemeinsam : 0)) * 1000) / 1000 };
  });
  punkte.sort((a, b) => b.punkte - a.punkte || b.gemeinsam - a.gemeinsam);
  const [erst, zweit] = punkte;
  if (hinweis.land) return { land: hinweis.land, sicher: true, vorschlag: hinweis.land, begruendung: `Regelname (${hinweis.land})`, punkte };
  if (erst && erst.gemeinsam > 0 && erst.jaccard >= 0.5 && (!zweit || erst.punkte - zweit.punkte >= 0.15)) return { land: erst.land, sicher: true, vorschlag: erst.land, begruendung: `${erst.gemeinsam} von ${n} SKUs im letzten BQool-Ist ${erst.land}${erst.regelGleich ? `, ${erst.regelGleich} mit gleicher Regel` : ""}`, punkte };
  const vorschlag = erst && erst.gemeinsam > 0 ? erst.land : null;
  return { land: null, sicher: false, vorschlag, begruendung: vorschlag ? `nicht eindeutig – am ehesten ${vorschlag} (${erst.gemeinsam} von ${n} SKUs${zweit ? `, ${zweit.land} ${zweit.gemeinsam}` : ""})` : "kein Abgleich möglich (kein BQool-Ist mit diesen SKUs)", punkte };
}

/**
 * Land einer Daily-Sales-Datei: Umsatz der letzten Tage gegen die Listing-Performance-Summe je Land (gleicher
 * Zeitraum). Passt genau ein Land auf ±10 %, ist es sicher; sonst Rückfrage mit dem nächsten Land als Vorschlag.
 */
export function tagesLand(tage: Tageswert[], lp: { land: BerichtLand; stichtag: string; tage: number; sales: number }[]): LandErgebnis {
  const summe = (von: string, bis: string) => tage.filter((t) => t.tag >= von && t.tag <= bis).reduce((s, t) => s + (t.sales ?? 0), 0);
  const tagMinus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const werte = lp
    .map((x) => {
      // „letzte 7 Tage“ endet je nach Uhrzeit heute oder gestern – beide Fenster prüfen
      const a = summe(tagMinus(x.stichtag, x.tage - 1), x.stichtag);
      const b = summe(tagMinus(x.stichtag, x.tage), tagMinus(x.stichtag, 1));
      const abw = Math.min(...[a, b].map((v) => Math.abs(v - x.sales) / Math.max(Math.abs(x.sales), 1)));
      return { land: x.land, abw };
    })
    .sort((a, b) => a.abw - b.abw);
  const [erst, zweit] = werte;
  const punkte = werte.map((w) => ({ land: w.land, gemeinsam: 0, jaccard: 0, regelGleich: 0, punkte: Math.round((1 - w.abw) * 1000) / 1000 }));
  if (erst && erst.abw <= 0.1 && (!zweit || zweit.abw - erst.abw >= 0.1)) return { land: erst.land, sicher: true, vorschlag: erst.land, begruendung: `Umsatz passt zur Listing Performance ${erst.land} (Abweichung ${Math.round(erst.abw * 100)} %)`, punkte };
  return { land: null, sicher: false, vorschlag: erst?.land ?? null, begruendung: erst ? `nicht eindeutig – am ehesten ${erst.land} (Abweichung ${Math.round(erst.abw * 100)} %)` : "kein Abgleich möglich (noch keine Listing Performance)", punkte };
}

/** Buy-Box-Anteil eines Landes: Summenzeile der Datei, sonst Mittel der SKUs mit Wert (gerundet). */
export function buyboxAnteil(zeilen: { bbWins: number | null }[], summe?: { bbWins: number | null } | null): number | null {
  if (summe?.bbWins !== null && summe?.bbWins !== undefined) return Math.round(summe.bbWins * 10) / 10;
  const w = zeilen.map((z) => z.bbWins).filter((x): x is number => x !== null);
  return w.length ? Math.round((w.reduce((s, x) => s + x, 0) / w.length) * 10) / 10 : null;
}

const prozent = (n: number) => `${Math.round(n)} %`;
/** Morgenbericht: „Buy Box DE 29 %, FR 43 %, IT 39 %, ES 53 %“ (feste Reihenfolge). */
export function buyboxZeile(werte: { land: string; anteil: number | null }[]): string | null {
  const w = BERICHT_LAENDER.map((l) => werte.find((x) => x.land === l)).filter((x): x is { land: string; anteil: number } => !!x && x.anteil !== null);
  return w.length ? `Buy Box ${w.map((x) => `${x.land} ${prozent(x.anteil)}`).join(", ")}` : null;
}

/** ISO-Kalenderwoche „2026-W45“. */
export function isoWoche(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jahrStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const kw = Math.ceil(((d.getTime() - jahrStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(kw)}`;
}

/** Buy-Box-Anteil je Land und Woche – je Woche der letzte Stand. */
export function buyboxWochen(berichte: { land: string; stichtag: string; anteil: number | null }[], wochen = 6): { woche: string; je: Record<string, number | null> }[] {
  const je = new Map<string, Record<string, { stichtag: string; anteil: number | null }>>();
  for (const b of berichte) {
    const w = isoWoche(b.stichtag);
    const m = je.get(w) ?? {};
    if (!m[b.land] || m[b.land].stichtag < b.stichtag) m[b.land] = { stichtag: b.stichtag, anteil: b.anteil };
    je.set(w, m);
  }
  return [...je.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, wochen)
    .map(([woche, m]) => ({ woche, je: Object.fromEntries(Object.entries(m).map(([l, v]) => [l, v.anteil])) }));
}

export const LEISTUNG_GRENZEN = { unterMinAb: 50, buyboxUnter: 10, preisAenderungEuro: 500, preisHochAb: 200 } as const;

export type Kontext = { bqMin: number | null; effMin: number | null; liquidation: boolean; regelSoll?: string | null };
export type LeistungFall = { land: string; sku: string; asin: string | null; titel: string | null; regel: string | null; werte: LeistungZeile; vorschlag: string; art: "min_senken" | "min_anheben" | "liquidation" | "pruefen" | "ek_fehlt" | "regel_pruefen" };

const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Die drei Listen des Reiters „Leistung“:
 * - unterMin: Below Min ≥ 50 % und Buy Box < 10 % → „Min senken auf effektiven Min“ (falls der darunter liegt)
 * - verlust: Est. Profit < 0 → Min anheben bzw. als Liquidation bestätigen
 * - preisbewegung: |Price Changes| > 500 € oder > 200 Erhöhungen bei Below Min 100 % → Aufgabe „BQool-Regel prüfen“
 */
export function leistungAuswerten(zeilen: (LeistungZeile & { land: string })[], kontext: Map<string, Kontext>, g = LEISTUNG_GRENZEN) {
  const k = (z: { land: string; sku: string }) => kontext.get(`${z.land}|${z.sku}`) ?? { bqMin: null, effMin: null, liquidation: false };
  const fall = (z: LeistungZeile & { land: string }, art: LeistungFall["art"], vorschlag: string): LeistungFall => ({ land: z.land, sku: z.sku, asin: z.asin, titel: z.titel, regel: z.regel, werte: z, vorschlag, art });
  const unterMin = zeilen
    .filter((z) => z.belowMin !== null && z.belowMin >= g.unterMinAb && (z.bbWins ?? 0) < g.buyboxUnter)
    .map((z) => {
      const c = k(z);
      if (c.effMin === null) return fall(z, "ek_fehlt", "EK fehlt – effektiver Min unbekannt");
      if (c.bqMin !== null && c.effMin < c.bqMin - 0.005) return fall(z, "min_senken", `Min senken auf effektiven Min ${eur(c.effMin)} (jetzt ${eur(c.bqMin)})`);
      return fall(z, "pruefen", `Min steht schon am effektiven Min ${eur(c.effMin)} – tiefer nur unter Mindestmarge`);
    })
    .sort((a, b) => (b.werte.belowMin ?? 0) - (a.werte.belowMin ?? 0) || a.sku.localeCompare(b.sku));
  const verlust = zeilen
    .filter((z) => z.profit !== null && z.profit < 0)
    .map((z) => {
      const c = k(z);
      if (c.liquidation || /liquidation|abverkauf/i.test(z.regel ?? "")) return fall(z, "liquidation", `Liquidation (Regel „${z.regel ?? c.regelSoll ?? "Liquidation"}“) – als gewollt bestätigen`);
      if (c.effMin !== null && c.bqMin !== null && c.bqMin < c.effMin - 0.005) return fall(z, "min_anheben", `Min anheben auf ${eur(c.effMin)} (jetzt ${eur(c.bqMin)}) oder als Liquidation bestätigen`);
      return fall(z, "pruefen", c.effMin === null ? "EK fehlt – Min prüfen oder als Liquidation bestätigen" : "Min liegt schon am effektiven Min – Kosten/Gebühren prüfen oder als Liquidation bestätigen");
    })
    .sort((a, b) => (a.werte.profit ?? 0) - (b.werte.profit ?? 0));
  const preisbewegung = zeilen
    .filter((z) => Math.abs(z.priceChanges ?? 0) > g.preisAenderungEuro || ((z.priceUp ?? 0) > g.preisHochAb && (z.belowMin ?? 0) >= 100))
    .map((z) => fall(z, "regel_pruefen", [Math.abs(z.priceChanges ?? 0) > g.preisAenderungEuro ? `Preisänderungen ${eur(z.priceChanges ?? 0)}` : "", (z.priceUp ?? 0) > g.preisHochAb && (z.belowMin ?? 0) >= 100 ? `${z.priceUp} Erhöhungen bei Below Min 100 %` : ""].filter(Boolean).join(", ") + " – BQool-Regel prüfen"))
    .sort((a, b) => Math.abs(b.werte.priceChanges ?? 0) - Math.abs(a.werte.priceChanges ?? 0));
  return { unterMin, verlust, preisbewegung };
}

/** Zeitraum aus Dateiname/Hinweis („30 Tage“, „30d“, „last 30 days“); Standard 7. */
export function zeitraumAus(text: string | null | undefined, standard: 7 | 30 = 7): 7 | 30 {
  return /(?<!\d)30[\s_-]*(tage|days|d)(?![a-z])/i.test(text ?? "") ? 30 : /(?<!\d)7[\s_-]*(tage|days|d)(?![a-z])/i.test(text ?? "") ? 7 : standard;
}
