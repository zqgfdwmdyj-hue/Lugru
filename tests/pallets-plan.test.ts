import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { freeLocations, inventoryCompare, locationRows, parseLocations } from "@/lib/pallets/billing";
import { buildPickupPdf } from "@/lib/pallets/pickup-pdf";

// Paletten: Lagerplan, Inventur, Abholschein. Fiktive Daten.

describe("Lagerplan", () => {
  it("Bereiche und einzelne Namen", () => {
    expect(parseLocations("A-01..A-03\nb1..b2, Tor 1;A-02")).toEqual(["A-01", "A-02", "A-03", "B1", "B2", "TOR 1"]);
    expect(parseLocations("C-8 bis C-10")).toEqual(["C-8", "C-9", "C-10"]);
    expect(parseLocations("")).toEqual([]);
  });
  it("Reihen und freie Plätze", () => {
    const plan = parseLocations("A-01..A-03\nB-01..B-02");
    expect(locationRows(plan)).toEqual([{ row: "A", places: ["A-01", "A-02", "A-03"] }, { row: "B", places: ["B-01", "B-02"] }]);
    expect(freeLocations(plan, ["A-02", null, "B-01", "X-9"])).toEqual(["A-01", "A-03", "B-02"]);
  });
});

describe("Inventur", () => {
  it("gefunden, fehlt, unbekannt – Groß/Klein egal, doppelt gescannt zählt einmal", () => {
    const r = inventoryCompare(["p-0001", "P-0001", "P-0003", "X-9"], [{ code: "P-0001" }, { code: "P-0002" }, { code: "P-0003" }]);
    expect(r.found.map((p) => p.code)).toEqual(["P-0001", "P-0003"]);
    expect(r.missing.map((p) => p.code)).toEqual(["P-0002"]);
    expect(r.unknown).toEqual(["X-9"]);
    expect(r.scanned).toBe(3);
  });
});

describe("Abholschein", () => {
  it("PDF mit Paletten und ohne Unterschriftsbild", async () => {
    const pdf = await buildPickupPdf({
      sender: { name: "Lager Muster" },
      number: "A-20261024-ABCD",
      day: "2026-10-24",
      customer: "Fremd AG",
      pickedBy: "Max Fahrer",
      plate: "S-XY 123",
      pallets: Array.from({ length: 50 }, (_, i) => ({ code: `P-${i + 1}`, location: "A-01", contents: "Kartons", inAt: "2026-10-01" })),
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getTitle()).toBe("Abholschein A-20261024-ABCD");
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
