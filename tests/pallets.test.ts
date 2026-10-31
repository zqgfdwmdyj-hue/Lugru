import { describe, expect, it } from "vitest";
import { amountForMonth, chargeableDaysInMonth, chargeableFrom, monthlyBill, nextPalletCodes, storedDays } from "@/lib/pallets/billing";

const rates = { pricePerMonth: 14, freeDays: 5, mode: "monat" as const };

describe("Paletten-Abrechnung", () => {
  it("die ersten 5 Tage sind frei, ab Tag 6 kostet es", () => {
    expect(chargeableFrom("2026-10-01", 5)).toBe("2026-10-06");
    expect(storedDays({ inAt: "2026-10-01", outAt: "2026-10-05" }, "2026-10-22")).toBe(5);
    expect(amountForMonth({ inAt: "2026-10-01", outAt: "2026-10-05" }, "2026-10", rates).amount).toBe(0);
    expect(amountForMonth({ inAt: "2026-10-01", outAt: "2026-10-06" }, "2026-10", rates)).toEqual({ days: 1, amount: 14 });
  });

  it("Monatswechsel: Freitage ragen in den nächsten Monat", () => {
    const p = { inAt: "2026-10-29", outAt: null };
    expect(chargeableDaysInMonth(p, "2026-10", 5)).toBe(0);
    expect(chargeableDaysInMonth(p, "2026-11", 5)).toBe(28); // 3.11. bis 30.11.
    expect(amountForMonth(p, "2026-11", rates).amount).toBe(14);
  });

  it("anteilig nach Tagen", () => {
    const r = { ...rates, mode: "anteilig" as const };
    expect(amountForMonth({ inAt: "2026-09-01", outAt: null }, "2026-11", r).amount).toBe(14);
    expect(amountForMonth({ inAt: "2026-11-01", outAt: "2026-11-20" }, "2026-11", r)).toEqual({ days: 15, amount: 7 });
  });

  it("ausgelagert vor dem Monat kostet nichts", () => {
    expect(amountForMonth({ inAt: "2026-08-01", outAt: "2026-09-30" }, "2026-10", rates).amount).toBe(0);
  });

  it("Monatsrechnung je Kunde", () => {
    const bill = monthlyBill(
      [
        { inAt: "2026-10-01", outAt: null, customer: "Müller" },
        { inAt: "2026-10-02", outAt: null, customer: "Müller" },
        { inAt: "2026-10-28", outAt: null, customer: "Abc" },
        { inAt: "2026-09-01", outAt: null, customer: null },
      ],
      "2026-10",
      rates,
    );
    expect(bill.count).toBe(3);
    expect(bill.total).toBe(42);
    expect(bill.groups.map((g) => [g.customer, g.total])).toEqual([["Müller", 28], ["Ohne Kunde", 14]]);
  });

  it("vergibt fortlaufende Nummern", () => {
    expect(nextPalletCodes(["P-0007", "ABC", "p-0010"], 2)).toEqual(["P-0011", "P-0012"]);
    expect(nextPalletCodes([], 1)).toEqual(["P-0001"]);
  });
});
