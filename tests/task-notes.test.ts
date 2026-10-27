import { describe, expect, it } from "vitest";
import { noteSummary } from "@/lib/today/notes";

// Lange Aufgabennotizen: Wirkung und erster Schritt sichtbar, Rest zum Aufklappen.

describe("noteSummary", () => {
  it("kurze Notiz bleibt vollständig und wird nicht eingeklappt", () => {
    const s = noteSummary("Im Seller Central erledigen und in der Liste abhaken.");
    expect(s).toEqual({ short: "Im Seller Central erledigen und in der Liste abhaken.", effect: null, long: false });
    expect(noteSummary("  ")).toBeNull();
    expect(noteSummary(null)).toBeNull();
  });

  it("Hebel-Notiz: Betrag als Wirkung, erste Produktzeile als nächster Schritt", () => {
    const notes = "Wirkung zusammen ca. 1.234,50 € im Monat.\n• Testartikel A: Preis um 2 € anheben\n• Testartikel B: Einkauf prüfen\n• Testartikel C: Listing verbessern";
    const s = noteSummary(notes)!;
    expect(s.long).toBe(true);
    expect(s.effect).toBe("ca. 1.234,50 € im Monat");
    expect(s.short).toBe("• Testartikel A: Preis um 2 € anheben");
  });

  it("langer Fließtext: erster Satz, Abkürzungen wie „z. B.“ trennen nicht", () => {
    const notes = "Rechnungen der letzten Monate je Marke, z. B. vom Großhändler, sammeln und hochladen. Belege findest du unter Einkauf → Eingangsrechnungen; im Reiter „Marken“ steht je Marke, wie viele Belege es gibt.";
    const s = noteSummary(notes)!;
    expect(s.long).toBe(true);
    expect(s.short).toBe("Rechnungen der letzten Monate je Marke, z. B. vom Großhändler, sammeln und hochladen.");
    expect(s.effect).toBeNull();
  });

  it("sehr langer erster Satz wird an einer Wortgrenze gekürzt", () => {
    const notes = `${"Sehr lange Beschreibung ohne Punkt ".repeat(8)}Ende`;
    const s = noteSummary(notes, 60)!;
    expect(s.short.length).toBeLessThanOrEqual(62);
    expect(s.short.endsWith(" …")).toBe(true);
    expect(s.short).not.toMatch(/\s{2}/);
  });

  it("Betrag im ersten Satz wird nicht doppelt als Wirkung gezeigt", () => {
    const notes = `Offene Erstattung über 49,90 € beim Lieferanten anfordern. ${"Weitere Hinweise zum Ablauf. ".repeat(5)}`;
    const s = noteSummary(notes)!;
    expect(s.short).toContain("49,90 €");
    expect(s.effect).toBeNull();
  });
});

describe("noteSummary – Wirkung", () => {
  it("Beträge aus anderen Sätzen gelten nicht als Wirkung", () => {
    const notes = `Listing überarbeiten und Bilder tauschen. ${"Danach Preis prüfen. ".repeat(4)}Versand kostet 4,90 €.`;
    expect(noteSummary(notes)!.effect).toBeNull();
  });
});
