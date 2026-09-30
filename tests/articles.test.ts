import { describe, expect, it } from "vitest";
import { amazonListingBody, checklist, ebayAspects, ebayDescriptionHtml, ebayTitle, makeSku, parseAttributeLines, parseListingResponse, parseListingTexts, type ArticleData } from "@/lib/articles/logic";

const base: ArticleData = {
  sku: "GRU-SAUER-01", title: "Grulu Sauer-Challenge Box – 9 amerikanische Süßigkeiten", ean: null, gtinExempt: true, asin: null, price: 29.99, costPrice: 12.5, vatRate: 7,
  weightGrams: 450, lengthCm: 20, widthCm: 15, heightCm: 8, bullets: ["A", "B", "C", "D", "E"], description: "Erster Absatz.\n\nZweiter <Absatz>.", keywords: "sauer candy",
  contents: ["4× Warheads (je 1,91 €)", "3× Nerds"], attributes: { Produktart: "Süßigkeiten-Box" },
  food: { ingredients: "Zucker …", allergens: "keine", nutrition: "Energie …", netQuantity: "450 g", countryOfOrigin: "us" },
  manufacturer: { companyName: "Beispiel GmbH", addressLine1: "Weg 1", postalCode: "12345", city: "Ort", country: "DE" },
  amazon: { productType: "GROCERY", fulfillment: "FBA" },
};

describe("Artikelstamm", () => {
  it("SKU aus Marke und Titel, eindeutig", () => {
    expect(makeSku("Grulu", "Sauer-Challenge Box für Halloween", new Set())).toBe("GRU-SAUER-CHALLENGE-HALLOWEEN-01");
    expect(makeSku("Grulu", "Sauer-Challenge Box für Halloween", new Set(["GRU-SAUER-CHALLENGE-HALLOWEEN-01"]))).toBe("GRU-SAUER-CHALLENGE-HALLOWEEN-02");
    expect(makeSku(null, "Größe ß", new Set())).toBe("ART-GROSSE-01");
  });
  it("Vollständigkeit: Lebensmittel-Pflichtfelder und Bilder", () => {
    const c = checklist(base, 0);
    expect(c.amazon.find((x) => x.text.startsWith("Bilder"))?.ok).toBe(false);
    expect(c.amazon.filter((x) => !x.ok)).toHaveLength(1);
    const noFood = checklist({ ...base, food: {} }, 3);
    expect(noFood.amazon.filter((x) => !x.ok).map((x) => x.text)).toEqual(["Zutaten", "Allergene (oder „keine“)", "Nährwerte", "Füllmenge"]);
  });
  it("Amazon: neues Produkt mit GTIN-Befreiung, Bildern und Lebensmittelangaben", () => {
    const b = amazonListingBody(base, { marketplaceId: "M1", brand: "Grulu", imageUrls: ["https://x/1.jpg", "https://x/2.jpg"] });
    expect(b.requirements).toBe("LISTING");
    expect(b.productType).toBe("GROCERY");
    expect(b.attributes.supplier_declared_has_product_identifier_exemption).toEqual([{ value: true, marketplace_id: "M1" }]);
    expect(b.attributes.bullet_point).toHaveLength(5);
    expect(b.attributes.main_product_image_locator).toEqual([{ media_location: "https://x/1.jpg", marketplace_id: "M1" }]);
    expect(b.attributes.other_product_image_locator_1).toBeDefined();
    expect(b.attributes.fulfillment_availability).toEqual([{ fulfillment_channel_code: "AMAZON_EU" }]);
    expect(b.attributes.country_of_origin).toEqual([{ value: "US", marketplace_id: "M1" }]);
    expect(b.attributes.purchasable_offer).toEqual([{ currency: "EUR", marketplace_id: "M1", our_price: [{ schedule: [{ value_with_tax: 29.99 }] }] }]);
  });
  it("Amazon: mit ASIN nur Angebot, Zusatz-JSON ergänzt", () => {
    const b = amazonListingBody({ ...base, asin: "B0TEST0001", amazon: { ...base.amazon, fulfillment: "FBM", quantity: 5, extraAttributes: '{"flavor":[{"value":"Sauer"}]}' } }, { marketplaceId: "M1", brand: "Grulu", imageUrls: [] });
    expect(b.requirements).toBe("LISTING_OFFER_ONLY");
    expect(b.attributes.merchant_suggested_asin).toEqual([{ value: "B0TEST0001", marketplace_id: "M1" }]);
    expect(b.attributes.item_name).toBeUndefined();
    expect(b.attributes.fulfillment_availability).toEqual([{ fulfillment_channel_code: "DEFAULT", quantity: 5 }]);
    expect(b.attributes.flavor).toEqual([{ value: "Sauer" }]);
    expect(() => amazonListingBody({ ...base, amazon: { extraAttributes: "[1]" } }, { marketplaceId: "M1", brand: "G", imageUrls: [] })).toThrow();
  });
  it("Amazon-Antwort mit Hinweisen", () => {
    expect(parseListingResponse({ status: "INVALID", issues: [{ severity: "ERROR", message: "Pflicht fehlt", attributeNames: ["item_name"] }] })).toEqual({ status: "INVALID", issues: [{ severity: "ERROR", message: "Pflicht fehlt", attributes: ["item_name"] }] });
    expect(parseListingResponse({}).status).toBe("ACCEPTED");
  });
  it("eBay: Titel ≤ 80, Merkmale, HTML ohne eingeschleustes Markup", () => {
    expect(ebayTitle("x ".repeat(60)).length).toBeLessThanOrEqual(80);
    expect(ebayAspects(base, "Grulu")).toMatchObject({ Marke: ["Grulu"], Produktart: ["Süßigkeiten-Box"], Allergene: ["keine"], Nettogewicht: ["450 g"] });
    const html = ebayDescriptionHtml(base);
    expect(html).toContain("Zweiter &lt;Absatz&gt;.");
    expect(html).toContain("<li>4× Warheads</li>");
    expect(html).toContain("Beispiel GmbH");
    expect(html).not.toMatch(/<script/i);
  });
  it("KI-Texte und Merkmale einlesen", () => {
    expect(parseListingTexts('[{"titel":"T","stichpunkte":["1","2"],"beschreibung":"B","suchbegriffe":"k"}]')).toEqual({ title: "T", bullets: ["1", "2"], description: "B", keywords: "k" });
    expect(parseListingTexts("nichts")).toBeNull();
    expect(parseAttributeLines("Produktart: Box\nfalsch\nGeschmack : sauer, süß")).toEqual({ Produktart: "Box", Geschmack: "sauer, süß" });
  });
});

describe("Artikelstamm – eigenes Listing mit ASIN", () => {
  it("von hier angelegt: weiter volles Listing (Texte), mit ASIN-Bezug", () => {
    const b = amazonListingBody({ ...base, asin: "B0TEST0001", amazon: { ...base.amazon, ownListing: true } }, { marketplaceId: "M1", brand: "Grulu", imageUrls: [] });
    expect(b.requirements).toBe("LISTING");
    expect(b.attributes.item_name).toBeDefined();
    expect(b.attributes.merchant_suggested_asin).toEqual([{ value: "B0TEST0001", marketplace_id: "M1" }]);
  });
});
