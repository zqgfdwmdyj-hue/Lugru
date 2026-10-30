import { describe, expect, it } from "vitest";
import { ustvaTermine } from "@/lib/fristen-geschaeft-logic";

describe("USt-Voranmeldung (nur Datum, Rhythmus aus den Einstellungen)", () => {
  it("monatlich: 10. des Folgemonats; mit Dauerfristverlängerung einen Monat später", () => {
    expect(ustvaTermine("2026-10-30", "2027-01-31", "monatlich", false)).toEqual([
      { datum: "2026-11-10", zeitraum: "10/2026" },
      { datum: "2026-12-10", zeitraum: "11/2026" },
      { datum: "2027-01-10", zeitraum: "12/2026" },
    ]);
    expect(ustvaTermine("2026-10-30", "2026-12-31", "monatlich", true).map((x) => x.datum)).toEqual(["2026-11-10", "2026-12-10"]);
    expect(ustvaTermine("2026-10-30", "2026-12-31", "monatlich", true)[0].zeitraum).toBe("09/2026");
  });
  it("Quartal: nach Quartalsende", () => {
    expect(ustvaTermine("2026-10-30", "2027-04-30", "quartal", false)).toEqual([{ datum: "2027-01-10", zeitraum: "Q4/2026" }, { datum: "2027-04-10", zeitraum: "Q1/2027" }]);
  });
});
