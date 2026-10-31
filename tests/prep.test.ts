import { describe, expect, it } from "vitest";
import { decideShipper, monthsBack, parseMonthParam, prepCsv, prepExplain, prepSummary, type PrepRow } from "@/lib/shipping/prep";

// Prep Center – erfundene Aufträge.
const row = (units: number, product: string, over: Partial<PrepRow> = {}): PrepRow => ({ orderId: "o", externalId: "399-1", channel: "Amazon", day: "2026-10-28", name: "Erika Test", place: "12345 Ort", units, items: `${units}× Testsocken`, product, tracking: null, status: "Versendet", ...over });

describe("Wer verschickt", () => {
  it("alle Artikel im Prep Center → Prep Center; einer bei mir → ich; nichts festgelegt → Vorgabe", () => {
    expect(decideShipper([{ shipFrom: "prep" }, { shipFrom: "prep" }], "self")).toBe("prep");
    expect(decideShipper([{ shipFrom: "prep" }, { shipFrom: "self" }], "prep")).toBe("self");
    expect(decideShipper([{ shipFrom: null }], "prep")).toBe("prep");
    expect(decideShipper([{ shipFrom: "prep" }, { shipFrom: null }], "self")).toBe("self");
  });
});

describe("Monatsübersicht", () => {
  it("Sendungen, Stück, je Versandart", () => {
    const s = prepSummary([row(1, "Warensendung"), row(2, "DHL Paket"), row(3, "DHL Paket")], { feeShipment: 0, feeExtraItem: 0 });
    expect(s).toMatchObject({ shipments: 3, units: 6, expected: null });
    expect(s.byProduct[0]).toEqual({ product: "DHL Paket", shipments: 2, units: 5 });
  });
  it("erwartete Kosten: je Sendung + je weiteres Stück", () => {
    expect(prepSummary([row(1, "Warensendung"), row(3, "DHL Paket")], { feeShipment: 1.5, feeExtraItem: 0.2 }).expected).toBe(3.4);
  });
  it("CSV mit Semikolon, Datum deutsch, Sonderzeichen geschützt", () => {
    const csv = prepCsv([row(2, "DHL Paket", { name: "Test; GmbH", tracking: "00340434" })]);
    expect(csv.startsWith("\uFEFFDatum;Kanal;Bestellnummer")).toBe(true);
    expect(csv).toContain('28.10.2026;Amazon;399-1;"Test; GmbH";12345 Ort;2;2× Testsocken;DHL Paket;00340434;Versendet');
  });
  it("Monat aus der Adresse", () => {
    expect(parseMonthParam("2026-09", "2026-10-28")).toBe("2026-09");
    expect(parseMonthParam("2026-13", "2026-10-28")).toBe("2026-10");
  });
});

describe("Prep Center: Monate und Erklärung für den Assistenten", () => {
  it("monthsBack über den Jahreswechsel", () => {
    expect(monthsBack("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBack("2026-10", 1)).toEqual(["2026-10"]);
  });
  it("Erklärung nennt Gebühren, Standard-Versender und die Abgrenzung zum Palettenlager", () => {
    const t = prepExplain({ name: "Test-Prep", defaultShipper: "prep", feeShipment: 2.5, feeExtraItem: 0.5 });
    expect(t).toContain("2,50 € je Sendung + 0,50 € je weiteres Stück");
    expect(t).toContain("sonst Standard = Test-Prep");
    expect(t).toContain("Palettenlager");
    expect(prepExplain({ name: "", defaultShipper: "self", feeShipment: 0, feeExtraItem: 0 })).toContain("noch keine Gebühren hinterlegt");
  });
});
