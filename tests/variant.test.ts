import { describe, expect, it } from "vitest";
import { splitVariant } from "@/lib/shipping/variant";

describe("Variante aus dem Artikelnamen", () => {
  it("Größe und Farbe getrennt, Größe zuerst", () => {
    expect(splitVariant("Testsocken 6 X 2 X 3er Pack SX0000, Farbe:Weiß, Größe:L = 42-46")).toEqual({ base: "Testsocken 6 X 2 X 3er Pack SX0000", variant: "Größe L = 42-46 · Weiß" });
    expect(splitVariant("Testsocken 6 X 2 X 3er Pack SX0000, Farbe:Weiß, Größe:M = 38-42").variant).toBe("Größe M = 38-42 · Weiß");
  });
  it("ohne Variante unverändert", () => {
    expect(splitVariant("Testmesser 20 cm")).toEqual({ base: "Testmesser 20 cm", variant: null });
  });
  it("englische Bezeichnungen", () => {
    expect(splitVariant("Test Shirt, Size: XL, Color: Black").variant).toBe("Größe XL · Black");
  });
});
