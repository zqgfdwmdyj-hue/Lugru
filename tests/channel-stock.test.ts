import { describe, expect, it } from "vitest";
import { availableOf, oversold, planSync, stockSkuOf, targetQuantity, type SyncListing } from "@/lib/stock/channel-logic";

const L = (over: Partial<SyncListing>): SyncListing => ({ id: "l1", channel: "ebay", sku: "LG-1", stockSku: null, status: "active", stockSync: true, maxQuantity: null, pushedQuantity: null, ...over });
const levels = new Map([
  ["SOCK-6", { sku: "SOCK-6", onHand: 10, reserved: 3 }],
  ["LG-1", { sku: "LG-1", onHand: 2, reserved: 0 }],
  ["OVER", { sku: "OVER", onHand: 1, reserved: 2 }],
]);

describe("Bestandsabgleich über Kanäle", () => {
  it("verfügbar = Lager − reserviert, nie negativ", () => {
    expect(availableOf(levels.get("SOCK-6"))).toBe(7);
    expect(availableOf(levels.get("OVER"))).toBe(0);
    expect(availableOf(undefined)).toBe(0);
  });

  it("Wawi-SKU: eigene Zuordnung vor Kanal-SKU", () => {
    expect(stockSkuOf({ sku: "LG-4006381333931-5", stockSku: "SOCK-6" })).toBe("SOCK-6");
    expect(stockSkuOf({ sku: "SOCK-6", stockSku: " " })).toBe("SOCK-6");
  });

  it("Deckel je Kanal", () => {
    expect(targetQuantity({ maxQuantity: 3 }, 7)).toBe(3);
    expect(targetQuantity({ maxQuantity: null }, 7)).toBe(7);
    expect(targetQuantity({ maxQuantity: 5 }, 2)).toBe(2);
  });

  it("alle Kanäle derselben Wawi-SKU bekommen dieselbe Menge", () => {
    const plan = planSync(
      [
        L({ id: "e", channel: "ebay", sku: "LG-9", stockSku: "SOCK-6", pushedQuantity: 10 }),
        L({ id: "a", channel: "amazon", sku: "SOCK-6", pushedQuantity: 10 }),
        L({ id: "t", channel: "temu", sku: "TEMU-77", stockSku: "SOCK-6", pushedQuantity: 7 }),
      ],
      levels,
    );
    expect(plan).toEqual([
      { listingId: "e", action: "push", target: 7, stockSku: "SOCK-6" },
      { listingId: "a", action: "push", target: 7, stockSku: "SOCK-6" },
      { listingId: "t", action: "none", target: 7, stockSku: "SOCK-6" },
    ]);
  });

  it("lässt Entwürfe, abgeschaltete und unbekannte SKUs in Ruhe (kein versehentliches 0)", () => {
    const plan = planSync(
      [
        L({ id: "d", status: "draft" }),
        L({ id: "o", stockSync: false }),
        L({ id: "u", sku: "UNBEKANNT" }),
      ],
      levels,
    );
    expect(plan.map((p) => (p.action === "skip" ? p.reason : p.action))).toEqual(["nicht aktiv", "Abgleich aus", "kein Wawi-Bestand"]);
  });

  it("Überverkauf erkennen", () => {
    expect(oversold(levels.values()).map((l) => l.sku)).toEqual(["OVER"]);
  });

});
