import { describe, expect, it } from "vitest";
import { detectReport, mergeRemovalOrders, parseRemovalOrders } from "@/lib/reports/amazon";
import { readTable } from "@/lib/tabular";

// Bericht „Remissionsaufträge (Details)“: Amazon führt Einheiten desselben Auftrags + SKU + Zustand mit
// unterschiedlicher Gebühr in eigenen Zeilen. Vorher brach der Import ab („ON CONFLICT … a second time“).
const KOPF = "request-date\torder-id\torder-source\torder-type\tservice-speed\torder-status\tlast-updated-date\tsku\tfnsku\tdisposition\trequested-quantity\tcancelled-quantity\tdisposed-quantity\tshipped-quantity\tin-process-quantity\tremoval-fee\tcurrency";
const zeile = (o: string, sku: string, disp: string, status: string, upd: string, fee: string) => `2026-09-01T10:00:00+00:00\t${o}\t\tReturn\tStandard\t${status}\t${upd}\t${sku}\tX00TEST001\t${disp}\t1\t0\t0\t1\t0\t${fee}\tEUR`;
const datei = [KOPF, zeile("TESTREM1", "TEST-SOCKEN", "Sellable", "Pending", "2026-09-02T08:00:00+00:00", "0.50"), zeile("TESTREM1", "TEST-SOCKEN", "Sellable", "Completed", "2026-09-05T08:00:00+00:00", "0.75"), zeile("TESTREM1", "TEST-SOCKEN", "Unsellable", "Completed", "2026-09-05T08:00:00+00:00", "0.50"), zeile("TESTREM2", "TEST-TASSE", "Sellable", "Completed", "2026-09-03T08:00:00+00:00", "")].join("\r\n");

describe("Remissionsaufträge: gleiche Zeilen zusammenfassen", () => {
  const t = readTable(new TextEncoder().encode(datei));
  it("wird als Remissionsaufträge erkannt, alle 4 Zeilen gelesen", () => {
    expect(detectReport(t)).toBe("removalOrders");
    expect(parseRemovalOrders(t)).toHaveLength(4);
  });
  it("Auftrag + SKU + Zustand je einmal; Mengen und Gebühren addiert, Status vom neuesten Stand", () => {
    const m = mergeRemovalOrders(parseRemovalOrders(t));
    expect(m).toHaveLength(3);
    const a = m.find((x) => x.orderId === "TESTREM1" && x.disposition === "Sellable")!;
    expect(a).toMatchObject({ requestedQuantity: 2, shippedQuantity: 2, removalFee: 1.25, orderStatus: "Completed", lastUpdated: "2026-09-05" });
    expect(m.find((x) => x.orderId === "TESTREM2")!.removalFee).toBeNull();
  });
  it("Zeilen ohne Doppel bleiben unverändert", () => {
    const p = parseRemovalOrders(t).filter((x) => x.orderId === "TESTREM2");
    expect(mergeRemovalOrders(p)).toEqual(p);
  });
});
