import { describe, expect, it } from "vitest";
import { abrechnungsMonat, inCm, inKg, inM3, istMonatsLagergebuehrText, istUebergross, lagerMarge, remissionPruefen, sellerboardLagerFixkosten } from "@/lib/reports/lagergebuehren-logic";
import { detectReport, parseStorageFees } from "@/lib/reports/amazon";
import { readTable } from "@/lib/tabular";
import { bewerteKapital } from "@/lib/money/kapital";

// Erfundene Werte (keine echten Artikel).

describe("Lagergebühren – Einheiten und Größe", () => {
  it("rechnet Zoll/Pfund/Kubikfuß um", () => {
    expect(inCm(10, "inches")).toBe(25.4);
    expect(inCm(30, "centimeters")).toBe(30);
    expect(inKg(2, "pounds")).toBe(0.91);
    expect(inKg(1.5, "kilograms")).toBe(1.5);
    expect(inM3(1, "cubic feet")).toBeCloseTo(0.0283, 4);
    expect(inM3(0.002, "cubic meters")).toBe(0.002);
    expect(inM3(1000, "cubic centimeters")).toBeCloseTo(0.001, 6);
  });

  it("übergroß nach Größenklasse oder längster Seite", () => {
    expect(istUebergross("Oversize", 20)).toBe(true);
    expect(istUebergross("Standard-Size", 20)).toBe(false);
    expect(istUebergross("Standard-Size", 50)).toBe(true);
    expect(istUebergross(null, null)).toBe(false);
  });

  it("liest den Bericht als .txt (Tabulator) mit Zoll und Kubikfuß", () => {
    const kopf = ["asin", "fnsku", "product-name", "fulfillment-center", "country-code", "longest-side", "measurement-units", "weight", "weight-units", "volume-units", "product-size-tier", "average-quantity-on-hand", "estimated-total-item-volume", "month-of-charge", "currency", "estimated-monthly-storage-fee"];
    const zeile = ["B0TESTLG01", "X00TEST1", "Testartikel (erfunden)", "TST1", "DE", "20", "inches", "3", "pounds", "cubic feet", "Standard", "10", "2", "2026-09", "EUR", "4,50"];
    const t = readTable(new TextEncoder().encode(`${kopf.join("\t")}\n${zeile.join("\t")}\n`));
    expect(detectReport(t)).toBe("storageFees");
    const [p] = parseStorageFees(t);
    expect(p).toMatchObject({ monat: "2026-09", land: "DE", laengsteSeiteCm: 50.8, gewichtKg: 1.36, uebergross: true, gebuehr: 4.5 });
    expect(p.volumenM3).toBeCloseTo(0.0566, 3);
  });
});

describe("Lagergebühr frisst Marge / Remission", () => {
  it("Gebühr bis zum Verkauf gegen Gewinn je Stück", () => {
    const m = lagerMarge({ gebuehrJeStueckMonat: 0.8, gewinnJeStueck: 4, reichweiteTage: 90 });
    expect(m).toMatchObject({ kostenBisVerkauf: 2.4, frisstMarge: true, anteil: 0.6 });
    expect(m!.text).toContain("Lagergebühr frisst Marge");
    expect(lagerMarge({ gebuehrJeStueckMonat: 0.1, gewinnJeStueck: 4, reichweiteTage: 30 })!.frisstMarge).toBe(false);
    expect(lagerMarge({ gebuehrJeStueckMonat: 0.5, gewinnJeStueck: -1, reichweiteTage: 30 })).toBeNull();
    expect(lagerMarge({ gebuehrJeStueckMonat: null, gewinnJeStueck: 3, reichweiteTage: 30 })).toBeNull();
  });

  it("Remission prüfen nur bei groß + langsam + spürbarer Gebühr", () => {
    expect(remissionPruefen({ uebergross: true, volumenM3: 0.02, gebuehrMonat: 12, reichweiteTage: 400 })).toContain("Remission prüfen (übergroß, Reichweite 400 Tage");
    expect(remissionPruefen({ uebergross: false, volumenM3: 0.3, gebuehrMonat: 8, reichweiteTage: 9999 })).toContain("keine Verkäufe");
    expect(remissionPruefen({ uebergross: true, volumenM3: 0.02, gebuehrMonat: 12, reichweiteTage: 40 })).toBeNull();
    expect(remissionPruefen({ uebergross: true, volumenM3: 0.02, gebuehrMonat: 1, reichweiteTage: 400 })).toBeNull();
    expect(remissionPruefen({ uebergross: false, volumenM3: 0.01, gebuehrMonat: 12, reichweiteTage: 400 })).toBeNull();
  });

  it("Kapital-Ampel: grün wird gelb, wenn die Lagergebühr die Marge frisst; Vorschlag Remission", () => {
    const basis = { sku: "TEST-LG", asin: "B0TESTLG01", name: null, stueck: 30, ek: 10, gewinn90: 120, stueck90: 30, tageDaten: 90, verkaufProTag: 0.6, aeltesteTage: 20, preis: 25, breakEven: 18, trendProzent: null };
    expect(bewerteKapital(basis).ampel).toBe("gruen");
    const mitLager = bewerteKapital({ ...basis, lager: { monat: "2026-09", gebuehrMonat: 30, jeStueckMonat: 1.2, uebergross: false, volumenM3: 0.05 } });
    expect(mitLager.ampel).toBe("gelb");
    expect(mitLager.gruende.join(" ")).toContain("Lagergebühr frisst Marge");
    expect(mitLager.vorschlaege.join(" ")).toContain("Lagergebühr");
    const langsam = bewerteKapital({ ...basis, verkaufProTag: 0.1, lager: { monat: "2026-09", gebuehrMonat: 15, jeStueckMonat: 0.5, uebergross: true, volumenM3: 0.2 } });
    expect(langsam.remission).toContain("Remission prüfen");
    expect(langsam.vorschlaege.some((v) => v.startsWith("Remission prüfen"))).toBe(true);
  });
});

describe("Abgleich", () => {
  it("sellerboard-Fixkosten „Lager…“ als Monatsbetrag", () => {
    expect(sellerboardLagerFixkosten([{ beschreibung: "Miete Büro", betrag: -500, rhythmus: "monthly" }])).toBeNull();
    expect(sellerboardLagerFixkosten([{ beschreibung: "FBA Lagergebühr", betrag: -120, rhythmus: "monthly" }, { beschreibung: "Storage fee yearly", betrag: -240, rhythmus: "yearly" }])).toEqual({ summeMonat: 140, posten: ["FBA Lagergebühr", "Storage fee yearly"] });
  });
  it("Buchungstexte und Abrechnungsmonat", () => {
    expect(istMonatsLagergebuehrText("FBA storage fee")).toBe(true);
    expect(istMonatsLagergebuehrText("Lagergebühren für Versand durch Amazon")).toBe(true);
    expect(istMonatsLagergebuehrText("FBA Long-Term Storage Fee")).toBe(false);
    expect(istMonatsLagergebuehrText("Langzeitlagergebühr")).toBe(false);
    expect(abrechnungsMonat("2026-09")).toBe("2026-10");
    expect(abrechnungsMonat("2026-12")).toBe("2027-01");
  });
});
