import { describe, expect, it } from "vitest";
import { auditMail, brandFacts, brandRegex, daysUntil, dealCalc, evidenceCheck, evidenceKey, FAHRPLAN, findDuplicateDocs, parseBrandList, parseDealList, salesState, suggestBrands } from "@/lib/sas/logic";

// Amazon SAS-Programm – fiktive Marken und ASINs.

describe("Markenliste", () => {
  it("Kopfzeile, Leerzeilen und Doppel (Groß/klein) fallen weg", () => {
    expect(parseBrandList(["brand_name", "Alpha", " beta  Tools ", "", "ALPHA", "Beta tools"])).toEqual(["Alpha", "beta Tools"]);
  });
  it("Marke als ganzes Wort", () => {
    const re = brandRegex("Testo");
    expect(re.test("testo Mini Ladegerät")).toBe(true);
    expect(re.test("Ladegerät (TESTO)")).toBe(true);
    expect(re.test("Testosteron Gel")).toBe(false);
  });
  it("Kennzahlen je Marke aus Produkten, 30-Tage-Werten, Rechnungen und Lieferanten", () => {
    const f = brandFacts(["Alpha", "Gamma"], {
      products: [{ name: "Alpha Kabel 1m" }, { name: "Alpha Kabel 2m" }, { name: "Gamma Box" }],
      stats: [{ name: "Alpha Kabel 1m", sales: 100, units: 5 }, { name: "Alpha Kabel 2m", sales: 50.5, units: 2 }],
      invoices: [{ text: "Rechnung Großhandel GmbH … 10x Alpha Kabel" }, { text: "nichts" }],
      offers: [{ title: "Gamma Box 3er" }],
    });
    expect(f.get("alpha")).toEqual({ products: 2, sales30: 150.5, units30: 7, salesRows: 2, invoices: 1, invoicesConfirmed: 0, invoicesUnsure: 0, supplierOffers: 0 });
    expect(f.get("gamma")).toEqual({ products: 1, sales30: 0, units30: 0, salesRows: 0, invoices: 0, invoicesConfirmed: 0, invoicesUnsure: 0, supplierOffers: 1 });
  });
  it("Umsatz-Spalte: Betrag, „kein Umsatz“, „keine Daten“ oder „?“", () => {
    expect(salesState({ sales30: "120.00", products: 2, salesRows: 2 }, 50)).toBe("umsatz");
    expect(salesState({ sales30: "0", products: 3, salesRows: 0 }, 50)).toBe("kein_umsatz");
    expect(salesState({ sales30: 0, products: 0, salesRows: 1 }, 50)).toBe("kein_umsatz");
    expect(salesState({ sales30: 0, products: 0, salesRows: 0 }, 50)).toBe("keine_daten");
    expect(salesState({ sales30: null, products: null, salesRows: null }, 50)).toBe("keine_daten");
    expect(salesState({ sales30: 0, products: 5, salesRows: 5 }, 0)).toBe("keine_quelle");
  });
  it("Belege: „falsch“ markierte zählen nicht, bestätigte und zu prüfende werden gezählt", () => {
    const f = brandFacts(["BiC"], {
      products: [],
      stats: [],
      invoices: [
        { id: "r1", vendor: "Bürobedarf Muster GmbH", text: "Pos. 1  20 Stk  Kugelschreiber BIC Cristal blau  4,00 €" },
        { id: "r2", vendor: "Papeterie Beispiel", text: "Lieferung frei Haus\nbestellt über bic-shop.example.de" },
        { id: "r3", vendor: "Händler Test", text: "Feuerzeug BIC Maxi" },
        { id: "r4", vendor: "Nichts KG", text: "Schrauben M4" },
      ],
      offers: [],
      verdicts: new Map([[evidenceKey("bic", "r3"), "falsch" as const], [evidenceKey("bic", "r1"), "stimmt" as const]]),
    });
    expect(f.get("bic")).toMatchObject({ invoices: 2, invoicesConfirmed: 1, invoicesUnsure: 1 });
  });
  it("Vorschlag: erst Belege, dann Umsatz; Marken ohne beides fallen weg; höchstens n", () => {
    const b = (brand: string, invoices: number, sales30: number, supplierOffers = 0) => ({ brand, invoices, sales30, supplierOffers });
    const pick = suggestBrands([b("Viel Umsatz", 0, 9000), b("Belegt klein", 3, 100), b("Belegt groß", 1, 5000), b("Nichts", 0, 0), b("Lieferant", 0, 50, 2)], 3);
    expect(pick.map((x) => x.brand)).toEqual(["Belegt groß", "Belegt klein", "Lieferant"]);
  });
  it("Mail an den Consultant mit nummerierter Liste", () => {
    const m = auditMail(["Alpha", "Beta"], "Max Muster");
    expect(m.body).toMatch(/^Hallo Max,/);
    expect(m.body).toMatch(/1\. Alpha\n2\. Beta/);
    expect(m.subject).toMatch(/Authorized Reseller/);
  });
});

