import { describe, expect, it } from "vitest";
import { profitgoLink } from "@/lib/deal-ampel/logic";
import { b2bPrepJeStueck, preislisteAusZeilen } from "@/lib/shipping/prep";

// Erfundene Preisliste und Adressmuster.
describe("Prep-Center-Preisliste", () => {
  const liste = preislisteAusZeilen([
    { name: "Etikettieren", preis: 0.35, einheit: "stueck", b2b: true },
    { name: "Polybeutel", preis: 0.2, einheit: "stueck", b2b: true },
    { name: "FBM-Versand", preis: 1.5, einheit: "sendung", b2b: true },
    { name: "Lagerung", preis: 12, einheit: "palette_monat", b2b: false },
    { name: "", preis: 3, einheit: "stueck", b2b: true },
    { name: "Ohne Preis", preis: null, einheit: "stueck" },
    { name: "Negativ", preis: -1, einheit: "stueck" },
    { name: "Unbekannte Einheit", preis: 1, einheit: "fass" },
  ]);
  it("übernimmt nur Posten mit Name und Preis ≥ 0; B2B nur bei „je Stück“", () => {
    expect(liste.map((x) => x.name)).toEqual(["Etikettieren", "Polybeutel", "FBM-Versand", "Lagerung", "Unbekannte Einheit"]);
    expect(liste.find((x) => x.name === "FBM-Versand")?.b2b).toBe(false);
    expect(liste.find((x) => x.name === "Unbekannte Einheit")?.einheit).toBe("stueck");
  });
  it("B2B-Prep je Stück: fester Wert vor Preisliste, sonst Summe der B2B-Posten", () => {
    expect(b2bPrepJeStueck(0.8, liste)).toMatchObject({ betrag: 0.8, quelle: "einstellung" });
    expect(b2bPrepJeStueck(0, liste)).toEqual({ betrag: 0.55, quelle: "preisliste", posten: ["Etikettieren", "Polybeutel"] });
    expect(b2bPrepJeStueck(0, [])).toMatchObject({ betrag: 0, quelle: "keine" });
    expect(b2bPrepJeStueck(0, undefined)).toMatchObject({ quelle: "keine" });
  });
});

describe("ProfitGo-Schnelllink", () => {
  it("nur mit https-Muster und {asin}; leer = kein Link", () => {
    expect(profitgoLink("https://profitgo.example/produkt/{asin}?m=de", "b0test0001")).toBe("https://profitgo.example/produkt/B0TEST0001?m=de");
    expect(profitgoLink("", "B0TEST0001")).toBeNull();
    expect(profitgoLink("https://profitgo.example/suche", "B0TEST0001")).toBeNull();
    expect(profitgoLink("http://profitgo.example/{asin}", "B0TEST0001")).toBeNull();
    expect(profitgoLink("javascript:alert({asin})", "B0TEST0001")).toBeNull();
    expect(profitgoLink("https://profitgo.example/{asin}", "123")).toBeNull();
    expect(profitgoLink("https://profitgo.example/{asin}", null)).toBeNull();
  });
});
