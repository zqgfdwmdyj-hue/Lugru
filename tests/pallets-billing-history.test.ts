import { describe, expect, it } from "vitest";
import { amountForMonth, chargeableFrom, changeRates, monthlyBill, ratesFor, type CustomerRates, type DefaultRates } from "@/lib/pallets/billing";

const std: DefaultRates = { pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 };

describe("Paletten-Abrechnung: bestehende Regeln (unverändert)", () => {
  it("5 freie Tage: Einlagerungstag = Tag 1, kostenpflichtig ab Tag 6", () => {
    expect(chargeableFrom("2026-10-01", 5)).toBe("2026-10-06");
    // bis Tag 5 ausgelagert → nichts
    expect(amountForMonth({ inAt: "2026-10-01", outAt: "2026-10-05" }, "2026-10", std).amount).toBe(0);
    // Tag 6 noch da → voller Monatspreis (je angefangenem Kalendermonat)
    expect(amountForMonth({ inAt: "2026-10-01", outAt: "2026-10-06" }, "2026-10", std)).toEqual({ days: 1, amount: 14 });
  });
  it("Monatswechsel: freie Tage reichen in den Folgemonat", () => {
    const p = { inAt: "2026-10-29", outAt: "2026-11-10" };
    expect(amountForMonth(p, "2026-10", std).amount).toBe(0);
    expect(amountForMonth(p, "2026-11", std)).toEqual({ days: 8, amount: 14 });
  });
  it("anteilig: tagesgenau", () => {
    expect(amountForMonth({ inAt: "2026-11-01", outAt: "2026-11-15" }, "2026-11", { ...std, mode: "anteilig" })).toEqual({ days: 10, amount: 4.67 });
  });
});

describe("Preisänderungen wirken nicht rückwirkend", () => {
  const history = changeRates({ pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 }, [], "2026-11");
  it("alte Fassung gilt bis zum Vormonat", () => {
    expect(history).toEqual({ history: [{ until: "2026-10", pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 }] });
    const d: DefaultRates = { ...std, pricePerMonth: 18, rateHistory: "history" in history ? history.history : [] };
    expect(ratesFor(null, d, new Map(), "2026-10").pricePerMonth).toBe(14);
    expect(ratesFor(null, d, new Map(), "2026-11").pricePerMonth).toBe(18);
    expect(ratesFor(null, d).pricePerMonth).toBe(18);
  });
  it("Kunde mit eigenen Konditionen und eigenem Verlauf", () => {
    const o = new Map<string, CustomerRates>([["müller", { name: "Müller", pricePerMonth: 12, freeDays: 10, rateHistory: [{ until: "2026-09", pricePerMonth: 10, freeDays: null, mode: null, inFee: null, outFee: null }] }]]);
    expect(ratesFor("Müller", std, o, "2026-09")).toMatchObject({ pricePerMonth: 10, freeDays: 5, own: true });
    expect(ratesFor("Müller", std, o, "2026-10")).toMatchObject({ pricePerMonth: 12, freeDays: 10, own: true });
    expect(ratesFor("Meier", std, o, "2026-10")).toMatchObject({ pricePerMonth: 14, own: false });
  });
  it("Änderung vor einer bereits gespeicherten Änderung wird abgelehnt", () => {
    const r = changeRates({ pricePerMonth: 18, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 }, [{ until: "2026-10", pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 0, outFee: 0 }], "2026-09");
    expect("error" in r).toBe(true);
  });
});

describe("Bisher angefallen vs. Hochrechnung bis Monatsende", () => {
  const pallets = [
    { code: "A", customer: "K", inAt: "2026-10-01", outAt: null },
    { code: "B", customer: "K", inAt: "2026-10-20", outAt: null },
  ];
  const rates = { ...std, mode: "anteilig" as const };
  it("Stichtag zählt nur bis heute", () => {
    const full = monthlyBill(pallets, "2026-10", rates);
    const toDate = monthlyBill(pallets, "2026-10", rates, [], { asOf: "2026-10-15" });
    // A: kostenpflichtig ab 06.10. → bis 31.10. = 26 Tage; bis 15.10. = 10 Tage. B: ab 25.10. → 7 Tage; bis 15.10. noch nicht eingelagert
    expect(full.total).toBe(Math.round((14 / 31) * 26 * 100) / 100 + Math.round((14 / 31) * 7 * 100) / 100);
    expect(toDate.total).toBe(Math.round((14 / 31) * 10 * 100) / 100);
    expect(toDate.count).toBe(1);
  });
});
