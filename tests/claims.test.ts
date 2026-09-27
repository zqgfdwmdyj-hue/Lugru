import { describe, expect, it } from "vitest";
import { detectClaims, type ClaimData } from "@/lib/claims/rules";
import { CLAIM_TYPES, type ClaimType } from "@/db/schema";

const windowDays = Object.fromEntries(
  CLAIM_TYPES.map((t) => [t, 60]),
) as Record<ClaimType, number>;
const settings = { windowDays, minAmount: 1 };
const today = "2026-09-27";

const base = (): ClaimData => ({
  adjustments: [],
  receipts: [],
  reimbursements: [],
  returnClaims: [],
  removals: [],
  inbound: [],
  costBySku: new Map([["SKU-1", 10]]),
  costByAsin: new Map(),
  asinBySku: new Map([["SKU-1", "B0TEST0001"]]),
});

const adj = (date: string, qty: number, reason: string, i = 0) => ({
  rowHash: `h${date}${reason}${i}`,
  date,
  sku: "SKU-1",
  fnsku: "X001TEST01",
  asin: "B0TEST0001",
  quantity: qty,
  reason,
  fulfillmentCenter: "DTM2",
  referenceId: `R${i}`,
});

const reimb = (over: Partial<ClaimData["reimbursements"][number]>) => ({
  reimbursementId: "RB1",
  date: "2026-08-01",
  reason: "Lost_Warehouse",
  sku: "SKU-1",
  fnsku: "X001TEST01",
  orderId: null,
  caseId: null,
  amountPerUnit: 10,
  amountTotal: 10,
  quantityCash: 1,
  quantityTotal: 1,
  ...over,
});

describe("detectClaims", () => {
  it("verloren minus gefunden minus erstattet", () => {
    const d = base();
    d.adjustments = [adj("2026-07-01", -3, "M", 1), adj("2026-07-10", 1, "F", 2)];
    d.reimbursements = [reimb({})];
    const c = detectClaims(d, settings, today);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ type: "lost_warehouse", quantity: 1, expectedAmount: 10, deadline: "2026-08-30" });
  });

  it("wartet die Karenzzeit ab", () => {
    const d = base();
    d.adjustments = [adj("2026-09-20", -1, "M")];
    expect(detectClaims(d, settings, today)).toHaveLength(0);
  });

  it("Beschädigung durch Amazon, Kundenschäden zählen nicht", () => {
    const d = base();
    d.adjustments = [adj("2026-07-01", -2, "E"), adj("2026-07-01", -5, "H", 1)];
    const c = detectClaims(d, settings, today);
    expect(c.map((x) => [x.type, x.quantity])).toEqual([["damaged_warehouse", 2]]);
  });

  it("Entsorgung ohne Auftrag – mit Auftrag nicht", () => {
    const d = base();
    d.adjustments = [adj("2026-07-01", -1, "D", 1), adj("2026-08-01", -1, "D", 2)];
    d.removals = [
      { orderId: "R9", orderType: "Disposal", orderStatus: "Completed", requestDate: "2026-07-30", lastUpdated: null, sku: "SKU-1", fnsku: null, requestedQuantity: 1, cancelledQuantity: 0, disposedQuantity: 1, shippedQuantity: 0, inProcessQuantity: 0, receivedQuantity: null },
    ];
    const c = detectClaims(d, settings, today);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ type: "disposed_without_order", eventDate: "2026-07-01" });
  });

  it("unter EK erstattet", () => {
    const d = base();
    d.reimbursements = [reimb({ amountPerUnit: 4.1, amountTotal: 4.1 })];
    const c = detectClaims(d, settings, today);
    expect(c[0]).toMatchObject({ type: "reimbursed_below_cost", expectedAmount: 5.9 });
  });

  it("Retouren-Abgleich: mit EK bewertet, ohne EK mit dem erstatteten Betrag", () => {
    const d = base();
    const claim = (sku: string) => ({ key: `retnr:302-1:${sku}`, type: "return_not_received" as const, title: "t", sku, quantity: 2, refundValue: 49.8, moneyOnly: false, reference: "302-1", eventDate: "2026-07-01", evidence: [] });
    d.returnClaims = [claim("SKU-1"), claim("SKU-X")];
    const c = detectClaims(d, settings, today);
    expect(c.map((x) => [x.sku, x.expectedAmount, x.deadline])).toEqual([
      ["SKU-1", 20, "2026-08-30"],
      ["SKU-X", 49.8, "2026-08-30"],
    ]);
  });

  it("Remission: Differenz zwischen versendet und angekommen", () => {
    const d = base();
    d.removals = [
      { orderId: "R1", orderType: "Return", orderStatus: "Completed", requestDate: "2026-09-01", lastUpdated: "2026-09-20", sku: "SKU-1", fnsku: null, requestedQuantity: 5, cancelledQuantity: 0, disposedQuantity: 0, shippedQuantity: 5, inProcessQuantity: 0, receivedQuantity: 3 },
    ];
    expect(detectClaims(d, settings, today)[0]).toMatchObject({ type: "removal_incomplete", quantity: 2 });
  });

  it("Wareneingang: gescannt minus eingebucht", () => {
    const d = base();
    d.inbound = [{ id: "s1", name: "KW 30", amazonShipmentId: "FBA1", shippedAt: "2026-07-20", items: [{ sku: "SKU-1", fnsku: "X001TEST01", asin: "B0TEST0001", scanned: 48 }] }];
    d.receipts = [{ referenceId: "FBA1", fnsku: "X001TEST01", sku: "SKU-1", quantity: 45, date: "2026-07-25" }];
    expect(detectClaims(d, settings, today)[0]).toMatchObject({ type: "inbound_shortage", quantity: 3, expectedAmount: 30 });
  });

  it("Kleinstbeträge werden ignoriert", () => {
    const d = base();
    d.costBySku.set("SKU-1", 0.5);
    d.adjustments = [adj("2026-07-01", -1, "M")];
    expect(detectClaims(d, settings, today)).toHaveLength(0);
  });
});
