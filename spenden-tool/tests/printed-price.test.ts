import { describe, expect, it } from "vitest";
import { differsFromPhoto, hasSeveralPrices, normalizeBox, parsePrintedPrice, parsePrintedReading, printedPlan } from "@/lib/printed-price";

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

  it("entscheidet, was die Collage druckt", () => {
    const box = { x: 0.2, y: 0.75, w: 0.6, h: 0.2 };
    expect(printedPlan(null)).toBe("normal");
    expect(printedPlan({ price: 0.6, text: "60 Cent", box })).toBe("keep");
    expect(printedPlan({ price: 0.6, text: "60 Cent", box: null })).toBe("keep");
  });
});

describe("Preis im Foto – nie etwas übers Foto zeichnen", () => {
  it("erkennt Staffelpreise und überdeckt sie nie", () => {
    expect(hasSeveralPrices("2kg - 5€ 5kg - 10€ 10kg - 18€")).toBe(true);
    expect(hasSeveralPrices("3 Stück 40 Cent")).toBe(false);
    expect(printedPlan({ price: 5, text: "2kg - 5€ 5kg - 10€ 10kg - 18€", box: { x: 0.1, y: 0.6, w: 0.8, h: 0.25 } })).toBe("keep");
    expect(differsFromPhoto({ price: 5, text: "2kg - 5€ 5kg - 10€", box: null }, 0.5)).toBe(false);
  });

  it("lässt das Foto unverändert und meldet nur Abweichungen", () => {
    expect(normalizeBox([5, 20, 95, 98])).toBeNull();
    expect(printedPlan({ price: 0.6, text: "60 Cent", box: { x: 0, y: 0.2, w: 1, h: 0.8 } })).toBe("keep");
    expect(printedPlan({ price: 0.6, text: "60 Cent", box: { x: 0.1, y: 0.05, w: 0.8, h: 0.15 } })).toBe("keep");
    expect(differsFromPhoto({ price: 0.6, text: "60 Cent", box: null }, 0.5)).toBe(true);
    expect(differsFromPhoto({ price: 0.6, text: "60 Cent", box: null }, 0.6)).toBe(false);
  });
});
