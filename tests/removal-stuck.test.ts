import { describe, expect, it } from "vitest";
import { detectClaims, removalParcels, type ClaimData } from "@/lib/claims/rules";
import { aiCaseTextPrompt, claimCaseText } from "@/lib/claims/texts";
import { CLAIM_TYPES, type ClaimType } from "@/db/schema";

const windowDays = { ...(Object.fromEntries(CLAIM_TYPES.map((t) => [t, 60])) as Record<ClaimType, number>), removal_shipment_stuck: 75 };
const settings = { windowDays, minAmount: 1, problemCarriers: "TENDRON, xyz" };

const order = (over: Partial<ClaimData["removals"][number]> = {}) => ({
  orderId: "RM-100", orderType: "Return", orderStatus: "Completed", requestDate: "2026-08-01", lastUpdated: "2026-08-10", sku: "SKU-1", fnsku: "X001A",
  requestedQuantity: 5, cancelledQuantity: 0, disposedQuantity: 0, shippedQuantity: 5, inProcessQuantity: 0, receivedQuantity: null, ...over,
});
const ship = (over: Partial<NonNullable<ClaimData["removalShipments"]>[number]> = {}) => ({
  orderId: "RM-100", requestDate: "2026-08-01", shipmentDate: "2026-08-05", sku: "SKU-1", fnsku: "X001A", quantity: 3, carrier: "TENDRON", trackingNumber: "123456789", ...over,
});
const base = (): ClaimData => ({
  adjustments: [], receipts: [], reimbursements: [], returnClaims: [], inbound: [],
  removals: [order(), order({ sku: "SKU-2", fnsku: "X002B", shippedQuantity: 2, requestedQuantity: 2 })],
  removalShipments: [ship(), ship({ sku: "SKU-2", fnsku: "X002B", quantity: 2 }), ship({ quantity: 2, carrier: "DHL", trackingNumber: "00340434" })],
  removalShipmentMarks: [],
  costBySku: new Map([["SKU-1", 4], ["SKU-2", 6]]), costByAsin: new Map(), asinBySku: new Map(),
});
const stuck = (d: ClaimData, today: string) => detectClaims(d, settings, today).filter((c) => c.type === "removal_shipment_stuck");

describe("hängende Remissionssendungen (TENDRON)", () => {
  it("fasst Pakete je Auftrag + Sendungsnummer zusammen", () => {
    const p = removalParcels(base(), ["tendron"], 75);
    expect(p).toHaveLength(2);
    const t = p.find((x) => x.trackingNumber === "123456789")!;
    expect(t).toMatchObject({ problemCarrier: true, quantity: 5, claimFrom: "2026-08-16", claimUntil: "2026-10-15" });
    expect(t.lines).toEqual([{ sku: "SKU-1", fnsku: "X001A", quantity: 3 }, { sku: "SKU-2", fnsku: "X002B", quantity: 2 }]);
  });

  it("erst ab Tag 15 nach Auftrag, Frist Tag 75", () => {
    expect(stuck(base(), "2026-08-15")).toHaveLength(0);
    const c = stuck(base(), "2026-08-16");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: "removal-ship:RM-100:123456789", quantity: 5, expectedAmount: 24, deadline: "2026-10-15", reference: "RM-100" });
  });

  it("Paket muss mindestens 10 Tage unterwegs sein", () => {
    const d = base();
    d.removalShipments = [ship({ shipmentDate: "2026-08-20" })];
    expect(stuck(d, "2026-08-25")).toHaveLength(0);
    expect(stuck(d, "2026-08-30")).toHaveLength(1);
  });

  it("andere Versender nur, wenn selbst als fehlend markiert – ebenfalls ab Tag 15", () => {
    const d = base();
    d.removalShipments = [ship({ quantity: 2, carrier: "DHL", trackingNumber: "00340434", shipmentDate: "2026-08-14" })];
    d.removalShipmentMarks = [{ orderId: "RM-100", trackingNumber: "00340434", status: "lost" }];
    expect(stuck(d, "2026-08-10")).toHaveLength(0);
    const c = stuck(d, "2026-08-16");
    expect(c.map((x) => x.key)).toEqual(["removal-ship:RM-100:00340434"]);
  });

  it("kein Anspruch, wenn angekommen markiert oder Eingang bestätigt", () => {
    const d = base();
    d.removalShipmentMarks = [{ orderId: "RM-100", trackingNumber: "123456789", status: "received" }];
    expect(stuck(d, "2026-09-01")).toHaveLength(0);
    const e = base();
    e.removals = e.removals.map((o) => ({ ...o, receivedQuantity: o.shippedQuantity }));
    expect(stuck(e, "2026-09-01")).toHaveLength(0);
  });

  it("Fall-Text enthält Auftrag, Versender, Sendungsnummer und FNSKUs", () => {
    const [c] = stuck(base(), "2026-09-01");
    const text = claimCaseText(c);
    expect(text).toContain("RM-100");
    expect(text).toContain("TENDRON");
    expect(text).toContain("123456789");
    expect(text).toContain("X001A × 3, X002B × 2");
    expect(aiCaseTextPrompt(c, "en")).toContain("auf Englisch");
  });
});

describe("Bericht Remissionssendungen: Stichwort Tendron", () => {
  it("erkennt Tendron auch außerhalb der Versender-Spalte und deutsche Spalten", async () => {
    const { detectReport, parseRemovalShipments } = await import("@/lib/reports/amazon");
    const de = {
      headers: ["Anforderungsdatum", "Auftragsnummer", "Versanddatum", "Händler-SKU", "FNSKU", "Zustand", "Versandte Menge", "Versandunternehmen", "Sendungsnummer", "Art des Remissionsauftrags"],
      rows: [
        ["2026-08-01", "RM-7", "2026-08-03", "SKU-1", "X001A", "Sellable", "3", "", "123456789", "Return via Tendron Logistics"],
        ["2026-08-01", "RM-8", "2026-08-03", "SKU-1", "X001A", "Sellable", "1", "DHL", "00340434", "Return"],
      ],
    };
    expect(detectReport(de)).toBe("removalShipments");
    const rows = parseRemovalShipments(de);
    expect(rows[0]).toMatchObject({ orderId: "RM-7", carrier: "TENDRON", trackingNumber: "123456789", fnsku: "X001A", shippedQuantity: 3 });
    expect(rows[1].carrier).toBe("DHL");
  });

  it("Stichwort trifft auch in der Sendungsnummer", () => {
    const d = base();
    d.removalShipments = [ship({ carrier: "", trackingNumber: "TENDRON-123456789" })];
    expect(stuck(d, "2026-09-01")).toHaveLength(1);
  });
});
