import { describe, expect, it } from "vitest";
import { hasSeveralPrices, normalizeBox, parsePrintedPrice, parsePrintedReading } from "@/lib/printed-price";
import { priceState } from "@/lib/price-logic";

const F = "f";
const read = (text: string, price: number, box: { x: number; y: number; w: number; h: number } | null) => ({ status: "done", text, price, box });

describe("Preis im Foto", () => {
  it("liest übliche Schreibweisen", () => {
    expect(parsePrintedPrice("60 Cent")).toBe(0.6);
    expect(parsePrintedPrice("Je 50 ct")).toBe(0.5);
    expect(parsePrintedPrice("2,50 €")).toBe(2.5);
    expect(parsePrintedPrice("1€")).toBe(1);
    expect(parsePrintedPrice("€ 1,99")).toBe(1.99);
    expect(parsePrintedPrice("3 Euro")).toBe(3);
    expect(parsePrintedPrice("Gratis")).toBeNull();
    expect(parsePrintedPrice(null)).toBeNull();
  });

  it("wertet die KI-Antwort aus und erweitert den Rahmen", () => {
    const r = parsePrintedReading('Ergebnis: {"preis_text": "Je 60 Cent", "preis": 60, "rahmen": [30, 80, 70, 92]}');
    expect(r.found).toBe(true);
    expect(r.price).toBe(0.6); // Text schlägt die falsche Zahl
    expect(r.box!.x).toBeLessThan(0.3);
    expect(r.box!.y + r.box!.h).toBeGreaterThan(0.92);
    expect(r.box!.y + r.box!.h).toBeLessThanOrEqual(1);
    expect(parsePrintedReading('{"preis_text": null}').found).toBe(false);
    expect(parsePrintedReading("kein JSON").found).toBe(false);
  });

  it("verwirft unsinnige Rahmen", () => {
    expect(normalizeBox([0, 0, 100, 100])).toBeNull();
    expect(normalizeBox([10, 10])).toBeNull();
    expect(normalizeBox(["a", 1, 2, 3])).toBeNull();
    expect(normalizeBox([0.3, 0.8, 0.7, 0.9])).not.toBeNull();
  });

  it("entscheidet, was die Collage druckt (gemeinsame Preislogik)", () => {
    const box = { x: 0.2, y: 0.75, w: 0.6, h: 0.2 };
    expect(priceState({ price: 0.6 }, F, null).plan).toBe("drucken");
    expect(priceState({ price: 0.6 }, F, read("60 Cent", 0.6, box)).plan).toBe("foto");
    expect(priceState({ price: 0.6 }, F, read("60 Cent", 0.6, null)).plan).toBe("foto");
  });
});

describe("Preis im Foto – Foto nie großflächig überdecken", () => {
  it("erkennt Staffelpreise und überdeckt sie nie", () => {
    expect(hasSeveralPrices("2kg - 5€ 5kg - 10€ 10kg - 18€")).toBe(true);
    expect(hasSeveralPrices("3 Stück 40 Cent")).toBe(false);
    expect(priceState({ price: 5 }, F, read("2kg - 5€ 5kg - 10€", 5, null))).toMatchObject({ plan: "foto", conflict: false });
  });

  it("Aufkleber nur mit glaubwürdiger, kleiner Lage – sonst normal drucken", () => {
    expect(normalizeBox([5, 20, 95, 98])).toBeNull();
    expect(priceState({ price: 0.5 }, F, read("60 Cent", 0.6, { x: 0, y: 0.2, w: 1, h: 0.8 })).plan).toBe("drucken");
    expect(priceState({ price: 0.5 }, F, read("60 Cent", 0.6, { x: 0.1, y: 0.05, w: 0.8, h: 0.15 })).plan).toBe("aufkleber");
    expect(priceState({ price: 0.5 }, F, read("60 Cent", 0.6, null)).conflict).toBe(true);
    expect(priceState({ price: 0.6 }, F, read("60 Cent", 0.6, null)).conflict).toBe(false);
  });
});
