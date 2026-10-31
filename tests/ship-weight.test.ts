import { describe, expect, it } from "vitest";
import { parseWeightInput, shipWeight } from "@/lib/shipping/weight";

// Versandgewicht: einmal je Artikel eintragen, Stückzahl rechnet hoch. Erfundene Artikel.

const opts = { defaultGrams: 300, packagingGrams: 150 };

describe("Versandgewicht", () => {
  it("eingetragen 0,3 kg je Stück: 2 Stück = 0,6 kg, ohne Verpackungszuschlag", () => {
    expect(shipWeight([{ quantity: 2, shipGrams: 300, productGrams: null }], opts)).toEqual({ kg: 0.6, source: "hinterlegt", note: "2 × 0,3 kg = 0,6 kg" });
    expect(shipWeight([{ quantity: 3, shipGrams: 300, productGrams: null }], opts).kg).toBe(0.9);
  });
  it("Artikelgewicht aus den Produktdaten: + Verpackung", () => {
    expect(shipWeight([{ quantity: 2, shipGrams: null, productGrams: 200 }], opts)).toEqual({ kg: 0.55, source: "artikeldaten", note: "2 × 0,2 kg + 0,15 kg Verpackung = 0,55 kg" });
  });
  it("ohne Angaben: Schätzwert, gekennzeichnet", () => {
    const w = shipWeight([{ quantity: 1, shipGrams: null, productGrams: null }], opts);
    expect(w.kg).toBe(0.45);
    expect(w.source).toBe("geschaetzt");
    expect(w.note).toContain("(geschätzt)");
  });
  it("gemischte Sendung: Verpackung nur einmal", () => {
    const w = shipWeight([{ quantity: 2, shipGrams: 300, productGrams: null }, { quantity: 1, shipGrams: null, productGrams: 100 }], opts);
    expect(w.kg).toBe(0.85);
    expect(w.source).toBe("artikeldaten");
  });
  it("Eingabe: kg mit Komma oder Punkt, Gramm, ungültig", () => {
    expect(parseWeightInput("0,3")).toBe(300);
    expect(parseWeightInput("0.25 kg")).toBe(250);
    expect(parseWeightInput("450 g")).toBe(450);
    expect(parseWeightInput("")).toBeNull();
    expect(parseWeightInput("schwer")).toBeNull();
    expect(parseWeightInput("40")).toBeNull();
  });
});
