import { describe, expect, it } from "vitest";
import { brandFacts, brandSnippet, invoiceTextForBrands } from "@/lib/sas/logic";
describe("Belege je Marke: Bankverbindung und Fußzeile zählen nicht", () => {
  // Erfundene Rechnungstexte.
  const product = "Testhandel GmbH · Rechnung 4711 · Pos. 1 Kugelschreiber BIC Cristal blau 50 Stk · Bankverbindung: Testbank IBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX · USt-IdNr. DE123456789";
  const bankOnly = "Muster AG · Rechnung 9 · Pos. 1 Schrauben · IBAN: DE89370400440532013000 · BIC: COBADEFFXXX · Amtsgericht Musterstadt HRB 1234";
  it("BIC-Code, IBAN und Registerangaben werden entfernt, Artikelzeilen bleiben", () => {
    const clean = invoiceTextForBrands(bankOnly);
    expect(clean).not.toMatch(/COBADEFF|DE8937|HRB/);
    expect(invoiceTextForBrands("Pos 1 BIC Cristal · SWIFT-BIC: DEUTDEFF500")).toContain("BIC Cristal");
    expect(invoiceTextForBrands("Pos 1 BIC Cristal · SWIFT-BIC: DEUTDEFF500")).not.toContain("DEUTDEFF");
    expect(invoiceTextForBrands("BIC KUGELSCHREIBER 10 Stk")).toContain("KUGELSCHREIBER");
  });
  it("Marke BiC: nur die Rechnung mit Artikel zählt, mit nachvollziehbarer Fundstelle", () => {
    const f = brandFacts(["BiC"], { products: [], stats: [], invoices: [{ text: product }, { text: bankOnly }], offers: [] });
    expect(f.get("bic")?.invoices).toBe(1);
    expect(brandSnippet("BiC", product)).toContain("Kugelschreiber BIC Cristal");
    expect(brandSnippet("BiC", bankOnly)).toBeNull();
  });
});
