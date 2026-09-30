import { describe, expect, it } from "vitest";
import { parseContentLine, shoppingList, shoppingText } from "@/lib/suppliers/shopping";

const comp = (o: Partial<Parameters<typeof shoppingList>[0][number]>) => ({ offerId: "o", qty: 1, title: "T", unitCost: 1, caseQty: 12, casePrice: 10, url: "https://s/p", supplierSku: "sku", feedId: "f", feedName: "candy hero", ...o });

describe("Einkaufsliste für Boxen", () => {
  it("liest Inhaltszeilen", () => {
    expect(parseContentLine("1× Warheads Extreme Sour Hard Candy (12 x 28g) (je 0,79 €)")).toEqual({ qty: 1, title: "Warheads Extreme Sour Hard Candy (12 x 28g)" });
    expect(parseContentLine("3x Nerds")).toEqual({ qty: 3, title: "Nerds" });
    expect(parseContentLine("Nerds")).toBeNull();
  });
  it("rechnet ganze Kartons je Lieferant", () => {
    const l = shoppingList([comp({ offerId: "a", qty: 1, caseQty: 12, casePrice: 10.5 }), comp({ offerId: "b", qty: 2, caseQty: 24, casePrice: 20, feedName: "x" })], 20);
    expect(l.rows[0]).toMatchObject({ unitsNeeded: 20, cases: 2, orderUnits: 24, cost: 21 });
    expect(l.rows[1]).toMatchObject({ unitsNeeded: 40, cases: 2, orderUnits: 48, cost: 40 });
    expect(l.total).toBe(61);
    expect(l.bySupplier).toEqual({ "candy hero": 21, x: 40 });
    expect(shoppingText("Sauer", 20, l.rows).split("\n")[1]).toBe("2 Kartons – T [sku] – https://s/p");
  });
});
