import { describe, expect, it } from "vitest";
import { daysLeft, stockDiscrepancies } from "@/lib/stock/discrepancies";

// Bestandsabweichungen (Claude-Werkzeug „bestandsabweichungen“) – erfundene SKUs und Sendungen.

const base = { today: "2026-10-28", shipments: [], countLines: [], ownStock: [], amazon: [], mapping: [] };

describe("Bestandsabweichungen", () => {
  it("FBA-Sendung: abgeschlossen mit Fehlmenge; laufende Annahme erst nach Wartezeit", () => {
    const r = stockDiscrepancies({
      ...base,
      shipments: [
        { name: "Sendung A", amazonId: "FBA1TEST", status: "CLOSED", lastUpdate: "2026-10-20", lines: [{ sku: "T-1", name: "Testkabel", units: 50, received: 47 }, { sku: "T-2", name: "Testbox", units: 10, received: 10 }] },
        { name: "Sendung B", amazonId: "FBA2TEST", status: "RECEIVING", lastUpdate: "2026-10-25", lines: [{ sku: "T-3", name: "Testlampe", units: 20, received: 5 }] },
        { name: "Sendung C", amazonId: "FBA3TEST", status: "RECEIVING", lastUpdate: "2026-10-01", lines: [{ sku: "T-4", name: "Testtasse", units: 8, received: 6 }] },
      ],
    });
    expect(r.map((d) => [d.kind, d.sku, d.expected, d.actual, d.diff])).toEqual([
      ["fba_sendung", "T-1", 50, 47, -3],
      ["fba_sendung", "T-4", 8, 6, -2],
    ]);
  });
  it("Inventur, negativer Bestand, Amazon-Klärung/unverkäuflich, Zuordnung – in fester Reihenfolge", () => {
    const r = stockDiscrepancies({
      ...base,
      countLines: [{ countId: "c1", countName: "Regal 1", sku: "T-5", expected: 12, counted: 9 }, { countId: "c1", countName: "Regal 1", sku: "T-6", expected: 4, counted: 4 }],
      ownStock: [{ sku: "T-7", quantity: -2 }, { sku: "T-8", quantity: 3 }],
      amazon: [{ sku: "T-9", title: "Testglas", unsellable: 2, researching: 1, unsellableSince: "2026-09-01" }],
      mapping: [
        { kind: "angebot-ohne-lager", sku: "T-10", title: null, detail: "ebay", href: "/produkte" },
        { kind: "ek-fehlt", sku: "T-11", title: null, detail: "3 im Lager", href: "/produkte" },
      ],
    });
    expect(r.map((d) => `${d.kind}:${d.sku}:${d.diff}`)).toEqual(["inventur:T-5:-3", "negativ:T-7:-2", "amazon_klaerung:T-9:-1", "amazon_unverkaeuflich:T-9:-2", "zuordnung:T-10:0"]);
    expect(r[0].href).toBe("/bestand/inventur/c1");
  });
  it("Tage bis zur Frist", () => {
    expect(daysLeft("2026-10-28", "2026-11-06")).toBe(9);
    expect(daysLeft("2026-10-28", "2026-10-20")).toBe(-8);
    expect(daysLeft("2026-10-28", null)).toBeNull();
  });
});
