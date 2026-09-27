import { describe, expect, it } from "vitest";
import { ImportFormatError, parseArbitrageOne, readSheet } from "@/lib/imports/arbitrageone";

const csv = (s: string) => readSheet(new TextEncoder().encode(s));

describe("parseArbitrageOne", () => {
  it("erkennt den AccountOne-COG-Export", () => {
    const r = parseArbitrageOne(
      csv(
        '"marketplace_article_nr","article_nr","ek_netto_euro"\r\n' +
          '"B0TEST0004","KAUFL_84.03_127.08_27SEP_B0TEST0004","84.03"\r\n',
      ),
    );
    expect(r.source).toBe("accountone");
    expect(r.rows).toEqual([
      { line: 2, asin: "B0TEST0004", sku: "KAUFL_84.03_127.08_27SEP_B0TEST0004", costNet: 84.03 },
    ]);
  });

  it("erkennt den Sellerboard-Export", () => {
    const r = parseArbitrageOne(csv("ASIN,SKU,Cost\nB0TEST0002,RET_1_LPNHE100000001_16JUL25_FBA,0.01\n"));
    expect(r.source).toBe("sellerboard");
    expect(r.rows[0]).toMatchObject({ asin: "B0TEST0002", costNet: 0.01 });
  });

  it("liest die eigene Vorlage mit deutschen Zahlen", () => {
    const r = parseArbitrageOne(
      csv(
        "ASIN;Seller SKU;FNSKU;Produktname;Kaufdatum;Menge (eingekauft);EK netto (mit VSK);Währung;EK netto (Standard)\n" +
          "B0TEST0004;KAUFL_84.03_127.08_27SEP_B0TEST0004;X001ABC123;Testartikel;27.09.2026;3;86,50;EUR;84,03\n",
      ),
    );
    expect(r.source).toBe("template");
    expect(r.rows[0]).toMatchObject({
      fnsku: "X001ABC123",
      title: "Testartikel",
      purchaseDate: "2026-09-27",
      quantity: 3,
      costNet: 86.5,
      currency: "EUR",
    });
  });

  it("meldet Zeilen ohne SKU", () => {
    const r = parseArbitrageOne(csv("ASIN,SKU,Cost\nB0TEST0002,,1\n"));
    expect(r.rows).toHaveLength(0);
    expect(r.skipped).toEqual([{ line: 2, reason: "SKU fehlt" }]);
  });

  it("lehnt unbekannte Formate ab", () => {
    expect(() => parseArbitrageOne(csv("foo,bar\n1,2\n"))).toThrow(ImportFormatError);
  });
});
