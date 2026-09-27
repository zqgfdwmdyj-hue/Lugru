import { describe, expect, it } from "vitest";
import { estimateDateWithoutYear, parseDateWithYear, parseSku } from "@/lib/sku/parse";

const reference = new Date("2026-09-27T12:00:00Z");
const p = (sku: string) => parseSku(sku, { reference });

describe("parseSku", () => {
  it("Schema A: SHOP_EK_VK_TTMON_ASIN", () => {
    const r = p("KAUFL_84.03_127.08_27SEP_B0TEST0004");
    expect(r).toMatchObject({
      schema: "A",
      supplierCode: "KAUFL",
      asin: "B0TEST0004",
      costNet: 84.03,
      targetPrice: 127.08,
      date: "2026-09-27",
      dateEstimated: true,
    });
  });

  it("Schema A: Datum nach dem Stichtag fällt ins Vorjahr", () => {
    expect(p("AMZIT_52.94_73.29_01OCT_B082DJ19CK").date).toBe("2025-10-01");
  });

  it("Schema B: SHOP_VK_TTMON_ASIN_EKBRUTTO rechnet Brutto in Netto um", () => {
    const r = p("FLACO_57.36_16SEP_B0TEST0003_42.93");
    expect(r).toMatchObject({
      schema: "B",
      supplierCode: "FLACO",
      asin: "B0TEST0003",
      targetPrice: 57.36,
      costGross: 42.93,
      costNet: 36.0756,
      date: "2026-09-16",
    });
  });

  it("Schema C: SHOP_TTMONJJ_ASIN_EKBRUTTO_VK mit echtem Jahr", () => {
    const r = p("AMZFR_24SEP26_B0TEST0008_305.99_470.00");
    expect(r).toMatchObject({
      schema: "C",
      supplierCode: "AMZFR",
      asin: "B0TEST0008",
      costGross: 305.99,
      targetPrice: 470,
      date: "2026-09-24",
      dateEstimated: false,
    });
    expect(r.costNet).toBeCloseTo(257.13, 2);
  });

  it("ISBN als ASIN", () => {
    expect(p("MEDIA_9.99_19.99_03MAR_3161484100").asin).toBe("3161484100");
  });

  it("Retoure: RET_CODE_LPN_TTMONJJ_KANAL", () => {
    const r = p("RET_3_LPNHK100000002_16JUL25_FBA");
    expect(r).toMatchObject({
      schema: "RET",
      date: "2025-07-16",
      ret: { code: "3", lpn: "LPNHK100000002", channel: "FBA" },
    });
  });

  it("Retoure mit Kleinbuchstaben in der LPN", () => {
    expect(p("RET_3_LPNHe100000003_03JUN26_FBA").ret?.lpn).toBe("LPNHe100000003");
  });

  it("Unbekanntes Schema behält das Shop-Kürzel", () => {
    expect(p("SIEHE_irgendwas")).toMatchObject({ schema: "UNKNOWN", supplierCode: "SIEHE" });
    expect(p("B0TEST0005")).toMatchObject({ schema: "UNKNOWN", supplierCode: null });
  });
});

describe("Datumsangaben", () => {
  it("prüft ungültige Tage", () => {
    expect(parseDateWithYear("31FEB26")).toBeNull();
    expect(parseDateWithYear("29FEB24")).toBe("2024-02-29");
  });

  it("findet für 29FEB das letzte Schaltjahr", () => {
    expect(estimateDateWithoutYear("29FEB", reference)).toBe("2024-02-29");
  });

  it("versteht deutsche Monatskürzel", () => {
    expect(estimateDateWithoutYear("03OKT", reference)).toBe("2025-10-03");
  });
});

describe("ältere Retouren-SKUs", () => {
  it("RET im Schema B mit Platzhalter-EK", () => {
    expect(p("RET_3.72_21NOV_B0TEST0007_0.10")).toMatchObject({
      schema: "RET",
      asin: "B0TEST0007",
      date: "2025-11-21",
      dateEstimated: true,
      costGross: 0.1,
    });
  });

  it("RET im Schema A", () => {
    expect(p("RET_0.84_4.28_03SEP_B0TEST0009")).toMatchObject({ schema: "RET", asin: "B0TEST0009", costNet: 0.84 });
  });
});
