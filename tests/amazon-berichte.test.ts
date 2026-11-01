import { describe, expect, it } from "vitest";
import { entfernungBald, gebuehrArt, gebundenesKapital, kontoBewerten, leseGesperrt, leseGestrandet, leseInboundMaengel, leseKontozustand, leseLangzeitlager, weitereJeMonat } from "@/lib/amazon-berichte/logic";
import { detectReport } from "@/lib/reports/amazon";
import { anteilVonTransaktion } from "@/lib/money/verlust";

// Amazon-Berichte 1–4 mit erfundenen Werten: Kontozustand (Leistungsbericht), gestrandet/gesperrt, Langzeitlager,
// Inbound-Mängel, Gebühren aus dem Transaktionsbericht.

const t = (head: string[], ...rows: string[][]) => ({ headers: head, rows });

describe("Kontozustand", () => {
  const json = {
    performanceMetrics: [
      { marketplaceId: "A1PA6795UKMFR9", accountHealthRating: { ahrStatus: "GOOD", ahrScore: 230 }, orderDefectRate: { afn: { status: "GOOD", rate: 0.002, targetValue: 0.01 }, mfn: { status: "POOR", rate: 0.015, targetValue: 0.01 } }, lateShipmentRate: { status: "GOOD", rate: 0.01, targetValue: 0.04 }, receivedIntellectualPropertyComplaints: { status: "POOR", defectsCount: 1, targetValue: 0 }, listingPolicyViolations: { status: "GOOD", defectsCount: 0 } },
      { marketplaceId: "A13V1IB3VIYZZH", accountHealthRating: { ahrStatus: "GREAT", ahrScore: 320 } },
    ],
  };
  it("liest Marktplätze, Kennzahlen und Verstöße", () => {
    const m = leseKontozustand(json);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ marktplatz: "A1PA6795UKMFR9", ahrStatus: "GOOD", ahrScore: 230 });
    expect(m[0].werte.odrFbm).toEqual({ rate: 0.015, status: "POOR", ziel: 0.01 });
    expect(m[0].verstoesse[0]).toMatchObject({ schluessel: "receivedIntellectualPropertyComplaints", text: "Beschwerden wegen geistigen Eigentums", anzahl: 1 });
    expect(leseKontozustand({})).toEqual([{ marktplatz: "", ahrStatus: null, ahrScore: null, werte: expect.any(Object), verstoesse: [] }]);
  });
  it("neue Markenbeschwerde = gefährdet; Kennzahl außerhalb des Ziels = prüfen; alles gut = gut", () => {
    const [de, fr] = leseKontozustand(json);
    const b = kontoBewerten(de, null);
    expect(b.stufe).toBe("kritisch");
    expect(b.gruende.join(" ")).toMatch(/Bestellmängelquote \(Händlerversand\) 1,5 %.*Ziel 1 %/);
    expect(kontoBewerten(fr, null)).toEqual({ stufe: "gut", gruende: [], neu: [] });
    // Gleicher Stand wie vorher: Beschwerde ist bekannt → nur noch „prüfen“, keine neue
    const nochmal = kontoBewerten(de, de);
    expect(nochmal.stufe).toBe("warnung");
    expect(nochmal.neu).toEqual([]);
    // Eine mehr als vorher → wieder gefährdet, „+1 neu“
    const mehr = { ...de, verstoesse: de.verstoesse.map((v) => (v.anzahl ? { ...v, anzahl: 2 } : v)) };
    const b2 = kontoBewerten(mehr, de);
    expect(b2.stufe).toBe("kritisch");
    expect(b2.neu[0]).toMatchObject({ anzahl: 1 });
    expect(b2.gruende.join(" ")).toContain("(+1 neu)");
  });
  it("Kontozustand-Wert unter 200 bzw. 100", () => {
    const basis = leseKontozustand({ performanceMetrics: [{ marketplaceId: "X", accountHealthRating: { ahrStatus: "AT_RISK", ahrScore: 150 } }] })[0];
    expect(kontoBewerten(basis, null).gruende[0]).toBe("Kontozustand gefährdet (150)");
    expect(kontoBewerten({ ...basis, ahrStatus: null, ahrScore: 80 }, null).gruende[0]).toBe("Kontozustand kritisch (80)");
  });
});

