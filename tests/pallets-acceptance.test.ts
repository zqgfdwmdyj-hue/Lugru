import { describe, expect, it } from "vitest";
import { changeRates, monthlyBill, ratesFor, type DefaultRates } from "@/lib/pallets/billing";

// Abnahme Paletten (Prüfrunde 2) nach der angezeigten Regel: Kalendermonat, Einlagerungstag = Tag 1,
// Auslagerungstag zählt mit, kostenpflichtig ab dem Tag nach 5 freien Tagen, 14 € netto je angefangenem Monat.
// Fiktive Kunden.

const std: DefaultRates = { pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 };
const bill = (inAt: string, outAt: string, months: string[], rates = (c: string | null, m?: string) => ratesFor(c, std, new Map(), m)) =>
  months.reduce((sum, m) => sum + monthlyBill([{ code: "P", customer: "Test", inAt, outAt }], m, (c) => rates(c, m)).total, 0);

describe("Abnahmefälle", () => {
  it("Ein 01.10., Aus 05.10. (5 freie Tage) → keine Lagergebühr", () => {
    expect(bill("2026-10-01", "2026-10-05", ["2026-10"])).toBe(0);
  });
  it("Ein 01.10., Aus 06.10. → 14 € netto", () => {
    expect(bill("2026-10-01", "2026-10-06", ["2026-10"])).toBe(14);
  });
  it("Ein 26.10., Aus 01.11. → 28 € netto (kostenpflichtige Tage in zwei Monaten)", () => {
    expect(bill("2026-10-26", "2026-11-01", ["2026-10"])).toBe(14);
    expect(bill("2026-10-26", "2026-11-01", ["2026-11"])).toBe(14);
    expect(bill("2026-10-26", "2026-11-01", ["2026-10", "2026-11"])).toBe(28);
  });
  it("Nachträgliche Preisänderung ab November: Oktober behält 14 €", () => {
    const h = changeRates({ pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 }, [], "2026-11");
    const d: DefaultRates = { ...std, pricePerMonth: 20, rateHistory: "history" in h ? h.history : [] };
    const rates = (c: string | null, m?: string) => ratesFor(c, d, new Map(), m);
    expect(bill("2026-10-26", "2026-11-01", ["2026-10"], rates)).toBe(14);
    expect(bill("2026-10-26", "2026-11-01", ["2026-11"], rates)).toBe(20);
  });
});
