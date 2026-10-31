import { describe, expect, it } from "vitest";
import { blattBild } from "@/lib/b2b/blatt-bild";

// B19.6: Deal-Blatt als Bild (SVG) mit erfundenen Werten – Inhalt wie das PDF, ohne EK/Verdienst, Text maskiert.
describe("Deal-Blatt als Bild", () => {
  it("enthält Artikel, Preis, Mengen und Länder; maskiert Sonderzeichen; kein EK", () => {
    const svg = blattBild({ firma: { name: "Testfirma GmbH" }, nr: 7, titel: "Erfundo Pfanne <28 cm> & Deckel", asin: "B0TEST0007", ean: null, marke: "Erfundo", preis: 12.5, mindestmenge: 10, maxProKunde: 50, rest: 120, frist: "2026-11-15", hinweis: null, laender: [{ land: "DE", vk: 29.9, gewinn: 6.1, roi: 45, verkaeufe: 300, angebote: 5 }], link: "https://portal.example/deals/x", stand: new Date("2026-10-31T10:00:00Z") });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Deal 7");
    expect(svg).toContain("Erfundo Pfanne &lt;28 cm&gt; &amp; Deckel");
    expect(svg).toContain("12,50 €");
    expect(svg).toContain("ab 10 Stück");
    expect(svg).toContain("bis 15.11.2026");
    expect(svg).toContain("6,10 €");
    expect(svg).not.toMatch(/\bEK\b|Verdienst/);
  });
});
