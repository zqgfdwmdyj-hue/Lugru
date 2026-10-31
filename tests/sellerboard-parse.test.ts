import { describe, expect, it } from "vitest";
import { dayOf, mapFixCosts, mapInventory, mapMonths, mapProduct, mapShipments, mapSkuRows, parseToolText, reorderNow, shipmentShortages } from "@/lib/sellerboard/parse";

// sellerboard-Connector: Antworten auswerten. Fiktive Daten.

describe("parseToolText", () => {
  it("liest den JSON-Teil nach der Textzeile", () => {
    expect(parseToolText('products: success (total: 2).\n{"status":"success","total":2}')).toEqual({ status: "success", total: 2 });
    expect(parseToolText('{"status":"preparing"}')).toEqual({ status: "preparing" });
  });
  it("ohne JSON: Fehler mit der ersten Zeile", () => {
    expect(() => parseToolText("Not cancelled: report finished")).toThrow(/Not cancelled/);
  });
});

describe("Produkte und Bestand", () => {
  it("EK 0 = nicht hinterlegt (null), sonst netto übernommen", () => {
    expect(mapProduct({ ProductID: "a", SKU: "X-1", Cost: 6.3 })?.cost).toBe(6.3);
    expect(mapProduct({ ProductID: "a", SKU: "X-1", Cost: 0 })?.cost).toBeNull();
    expect(mapProduct({ ProductID: "a", SKU: "" })).toBeNull();
  });
  it("reserviert = Kundenbestellungen + Umlagerung + Bearbeitung", () => {
    const r = mapInventory({ ProductID: "i", SKU: "X-1", FBAStock: 40, Reserved: 1, reserved_customerorders: 2, reserved_fc_transfers: 1, reserved_fc_processing: 0, SentToFBA: 10, TimeToReorder: "YES", QtyToReorder: 120, DaysToReorder: -5 })!;
    expect([r.fbaStock, r.reserved, r.inbound, r.qtyToReorder, r.daysToReorder]).toEqual([40, 3, 10, 120, -5]);
    expect(mapInventory({ ProductID: "i", SKU: "X-2", Reserved: 4 })!.reserved).toBe(4);
  });
  it("Sammelaufgabe nur für „jetzt“ mit Menge", () => {
    expect(reorderNow([{ timeToReorder: "YES", qtyToReorder: 5 }, { timeToReorder: "SOON", qtyToReorder: 5 }, { timeToReorder: "YES", qtyToReorder: 0 }])).toHaveLength(1);
  });
});

describe("FBA-Sendungen", () => {
  const reply = {
    products: [{ ProductID: "p1", SKU: "A", fnsku: "XA", ASIN: "B1", Name: "A" }],
    result: [{ number: "PLAN", status: "SHIPPED", shipments: [{ id: "s1", amazonId: "FBA1", status: "closed", date: 1790000000, last_update_date: 1790500000, products: [{ id: "p1", Units: 10, UnitsReceived: 8 }, { id: "unbekannt", Units: 3 }] }] }],
  };
  it("Pläne → Sendungen mit SKU-Zeilen (unbekannte Produkte weggelassen)", () => {
    const [s] = mapShipments(reply);
    expect(s).toMatchObject({ sbId: "s1", amazonId: "FBA1", status: "CLOSED", lines: [{ sku: "A", fnsku: "XA", units: 10, received: 8 }] });
    expect(s.createdOn).toBe(dayOf(1790000000));
  });
  it("Fehlmenge nur bei abgeschlossener bzw. seit der Wartezeit ruhiger Sendung", () => {
    const lines = [{ units: 10, received: 8 }, { units: 5, received: 5 }];
    expect(shipmentShortages({ status: "CLOSED", lastUpdate: "2026-10-20", lines }, "2026-10-26", 30).map((l) => l.missing)).toEqual([2]);
    expect(shipmentShortages({ status: "RECEIVING", lastUpdate: "2026-10-20", lines }, "2026-10-26", 30)).toEqual([]);
    expect(shipmentShortages({ status: "RECEIVING", lastUpdate: "2026-09-01", lines }, "2026-10-26", 30)).toHaveLength(1);
    expect(shipmentShortages({ status: "WORKING", lastUpdate: "2026-01-01", lines }, "2026-10-26", 30)).toEqual([]);
  });
});

describe("Monatswerte, Gewinn je SKU, Fixkosten", () => {
  it("Monate aus dashboard_period", () => {
    const m = mapMonths({ result: [{ start: 1788220800, has_data: true, data: { Info: { Sales: 100, Units: 5, NetProfit: 12.5, AmazonFees: -30, Expenses: -10 } } }, { start: 1790812800, has_data: false }] }, (u) => new Date(u * 1000).toISOString().slice(0, 7));
    expect(m).toEqual([expect.objectContaining({ month: "2026-09", sales: 100, units: 5, netProfit: 12.5, amazonFees: -30, expenses: -10 })]);
  });
  it("SKU-Zeilen aus dashboard_table", () => {
    expect(mapSkuRows({ result: [{ Info: { SKU: "A", Units: 3, Sales: 30, NetProfit: -1 } }, { Info: {} }] })).toEqual([{ sku: "A", asin: null, name: null, units: 3, sales: 30, netProfit: -1 }]);
  });
  it("Fixkosten: je Posten der letzte Betrag, Ausgabe negativ, Vergangenes Einmaliges weg", () => {
    const u = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
    const out = mapFixCosts(
      [
        { id: "m_20260801", Name: "Miete", Type: "Monthly", OperDate: u("2026-08-01"), Sum: 300, begindate: u("2026-01-01"), enddate: -62135596800 },
        { id: "m_20260901", Name: "Miete", Type: "Monthly", OperDate: u("2026-09-01"), Sum: 320, begindate: u("2026-01-01"), enddate: -62135596800 },
        { id: "alt_20260101", Name: "Beendet", Type: "Monthly", OperDate: u("2026-01-01"), Sum: 10, begindate: u("2025-01-01"), enddate: u("2026-02-01") },
        { id: "x_20260310", Name: "Messe", Type: "OneTime", OperDate: u("2026-03-10"), Sum: 500 },
        { id: "y_20261201", Name: "Messe neu", Type: "OneTime", OperDate: u("2026-12-01"), Sum: 200 },
        { id: "f_20261101", Name: "Prognose", Type: "Monthly", OperDate: u("2026-11-01"), Sum: 5, Forecast: true },
      ],
      "2026-10-26",
    );
    // sortiert nach Name („Messe neu“ vor „Miete“)
    expect(out.map((c) => [c.ref, c.amount, c.recurrence, c.start])).toEqual([
      ["y", -200, "none", "2026-12-01"],
      ["m", -320, "monthly", "2026-01-01"],
    ]);
  });
});
