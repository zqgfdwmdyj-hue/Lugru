import { describe, expect, it } from "vitest";
import { BOOKMARKLET_SOURCE, chunkText, dedupe, fromCards, fromJsonLd, fromShopify, jsonLdFromHtml, normalizeEan, packInfo, packOf, parseCapture, searchTerm, parseEcb, parseScan, priceOf, skuFor, toEur } from "@/lib/suppliers/scan";

describe("Lieferanten-Scan", () => {
  it("UPC-12 wird zu EAN-13, Unsinn zu null", () => {
    expect(normalizeEan("0 41420-01234 5")).toBe("0041420012345");
    expect(normalizeEan("4001234567890")).toBe("4001234567890");
    expect(normalizeEan("00012345678905")).toBe("0012345678905");
    expect(normalizeEan("12345")).toBeNull();
  });
  it("Preise in US- und deutscher Schreibweise", () => {
    expect(priceOf("$1,299.50")).toBe(1299.5);
    expect(priceOf("2,49 €")).toBe(2.49);
    expect(priceOf("1.234,56")).toBe(1234.56);
    expect(priceOf(3)).toBe(3);
    expect(priceOf("free")).toBeNull();
  });
  it("Packungsgröße und Artikelnummer", () => {
    expect(packOf("Nerds Rope Rainbow 0.92oz - 24ct")).toBe("24 Einheiten");
    expect(packOf("Box of 12 Airheads")).toBe("12 Einheiten");
    expect(skuFor({ title: "X", url: "https://shop.test/products/nerds-rope-24ct?variant=1" })).toBe("nerds-rope-24ct");
    expect(skuFor({ title: "Warheads Sour", ean: "0012345678905" })).toBe("0012345678905");
  });
  it("JSON-LD: Produkt, Liste und @graph", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Test Candy 1.5oz - 36ct","sku":"TC-1","gtin12":"012345678905","image":["/img/a.jpg"],"offers":{"@type":"Offer","price":"24.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"Product","name":"Other Candy","offers":{"price":3.5,"priceCurrency":"USD","availability":"OutOfStock"}}}]}]}</script>`;
    const items = fromJsonLd(jsonLdFromHtml(html), "https://shop.test/p/1");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sku: "TC-1", ean: "0012345678905", price: 24.99, currency: "USD", pack: "36 Einheiten", imageUrl: "https://shop.test/img/a.jpg" });
    expect(items[1]).toMatchObject({ title: "Other Candy", price: 3.5, stock: 0 });
  });
  it("Shopify-Katalog mit Varianten", () => {
    const items = fromShopify({ products: [{ title: "Sour Belts", handle: "sour-belts", images: [{ src: "https://cdn/x.jpg" }], variants: [{ title: "Default Title", sku: "SB1", barcode: "012345678905", price: "19.99", available: true }] }] }, "https://s.test");
    expect(items[0]).toMatchObject({ title: "Sour Belts", sku: "SB1", ean: "0012345678905", price: 19.99, url: "https://s.test/products/sour-belts" });
  });
  it("Browser-Erfassung: Kacheln ohne KI", () => {
    const cap = parseCapture(JSON.stringify({ sellerCapture: 1, url: "https://candy.test/c", items: [
      { href: "https://candy.test/p/a", text: "Sale | Jolly Rancher Hard Candy 14oz Bag - 12ct | $38.99 | Add to Cart", img: "https://candy.test/a.jpg" },
      { href: "https://candy.test/about", text: "About us", img: null },
    ], text: "Prices in $" }));
    expect(cap).not.toBeNull();
    const items = fromCards(cap!.items!, cap!.text);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Jolly Rancher Hard Candy 14oz Bag - 12ct", price: 38.99, currency: "USD", pack: "12 Einheiten", sku: "a", imageUrl: "https://candy.test/a.jpg" });
    expect(parseCapture("einfach Text")).toBeNull();
  });
  it("KI-Antwort einlesen, Dubletten zusammenfassen", () => {
    const items = parseScan('```json\n[{"sku":"A1","title":"Candy A","ean":"012345678905","price":"2.10","currency":"usd","pack":"24 Stk","url":"/p/a","stock":0},{"title":"Candy A","sku":"A1","price":2.1},{"title":""}]\n```', "https://x.test/list");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ currency: "USD", url: "https://x.test/p/a", stock: 0, ean: "0012345678905" });
    expect(dedupe(items)).toHaveLength(1);
    expect(dedupe(items)[0].ean).toBe("0012345678905");
  });
  it("Kurse und Umrechnung", () => {
    const rates = parseEcb(`<Cube currency='USD' rate='1.0870'/><Cube currency='GBP' rate='0.8400'/>`);
    expect(rates.USD).toBeCloseTo(0.92, 3);
    expect(toEur(10, "USD", { USD: 0.92 })).toBe(9.2);
    expect(toEur(10, "EUR", {})).toBe(10);
    expect(toEur(10, "CAD", {})).toBeNull();
  });
  it("Text in Stücke, Lesezeichen ist gültiges JavaScript", () => {
    const parts = chunkText("zeile\n".repeat(20000), 25000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 25000)).toBe(true);
    expect(() => new Function(BOOKMARKLET_SOURCE)).not.toThrow();
  });
  it("CandyHero-Titel: Karton vs. Inhalt", () => {
    expect(packInfo("Aftershocks Popping Candy Blue Raspberry (24 x 9g)", "https://candyhero.com/products/aftershocks-popping-candy-blue-raspberry-9g-box-of-24")).toEqual({ caseQty: 24, inner: null, unitSize: "9g" });
    expect(packInfo("Airheads Bars Assorted 5 Pack (18 x 78g)")).toEqual({ caseQty: 18, inner: 5, unitSize: "78g" });
    expect(packInfo("Airheads Bars Assorted 60 Pack (936g)")).toEqual({ caseQty: 1, inner: 60, unitSize: "936g" });
    expect(packInfo("Airheads Bars Assorted 6 Pack", "https://x/products/airheads-bars-assorted-6-pack-94g-case-of-12").caseQty).toBe(12);
    expect(packInfo("Aftershocks Watermelon (16 x 30g)", "https://x/products/aftershocks-30g-box-").caseQty).toBe(16);
    expect(packOf("Airheads Bars Assorted 5 Pack (18 x 78g)")).toBe("18 × 78g · je 5er-Pack");
    expect(searchTerm("Airheads Bars Assorted 5 Pack (18 x 78g)")).toBe("Airheads Bars Assorted 5 Pack");
  });
});
