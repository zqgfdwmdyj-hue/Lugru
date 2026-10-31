import { describe, expect, it } from "vitest";
import { formatVorschlag, spaltenProtokoll, vorschlagText } from "@/lib/reports/format-vorschlag";

describe("Format nicht erkannt → Vorschlag", () => {
  it("Lagergebühren ohne Gebühren-Spalte → „sieht aus wie Monatliche Lagergebühren“", () => {
    const v = formatVorschlag(["asin", "fnsku", "product_name", "fulfillment_center", "country_code", "product_size_tier", "average_quantity_on_hand", "month_of_charge"]);
    expect(v).toMatchObject({ art: "storageFees", importArt: "amazon_lagergebuehren", treffer: 8, von: 10 });
    expect(v!.fehlen).toEqual(["estimated-monthly-storage-fee", "currency"]);
    expect(vorschlagText(v)).toContain("Sieht aus wie „Monatliche Lagergebühren");
    expect(vorschlagText(v)).toContain("import_link art=amazon_lagergebuehren");
  });

  it("völlig fremde Spalten → kein Vorschlag, aber vollständige Spaltenliste", () => {
    const h = ["Kundennummer", "Lieblingsfarbe", "Schuhgröße"];
    expect(formatVorschlag(h)).toBeNull();
    expect(vorschlagText(null)).toBeNull();
    expect(spaltenProtokoll(h)).toBe("Spalten in der Datei (3): kundennummer, lieblingsfarbe, schuhgröße");
  });
});
