// EK-Import – reine Logik: Vorschau (neu / geändert / gleich / unbekannte SKU, Abweichung in %, Warnungen) und die
// Importdatei für sellerboard im Format der ArbitrageOne-Datei (Blatt „Worksheet“, Spalten ASIN | SKU | Cost).

import * as XLSX from "xlsx";
import type { EkImportZeile } from "@/db/tables/ek-import";

/** sellerboard-Platzhalter (EK 0,01 €) – nie als echter EK übernehmen. */
export const PLATZHALTER = 0.011;
export const WARN_PROZENT = 20;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Platzhalter-EK: 0,01 € (sellerboard) bzw. bei Retouren bis 0,10 € – kein echter EK. */
export function istPlatzhalter(sku: string, cost: number | null): boolean {
  if (cost === null) return false;
  return cost <= PLATZHALTER || (/^RET/i.test(sku) && cost <= 0.1);
}

export function ekVorschau(rows: { sku: string; asin: string; costNet: number | null }[], aktuell: Map<string, { cost: number; source: string }>, bekannt: Set<string>): { zeilen: EkImportZeile[]; anzahl: Record<string, number> } {
  const zeilen: EkImportZeile[] = rows.map((r) => {
    const alt = aktuell.get(r.sku) ?? null;
    const warnungen: string[] = [];
    const platzhalter = istPlatzhalter(r.sku, r.costNet);
    if (r.costNet === null) warnungen.push("kein EK in der Datei");
    else if (platzhalter) warnungen.push(alt ? `Platzhalter ${r.costNet.toFixed(2).replace(".", ",")} € in der Datei – EK im System bleibt (${alt.source})` : "EK 0,01 € (sellerboard-Platzhalter) – wird nicht als EK übernommen");
    let art: EkImportZeile["art"];
    let abweichung: number | null = null;
    if (!alt && !bekannt.has(r.sku)) art = "unbekannt";
    else if (!alt) art = "neu";
    // Platzhalter (z. B. Retouren mit geerbtem EK) ändern nichts.
    else if (platzhalter || (r.costNet !== null && Math.abs(alt.cost - r.costNet) < 0.005)) art = "gleich";
    else {
      art = "geaendert";
      if (r.costNet !== null && alt.cost > 0) abweichung = r1(((r.costNet - alt.cost) / alt.cost) * 100);
      if (abweichung !== null && Math.abs(abweichung) > WARN_PROZENT) warnungen.push(`Abweichung ${abweichung > 0 ? "+" : ""}${String(abweichung).replace(".", ",")} % zum bisherigen EK`);
    }
    return { sku: r.sku, asin: r.asin, ekNeu: r.costNet, ekAlt: alt?.cost ?? null, quelleAlt: alt?.source ?? null, art, abweichungProzent: abweichung, warnungen };
  });
  const anzahl: Record<string, number> = { neu: 0, geaendert: 0, gleich: 0, unbekannt: 0, warnungen: 0 };
  for (const z of zeilen) {
    anzahl[z.art]++;
    if (z.warnungen.length) anzahl.warnungen++;
  }
  return { zeilen, anzahl };
}

/** sellerboard-Kostenimport: .xls (wie aus ArbitrageOne), Blatt „Worksheet“, ASIN | SKU | Cost (Zahl). Platzhalter raus. */
export function sellerboardXls(rows: { asin: string; sku: string; cost: number | null }[]): Uint8Array {
  const daten = rows.filter((r) => r.cost !== null && !istPlatzhalter(r.sku, r.cost)).map((r) => [r.asin, r.sku, Math.round(r.cost! * 100) / 100]);
  const ws = XLSX.utils.aoa_to_sheet([["ASIN", "SKU", "Cost"], ...daten]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Worksheet");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer);
}

/** Gegenprüfung: EK im System vs. sellerboard je SKU (Cent-genau); fehlend in sellerboard zählt als Abweichung. */
export function ekAbgleich(skus: string[], system: Map<string, number>, sellerboard: Map<string, number>): { sku: string; system: number | null; sellerboard: number | null }[] {
  const out: { sku: string; system: number | null; sellerboard: number | null }[] = [];
  for (const sku of skus) {
    const a = system.get(sku) ?? null;
    const b = sellerboard.get(sku) ?? null;
    if (a === null) continue;
    if (b === null || Math.abs(a - b) >= 0.01) out.push({ sku, system: a, sellerboard: b });
  }
  return out;
}
