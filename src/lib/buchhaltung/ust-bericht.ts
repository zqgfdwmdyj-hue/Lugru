// Amazon-Umsatzsteuer-Transaktionsbericht (GET_VAT_TRANSACTION_DATA) je Land aufbereiten – reine Logik.
// Ergebnis: Summen je steuerpflichtigem Land, Vorgang und Verfahren (OSS, regulär, Amazon als Steuerschuldner)
// plus Hinweise, welche Meldungen anfallen könnten. Die Bewertung bleibt beim Steuerberater.

import { parseAmount } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";

export type UstZeile = { land: string; vorgang: string; verfahren: string; satz: number | null; netto: number; ust: number; anzahl: number; von: string | null; nach: string | null };
export type UstAuswertung = { zeilen: UstZeile[]; zeitraum: { von: string | null; bis: string | null }; waehrungen: string[]; hinweise: string[]; transfers: { von: string; nach: string; netto: number; anzahl: number }[] };

const n = (h: string) => h.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const LAENDER: Record<string, string> = { DE: "Deutschland", FR: "Frankreich", IT: "Italien", ES: "Spanien", PL: "Polen", CZ: "Tschechien", NL: "Niederlande", BE: "Belgien", AT: "Österreich", SE: "Schweden", IE: "Irland", GB: "Großbritannien" };
export const landName = (c: string) => LAENDER[c] ?? c;

export function leseUstBericht(bytes: Uint8Array, heimat = "DE"): UstAuswertung {
  const t = readTable(bytes);
  const kopf = t.headers.map(n);
  const sp = (...namen: string[]) => kopf.findIndex((h) => namen.includes(h));
  const c = {
    typ: sp("TRANSACTION_TYPE"),
    land: sp("TAXABLE_JURISDICTION", "TAX_REPORTING_JURISDICTION"),
    verfahren: sp("TAX_REPORTING_SCHEME"),
    schuldner: sp("TAX_COLLECTION_RESPONSIBILITY"),
    netto: sp("TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL", "PRICE_OF_ITEMS_AMT_VAT_EXCL"),
    ust: sp("TOTAL_ACTIVITY_VALUE_VAT_AMT", "PRICE_OF_ITEMS_VAT_AMT"),
    satz: sp("PRICE_OF_ITEMS_VAT_RATE_PERCENT", "VAT_RATE_PERCENT"),
    datum: sp("TRANSACTION_COMPLETE_DATE", "TAX_CALCULATION_DATE", "TRANSACTION_DEPART_DATE"),
    von: sp("SALE_DEPART_COUNTRY", "DEPARTURE_COUNTRY"),
    nach: sp("SALE_ARRIVAL_COUNTRY", "ARRIVAL_COUNTRY"),
    waehrung: sp("TRANSACTION_CURRENCY_CODE"),
  };
  if (c.typ < 0 || c.netto < 0) throw new Error("Das ist kein Amazon-Umsatzsteuerbericht (Spalten TRANSACTION_TYPE und TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL fehlen).");
  const z = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const gruppen = new Map<string, UstZeile>();
  const transfers = new Map<string, { von: string; nach: string; netto: number; anzahl: number }>();
  const tage: string[] = [];
  const waehrungen = new Set<string>();
  for (const r of t.rows) {
    const typ = z(r, c.typ).toUpperCase();
    if (!typ) continue;
    const netto = parseAmount(z(r, c.netto)) ?? 0;
    const ust = parseAmount(z(r, c.ust)) ?? 0;
    const von = z(r, c.von).toUpperCase() || null;
    const nach = z(r, c.nach).toUpperCase() || null;
    const d = z(r, c.datum);
    const iso = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d) ? d.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$2-$1") : /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
    if (iso) tage.push(iso);
    if (z(r, c.waehrung)) waehrungen.add(z(r, c.waehrung).toUpperCase());
    if (typ === "FC_TRANSFER" || typ === "INBOUND") {
      if (von && nach && von !== nach) {
        const k = `${von}>${nach}`;
        const x = transfers.get(k) ?? { von, nach, netto: 0, anzahl: 0 };
        x.netto += netto;
        x.anzahl++;
        transfers.set(k, x);
      }
      continue;
    }
    const verfahren = (z(r, c.schuldner).toUpperCase() === "MARKETPLACE" ? "MARKETPLACE" : z(r, c.verfahren).toUpperCase()) || "REGULAR";
    const land = z(r, c.land).toUpperCase() || nach || "?";
    const satzRoh = parseAmount(z(r, c.satz));
    const satz = satzRoh === null ? null : satzRoh > 1 ? satzRoh / 100 : satzRoh;
    const key = [land, typ, verfahren, satz ?? ""].join("|");
    const g = gruppen.get(key) ?? { land, vorgang: typ, verfahren, satz, netto: 0, ust: 0, anzahl: 0, von, nach };
    g.netto += netto;
    g.ust += ust;
    g.anzahl++;
    gruppen.set(key, g);
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const zeilen = [...gruppen.values()].map((g) => ({ ...g, netto: r2(g.netto), ust: r2(g.ust) })).sort((a, b) => a.land.localeCompare(b.land) || a.vorgang.localeCompare(b.vorgang));
  const tr = [...transfers.values()].map((x) => ({ ...x, netto: r2(x.netto) }));
  return { zeilen, zeitraum: { von: tage.sort()[0] ?? null, bis: tage[tage.length - 1] ?? null }, waehrungen: [...waehrungen], hinweise: ustHinweise(zeilen, tr, heimat), transfers: tr };
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
