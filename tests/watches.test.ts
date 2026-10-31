import { describe, expect, it } from "vitest";
import { filterDeals } from "@/lib/watches/logic";

// Übungs-Deals (nur auf dem Papier) zählen nirgends mit – erfundene Deals.
const d = (status: string, practice = false) => ({ status, practice });
const deals = [d("verworfen", true), d("verworfen"), d("gekauft"), d("verkauft"), d("beobachtet", true)];

describe("Uhren-Deals: Übungsdaten getrennt", () => {
  it("standardmäßig ohne Übungs-Deals – auch nicht unter „Verworfen“", () => {
    expect(filterDeals(deals, "verworfen")).toEqual([d("verworfen")]);
    expect(filterDeals(deals, "offen")).toEqual([d("gekauft")]);
    expect(filterDeals(deals, "alle")).toHaveLength(3);
  });
  it("eingeblendet bzw. Filter „Übung“", () => {
    expect(filterDeals(deals, "verworfen", true)).toHaveLength(2);
    expect(filterDeals(deals, "alle", true)).toHaveLength(5);
    expect(filterDeals(deals, "uebung")).toEqual([d("verworfen", true), d("beobachtet", true)]);
  });
});
