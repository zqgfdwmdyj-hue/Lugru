import { describe, expect, it } from "vitest";
import { buildSku, netFromGross, statusAfterReceipt, suggest, supplierCode } from "@/lib/purchasing/calc";
import { parseSku } from "@/lib/sku/parse";

describe("Einkauf", () => {
  it("baut SKUs nach Schema C, die der SKU-Leser wieder versteht", () => {
    const sku = buildSku("amz-fr", "2026-09-04", "b0test0008", 305.99, 470);
    expect(sku).toBe("AMZFR_04SEP26_B0TEST0008_305.99_470.00");
    expect(parseSku(sku, { reference: new Date("2026-09-28") })).toMatchObject({ schema: "C", supplierCode: "AMZFR", asin: "B0TEST0008", date: "2026-09-04", costGross: 305.99, targetPrice: 470, dateEstimated: false });
    expect(supplierCode("Kaufland.de")).toBe("KAUFLANDDE");
  });

  it("rechnet Netto aus Brutto", () => {
    expect(netFromGross(119, 19)).toBe(100);
    expect(netFromGross(10.7, 7)).toBe(10);
  });

  it("schlägt Mengen aus Absatz, Bestand und offenen Bestellungen vor", () => {
    // 30 Tage: 30 Stück, 90 Tage: 60 Stück → 0,6·1 + 0,4·0,667 = 0,87 pro Tag
    const s = suggest({ sold30: 30, sold90: 60, stock: 10, onOrder: 5, leadDays: 14, coverDays: 30 });
    expect(s.daily).toBeCloseTo(0.87, 2);
    expect(s.need).toBe(24); // ceil(0,8667·44) = 39 − 15
    expect(s.daysLeft).toBe(17);
    expect(suggest({ sold30: 0, sold90: 0, stock: 3, onOrder: 0, leadDays: 14, coverDays: 30 })).toEqual({ daily: 0, daysLeft: null, need: 0 });
    expect(suggest({ sold30: 3, sold90: 9, stock: 100, onOrder: 0, leadDays: 14, coverDays: 30 }).need).toBe(0);
  });

  it("setzt den Status nach dem Wareneingang", () => {
    expect(statusAfterReceipt([{ quantity: 5, received: 5 }, { quantity: 2, received: 2 }], "shipped")).toBe("received");
    expect(statusAfterReceipt([{ quantity: 5, received: 3 }, { quantity: 2, received: 0 }], "shipped")).toBe("partial");
    expect(statusAfterReceipt([{ quantity: 5, received: 0 }], "ordered")).toBe("ordered");
  });
});
