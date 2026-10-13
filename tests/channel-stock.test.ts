import { describe, expect, it } from "vitest";
import { availableOf, oversold, planSync, setsContaining, stockSkuOf, targetQuantity, withSets, type SyncListing } from "@/lib/stock/channel-logic";

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

describe("Sets (Komplettset aus Einzelsorten)", () => {
  const lvl = (sku: string, onHand: number, reserved = 0) => [sku, { sku, onHand, reserved }] as const;
  const set = { sku: "SET-1", components: [{ sku: "A", qty: 1 }, { sku: "B", qty: 1 }, { sku: "C", qty: 2 }] };

  it("verfügbar = was sich aus den freien Einzelsorten bilden lässt", () => {
    const out = withSets(new Map([lvl("A", 5), lvl("B", 3, 1), lvl("C", 9)]), new Map(), [set]);
    expect(out.get("SET-1")).toEqual({ sku: "SET-1", onHand: 2, reserved: 0 }); // B: 3 − 1 = 2
  });
  it("offene Set-Bestellungen reservieren die Einzelsorten", () => {
    const out = withSets(new Map([lvl("A", 5), lvl("B", 3), lvl("C", 9)]), new Map([["SET-1", 2]]), [set]);
    expect(out.get("A")!.reserved).toBe(2);
    expect(out.get("C")!.reserved).toBe(4);
    expect(out.get("SET-1")!.onHand).toBe(1); // B: 3 − 2 = 1; C: (9 − 4) / 2 = 2
    // Überverkauf zeigt sich an der Einzelsorte
    expect(oversold(withSets(new Map([lvl("A", 1), lvl("B", 3), lvl("C", 9)]), new Map([["SET-1", 2]]), [set]).values()).map((l) => l.sku)).toEqual(["A"]);
  });
  it("ohne Bestand einer Einzelsorte kein Stand (kein Abgleich); fertig gepackte Sets bleiben normale SKUs", () => {
    expect(withSets(new Map([lvl("A", 5), lvl("B", 3)]), new Map(), [set]).has("SET-1")).toBe(false);
    expect(withSets(new Map([lvl("A", 5), lvl("B", 3), lvl("C", 9), lvl("SET-1", 7)]), new Map([["SET-1", 1]]), [set]).get("SET-1")).toEqual({ sku: "SET-1", onHand: 7, reserved: 0 });
  });
  it("ändert sich eine Einzelsorte, wird auch das Set abgeglichen", () => {
    expect(setsContaining([set, { sku: "SET-2", components: [{ sku: "X", qty: 1 }] }], ["B"])).toEqual(["SET-1"]);
  });
});
