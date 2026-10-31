import { describe, expect, it } from "vitest";
import { kaufZuDeal, type EigenerKauf } from "@/lib/lugru-deals/auswertung-logic";

// Eigene Käufe zu Lugru-Deals: gleiche ASIN, bis 14 Tage nach dem Post. Chargen kennen nur das Kaufdatum.
// Erfundene ASINs.

const deal = { asin: "B0TESTKAUF", gepostetAm: new Date("2026-10-10T18:30:00Z") }; // 20:30 Berlin
const charge = (tag: string, asin = "B0TESTKAUF"): EigenerKauf => ({ asin, am: new Date(`${tag}T12:00:00Z`), ref: `Charge X-${tag}`, nurTag: true });

describe("kaufZuDeal", () => {
  it("Charge am selben Tag zählt, obwohl ihr Datum vor der Uhrzeit des Posts liegt", () => {
    expect(kaufZuDeal(deal, [charge("2026-10-10")])?.ref).toBe("Charge X-2026-10-10");
  });

  it("Charge bis 14 Tage danach zählt, am 15. Tag nicht", () => {
    expect(kaufZuDeal(deal, [charge("2026-10-24")])).not.toBeNull();
    expect(kaufZuDeal(deal, [charge("2026-10-25")])).toBeNull();
  });

  it("Charge vom Vortag (Altbestand) zählt nicht", () => {
    expect(kaufZuDeal(deal, [charge("2026-10-09")])).toBeNull();
  });

  it("andere ASIN zählt nicht; Groß-/Kleinschreibung egal", () => {
    expect(kaufZuDeal(deal, [charge("2026-10-11", "B0ANDERE01")])).toBeNull();
    expect(kaufZuDeal(deal, [charge("2026-10-11", "b0testkauf")])).not.toBeNull();
  });

  it("Bestellung mit Uhrzeit: ab 1 Std. vor dem Post, frühester Treffer gewinnt", () => {
    const b = (iso: string, ref: string): EigenerKauf => ({ asin: "B0TESTKAUF", am: new Date(iso), ref });
    expect(kaufZuDeal(deal, [b("2026-10-10T17:00:00Z", "zu früh")])).toBeNull();
    expect(kaufZuDeal(deal, [b("2026-10-12T09:00:00Z", "später"), charge("2026-10-11"), b("2026-10-10T18:00:00Z", "kurz vorher")])?.ref).toBe("kurz vorher");
  });
});
