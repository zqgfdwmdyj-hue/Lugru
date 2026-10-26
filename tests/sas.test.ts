import { describe, expect, it } from "vitest";
import { auditMail, brandFacts, brandRegex, daysUntil, dealCalc, FAHRPLAN, parseBrandList, parseDealList, suggestBrands } from "@/lib/sas/logic";

// Amazon SAS-Programm – fiktive Marken und ASINs.

describe("Markenliste", () => {
  it("Kopfzeile, Leerzeilen und Doppel (Groß/klein) fallen weg", () => {
    expect(parseBrandList(["brand_name", "Alpha", " beta  Tools ", "", "ALPHA", "Beta tools"])).toEqual(["Alpha", "beta Tools"]);
  });
  it("Marke als ganzes Wort", () => {
    const re = brandRegex("Testo");
    expect(re.test("testo Mini Ladegerät")).toBe(true);
    expect(re.test("Ladegerät (TESTO)")).toBe(true);
    expect(re.test("Testosteron Gel")).toBe(false);
  });
  it("Kennzahlen je Marke aus Produkten, 30-Tage-Werten, Rechnungen und Lieferanten", () => {
    const f = brandFacts(["Alpha", "Gamma"], {
      products: [{ name: "Alpha Kabel 1m" }, { name: "Alpha Kabel 2m" }, { name: "Gamma Box" }],
      stats: [{ name: "Alpha Kabel 1m", sales: 100, units: 5 }, { name: "Alpha Kabel 2m", sales: 50.5, units: 2 }],
      invoices: [{ text: "Rechnung Großhandel GmbH … 10x Alpha Kabel" }, { text: "nichts" }],
      offers: [{ title: "Gamma Box 3er" }],
    });
    expect(f.get("alpha")).toEqual({ products: 2, sales30: 150.5, units30: 7, invoices: 1, supplierOffers: 0 });
    expect(f.get("gamma")).toEqual({ products: 1, sales30: 0, units30: 0, invoices: 0, supplierOffers: 1 });
  });
  it("Vorschlag: erst Belege, dann Umsatz; Marken ohne beides fallen weg; höchstens n", () => {
    const b = (brand: string, invoices: number, sales30: number, supplierOffers = 0) => ({ brand, invoices, sales30, supplierOffers });
    const pick = suggestBrands([b("Viel Umsatz", 0, 9000), b("Belegt klein", 3, 100), b("Belegt groß", 1, 5000), b("Nichts", 0, 0), b("Lieferant", 0, 50, 2)], 3);
    expect(pick.map((x) => x.brand)).toEqual(["Belegt groß", "Belegt klein", "Lieferant"]);
  });
  it("Mail an den Consultant mit nummerierter Liste", () => {
    const m = auditMail(["Alpha", "Beta"], "Max Muster");
    expect(m.body).toMatch(/^Hallo Max,/);
    expect(m.body).toMatch(/1\. Alpha\n2\. Beta/);
    expect(m.subject).toMatch(/Authorized Reseller/);
  });
});

describe("Deals", () => {
  it("Liste mit Kopfzeile: ASIN, Rabatt in verschiedenen Schreibweisen", () => {
    const r = parseDealList(["ASIN", "Produkt", "Mindestrabatt", "Deal-Typ"], [
      ["B0TESTAAA1", "Kabel", "20%", "MBD"],
      ["b0testaaa2", "Box", "0,15", "MBD"],
      ["kein", "x", "10", ""],
      ["B0TESTAAA1", "doppelt", "30", ""],
    ]);
    expect(r).toEqual([
      { asin: "B0TESTAAA1", title: "Kabel", minDiscountPct: 20, dealType: "MBD" },
      { asin: "B0TESTAAA2", title: "Box", minDiscountPct: 15, dealType: "MBD" },
    ]);
  });
  it("Liste ohne Kopfzeile: ASIN-Spalte wird erkannt", () => {
    expect(parseDealList(["B0TESTAAA3", "25"], [["B0TESTAAA4", "10"]]).map((x) => x.asin)).toEqual(["B0TESTAAA3", "B0TESTAAA4"]);
  });
  it("Gewinn je Stück zum Deal-Preis", () => {
    // 30 € brutto, 20 % Rabatt → 24 €; 24/1,19 − 15 % × 24 − 4 € FBA − 10 € EK = 2,57 €
    const r = dealCalc({ price: 30, vatPct: 19, referralRate: 0.15, fbaFee: 4, ek: 10, discountPct: 20 });
    expect(r.dealPrice).toBe(24);
    expect(r.profit).toBeCloseTo(2.57, 2);
    expect(r.verdict).toBe("lohnt");
    expect(dealCalc({ price: 30, vatPct: 19, referralRate: 0.15, fbaFee: 4, ek: 18, discountPct: 20 }).verdict).toBe("verlust");
    expect(dealCalc({ price: 30, vatPct: 19, referralRate: 0.15, fbaFee: 4, ek: null, discountPct: 20 }).verdict).toBe("unklar");
  });
});

describe("Fahrplan", () => {
  it("Fälligkeiten aus Frist und Termin", () => {
    const ctx = { today: "2026-10-26", dealDeadline: "2026-11-06", nextMeeting: "2026-11-10" };
    const due = Object.fromEntries(FAHRPLAN.map((s) => [s.key, s.due(ctx)]));
    expect(due["bw-einreichen"]).toBe("2026-11-06");
    expect(due["termin-bp"]).toBe("2026-11-08");
    expect(due["ar-auswahl"]).toBe("2026-10-29");
    expect(due["ar-appeal-mail"]).toBeNull();
    expect(new Set(FAHRPLAN.map((s) => s.key)).size).toBe(FAHRPLAN.length);
    expect(daysUntil("2026-10-26", "2026-11-06")).toBe(11);
  });
});
