import { describe, expect, it } from "vitest";
import { buildWeeks, projectPayouts, weekStart } from "@/lib/money/cashflow";

describe("Cash Flow", () => {
  it("Wochenbeginn ist Montag", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
  });

  it("schätzt Auszahlungen aus dem Rhythmus", () => {
    const p = projectPayouts(
      [
        { date: "2026-08-20", amount: 1000 },
        { date: "2026-09-03", amount: 2000 },
        { date: "2026-09-17", amount: 3000 },
      ],
      "2026-09-27",
      "2026-10-31",
    );
    expect(p).toEqual([
      { date: "2026-10-01", amount: 2000 },
      { date: "2026-10-15", amount: 2000 },
      { date: "2026-10-29", amount: 2000 },
    ]);
  });

  it("verteilt einmalige und monatliche Posten", () => {
    const w = buildWeeks({
      today: "2026-09-28",
      weeks: 5,
      items: [
        { date: "2026-09-30", amount: -500, description: "Einkauf", category: "einkauf", recurrence: "none", endDate: null },
        { date: "2026-10-01", amount: -50, description: "Software", category: "fix", recurrence: "monthly", endDate: null },
      ],
      payouts: [{ date: "2026-10-01", amount: 2000 }],
    });
    expect(w[0]).toMatchObject({ start: "2026-09-28", inflow: 2000, outflow: 550 });
    expect(w.reduce((n, x) => n + x.outflow, 0)).toBe(600); // Software auch am 01.11.
  });
});
