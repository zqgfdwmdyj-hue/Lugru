// Amazon-Umsatzsteuer-Transaktionsbericht (GET_VAT_TRANSACTION_DATA) je Land aufbereiten – reine Logik.
// Ergebnis: Summen je steuerpflichtigem Land, Vorgang und Verfahren (OSS, regulär, Amazon als Steuerschuldner)
// plus Hinweise, welche Meldungen anfallen könnten. Die Bewertung bleibt beim Steuerberater.

import { parseAmount } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";

export type UstZeile = { land: string; vorgang: string; verfahren: string; satz: number | null; netto: number; ust: number; anzahl: number; von: string | null; nach: string | null; brutto?: number };
export type UstAuswertung = {
  zeilen: UstZeile[];
  zeitraum: { von: string | null; bis: string | null };
  waehrungen: string[];
  hinweise: string[];
  transfers: { von: string; nach: string; netto: number; anzahl: number; stueck?: number }[];
  /** Periode laut ACTIVITY_PERIOD (YYYY-MM), falls vorhanden. */
  periode?: string | null;
  marktplaetze?: string[];
  jeTyp?: Record<string, number>;
  /** Zeilen je Meldeschema (UNION-OSS, REGULAR, CH_VOEC …) – ohne Verbringungen. */
  jeVerfahren?: Record<string, number>;
  /** INVOICE/CREDIT_NOTE ohne Steuerland – gesondert, nie stillschweigend im Umsatz. */
  ohneSteuerland?: { vorgang: string; netto: number; ust: number; brutto: number; anzahl: number }[];
};

