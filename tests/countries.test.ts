import { describe, expect, it } from "vitest";
import { countryKey, countrySpellings } from "@/lib/leads/logic";

// Länder einheitlich: verschiedene Schreibweisen zählen als ein Land (Filter, Sortierung).

describe("Länder", () => {
  it("USA in allen Schreibweisen", () => {
    for (const v of ["USA", "US", "U.S.A.", "United States", "United States of America", "Vereinigte Staaten von Amerika", "vereinigte staaten von amerika ", "USA (Vereinigte Staaten)", "Amerika"]) {
      expect(countryKey(v)).toBe("USA");
    }
  });
  it("weitere Länder und Rest unverändert", () => {
    expect(countryKey("Republic of Korea")).toBe("Südkorea");
    expect(countryKey("Kanada")).toBe("Kanada");
    expect(countryKey("Deutschland.")).toBe("Deutschland");
    expect(countryKey("Atlantis")).toBe("Atlantis");
  });
  it("Datenbankfilter kennt die neue Schreibweise", () => {
    expect(countrySpellings("USA")).toContain("vereinigte staaten von amerika");
  });
});
