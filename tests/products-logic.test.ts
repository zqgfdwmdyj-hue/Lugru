import { describe, expect, it } from "vitest";
import { ekCheck, groupCandidates, mappingIssues, type Candidate, type MappingInput } from "@/lib/products/logic";

// Produkte: Bündeln, EK-Abgleich, Arbeitsliste. Fiktive SKUs.

const c = (p: Partial<Candidate> & { sku: string }): Candidate => ({ productId: null, title: null, asin: null, ean: null, image: null, source: "lager", ...p });

describe("Produkte bündeln", () => {
  it("SKUs eines Produkts zusammen, auch wenn nur eine Quelle das Produkt kennt", () => {
    const g = groupCandidates([
      c({ sku: "A-1", productId: "p1", title: "Testduft 100 ml", asin: "B0TEST0001", source: "produkt" }),
      c({ sku: "A-2", productId: "p1", source: "produkt", title: "Testduft 100 ml" }),
      c({ sku: "A-1", source: "lager" }),
      c({ sku: "A-1", source: "angebot", title: "Testduft EDT 100ml – Angebot", image: "https://img.example/a.jpg", active: true }),
      c({ sku: "LG-9", source: "ebay", title: "Lagerware 9", image: "https://img.example/9.jpg" }),
    ]);
    expect(g).toHaveLength(2);
    const p = g.find((x) => x.productId === "p1")!;
    expect(p.skus).toEqual(["A-1", "A-2"]);
    expect(p.title).toBe("Testduft 100 ml");
    expect(p.image).toBe("https://img.example/a.jpg");
    expect(p.href).toBe("/produkte/p1");
    const s = g.find((x) => !x.productId)!;
    expect(s.href).toBe("/produkte/sku/LG-9");
  });
  it("aktives Angebot vor beendetem für Name und Bild", () => {
    const [g] = groupCandidates([c({ sku: "X", source: "angebot", title: "alt", active: false }), c({ sku: "X", source: "angebot", title: "neu", active: true })]);
    expect(g.title).toBe("neu");
  });
});

describe("EK-Abgleich", () => {
  it("kleine Abweichung (Rundung) ist kein Widerspruch, große schon", () => {
    expect(ekCheck("A", [{ source: "charge", label: "Charge", cost: 10 }, { source: "ebay", label: "eBay-Tool", cost: 10.1 }], { cost: 10, source: "charge" }).conflict).toBe(false);
    const k = ekCheck("A", [{ source: "charge", label: "Charge", cost: 10 }, { source: "ebay", label: "eBay-Tool", cost: 12 }], { cost: 10, source: "charge" });
    expect(k.conflict).toBe(true);
    expect(k.spread).toBe(2);
    expect(ekCheck("A", [{ source: "manuell", label: "von Hand", cost: 5 }], { cost: 5, source: "manuell" }).conflict).toBe(false);
  });
});

describe("Arbeitsliste Zuordnung", () => {
  const base = (): MappingInput => ({
    ownStock: new Map([["LG-1", 4], ["LG-2", 2], ["LG-NEG", -1]]),
    fbaStock: new Map([["AMZ-1", 10]]),
    lotSkus: new Set(["AMZ-1"]),
    setSkus: new Set(["SET-1"]),
    setComponents: new Set(["LG-2"]),
    listings: [
      { channel: "ebay", sku: "EB-1", stockSku: "LG-1", status: "active", title: "Lagerware 1" },
      { channel: "temu", sku: "TM-X", stockSku: "LG-FEHLT", status: "active", title: "Temu ohne Lager" },
      { channel: "ebay", sku: "EB-ALT", stockSku: "LG-WEG", status: "ended", title: "beendet" },
    ],
    ebayTool: [
      { sku: "EB-1", title: "Lagerware 1", listingId: "111", status: "published" },
      { sku: "EB-NEU", title: "Nur im Tool", listingId: "222", status: "published" },
      { sku: "EB-ENTWURF", title: "Entwurf", listingId: null, status: "draft" },
    ],
    sold: [
      { sku: "EB-1", channel: "ebay", units: 2, title: null },
      { sku: "UNBEKANNT-7", channel: "ebay", units: 1, title: "Altes Angebot" },
      { sku: "AMZ-1", channel: "amazon", units: 3, title: null },
    ],
    costs: new Map([["AMZ-1", { cost: 7, source: "charge" as const }]]),
    ekChecks: [ekCheck("AMZ-1", [{ source: "charge", label: "Charge", cost: 7 }, { source: "ebay", label: "eBay-Tool", cost: 9 }], { cost: 7, source: "charge" })],
    eanAsins: [{ ean: "4000000000001", asins: ["B0A", "B0B"] }],
    titles: new Map([["LG-1", "Lagerware 1"]]),
  });
  it("findet alle Arten, wichtigste zuerst, ohne Doppelte", () => {
    const issues = mappingIssues(base());
    const kinds = issues.map((i) => `${i.kind}:${i.sku}`);
    expect(kinds).toEqual([
      "verkauft-unbekannt:UNBEKANNT-7",
      "angebot-ohne-lager:TM-X",
      "ebay-nicht-in-wawi:EB-NEU",
      "ek-fehlt:EB-1",
      "ek-fehlt:LG-1",
      "ek-fehlt:LG-2",
      "ek-abweichung:AMZ-1",
      "ean-mehrdeutig:4000000000001",
    ]);
    // Set-Bestandteil (LG-2) ist kein „Lagerware ohne Angebot“; LG-1 wird über die Lager-SKU angeboten.
    expect(issues.some((i) => i.kind === "bestand-ohne-angebot")).toBe(false);
    expect(issues.find((i) => i.kind === "angebot-ohne-lager")!.href).toBe("/produkte/sku/LG-FEHLT?tab=angebote");
    expect(issues.find((i) => i.sku === "LG-1")!.href).toBe("/produkte/sku/LG-1?tab=einkauf");
  });
  it("Lagerware ohne Angebot", () => {
    const i = base();
    i.ownStock.set("LG-3", 5);
    i.costs.set("LG-3", { cost: 1, source: "manuell" });
    expect(mappingIssues(i).filter((x) => x.kind === "bestand-ohne-angebot").map((x) => x.sku)).toEqual(["LG-3"]);
  });
});