const n = (h: string) => h.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const LAENDER: Record<string, string> = { DE: "Deutschland", FR: "Frankreich", IT: "Italien", ES: "Spanien", PL: "Polen", CZ: "Tschechien", NL: "Niederlande", BE: "Belgien", AT: "Österreich", SE: "Schweden", IE: "Irland", GB: "Großbritannien", SK: "Slowakei", CH: "Schweiz" };
export const landName = (c: string) => LAENDER[c] ?? c;
const MONATE: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
/** „2026-JUL“ → „2026-07“ (auch schon „2026-07“). */
export function periodeAus(v: string): string | null {
  const m = /^(\d{4})-([A-Z]{3}|\d{2})$/i.exec(v.trim());
  if (!m) return null;
  const mo = /^\d{2}$/.test(m[2]) ? m[2] : MONATE[m[2].toUpperCase()];
  return mo ? `${m[1]}-${mo}` : null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function spalten(kopf: string[]) {
  const sp = (...namen: string[]) => kopf.findIndex((h) => namen.includes(h));
  return {
    typ: sp("TRANSACTION_TYPE"),
    periode: sp("ACTIVITY_PERIOD"),
    markt: sp("MARKETPLACE"),
    land: sp("TAXABLE_JURISDICTION", "TAX_REPORTING_JURISDICTION"),
    verfahren: sp("TAX_REPORTING_SCHEME"),
    schuldner: sp("TAX_COLLECTION_RESPONSIBILITY"),
    netto: sp("TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL", "PRICE_OF_ITEMS_AMT_VAT_EXCL"),
    ust: sp("TOTAL_ACTIVITY_VALUE_VAT_AMT", "PRICE_OF_ITEMS_VAT_AMT"),
    brutto: sp("TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL", "PRICE_OF_ITEMS_AMT_VAT_INCL"),
    satz: sp("PRICE_OF_ITEMS_VAT_RATE_PERCENT", "VAT_RATE_PERCENT"),
    datum: sp("TRANSACTION_COMPLETE_DATE", "TAX_CALCULATION_DATE", "TRANSACTION_DEPART_DATE"),
    von: sp("SALE_DEPART_COUNTRY", "DEPARTURE_COUNTRY"),
    nach: sp("SALE_ARRIVAL_COUNTRY", "ARRIVAL_COUNTRY"),
    menge: sp("QTY"),
    waehrung: sp("TRANSACTION_CURRENCY_CODE"),
  };
}

function auswerten(rows: string[][], c: ReturnType<typeof spalten>, heimat: string, periode: string | null): UstAuswertung {
  const z = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const gruppen = new Map<string, UstZeile>();
  const transfers = new Map<string, { von: string; nach: string; netto: number; anzahl: number; stueck: number }>();
  const ohne = new Map<string, { vorgang: string; netto: number; ust: number; brutto: number; anzahl: number }>();
  const tage: string[] = [];
  const waehrungen = new Set<string>();
  const maerkte = new Set<string>();
  const jeTyp: Record<string, number> = {};
  const jeVerfahren: Record<string, number> = {};
  for (const r of rows) {
    const typ = z(r, c.typ).toUpperCase();
    if (!typ) continue;
    jeTyp[typ] = (jeTyp[typ] ?? 0) + 1;
    const netto = parseAmount(z(r, c.netto)) ?? 0;
    const ust = parseAmount(z(r, c.ust)) ?? 0;
    const brutto = parseAmount(z(r, c.brutto)) ?? r2(netto + ust);
    const von = z(r, c.von).toUpperCase() || null;
    const nach = z(r, c.nach).toUpperCase() || null;
    const d = z(r, c.datum);
    const iso = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d) ? d.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$2-$1") : /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
    if (iso) tage.push(iso);
    if (z(r, c.waehrung)) waehrungen.add(z(r, c.waehrung).toUpperCase());
    if (z(r, c.markt)) maerkte.add(z(r, c.markt).toLowerCase());
    if (typ === "FC_TRANSFER" || typ === "INBOUND") {
      if (von && nach && von !== nach) {
        const k = `${von}>${nach}`;
        const x = transfers.get(k) ?? { von, nach, netto: 0, anzahl: 0, stueck: 0 };
        x.netto += netto;
        x.anzahl++;
        x.stueck += Math.abs(parseAmount(z(r, c.menge)) ?? 1);
        transfers.set(k, x);
      }
      continue;
    }
    const land = z(r, c.land).toUpperCase();
    if (!land && (typ === "INVOICE" || typ === "CREDIT_NOTE")) {
      const x = ohne.get(typ) ?? { vorgang: typ, netto: 0, ust: 0, brutto: 0, anzahl: 0 };
      x.netto += netto;
      x.ust += ust;
      x.brutto += brutto;
      x.anzahl++;
      ohne.set(typ, x);
      continue;
    }
    const verfahren = (z(r, c.schuldner).toUpperCase() === "MARKETPLACE" ? "MARKETPLACE" : z(r, c.verfahren).toUpperCase()) || "REGULAR";
    jeVerfahren[verfahren] = (jeVerfahren[verfahren] ?? 0) + 1;
    const steuerland = land || nach || "?";
    const satzRoh = parseAmount(z(r, c.satz));
    const satz = satzRoh === null ? null : satzRoh > 1 ? satzRoh / 100 : satzRoh;
    const key = [steuerland, typ, verfahren, satz ?? ""].join("|");
    const g = gruppen.get(key) ?? { land: steuerland, vorgang: typ, verfahren, satz, netto: 0, ust: 0, brutto: 0, anzahl: 0, von, nach };
    g.netto += netto;
    g.ust += ust;
    g.brutto = (g.brutto ?? 0) + brutto;
    g.anzahl++;
    gruppen.set(key, g);
  }
  const zeilen = [...gruppen.values()].map((g) => ({ ...g, netto: r2(g.netto), ust: r2(g.ust), brutto: r2(g.brutto ?? 0) })).sort((a, b) => a.land.localeCompare(b.land) || a.vorgang.localeCompare(b.vorgang));
  const tr = [...transfers.values()].map((x) => ({ ...x, netto: r2(x.netto) }));
  tage.sort();
  return {
    zeilen,
    zeitraum: { von: tage[0] ?? null, bis: tage[tage.length - 1] ?? null },
    waehrungen: [...waehrungen],
    hinweise: ustHinweise(zeilen, tr, heimat),
    transfers: tr,
    periode,
    marktplaetze: [...maerkte].sort(),
    jeTyp,
    jeVerfahren,
    ohneSteuerland: [...ohne.values()].map((x) => ({ ...x, netto: r2(x.netto), ust: r2(x.ust), brutto: r2(x.brutto) })),
  };
}

function lesen(bytes: Uint8Array) {
  const t = readTable(bytes);
  const c = spalten(t.headers.map(n));
  if (c.typ < 0 || c.netto < 0) throw new Error("Das ist kein Amazon-Umsatzsteuerbericht (Spalten TRANSACTION_TYPE und TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL fehlen).");
  return { t, c };
}