describe("Gestrandet und gesperrt", () => {
  it("liest den Stranded-Bericht, Menge aus verkäuflich + nicht verkäuflich + reserviert", () => {
    const z = leseGestrandet(t(["primary-action", "date-stranded", "Date-to-take-auto-removal", "stranded-reason", "asin", "sku", "fnsku", "product-name", "fulfillable-qty", "unfulfillable-qty", "reserved-quantity", "your-price"], ["Relist", "2026-10-20", "2026-11-05", "No listing exists", "b0test0001", "TEST-A", "X00A", "Testartikel", "5", "1", "0", "9,99"]));
    expect(z).toEqual([{ sku: "TEST-A", asin: "B0TEST0001", fnsku: "X00A", titel: "Testartikel", grund: "No listing exists", seit: "2026-10-20", autoEntfernung: "2026-11-05", menge: 6, preis: 9.99, aktion: "Relist" }]);
  });
  it("liest gesperrte Angebote (englisch und deutsch)", () => {
    expect(leseGesperrt(t(["Status", "Reason", "SKU", "ASIN", "Product name", "Status Change Date", "Issue Description"], ["Search Suppressed", "Missing information", "TEST-B", "B0TESTB", "Tasse", "10/30/2026", "Hauptbild fehlt"]))[0]).toEqual({ sku: "TEST-B", asin: "B0TESTB", titel: "Tasse", status: "Search Suppressed", grund: "Missing information – Hauptbild fehlt", seit: "2026-10-30" });
    expect(leseGesperrt(t(["Status", "Grund", "SKU", "ASIN", "Produktname", "Datum der Statusänderung", "Problembeschreibung"], ["Unterdrückt", "Fehlende Angaben", "TEST-C", "B0TESTC", "Kanne", "30.10.2026", "Marke fehlt"]))[0]).toMatchObject({ sku: "TEST-C", grund: "Fehlende Angaben – Marke fehlt", seit: "2026-10-30" });
  });
  it("gebundenes Kapital nur mit EK; Entfernung in 7 Tagen", () => {
    expect(gebundenesKapital([{ sku: "A", menge: 5 }, { sku: "B", menge: 2 }], new Map([["A", 2.1]]))).toEqual({ summe: 10.5, ohneEk: 1, stueck: 7 });
    expect(entfernungBald("2026-11-05", "2026-11-01")).toBe(true);
    expect(entfernungBald("2026-11-20", "2026-11-01")).toBe(false);
    expect(entfernungBald(null, "2026-11-01")).toBe(false);
  });
  it("Erkennung der Berichte (auch für den Upload)", () => {
    expect(detectReport(t(["sku", "asin", "date-stranded", "fulfillable-qty"]))).toBe("gestrandet");
    expect(detectReport(t(["Status", "Reason", "SKU", "ASIN", "Issue Description"]))).toBe("gesperrt");
    expect(detectReport(t(["snapshot-date", "sku", "asin", "amount-charged"]))).toBe("langzeitlager");
    expect(detectReport(t(["problem-type", "shipment-id", "fee-total"]))).toBe("inboundMaengel");
    expect(detectReport(t(["sku", "afn-fulfillable-quantity"]))).toBe("inventory");
  });
});

describe("Weitere Gebühren", () => {
  it("Langzeitlager: Betrag direkt oder 6+12 Monate", () => {
    const z = leseLangzeitlager(t(["snapshot-date", "sku", "asin", "fnsku", "qty-charged", "amount-charged", "currency", "country"], ["2026-10-15", "TEST-A", "B0TESTA", "X00A", "4", "3,40", "EUR", "DE"]));
    expect(z[0]).toMatchObject({ art: "langzeitlager", monat: "2026-10", sku: "TEST-A", asin: "B0TESTA", menge: 4, betrag: 3.4, land: "DE" });
    const alt = leseLangzeitlager(t(["snapshot-date", "sku", "asin", "12-mo-long-terms-storage-fee", "6-mo-long-terms-storage-fee", "qty-charged-12-mo-long-term-storage-fee"], ["2026-09-15", "TEST-B", "B0TESTB", "1.50", "0.50", "2"]));
    expect(alt[0]).toMatchObject({ betrag: 2, menge: 2 });
    expect(leseLangzeitlager(t(["snapshot-date", "sku", "asin", "amount-charged"], ["2026-09-15", "TEST-C", "B0TESTC", "0"]))).toEqual([]);
  });
  it("Inbound-Mängel je Sendung mit Gebühr", () => {
    const z = leseInboundMaengel(t(["date", "problem-type", "shipment-id", "merchant-sku", "fee-type", "currency", "fee-total", "problem-quantity"], ["2026-10-25", "Unplanned service: Labeling", "FBA15TEST", "TEST-A", "Unplanned prep service fee", "EUR", "1.20", "6"]), "2026-11-01");
    expect(z[0]).toMatchObject({ art: "inbound_mangel", monat: "2026-10", sendung: "FBA15TEST", sku: "TEST-A", betrag: 1.2, menge: 6, text: "Unplanned service: Labeling – Unplanned prep service fee" });
  });
  it("Art aus dem Transaktionsbericht (deutsch/englisch)", () => {
    expect(gebuehrArt("FBA Long-Term Storage Fee")).toBe("langzeitlager");
    expect(gebuehrArt("Zuschlag für Altbestand")).toBe("langzeitlager");
    expect(gebuehrArt("Storage capacity overage fee")).toBe("lagerlimit");
    expect(gebuehrArt("Gebühr für Überschreitung des Lagerlimits")).toBe("lagerlimit");
    expect(gebuehrArt("FBA Inbound Defect Fee")).toBe("inbound_mangel");
    expect(gebuehrArt("Inbound placement service fee")).toBe("inbound_platzierung");
    expect(gebuehrArt("FBA Storage Fee")).toBeNull();
    expect(gebuehrArt("Order Payment")).toBeNull();
  });
  it("Monatssummen: Bericht geht vor Transaktionen", () => {
    const z = weitereJeMonat([{ art: "langzeitlager", monat: "2026-10", betrag: 3.4 }], [{ art: "langzeitlager", monat: "2026-10", betrag: -3.4 }, { art: "langzeitlager", monat: "2026-09", betrag: -2 }, { art: "lagerlimit", monat: "2026-10", betrag: -15 }]);
    expect(z).toEqual([
      { monat: "2026-10", art: "lagerlimit", betrag: 15, quelle: "transaktionen" },
      { monat: "2026-10", art: "langzeitlager", betrag: 3.4, quelle: "bericht" },
      { monat: "2026-09", art: "langzeitlager", betrag: 2, quelle: "transaktionen" },
    ]);
  });
  it("Verlust-Stopp: Lagerlimit und Inbound-Mängel zählen wie Lager, nicht als Verkauf", () => {
    expect(anteilVonTransaktion({ kind: "other", type: "Service Fee", description: "FBA Inbound Defect Fee" })).toBe("lager");
    expect(anteilVonTransaktion({ kind: "other", type: "Service Fee", description: "Storage capacity overage fee" })).toBe("lager");
    expect(anteilVonTransaktion({ kind: "sale", type: "Order", description: "Testsocken" })).toBeNull();
  });
});
