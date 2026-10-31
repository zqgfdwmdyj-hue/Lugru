import { describe, expect, it } from "vitest";
import { abdeckung, abdeckungCsv, abdeckungStatus, auditDateiname, markeTrifft } from "@/lib/echtheit/logic";

// Echtheits-Ordner: Marke erkennen, Abdeckung gekauft/verkauft, Lücken, Audit-Dateinamen. Erfundene Marken/Werte.

describe("Marke erkennen", () => {
  it("ganzes Wort, Groß/klein egal, mit Schreibweisen", () => {
    expect(markeTrifft("Testmarke", [], "TESTMARKE Topf 24 cm")).toBe(true);
    expect(markeTrifft("Testmarke", [], "Testmarkenshop GmbH")).toBe(false);
    expect(markeTrifft("Röstwerk", ["Roestwerk"], "Roestwerk Mühle")).toBe(true);
    expect(markeTrifft("Röstwerk", [], null)).toBe(false);
  });
});

describe("Abdeckung", () => {
  const z = (sku: string, verkauft: number, gekauftBelegt: number, gekauftOhneBeleg = 0) => ({ sku, asin: null, name: null, verkauft, gekauftBelegt, gekauftOhneBeleg });
  it("Status je SKU", () => {
    expect(abdeckungStatus(z("A", 10, 12))).toBe("belegt");
    expect(abdeckungStatus(z("A", 10, 4))).toBe("teilweise");
    expect(abdeckungStatus(z("A", 10, 0))).toBe("luecke");
    expect(abdeckungStatus(z("A", 0, 5))).toBe("kein_verkauf");
  });
  it("Quote: gedeckte Stück ÷ verkaufte Stück, Überdeckung zählt nicht doppelt; Lücken zuerst", () => {
    const a = abdeckung([z("A", 10, 20), z("B", 10, 0, 10), z("C", 10, 5), z("D", 0, 3)]);
    // gedeckt: 10 + 0 + 5 = 15 von 30
    expect(a.quote).toBe(50);
    expect(a.luecken).toBe(2);
    expect(a.zeilen.map((x) => x.sku)).toEqual(["B", "C", "A", "D"]);
    expect(a.gekauftOhneBeleg).toBe(10);
    expect(abdeckung([z("D", 0, 3)]).quote).toBeNull();
  });
});

describe("Audit-Paket", () => {
  it("Dateinamen eindeutig und ohne Sonderzeichen", () => {
    const v = new Set<string>();
    expect(auditDateiname({ datum: "2026-03-01", lieferant: "Großhandel Müller & Co.", nummer: "RE/2026/17", original: "x.PDF" }, v)).toBe("Rechnungen/2026-03-01_Grosshandel-Muller-Co_RE-2026-17.pdf");
    expect(auditDateiname({ datum: "2026-03-01", lieferant: "Großhandel Müller & Co.", nummer: "RE/2026/17", original: "y.pdf" }, v)).toBe("Rechnungen/2026-03-01_Grosshandel-Muller-Co_RE-2026-17-2.pdf");
    expect(auditDateiname({ datum: null, lieferant: null, nummer: null, original: "scan.jpg" }, v)).toBe("Rechnungen/ohne-datum_lieferant_ohne-nr.jpg");
  });
  it("CSV mit Semikolon und Schutz vor Formeln", () => {
    const a = abdeckung([{ sku: "=HYPERLINK()", asin: "B0TEST0001", name: "Topf; groß", verkauft: 2, gekauftBelegt: 0, gekauftOhneBeleg: 0 }]);
    const csv = abdeckungCsv(a.zeilen);
    expect(csv.split("\r\n")[1]).toBe(`'=HYPERLINK();B0TEST0001;"Topf; groß";2;0;0;Lücke`);
  });
});
