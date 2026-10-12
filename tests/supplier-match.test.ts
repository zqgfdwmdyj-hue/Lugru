import { describe, expect, it } from "vitest";
import { matchIssue, pickTitleMatch, titleTokens } from "@/lib/suppliers/match";
import { sizeIssue } from "@/lib/suppliers/scan";
import { econOf } from "@/lib/suppliers/offer-econ";

// Titel-Treffer (ohne EAN): passt das Amazon-Angebot zum Artikel des Großhändlers?
// Beispiele nach Mustern aus echten Titelsuchen (öffentliche Produktnamen, keine Preise).

describe("Titel-Treffer prüfen", () => {
  it("anderes Produkt (Merchandise, Tierfutter, Getränk, Spiel, Buch)", () => {
    expect(matchIssue("Spongebob Squarepants Krabby Patties Sour (24 x 72g)", "SpongeBob SquarePants Krusty Krab Krabby Patties Ad T-Shirt")?.kind).toBe("produkt");
    expect(matchIssue("Chewits Juicy Bites Blue Raspberry (10 x 115g)", "INABA Juicy Bites, Katzen Leckerlies mit Huhn und Meeresfrüchte")?.kind).toBe("produkt");
    expect(matchIssue("Spree Original (12 x 142g)", "Spree Gin aus Berlin, 500ml Flasche Dry Gin")?.text).toMatch(/gin/);
    expect(matchIssue("Mario Coin Block Candies (12 x 32g)", "ThinkFun Logikspiel Super Mario Coin Collectors - Reisespiel")?.kind).toBe("produkt");
    expect(matchIssue("Dots Tropical (24 x 64g)", "Dot to Dot Tropical Island for Adults: Connect the Dots Book")?.kind).toBe("produkt");
  });

  it("andere Marke", () => {
    expect(matchIssue("Millions Shaker Strawberry (20 x 82g)", "HOLY Milkshake Pulver 'Strawberry' – 50 Portionen")?.kind).toBe("marke");
    expect(matchIssue("Swizzels Strawberry Tarts (576g)", "Kellogg's Pop Tarts Frosted Strawberry Sensation (8 Stk)")?.kind).toBe("marke");
    expect(matchIssue("Kidsmania Ooze Tubes (12 x 114g)", "TickiT Sensory Ooze Tube Set, 50 mm Diameter, 3 Pieces")).not.toBeNull();
  });

  it("andere Sorte derselben Marke", () => {
    expect(matchIssue("Jolly Rancher Ropes Blue Raspberry & Cherry (12 x 170g)", "Jolly Rancher Hard Candy, Awesome Reds, 13 oz")?.kind).toBe("sorte");
    expect(matchIssue("Ice Breakers Gum Ice Cubes Raspberry Sorbet (6 x 92g)", "ICE BREAKERS ICE CUBES Sugar Free Gum (Arctic Grape)")?.text).toMatch(/raspberry ↔ grape/);
    expect(matchIssue("Now & Later Tropical Punch (24 x 26g)", "Now and Later SOFT Grape")?.kind).toBe("sorte");
  });

  it("passt – auch bei deutschen Sorten, Schreibweisen und ohne Herstellernamen", () => {
    expect(matchIssue("Twizzlers Bites Cherry (24 x 453g)", "TWIZZLERS Licorice Candy Bites, Kirsche, 473 ml")).toBeNull();
    expect(matchIssue("Rowntree's Randoms (8 x 320g)", "Rowntree Random Gelee-Fruchtgummi-Mischung Tüte")).toBeNull();
    expect(matchIssue("Laffy Taffy Rope Blue Raspberry (24 x 23g)", "Laffy Taffy Blue Himbeer-Seil, 24 Stück")).toBeNull();
    expect(matchIssue("Laffy Taffy Rope Sour Apple (24 x 23g)", "Laffy Taffy Rope Candy, Saure Apple, 0,81 Unzen (24 Stück)")).toBeNull();
    expect(matchIssue("Millions Apple Tube (12 x 55g)", "Millionen Tubes Apfel 65 g (Packung mit 12 Stück)")).toBeNull();
    expect(matchIssue("SweeTARTS (36 x 51g)", "SweetTarts Sweet Tarts Mini Chewy")).toBeNull();
    expect(matchIssue("Swizzels Mega Double Lollies (36 x 31g)", "Mega Double Lollies")).toBeNull();
    expect(matchIssue("Tootsie Pops Caramel Apple (48 x 17g)", "Caramel Apple Pops, 48-Count Package")).toBeNull();
    expect(matchIssue("Jolly Rancher Filled Pops (100 x 16g)", "JOLLY RANCHER Frucht Gefüllte Lutscher")).toBeNull();
    expect(matchIssue(null, "x")).toBeNull();
  });

  it("Wörter für den Vergleich", () => {
    expect(titleTokens("Rowntree's Randoms (8 x 320g)")).toEqual(["rowntree", "random"]);
    expect(titleTokens("Blaue Himbeere Kaubonbons 2er Pack")).toEqual(["blueraspberry", "chew"]);
  });

  it("Titelsuche nimmt den ersten passenden Treffer", () => {
    const products = [{ title: "SpongeBob Krabby Patties T-Shirt" }, { title: "Spongebob Krabby Patties Gummies Sour" }];
    expect(pickTitleMatch("Spongebob Krabby Patties Sour (24 x 72g)", products)?.title).toBe("Spongebob Krabby Patties Gummies Sour");
    expect(pickTitleMatch("Chewits Juicy Bites", [{ title: "INABA Katzen Leckerlies" }])?.title).toBe("INABA Katzen Leckerlies");
    expect(pickTitleMatch("x", [])).toBeUndefined();
  });
});