/** Ganze Datei als eine Auswertung (wie bisher). */
export function leseUstBericht(bytes: Uint8Array, heimat = "DE"): UstAuswertung {
  const { t, c } = lesen(bytes);
  return auswerten(t.rows, c, heimat, null);
}

/**
 * Je Periode (ACTIVITY_PERIOD, sonst Monat des Abschlussdatums) eine Auswertung – Zeilen anderer Perioden in der Datei
 * gehören zur Periode der Zeile, nicht der Datei.
 */
export function leseUstBerichtJePeriode(bytes: Uint8Array, heimat = "DE"): { monat: string; auswertung: UstAuswertung; zeilen: number }[] {
  const { t, c } = lesen(bytes);
  const gruppen = new Map<string, string[][]>();
  for (const r of t.rows) {
    const p = (c.periode >= 0 ? periodeAus(r[c.periode] ?? "") : null) ?? (() => {
      const d = (r[c.datum] ?? "").trim();
      const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
      return m ? `${m[3]}-${m[2]}` : /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null;
    })();
    if (!p) continue;
    const g = gruppen.get(p) ?? [];
    g.push(r);
    gruppen.set(p, g);
  }
  return [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([monat, rows]) => ({ monat, auswertung: auswerten(rows, c, heimat, monat), zeilen: rows.length }));
}

/** Mehrere Teil-Auswertungen derselben Periode (aus verschiedenen Dateien) zusammenführen. */
export function ustZusammenfuehren(teile: UstAuswertung[], heimat = "DE"): UstAuswertung {
  const zeilen = new Map<string, UstZeile>();
  const transfers = new Map<string, { von: string; nach: string; netto: number; anzahl: number; stueck: number }>();
  const ohne = new Map<string, { vorgang: string; netto: number; ust: number; brutto: number; anzahl: number }>();
  const jeTyp: Record<string, number> = {};
  const jeVerfahren: Record<string, number> = {};
  const add = (ziel: Record<string, number>, q?: Record<string, number>) => Object.entries(q ?? {}).forEach(([k, v]) => (ziel[k] = (ziel[k] ?? 0) + v));
  for (const t of teile) {
    for (const z of t.zeilen) {
      const k = [z.land, z.vorgang, z.verfahren, z.satz ?? ""].join("|");
      const g = zeilen.get(k) ?? { ...z, netto: 0, ust: 0, brutto: 0, anzahl: 0 };
      g.netto += z.netto;
      g.ust += z.ust;
      g.brutto = (g.brutto ?? 0) + (z.brutto ?? z.netto + z.ust);
      g.anzahl += z.anzahl;
      zeilen.set(k, g);
    }
    for (const x of t.transfers) {
      const k = `${x.von}>${x.nach}`;
      const g = transfers.get(k) ?? { von: x.von, nach: x.nach, netto: 0, anzahl: 0, stueck: 0 };
      g.netto += x.netto;
      g.anzahl += x.anzahl;
      g.stueck += x.stueck ?? x.anzahl;
      transfers.set(k, g);
    }
    for (const x of t.ohneSteuerland ?? []) {
      const g = ohne.get(x.vorgang) ?? { vorgang: x.vorgang, netto: 0, ust: 0, brutto: 0, anzahl: 0 };
      g.netto += x.netto;
      g.ust += x.ust;
      g.brutto += x.brutto;
      g.anzahl += x.anzahl;
      ohne.set(x.vorgang, g);
    }
    add(jeTyp, t.jeTyp);
    add(jeVerfahren, t.jeVerfahren);
  }
  const zs = [...zeilen.values()].map((g) => ({ ...g, netto: r2(g.netto), ust: r2(g.ust), brutto: r2(g.brutto ?? 0) })).sort((a, b) => a.land.localeCompare(b.land) || a.vorgang.localeCompare(b.vorgang));
  const tr = [...transfers.values()].map((x) => ({ ...x, netto: r2(x.netto) }));
  const tage = teile.flatMap((t) => [t.zeitraum.von, t.zeitraum.bis]).filter((x): x is string => Boolean(x)).sort();
  return {
    zeilen: zs,
    zeitraum: { von: tage[0] ?? null, bis: tage[tage.length - 1] ?? null },
    waehrungen: [...new Set(teile.flatMap((t) => t.waehrungen))],
    hinweise: ustHinweise(zs, tr, heimat),
    transfers: tr,
    periode: teile.find((t) => t.periode)?.periode ?? null,
    marktplaetze: [...new Set(teile.flatMap((t) => t.marktplaetze ?? []))].sort(),
    jeTyp,
    jeVerfahren,
    ohneSteuerland: [...ohne.values()].map((x) => ({ ...x, netto: r2(x.netto), ust: r2(x.ust), brutto: r2(x.brutto) })),
  };
}

