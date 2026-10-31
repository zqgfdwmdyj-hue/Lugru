// Amazon Business – reine Logik: B2B-Werte je ASIN aus dem Bericht „Sales and Traffic“ (SP-API) oder dem
// Geschäftsbericht aus Seller Central (CSV), Staffelpreise mit Gewinnprüfung, Upload-Datei für Seller Central.

import { landVonId, type Land } from "@/lib/amazon-markt/logic";

export type B2bZeile = {
  asin: string;
  sku: string | null;
  titel: string | null;
  sitzungen: number | null;
  sitzungenB2b: number | null;
  einheiten: number | null;
  einheitenB2b: number | null;
  umsatz: number | null;
  umsatzB2b: number | null;
  buybox: number | null;
  buyboxB2b: number | null;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[€$£%\s ]/g, "").trim();
  if (!s || s === "-" || s === "–") return null;
  if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/** GET_SALES_AND_TRAFFIC_REPORT → B2B-Werte je ASIN (unitsOrderedB2B, orderedProductSalesB2B, sessionsB2B, buyBoxPercentageB2B). */
export function leseSalesTrafficB2b(doc: unknown): { land: Land | null; von: string | null; bis: string | null; zeilen: B2bZeile[] } {
  const d = (doc ?? {}) as { reportSpecification?: { dataStartTime?: string; dataEndTime?: string; marketplaceIds?: string[] }; salesAndTrafficByAsin?: Record<string, unknown>[] };
  const spec = d.reportSpecification ?? {};
  const zeilen: B2bZeile[] = [];
  for (const e of d.salesAndTrafficByAsin ?? []) {
    const asin = (e.childAsin ?? e.asin ?? e.parentAsin) as string | undefined;
    if (!asin) continue;
    const s = (e.salesByAsin ?? {}) as Record<string, unknown> & { orderedProductSales?: { amount?: number }; orderedProductSalesB2B?: { amount?: number } };
    const t = (e.trafficByAsin ?? {}) as Record<string, unknown>;
    zeilen.push({
      asin,
      sku: (e.sku as string | undefined) ?? null,
      titel: null,
      sitzungen: num(t.sessions),
      sitzungenB2b: num(t.sessionsB2B),
      einheiten: num(s.unitsOrdered),
      einheitenB2b: num(s.unitsOrderedB2B),
      umsatz: r2(num(s.orderedProductSales?.amount)),
      umsatzB2b: r2(num(s.orderedProductSalesB2B?.amount)),
      buybox: num(t.buyBoxPercentage),
      buyboxB2b: num(t.buyBoxPercentageB2B),
    });
  }
  const day = (x?: string) => (x ? x.slice(0, 10) : null);
  return { land: spec.marketplaceIds?.[0] ? landVonId(spec.marketplaceIds[0]) : null, von: day(spec.dataStartTime), bis: day(spec.dataEndTime), zeilen };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/**
 * Geschäftsbericht „Detailseite Verkäufe und Traffic nach untergeordnetem Artikel“ (CSV, deutsch oder englisch)
 * mit B2B-Spalten. Erkennt die Spalten am Namen; ohne B2B-Spalten → Fehler mit Hinweis.
 */
export function leseBusinessReport(headers: string[], rows: string[][]): { zeilen: B2bZeile[]; fehler: string | null } {
  const h = headers.map(norm);
  const finde = (pred: (x: string) => boolean) => h.findIndex(pred);
  const b2b = (x: string) => x.includes("b2b");
  const iAsin = finde((x) => !b2b(x) && (x === "untergeordneteasin" || x === "childasin" || x === "asinuntergeordnet")) >= 0 ? finde((x) => !b2b(x) && (x === "untergeordneteasin" || x === "childasin" || x === "asinuntergeordnet")) : finde((x) => x.endsWith("asin") && !x.includes("ubergeordnet") && !x.includes("parent"));
  const iSku = finde((x) => x === "sku");
  const iTitel = finde((x) => x === "titel" || x === "title");
  const iSitz = finde((x) => !b2b(x) && (x === "sitzungensumme" || x === "sessionstotal" || x === "sitzungen" || x === "sessions"));
  const iSitzB = finde((x) => b2b(x) && (x.startsWith("sitzungensumme") || x.startsWith("sessionstotal")));
  const iEinh = finde((x) => !b2b(x) && (x === "bestellteeinheiten" || x === "unitsordered"));
  const iEinhB = finde((x) => b2b(x) && (x.startsWith("bestellteeinheiten") || x.startsWith("unitsordered")));
  const iUms = finde((x) => !b2b(x) && (x === "umsatzbestellterprodukte" || x === "orderedproductsales"));
  const iUmsB = finde((x) => b2b(x) && (x.startsWith("umsatzbestellterprodukte") || x.startsWith("orderedproductsales")));
  const iBb = finde((x) => !b2b(x) && (x.includes("buybox") || x.includes("empfohlenesangebot") || x.includes("featuredoffer")) && (x.includes("prozent") || x.includes("percentage")));
  const iBbB = finde((x) => b2b(x) && (x.includes("buybox") || x.includes("empfohlenesangebot") || x.includes("featuredoffer")));
  if (iAsin < 0) return { zeilen: [], fehler: "Spalte „(Untergeordnete) ASIN“ nicht gefunden – bitte den Geschäftsbericht „nach untergeordnetem Artikel“ wählen." };
  if (iSitzB < 0 && iEinhB < 0 && iUmsB < 0) return { zeilen: [], fehler: "Keine B2B-Spalten gefunden – in Seller Central beim Geschäftsbericht „B2B“ einblenden bzw. „Alle Spalten“ wählen." };
  const v = (r: string[], i: number) => (i >= 0 ? num(r[i]) : null);
  const zeilen: B2bZeile[] = [];
  for (const r of rows) {
    const asin = (r[iAsin] ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    zeilen.push({
      asin,
      sku: iSku >= 0 ? r[iSku]?.trim() || null : null,
      titel: iTitel >= 0 ? r[iTitel]?.trim().slice(0, 200) || null : null,
      sitzungen: v(r, iSitz),
      sitzungenB2b: v(r, iSitzB),
      einheiten: v(r, iEinh),
      einheitenB2b: v(r, iEinhB),
      umsatz: r2(v(r, iUms)),
      umsatzB2b: r2(v(r, iUmsB)),
      buybox: v(r, iBb),
      buyboxB2b: v(r, iBbB),
    });
  }
  return { zeilen, fehler: zeilen.length ? null : "Keine Zeilen mit ASIN gefunden." };
}

export type Periode = { land: string; von: string; bis: string; quelle: string; abgerufenAm: Date };

/**
 * Zeitraum wählen: „letzte“ (Standard: jüngster Zeitraum je Land), „JJJJ-MM“ (Zeitraum, der in diesem Monat endet)
 * oder „von:bis“ (genau dieser Zeitraum).
 */
export function waehlePerioden(alle: Periode[], zeitraum: string | undefined, land?: string): Periode[] {
  const l = land ? alle.filter((p) => p.land === land) : alle;
  const z = (zeitraum ?? "letzte").trim();
  const exakt = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(z);
  const monat = /^\d{4}-\d{2}$/.test(z) ? z : null;
  const passend = exakt ? l.filter((p) => p.von === exakt[1] && p.bis === exakt[2]) : monat ? l.filter((p) => p.bis.startsWith(monat)) : l;
  const jeLand = new Map<string, Periode>();
  for (const p of passend) if (!jeLand.has(p.land) || jeLand.get(p.land)!.bis < p.bis) jeLand.set(p.land, p);
  return [...jeLand.values()];
}

/** Summen und Anteil B2B. */
export function b2bSummen(zeilen: B2bZeile[]) {
  const s = (f: (z: B2bZeile) => number | null) => zeilen.reduce((n, z) => n + (f(z) ?? 0), 0);
  const umsatz = s((z) => z.umsatz);
  const umsatzB2b = s((z) => z.umsatzB2b);
  const sitzB = s((z) => z.sitzungenB2b);
  // Buy Box B2B gewichtet mit den B2B-Sitzungen
  const bbGew = zeilen.filter((z) => z.buyboxB2b !== null && (z.sitzungenB2b ?? 0) > 0);
  const bbSitz = bbGew.reduce((n, z) => n + (z.sitzungenB2b ?? 0), 0);
  return {
    umsatz: r2(umsatz)!,
    umsatzB2b: r2(umsatzB2b)!,
    anteilProzent: umsatz > 0 ? Math.round((umsatzB2b / umsatz) * 1000) / 10 : null,
    einheitenB2b: s((z) => z.einheitenB2b),
    sitzungenB2b: sitzB,
    buyboxB2b: bbSitz > 0 ? Math.round((bbGew.reduce((n, z) => n + (z.buyboxB2b ?? 0) * (z.sitzungenB2b ?? 0), 0) / bbSitz) * 10) / 10 : null,
    kaufquoteB2b: sitzB > 0 ? Math.round((s((z) => z.einheitenB2b) / sitzB) * 1000) / 10 : null,
  };
}

// ---- Staffelpreise

export type StaffelRegel = { stufen: number[]; rabatte: number[]; minGewinn: number };
export const STAFFEL_STANDARD: StaffelRegel = { stufen: [3, 10, 25], rabatte: [3, 5, 8], minGewinn: 1 };
export type Stufe = { ab: number; preis: number; gewinn: number; marge: number; ok: boolean; hinweis: string | null };

/** Gewinn je Stück (netto) bei Bruttopreis p: p/(1+USt) − Provision·p − EK − FBA. */
export function gewinnJeStueck(p: number, k: { ek: number; fba: number; provision: number; mwst: number }): number {
  return Math.round((p / (1 + k.mwst) - k.provision * p - k.ek - k.fba) * 100) / 100;
}

/** Kleinster Bruttopreis mit mindestens `min` € Gewinn je Stück. */
export function mindestPreis(k: { ek: number; fba: number; provision: number; mwst: number }, min: number): number | null {
  const netto = 1 / (1 + k.mwst) - k.provision;
  return netto > 0 ? Math.ceil(((k.ek + k.fba + min) / netto) * 100) / 100 : null;
}

/**
 * Staffelpreise je Stufe: Rabatt auf den aktuellen Preis, aber nie unter den Mindestpreis (Gewinn ≥ minGewinn).
 * Jede Stufe muss günstiger sein als die vorige – sonst entfällt sie (ok = false mit Hinweis).
 */
export function staffelVorschlag(preis: number, k: { ek: number | null; fba: number; provision: number; mwst: number }, r: StaffelRegel = STAFFEL_STANDARD): { stufen: Stufe[]; mindestPreis: number | null; fehler: string | null } {
  if (k.ek === null) return { stufen: [], mindestPreis: null, fehler: "EK fehlt – keine Gewinnprüfung möglich" };
  const kk = { ...k, ek: k.ek };
  const min = mindestPreis(kk, r.minGewinn);
  if (min === null) return { stufen: [], mindestPreis: null, fehler: "Provision/USt ergeben keinen positiven Erlös" };
  const stufen: Stufe[] = [];
  let vorher = preis;
  r.stufen.forEach((ab, i) => {
    const ziel = Math.floor(preis * (1 - (r.rabatte[i] ?? 0) / 100) * 100) / 100;
    const p = Math.max(ziel, min);
    const g = gewinnJeStueck(p, kk);
    const marge = Math.round((g / (p / (1 + kk.mwst))) * 1000) / 10;
    if (p >= vorher) stufen.push({ ab, preis: p, gewinn: g, marge, ok: false, hinweis: p === min ? "Mindestgewinn erlaubt keinen weiteren Rabatt" : "nicht günstiger als die vorige Stufe" });
    else {
      stufen.push({ ab, preis: p, gewinn: g, marge, ok: true, hinweis: p > ziel ? `Rabatt auf Mindestpreis begrenzt (${r.rabatte[i]} % gewünscht)` : null });
      vorher = p;
    }
  });
  return { stufen, mindestPreis: min, fehler: null };
}

/**
 * Upload-Datei „Preis und Menge“ mit Amazon-Business-Spalten (Tabulator getrennt) für Seller Central → Lagerbestand
 * → Lagerbestandsdateien hochladen. Nur Stufen mit ok = true.
 */
export function staffelUploadDatei(zeilen: { sku: string; businessPreis: number | null; stufen: { ab: number; preis: number; ok: boolean }[] }[]): string {
  const kopf = ["sku", "business-price", "quantity-price-type", "quantity-lower-bound1", "quantity-price1", "quantity-lower-bound2", "quantity-price2", "quantity-lower-bound3", "quantity-price3", "quantity-lower-bound4", "quantity-price4", "quantity-lower-bound5", "quantity-price5"];
  const f = (n: number) => n.toFixed(2);
  const out = [kopf.join("\t")];
  for (const z of zeilen) {
    const st = z.stufen.filter((s) => s.ok).slice(0, 5);
    const zellen = [z.sku.replace(/[\t\r\n]/g, " "), z.businessPreis !== null ? f(z.businessPreis) : "", st.length ? "fixed" : ""];
    for (let i = 0; i < 5; i++) zellen.push(st[i] ? String(st[i].ab) : "", st[i] ? f(st[i].preis) : "");
    out.push(zellen.join("\t"));
  }
  return out.join("\r\n") + "\r\n";
}

/** SP-API Listings-Patch für das B2B-Angebot (Business-Preis + Mengenrabatte, fester Preis je Stufe). */
export function staffelPatch(marketplaceId: string, businessPreis: number, stufen: { ab: number; preis: number; ok: boolean }[]) {
  const levels = stufen.filter((s) => s.ok).slice(0, 5).map((s) => ({ lower_bound: s.ab, value: s.preis }));
  return [
    {
      op: "replace",
      path: "/attributes/purchasable_offer",
      value: [
        {
          marketplace_id: marketplaceId,
          currency: "EUR",
          audience: "B2B",
          our_price: [{ schedule: [{ value_with_tax: businessPreis }] }],
          ...(levels.length ? { quantity_discount_plan: [{ schedule: [{ discount_type: "fixed", levels }] }] } : {}),
        },
      ],
    },
  ];
}