describe("Packungsgröße bei Titel-Treffern", () => {
  it("weicht ab", () => {
    expect(sizeIssue({ amazonTitle: "Twizzlers Nibs Cherry 2.25 OZ (63.8g)", supplierTitle: "Twizzlers Nibs Cherry (12 x 170g)", source: null })).toMatch(/Amazon 63,8 g, Lieferant 170 g/);
    expect(sizeIssue({ amazonTitle: "Rowntree Random Gelee-Fruchtgummi Tüte - 120g - 4er-Packung", supplierTitle: "Rowntree's Randoms (8 x 320g)", source: "titel" })).toMatch(/120 g, Lieferant 320 g/);
    // „.78 oz“ ohne führende Null = 22,1 g
    expect(sizeIssue({ amazonTitle: "Mike and Ike Jolly Joes .78 oz Pouches - 24 Pack", supplierTitle: "Mike and Ike Jolly Joes (12 x 120g)", source: "titel" })).toMatch(/22,1 g/);
  });
  it("passt bzw. nicht anwendbar", () => {
    expect(sizeIssue({ amazonTitle: "Pop Rocks - Blue Razz, 24 count (8.4oz)", supplierTitle: "Pop Rocks Blue Razz (24 x 10g)", source: "titel" })).toBeNull();
    expect(sizeIssue({ amazonTitle: "TWIZZLERS Licorice Candy Bites, Kirsche, 473 ml", supplierTitle: "Twizzlers Bites Cherry (24 x 453g)", source: null })).toBeNull();
    // Stückzahl nach Inhalt berechnet → Größen unterscheiden sich gewollt
    expect(sizeIssue({ amazonTitle: "Airheads Mini Sours 340 g Beutel", supplierTitle: "Airheads Bar (36 x 16g)", source: "gewicht" })).toBeNull();
  });
});

describe("Kalkulation: Prüffälle und Prüfung von Hand", () => {
  const s = { vatRate: 0.19, pricing: { defaultFbaFee: 3, referralRate: 0.15 } };
  const base = { price: 24, title: "Chewits Juicy Bites Blue Raspberry (10 x 115g)", url: null, pricesGross: false, costPct: 0, vatPct: null };
  const market = { checkedAt: "2026-10-01T00:00:00Z", asin: "B0TESTMATCH", title: "INABA Juicy Bites, Katzen Leckerlies", price: 19.99, fbaFee: 3, referralPct: 15, monthlySold: 10, salesRank: 100, byTitle: true };
  it("Titel-Treffer, der nicht passt → prüfen statt profitabel", () => {
    const e = econOf({ ...base, market }, s);
    expect(e.issues).toHaveLength(1);
    expect(e.needsReview).toBe(true);
  });
  it("„passt“ gilt für diese ASIN, „falsch“ blendet aus", () => {
    expect(econOf({ ...base, market, matchReview: { asin: "B0TESTMATCH", ok: true } }, s)).toMatchObject({ issues: [], needsReview: false, confirmed: true });
    expect(econOf({ ...base, market, matchReview: { asin: "B0TESTMATCH", ok: false } }, s).rejected).toBe(true);
    // Neue ASIN nach erneuter Suche → Prüfung gilt nicht mehr
    expect(econOf({ ...base, market, matchReview: { asin: "B0ANDERE00", ok: true } }, s).needsReview).toBe(true);
  });
  it("Treffer per EAN wird nicht geprüft", () => {
    expect(econOf({ ...base, market: { ...market, byTitle: false } }, s).issues).toEqual([]);
  });
});
