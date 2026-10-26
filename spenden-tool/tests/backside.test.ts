import { describe, expect, it } from "vitest";
import { backsideCandidates, sameProduct } from "@/lib/backside";

const row = (itemId: string, name: string, variant: string | null = null, extra: Partial<{ side: string; distinctFrom: string[]; hasPhoto: boolean }> = {}) => ({ itemId, productId: `p-${itemId}`, name, variant, hasPhoto: true, ...extra });

describe("Vorder- und Rückseite erkennen", () => {
  it("gleicher oder enthaltener Name", () => {
    expect(sameProduct({ name: "DreamWorks Dragons", variant: null }, { name: "DreamWorks Dragons", variant: null })).toBe("gleicher Name");
    expect(sameProduct({ name: "Funny-frisch Jumpys Paprika", variant: "75 g" }, { name: "Funny Frisch Jumpys", variant: null })).toBe("Name enthalten");
  });
  it("verschiedene Produkte bleiben getrennt", () => {
    expect(sameProduct({ name: "Getrocknete Tomaten", variant: "2 kg" }, { name: "Getrocknete Tomaten", variant: "5 kg" })).toBeNull();
    expect(sameProduct({ name: "Wiberg Paprika edelsüß", variant: null }, { name: "Wiberg Chili-Fäden", variant: null })).toBeNull();
    expect(sameProduct({ name: "Fondant-Mischung mit Bitterschokolade", variant: "100 g" }, { name: "Funny-frisch Jumpys Paprika", variant: "75 g" })).toBeNull();
    expect(sameProduct({ name: "Neues Produkt", variant: null }, { name: "Neues Produkt", variant: null })).toBeNull();
    expect(sameProduct({ name: "Haferflocken", variant: null }, { name: "Haferflocken zart", variant: null })).toBeNull();
  });
  it("Paare: Vorderseite hat mehr Angaben oder laut KI „vorne“; „verschieden“ wird beachtet", () => {
    const rows = [row("a", "Funny Frisch Jumpys"), row("b", "Funny-frisch Jumpys Paprika", "75 g"), row("c", "Furby Connect"), row("d", "DreamWorks Dragons", null, { side: "hinten" }), row("e", "DreamWorks Dragons")];
    expect(backsideCandidates(rows)).toEqual([
      { front: "b", back: "a", reason: "Name enthalten" },
      { front: "e", back: "d", reason: "gleicher Name, KI: Rückseite" },
    ]);
    expect(backsideCandidates([row("a", "Furby Connect", null, { distinctFrom: ["p-b"] }), row("b", "Furby Connect")])).toEqual([]);
  });
});
