import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { addressLines, buildAddressLabels, countryLine, fitFontSize } from "@/lib/shipping/address-label";

// Adressetiketten 62 × 29 mm (Brother QL-800). Fiktive Anschriften.

describe("Adressetikett 62 × 29 mm", () => {
  it("Zeilen: Name, Zusatz, Straße + Nr., PLZ Ort, Land nur im Ausland", () => {
    expect(addressLines({ name1: "Erika Muster", street: "Waldweg", houseNo: "5", zip: "70186", city: "Stuttgart", country: "DEU" })).toEqual(["Erika Muster", "Waldweg 5", "70186 Stuttgart"]);
    expect(addressLines({ name1: "Max Probe", name2: "c/o Firma Test", street: "Probeweg", houseNo: "7b", zip: "1010", city: "Wien", country: "AT" })).toEqual(["Max Probe", "c/o Firma Test", "Probeweg 7b", "1010 Wien", "ÖSTERREICH"]);
    expect(addressLines({ street: "Waldweg 5", zip: "70186", city: "Stuttgart" }, "Käufer Name")).toEqual(["Käufer Name", "Waldweg 5", "70186 Stuttgart"]);
    expect(addressLines({ name1: "Ohne Straße", zip: "70186", city: "Stuttgart" })).toBeNull();
    expect(addressLines(null, "Nur Name")).toBeNull();
  });

  it("Land: Deutschland ohne, sonst deutscher Name (2- oder 3-stellig)", () => {
    expect(countryLine("DE")).toBeNull();
    expect(countryLine("Germany")).toBeNull();
    expect(countryLine(undefined)).toBeNull();
    expect(countryLine("CHE")).toBe("SCHWEIZ");
    expect(countryLine("nl")).toBe("NIEDERLANDE");
    expect(countryLine("XYZ")).toBe("XYZ");
  });

  it("Schriftgröße: so groß wie möglich, höchstens 15 pt, mindestens 6 pt", () => {
    expect(fitFontSize([5, 5, 5], 160, 70)).toBe(15);
    expect(fitFontSize([20, 5, 5], 160, 70)).toBe(8);
    expect(fitFontSize([10, 10, 10, 10, 10], 160, 70)).toBeCloseTo(70 / (5 * 1.15), 5);
    expect(fitFontSize([100], 160, 70)).toBe(6);
  });

  it("PDF: je Anschrift eine Seite 62 × 29 mm, ohne Anschrift übersprungen, Sonderzeichen gehen", async () => {
    const { pdf, printed, skipped } = await buildAddressLabels([
      { address: { name1: "Nadine Lehmann", street: "Waldmeisterstraße", houseNo: "12", zip: "70186", city: "Stuttgart" } },
      { address: { name1: "Fehlt", zip: "1" } },
      { address: { name1: "Łukasz Żółć", street: "Ulica Testowa", houseNo: "1", zip: "00-001", city: "Warszawa", country: "PL" } },
      { address: { name1: "Sehr Langer Name Mit Vielen Teilen Und Noch Mehr Text Der Nicht Passt", street: "Hauptstraße", houseNo: "1", zip: "10115", city: "Berlin" } },
    ]);
    expect([printed, skipped]).toEqual([3, 1]);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(3);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo((62 * 72) / 25.4, 1);
      expect(height).toBeCloseTo((29 * 72) / 25.4, 1);
    }
  });
});
