import { describe, expect, it, vi } from "vitest";
import { bulkUpdateInventory, fetchActiveListings, fetchListing, gql, ListingApiError, ListingScopeError, updateListing, type GqlConn, type GqlListing } from "@/lib/ebay/listing-api";
import { activeFromListing, durationDays, factsFromListing, imagesOf, isVariationListing, legacyFromListing, updateInput } from "@/lib/ebay/listing-map";

// Neue eBay-Listing-API (GraphQL). Fiktive Angebote, Firmen und Nummern.

const conn: GqlConn = { url: "https://graphql.example/graphql", token: "tok-test", marketplaceId: "EBAY_DE" };

const money = (v: string) => ({ original: { value: v, currency: "EUR" } });

const SINGLE: GqlListing = {
  __typename: "SingleSkuListing",
  listingId: "220000000001",
  sellerProduct: {
    title: "Testkanne 1 l",
    description: '<div style="width: 1000px"><p>Kanne &amp; Deckel</p></div>',
    aspects: [
      { name: "Marke", values: ["Testmarke"] },
      { name: "Farbe", values: ["Rot", " "] },
      { name: "EAN", values: ["Nicht zutreffend"] },
      { name: "", values: ["leer"] },
    ],
    categories: { primaryCategory: { categoryId: "20625", name: "Kannen" } },
    images: [
      { externalImageUrl: "https://bilder.example/2.jpg", order: 2 },
      { ebayImageUrl: "https://i.ebayimg.example/1.jpg", externalImageUrl: "https://bilder.example/1.jpg", order: 1 },
    ],
    itemCondition: { itemConditionId: "1000", displayName: "Neu" },
  },
  listingTerms: {
    listingFormat: "FIXED_PRICE",
    bestOfferTerms: { acceptBestOffer: true },
    lifecycleTerms: { startAt: "2026-01-02T10:00:00Z", listingStatus: "ACTIVE" },
    listingFulfillmentTerms: {
      freeShippingAvailable: false,
      shippingTerms: { handlingTimeDuration: "DAYS_2", shippingServices: [{ rank: 2, shippingCostAmount: money("9.90") }, { rank: 1, shippingCostAmount: money("4.95") }] },
    },
    listingReturnTerms: { domesticReturnTerms: { returnAccepted: true, returnDuration: "MONTHS_1", returnShipmentInvoicee: "SELLER" } },
    regulatory: { manufacturer: { companyName: "Testmarke GmbH", address: { addressLine1: "Teststr. 1", city: "Berlin", postalCode: "10115", country: "DE" }, contact: { email: "info@testmarke.example" } }, responsiblePersons: [] },
  },
  items: [
    {
      itemId: "220000000001",
      sku: "KANNE-1",
      itemSellerProduct: { productIdentifiers: { globalIdentifiers: { ean: "4006381333931" } }, traits: [] },
      itemTerms: { availability: { quantityAvailable: 4, quantitySold: 2 }, pricingTerms: { fixedPrice: money("24.90") } },
    },
  ],
};

const VARIATION: GqlListing = {
  __typename: "VariationListing",
  listingId: "220000000002",
  sku: "SHIRT",
  sellerProduct: {
    title: "Testshirt Herren",
    aspects: [{ name: "Brand", values: ["Markenlos"] }, { name: "EAN", values: ["4006381333948"] }],
    images: [{ ebayImageUrl: "https://i.ebayimg.example/s.jpg", order: 0 }],
    itemCondition: { itemConditionId: "1000" },
  },
  listingTerms: { listingFormat: "FIXED_PRICE", lifecycleTerms: { listingStatus: "ENDED" }, regulatory: { responsiblePersons: [{ companyName: "Verantwortlich GmbH", address: { country: "DE" } }] } },
  items: [
    { sku: "S-R", itemSellerProduct: { productIdentifiers: { globalIdentifiers: { ean: "4006381333955" } }, traits: [{ name: "Farbe", value: "Rot" }, { name: "Größe", value: "M" }] }, itemTerms: { availability: { quantityAvailable: 3, quantitySold: 1 }, pricingTerms: { fixedPrice: money("12.99") } } },
    { sku: null, itemSellerProduct: { traits: [{ name: "Farbe", value: "Blau" }, { name: "Größe", value: "L" }] }, itemTerms: { availability: { quantityAvailable: 2 }, pricingTerms: { fixedPrice: money("11.49") } } },
  ],
  listingVariations: {
    imagesVaryByTrait: { traitName: "Farbe", traitValueImages: [{ traitValue: "Rot", traitImages: [{ ebayImageUrl: "https://i.ebayimg.example/rot.jpg" }] }] },
  },
};