/** Umsatz je Steuerland (SALE/REFUND, ohne Verbringungen): netto, USt, brutto, getrennt nach OSS und lokal. */
export function umsatzJeSteuerland(a: UstAuswertung) {
  const m = new Map<string, { land: string; netto: number; ust: number; brutto: number; oss: number; lokal: number }>();
  for (const z of a.zeilen) {
    if (!["SALE", "REFUND", "RETURN"].includes(z.vorgang)) continue;
    const g = m.get(z.land) ?? { land: z.land, netto: 0, ust: 0, brutto: 0, oss: 0, lokal: 0 };
    g.netto += z.netto;
    g.ust += z.ust;
    g.brutto += z.brutto ?? z.netto + z.ust;
    if (z.verfahren.includes("OSS")) g.oss += z.netto;
    else g.lokal += z.netto;
    m.set(z.land, g);
  }
  return [...m.values()].map((g) => ({ ...g, netto: r2(g.netto), ust: r2(g.ust), brutto: r2(g.brutto), oss: r2(g.oss), lokal: r2(g.lokal) })).sort((x, y) => y.brutto - x.brutto);
}

/** OSS-Meldung je Quartal: Land und Steuersatz, Netto und USt (nur Meldeschema OSS, Verkäufe und Erstattungen). */
export function ossQuartal(monate: UstAuswertung[]) {
  const m = new Map<string, { land: string; satz: number | null; netto: number; ust: number; anzahl: number }>();
  for (const a of monate)
    for (const z of a.zeilen) {
      if (!z.verfahren.includes("OSS") || !["SALE", "REFUND", "RETURN"].includes(z.vorgang)) continue;
      const k = `${z.land}|${z.satz ?? ""}`;
      const g = m.get(k) ?? { land: z.land, satz: z.satz, netto: 0, ust: 0, anzahl: 0 };
      g.netto += z.netto;
      g.ust += z.ust;
      g.anzahl += z.anzahl;
      m.set(k, g);
    }
  return [...m.values()].map((g) => ({ ...g, netto: r2(g.netto), ust: r2(g.ust) })).sort((a, b) => a.land.localeCompare(b.land) || (a.satz ?? 0) - (b.satz ?? 0));
}

/** Hinweise, welche Meldungen anfallen könnten – nur Hinweise, keine Steuerberatung. */
export function ustHinweise(zeilen: UstZeile[], transfers: { von: string; nach: string }[], heimat = "DE"): string[] {
  const h = new Set<string>();
  const auslandRegulaer = [...new Set(zeilen.filter((z) => z.land !== heimat && z.verfahren === "REGULAR" && z.vorgang === "SALE").map((z) => z.land))];
  for (const l of auslandRegulaer) h.add(`${landName(l)}: Verkäufe mit Steuerpflicht in ${landName(l)} (z. B. aus dortigem Lager) – Umsatzsteuer-Registrierung und Voranmeldung in ${landName(l)} prüfen.`);
  if (zeilen.some((z) => z.verfahren.includes("OSS"))) h.add("OSS-Verkäufe (Fernverkäufe in andere EU-Länder) – vierteljährliche OSS-Meldung beim BZSt.");
  for (const t of transfers) if (t.von === heimat || t.nach === heimat || t.von !== t.nach) h.add(`Warenbewegung ${landName(t.von)} → ${landName(t.nach)} (Amazon-Lager): innergemeinschaftliches Verbringen – Meldung in beiden Ländern (ZM/Voranmeldung) mit dem Steuerberater klären.`);
  if (zeilen.some((z) => z.verfahren === "MARKETPLACE" || z.verfahren.includes("DEEMED"))) h.add("Teilweise führt Amazon die Umsatzsteuer selbst ab (Marktplatz als Steuerschuldner) – diese Umsätze gesondert ausweisen.");
  return [...h];
}