describe("Nachweis je Beleg (Fundstelle + Einschätzung)", () => {
  it("Lieferant ist die Marke → sicher", () => {
    expect(evidenceCheck("Testmarke Alpha", "Testmarke Alpha GmbH", "Rechnung 4711")).toMatchObject({ level: "sicher", reason: "Lieferant ist die Marke selbst" });
  });
  it("Rechnungsposition mit Menge/Preis → sicher; die belastbarste Fundstelle zählt", () => {
    const r = evidenceCheck("BiC", "Bürobedarf Muster GmbH", "Fragen? info@bic-fans.example.de\n20 Stk Kugelschreiber BIC Cristal 4,00 €");
    expect(r?.level).toBe("sicher");
    expect(r?.snippet).toContain("Kugelschreiber BIC Cristal");
  });
  it("nur in Web-/Mail-Adresse oder neben Bankangaben → prüfen", () => {
    expect(evidenceCheck("BiC", "Shop", "Bestellt über www.bic-shop.example.de")?.reason).toBe("nur in einer Web- oder Mail-Adresse");
    expect(evidenceCheck("Sparfuchs", "Shop", "Bitte per Überweisung an Sparfuchs eG zahlen")).toMatchObject({ level: "pruefen", reason: "steht bei Bankangaben" });
    // ganze Bankzeilen („Kontoinhaber …“) zählen gar nicht
    expect(evidenceCheck("Sparfuchs", "Shop", "Kontoinhaber Sparfuchs eG")).toBeNull();
  });
  it("kurzer Name nur kleingeschrieben → prüfen; großgeschrieben ohne Preis → im Text", () => {
    expect(evidenceCheck("BiC", "Shop", "die bic Lieferung kam spät")?.reason).toBe("kurzer Name, nur kleingeschrieben");
    expect(evidenceCheck("BiC", "Shop", "Hinweis zu BIC Produkten folgt")?.level).toBe("text");
  });
  it("Bankcode „BIC: COBADEFFXXX“ ist kein Fund", () => {
    expect(evidenceCheck("BiC", "Shop", "IBAN DE12 3456 7890 1234 5678 90 BIC: COBADEFFXXX")).toBeNull();
  });
});

describe("Unterlagen doppelt", () => {
  const d = (id: string, name: string, size: number, sha: string, day: string) => ({ id, name, size, sha256: sha, createdAt: new Date(`${day}T10:00:00Z`) });
  it("gleicher Inhalt → doppelt (Original = ältestes); gleicher Name/Größe, anderer Inhalt → nur ähnlich", () => {
    const m = findDuplicateDocs([d("b", "Markenliste.xlsx", 900, "aaa", "2026-10-21"), d("a", "Markenliste.xlsx", 900, "aaa", "2026-10-20"), d("c", "Markenliste.xlsx", 900, "bbb", "2026-10-22"), d("e", "Präsentation.pdf", 5000, "ccc", "2026-10-20")]);
    expect(m.get("b")).toMatchObject({ kind: "doppelt", of: { id: "a" } });
    expect(m.get("c")).toMatchObject({ kind: "aehnlich", of: { id: "a" } });
    expect(m.has("a")).toBe(false);
    expect(m.has("e")).toBe(false);
  });
});

describe("Deals", () => {
  it("Liste mit Kopfzeile: ASIN, Rabatt in verschiedenen Schreibweisen", () => {
    const r = parseDealList(["ASIN", "Produkt", "Mindestrabatt", "Deal-Typ"], [
      ["B0TESTAAA1", "Kabel", "20%", "MBD"],
      ["b0testaaa2", "Box", "0,15", "MBD"],
      ["kein", "x", "10", ""],
      ["B0TESTAAA1", "doppelt", "30", ""],
    ]);
    expect(r).toEqual([
      { asin: "B0TESTAAA1", title: "Kabel", minDiscountPct: 20, dealType: "MBD" },
      { asin: "B0TESTAAA2", title: "Box", minDiscountPct: 15, dealType: "MBD" },
    ]);
  });
  it("Liste ohne Kopfzeile: ASIN-Spalte wird erkannt", () => {
    expect(parseDealList(["B0TESTAAA3", "25"], [["B0TESTAAA4", "10"]]).map((x) => x.asin)).toEqual(["B0TESTAAA3", "B0TESTAAA4"]);
  });
  it("Gewinn je Stück zum Deal-Preis", () => {
    // 30 € brutto, 20 % Rabatt → 24 €; 24/1,19 − 15 % × 24 − 4 € FBA − 10 € EK = 2,57 €
    const r = dealCalc({ price: 30, vatPct: 19, referralRate: 0.15, fbaFee: 4, ek: 10, discountPct: 20 });
    expect(r.dealPrice).toBe(24);
    expect(r.profit).toBeCloseTo(2.57, 2);
    expect(r.verdict).toBe("lohnt");
    expect(dealCalc({ price: 30, vatPct: 19, referralRate: 0.15, fbaFee: 4, ek: 18, discountPct: 20 }).verdict).toBe("verlust");
    expect(dealCalc({ price: 30, vatPct: 19, referralRate: 0.15, fbaFee: 4, ek: null, discountPct: 20 }).verdict).toBe("unklar");
  });
});

describe("Fahrplan", () => {
  it("Fälligkeiten aus Frist und Termin", () => {
    const ctx = { today: "2026-10-26", dealDeadline: "2026-11-06", nextMeeting: "2026-11-10" };
    const due = Object.fromEntries(FAHRPLAN.map((s) => [s.key, s.due(ctx)]));
    expect(due["bw-einreichen"]).toBe("2026-11-06");
    expect(due["termin-bp"]).toBe("2026-11-08");
    expect(due["ar-auswahl"]).toBe("2026-10-29");
    expect(due["ar-appeal-mail"]).toBeNull();
    expect(new Set(FAHRPLAN.map((s) => s.key)).size).toBe(FAHRPLAN.length);
    expect(daysUntil("2026-10-26", "2026-11-06")).toBe(11);
  });
});