describe("Listing-API → bisherige Formen", () => {
  it("erkennt Varianten am Typ, sonst an Positionen und Merkmalen", () => {
    expect(isVariationListing(SINGLE)).toBe(false);
    expect(isVariationListing(VARIATION)).toBe(true);
    expect(isVariationListing({ ...VARIATION, __typename: undefined })).toBe(true);
    expect(isVariationListing({ ...SINGLE, __typename: undefined })).toBe(false);
  });

  it("Bilder in eBays Reihenfolge, eBay-Adresse bevorzugt", () => {
    expect(imagesOf(SINGLE)).toEqual(["https://i.ebayimg.example/1.jpg", "https://bilder.example/2.jpg"]);
  });

  it("Angebotsliste: Menge = verfügbar, Preis = günstigste Variante", () => {
    expect(activeFromListing(SINGLE)).toEqual({ itemId: "220000000001", title: "Testkanne 1 l", sku: "KANNE-1", price: 24.9, quantity: 4, image: "https://i.ebayimg.example/1.jpg", url: "https://www.ebay.de/itm/220000000001", variations: 0 });
    const v = activeFromListing(VARIATION);
    expect(v).toMatchObject({ sku: "SHIRT", price: 11.49, quantity: 5, variations: 2 });
  });

  it("Wawi-Übernahme eines einfachen Angebots", () => {
    const r = legacyFromListing(SINGLE);
    expect(r.active).toBe(true);
    expect(r.url).toBe("https://www.ebay.de/itm/220000000001");
    expect(r.skus).toEqual([{ sku: "KANNE-1", ebaySku: "KANNE-1", specifics: [], quantity: 4 }]);
    expect(r.attempt).toMatchObject({ ean: "4006381333931", price: 24.9, quantity: 4, condition: "NEW", sku: "KANNE-1", listingId: "220000000001", categoryId: "20625" });
    // EAN-Merkmal fällt aus den Merkmalen heraus, leere Werte und Namen auch.
    expect(r.attempt.aspects).toEqual({ Marke: ["Testmarke"], Farbe: ["Rot"] });
    expect(r.attempt.gpsr?.manufacturer).toMatchObject({ companyName: "Testmarke GmbH", city: "Berlin", email: "info@testmarke.example" });
    expect(r.attempt.variants).toBeUndefined();
  });

  it("Wawi-Übernahme mit Varianten, Variantenbildern und fehlender SKU", () => {
    const r = legacyFromListing(VARIATION);
    expect(r.active).toBe(false);
    expect(r.attempt.sku).toBe("EB-220000000002");
    expect(r.attempt.ean).toBe("4006381333948");
    expect(r.attempt.price).toBe(11.49);
    expect(r.attempt.quantity).toBe(5);
    expect(r.attempt.variants?.name).toBe("Farbe / Größe");
    expect(r.attempt.variants?.items[0]).toMatchObject({ value: "Rot / M", sku: "S-R", ean: "4006381333955", price: 12.99, quantity: 3, imageUrl: "https://i.ebayimg.example/rot.jpg" });
    expect(r.attempt.variants?.items[1]).toMatchObject({ value: "Blau / L", sku: "EB-220000000002-V2", quantity: 2 });
    expect(r.attempt.variants?.items[1].imageUrl).toBeUndefined();
    expect(r.skus.map((s) => s.ebaySku)).toEqual(["S-R", null]);
    expect(r.attempt.gpsr?.responsiblePersons).toHaveLength(1);
  });

  it("Laufzeiten", () => {
    expect(durationDays("DAYS_3")).toBe(3);
    expect(durationDays("MONTHS_1")).toBe(30);
    expect(durationDays("GTC")).toBeNull();
    expect(durationDays(null)).toBeNull();
  });

  it("Fakten für „Angebote prüfen“", () => {
    const f = factsFromListing(SINGLE, "testverkaeufer");
    expect(f).toMatchObject({
      itemId: "220000000001",
      sku: "KANNE-1",
      categoryName: "Kannen",
      conditionName: "Neu",
      listingType: "FixedPriceItem",
      price: 24.9,
      quantity: 4,
      sold: 2,
      watchers: null,
      ean: "4006381333931",
      brand: "Testmarke",
      bestOffer: true,
      shippingCost: 4.95,
      dispatchDays: 2,
      returnsAccepted: true,
      returnDays: 30,
      freeReturns: true,
      hasManufacturer: true,
      sellerUser: "testverkaeufer",
      fixedWidth: true,
      activeContent: false,
    });
    expect(f.descriptionText).toContain("Kanne & Deckel");

    const v = factsFromListing(VARIATION);
    expect(v).toMatchObject({ brand: null, variations: 2, ean: "4006381333948", shippingCost: null, returnsAccepted: null, freeReturns: null, hasManufacturer: true, sellerUser: null });
    // Ohne Angaben zur Produktsicherheit: unbekannt statt „fehlt“.
    expect(factsFromListing({ ...SINGLE, listingTerms: { ...SINGLE.listingTerms, regulatory: null } }).hasManufacturer).toBeNull();
  });

  it("Änderung als updateListing-Eingabe", () => {
    expect(updateInput("220000000001", {})).toBeNull();
    expect(updateInput("220000000001", { price: 10 })).toBeNull();
    const longName = "N".repeat(70);
    const input = updateInput("220000000001", {
      title: "  Testkanne   1 l  ",
      aspects: { Marke: ["Testmarke"], [longName]: ["x".repeat(70)], Leer: [] },
      description: "<p>Neu</p>",
      images: Array.from({ length: 30 }, (_, i) => `https://bilder.example/${i}.jpg`),
      bestOffer: false,
    })!;
    expect(input.listingIdentifier).toEqual({ listingId: "220000000001" });
    expect(input.marketplace).toBe("EBAY_DE");
    const product = input.product as { title: string; aspects: { name: string; values: string[] }[]; description: string; imageUrls: string[] };
    expect(product.title).toBe("Testkanne 1 l");
    expect(product.aspects).toHaveLength(2);
    expect(product.aspects[1].name).toHaveLength(65);
    expect(product.aspects[1].values[0]).toHaveLength(65);
    expect(product.imageUrls).toHaveLength(24);
    expect(input.listingTerms).toEqual({ bestOfferTerms: { bestOfferEnabled: false } });
    expect(updateInput("1", { bestOffer: true })).toEqual({ listingIdentifier: { listingId: "1" }, marketplace: "EBAY_DE", listingTerms: { bestOfferTerms: { bestOfferEnabled: true } } });
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Sent = { url: string; headers: Record<string, string>; body: { query: string; variables: Record<string, unknown> } };
function stub(...answers: Response[]) {
  const sent: Sent[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const a = answers.shift();
    if (!a) throw new Error("keine Antwort mehr vorbereitet");
    return a;
  });
  return { f: f as unknown as typeof fetch, sent };
}

describe("Listing-API-Aufrufe", () => {
  it("schickt Token und Marktplatz mit", async () => {
    const { f, sent } = stub(json({ data: { ok: true } }));
    expect(await gql(conn, "query { ok }", {}, f)).toEqual({ ok: true });
    expect(sent[0].url).toBe(conn.url);
    expect(sent[0].headers.Authorization).toBe("Bearer tok-test");
    expect(sent[0].headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_DE");
    expect(sent[0].headers["Accept-Language"]).toBe("de-DE");
  });

  it("fehlende Berechtigung → ListingScopeError, sonstige Fehler → ListingApiError", async () => {
    await expect(gql(conn, "q", {}, stub(json({ errors: [{ message: "Forbidden" }] }, 403)).f)).rejects.toBeInstanceOf(ListingScopeError);
    await expect(gql(conn, "q", {}, stub(json({ errors: [{ message: "Insufficient permissions to fulfill the request.", extensions: { errorCode: "INSUFFICIENT_SCOPE" } }] })).f)).rejects.toBeInstanceOf(ListingScopeError);
    const other = gql(conn, "q", {}, stub(json({ errors: [{ message: "Interner Fehler" }] }, 500)).f);
    await expect(other).rejects.toBeInstanceOf(ListingApiError);
    await expect(gql(conn, "q", {}, stub(json({ errors: [{ message: "Interner Fehler" }] }, 500)).f)).rejects.not.toBeInstanceOf(ListingScopeError);
    await expect(gql(conn, "q", {}, stub(new Response("<html>", { status: 502 })).f)).rejects.toThrow(/unerwartete Antwort/);
  });

  it("Angebotsliste blättert über den Cursor", async () => {
    const page = (ids: string[], next: string | null) => json({ data: { sellerListingSearch: { activeListings: { __typename: "SellerListings", listings: ids.map((id) => ({ listingId: id, listing: { ...SINGLE, listingId: id } })), pagination: { nextCursor: next } } } } });
    const { f, sent } = stub(page(["1", "2"], "c-2"), page(["3"], null));
    const all = await fetchActiveListings(conn, { pageSize: 2, fetcher: f });
    expect(all.map((l) => l.listingId)).toEqual(["1", "2", "3"]);
    expect(sent[0].body.variables).toEqual({ input: { pagination: { maxPageSize: 2 } } });
    expect(sent[1].body.variables).toEqual({ input: { pagination: { pageCursor: "c-2", pageIndex: 2 } } });
  });

  it("Angebotsliste: ungültige Anfrage wird gemeldet", async () => {
    const { f } = stub(json({ data: { sellerListingSearch: { activeListings: { __typename: "SellerListingSearchInvalidInput", errorCode: "INVALID", errorMessage: "Seitengröße ungültig", validationErrors: [{ errorDescription: "maxPageSize" }] } } } }));
    await expect(fetchActiveListings(conn, { fetcher: f })).rejects.toThrow(/Seitengröße ungültig – maxPageSize/);
  });

  it("einzelnes Angebot, auch teilweise geliefert", async () => {
    const { f, sent } = stub(json({ data: { sellerListings: { __typename: "ListingsSuccess", listings: [{ __typename: "ListingPartialSuccess", listingId: "220000000001", listing: SINGLE, errors: [{ errorMessage: "Teil fehlt" }] }] } } }));
    const l = await fetchListing(conn, "220000000001", f);
    expect(l.sellerProduct?.title).toBe("Testkanne 1 l");
    expect(sent[0].body.variables).toEqual({ input: { listings: [{ listingId: "220000000001" }] } });
    const missing = stub(json({ data: { sellerListings: { __typename: "ListingsSuccess", listings: [{ __typename: "ListingPartialSuccess", listingId: "9", listing: null, errors: [{ errorMessage: "Angebot unbekannt" }] }] } } }));
    await expect(fetchListing(conn, "9", missing.f)).rejects.toThrow(/Angebot unbekannt/);
  });

  it("Angebot ändern: Prüffehler werden gemeldet, Hinweise zurückgegeben", async () => {
    const ok = stub(json({ data: { updateListing: { __typename: "UpdateListingSuccess", warnings: [{ warningMessage: "Bild klein" }] } } }));
    expect(await updateListing(conn, { listingIdentifier: { listingId: "1" } }, ok.f)).toEqual({ warnings: ["Bild klein"] });
    const bad = stub(json({ data: { updateListing: { __typename: "UpdateListingValidationError", errorMessage: "Ungültig", violations: [{ violationDescription: "Titel zu lang" }] } } }));
    await expect(updateListing(conn, {}, bad.f)).rejects.toThrow(/Ungültig \| Titel zu lang/);
  });

  it("Menge/Preis: höchstens 4 Positionen je Aufruf, Preis als Dezimalzahl", async () => {
    const success = () => json({ data: { bulkUpdateInventory: { __typename: "BulkUpdateInventorySuccess", successes: [] } } });
    const { f, sent } = stub(success(), success());
    await bulkUpdateInventory(conn, [
      { listingId: "1", sku: "A", availableQuantity: 3.7 },
      { listingId: "2", availableQuantity: -2 },
      { listingId: "3", fixedPrice: 9.5 },
      { listingId: "4", sku: null, availableQuantity: 0 },
      { listingId: "5", sku: "E", availableQuantity: 1, fixedPrice: 12 },
    ], f);
    expect(sent).toHaveLength(2);
    const first = (sent[0].body.variables.input as { inventory: unknown[] }).inventory;
    expect(first).toEqual([
      { listingItemIdentifier: { listingId: "1", sku: "A" }, availableQuantity: 3 },
      { listingItemIdentifier: { listingId: "2" }, availableQuantity: 0 },
      { listingItemIdentifier: { listingId: "3" }, fixedPrice: "9.50" },
      { listingItemIdentifier: { listingId: "4" }, availableQuantity: 0 },
    ]);
    expect((sent[1].body.variables.input as { inventory: unknown[] }).inventory).toEqual([{ listingItemIdentifier: { listingId: "5", sku: "E" }, availableQuantity: 1, fixedPrice: "12.00" }]);

    const fail = stub(json({ data: { bulkUpdateInventory: { __typename: "BulkUpdateInventoryFailure", errorMessage: "Abgelehnt", failures: [{ violations: [{ violationDescription: "Menge zu hoch" }] }] } } }));
    await expect(bulkUpdateInventory(conn, [{ listingId: "1", availableQuantity: 1 }], fail.f)).rejects.toThrow(/Abgelehnt \| Menge zu hoch/);
  });
});
