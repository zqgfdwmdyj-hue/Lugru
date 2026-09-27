import { describe, expect, it } from "vitest";
import { pickOriginLot } from "@/lib/costs/returns";
import { buildAccountOneCsv } from "@/lib/exports/accountone";
import { parseAmount, parseDate } from "@/lib/numbers";

describe("pickOriginLot", () => {
  const lots = [
    { id: "jan", purchaseDate: "2026-01-10", unitCostNet: 10 },
    { id: "mai", purchaseDate: "2026-05-02", unitCostNet: 12 },
    { id: "aug", purchaseDate: "2026-08-20", unitCostNet: 11 },
  ];

  it("nimmt die letzte Charge vor der Retoure", () => {
    expect(pickOriginLot("2026-06-01", lots)).toEqual({ lotId: "mai", unitCostNet: 12, basis: "dated" });
  });

  it("nimmt die früheste, wenn alle Chargen nach der Retoure liegen", () => {
    expect(pickOriginLot("2025-12-01", lots)?.basis).toBe("fallback");
    expect(pickOriginLot("2025-12-01", lots)?.lotId).toBe("jan");
  });

  it("ignoriert Platzhalter-EK bis 0,10 €", () => {
    expect(
      pickOriginLot("2026-06-01", [
        { id: "ret", purchaseDate: "2026-05-30", unitCostNet: 0.08 },
        { id: "echt", purchaseDate: "2026-01-01", unitCostNet: 8 },
      ]),
    ).toEqual({ lotId: "echt", unitCostNet: 8, basis: "single" });
  });

  it("gibt null zurück, wenn es keine Ursprungs-Charge gibt", () => {
    expect(pickOriginLot("2026-06-01", [])).toBeNull();
  });
});

describe("buildAccountOneCsv", () => {
  const rows = [
    { asin: "B0TEST0004", sku: "KAUFL_84.03_127.08_27SEP_B0TEST0004", unitCostNet: 84.03 },
    { asin: "B0TEST0006", sku: "AMZDE_12.6_34.17_28SEP_B0TEST0006", unitCostNet: 12.6 },
  ];

  it("entspricht dem Arbitrage-One-Format", () => {
    expect(buildAccountOneCsv(rows)).toBe(
      '"marketplace_article_nr","article_nr","ek_netto_euro"\r\n' +
        '"B0TEST0004","KAUFL_84.03_127.08_27SEP_B0TEST0004","84.03"\r\n' +
        '"B0TEST0006","AMZDE_12.6_34.17_28SEP_B0TEST0006","12.6"\r\n',
    );
  });

  it("hängt die Konto-ID an, wenn angegeben", () => {
    const csv = buildAccountOneCsv(rows.slice(0, 1), "A1-123");
    expect(csv.split("\r\n")[0]).toBe(
      '"marketplace_article_nr","article_nr","ek_netto_euro","source_account_id"',
    );
    expect(csv.split("\r\n")[1]).toMatch(/,"A1-123"$/);
  });
});

describe("Zahlen und Datum", () => {
  it.each([
    [84.03, 84.03],
    ["84.03", 84.03],
    ["84,03", 84.03],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["12,60 €", 12.6],
    ["", null],
    ["abc", null],
  ])("parseAmount(%j) = %j", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("parseDate", () => {
    expect(parseDate("27.09.2026")).toBe("2026-09-27");
    expect(parseDate("2026-09-27")).toBe("2026-09-27");
    expect(parseDate("7.9.26")).toBe("2026-09-07");
    expect(parseDate(46292)).toBe("2026-09-27");
  });
});

describe("Datumsformate aus Reports", () => {
  it("versteht die gängigen Formate", async () => {
    const { parseDate, parseDateTime } = await import("@/lib/numbers");
    expect(parseDate("09/27/2026")).toBe("2026-09-27");
    expect(parseDate("27/09/2026")).toBe("2026-09-27");
    expect(parseDate("27.09.2026 10:11:12 UTC")).toBe("2026-09-27");
    expect(parseDate("2026-09-27T10:11:12+00:00")).toBe("2026-09-27");
    expect(parseDateTime("27.09.2026 10:11:12 UTC")?.toISOString()).toBe("2026-09-27T10:11:12.000Z");
    expect(parseDateTime("2026-09-27T10:11:12+02:00")?.toISOString()).toBe("2026-09-27T08:11:12.000Z");
  });
});
