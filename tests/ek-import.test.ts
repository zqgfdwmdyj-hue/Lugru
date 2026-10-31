import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ekAbgleich, ekVorschau, sellerboardXls } from "@/lib/ek-import/logic";
import { parseArbitrageOne, readSheet } from "@/lib/imports/arbitrageone";

// EK-Import (B7 Teil 2) – erfundene SKUs und Preise.

describe("Vorschau", () => {
  const aktuell = new Map([
    ["TEST-A", { cost: 10, source: "charge" }],
    ["TEST-B", { cost: 10, source: "sellerboard" }],
    ["TEST-C", { cost: 4, source: "manuell" }],
  ]);
  const bekannt = new Set(["TEST-A", "TEST-B", "TEST-C", "TEST-D"]);
  const v = ekVorschau(
    [
      { sku: "TEST-A", asin: "B0TEST0001", costNet: 10 },
      { sku: "TEST-B", asin: "B0TEST0002", costNet: 12.5 },
      { sku: "TEST-C", asin: "B0TEST0003", costNet: 4.4 },
      { sku: "TEST-D", asin: "B0TEST0004", costNet: 7 },
      { sku: "TEST-X", asin: "B0TEST0005", costNet: 0.01 },
    ],
    aktuell,
    bekannt,
  );
  it("neu / geändert (mit %) / unverändert / unbekannte SKU", () => {
    expect(v.zeilen.map((z) => z.art)).toEqual(["gleich", "geaendert", "geaendert", "neu", "unbekannt"]);
    expect(v.zeilen[1]).toMatchObject({ ekAlt: 10, ekNeu: 12.5, abweichungProzent: 25, quelleAlt: "sellerboard" });
    expect(v.zeilen[2].abweichungProzent).toBe(10);
    expect(v.anzahl).toEqual({ neu: 1, geaendert: 2, gleich: 1, unbekannt: 1, warnungen: 2 });
  });
  it("Warnung bei > 20 % und bei 0,01 € (Platzhalter)", () => {
    expect(v.zeilen[1].warnungen[0]).toMatch(/Abweichung \+25 %/);
    expect(v.zeilen[2].warnungen).toEqual([]);
    expect(v.zeilen[4].warnungen[0]).toMatch(/Platzhalter/);
  });
  it("Retoure mit Platzhalter 0,10 € und geerbtem EK im System → unverändert, Hinweis", () => {
    const r = ekVorschau([{ sku: "RET_TEST_1", asin: "B0TEST0001", costNet: 0.1 }], new Map([["RET_TEST_1", { cost: 8.5, source: "charge" }]]), new Set(["RET_TEST_1"]));
    expect(r.zeilen[0]).toMatchObject({ art: "gleich", ekAlt: 8.5 });
    expect(r.zeilen[0].warnungen[0]).toMatch(/EK im System bleibt/);
  });
});

describe("sellerboard-Importdatei", () => {
  it(".xls wie aus ArbitrageOne: Blatt „Worksheet“, ASIN | SKU | Cost als Zahl; Platzhalter fehlen; wieder lesbar", () => {
    const bytes = sellerboardXls([
      { asin: "B0TEST0001", sku: "TEST-A", cost: 10 },
      { asin: "B0TEST0002", sku: "TEST-B", cost: 12.499 },
      { asin: "B0TEST0005", sku: "TEST-X", cost: 0.01 },
    ]);
    expect([...bytes.subarray(0, 4)].map((b) => b.toString(16))).toEqual(["d0", "cf", "11", "e0"]);
    const wb = XLSX.read(bytes, { type: "array" });
    expect(wb.SheetNames).toEqual(["Worksheet"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Worksheet, { header: 1, raw: true });
    expect(rows).toEqual([["ASIN", "SKU", "Cost"], ["B0TEST0001", "TEST-A", 10], ["B0TEST0002", "TEST-B", 12.5]]);
    const p = parseArbitrageOne(readSheet(bytes));
    expect(p.source).toBe("sellerboard");
    expect(p.rows.map((r) => [r.sku, r.costNet])).toEqual([["TEST-A", 10], ["TEST-B", 12.5]]);
  });
});

describe("Gegenprüfung", () => {
  it("abweichend oder in sellerboard fehlend; ohne System-EK nicht geprüft", () => {
    const r = ekAbgleich(["TEST-A", "TEST-B", "TEST-C", "TEST-D"], new Map([["TEST-A", 10], ["TEST-B", 12.5], ["TEST-C", 4]]), new Map([["TEST-A", 10], ["TEST-B", 10]]));
    expect(r).toEqual([{ sku: "TEST-B", system: 12.5, sellerboard: 10 }, { sku: "TEST-C", system: 4, sellerboard: null }]);
  });
});
