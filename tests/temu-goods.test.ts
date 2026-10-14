import { describe, expect, it } from "vitest";
import { gpsrText, temuBarcodeType, temuGoodsFromAttempt, temuGoodsPayload, temuGoodsProblems, temuListingState, temuMeasure, temuMoney } from "@/lib/temu/goods";
import type { ListingAttempt } from "@/lib/ebay/types";

// Temu-Angebot aus einem eBay-Listing. Fiktive Produkte, Preise und Firmen.

const pack = { weightG: 350, lengthCm: 20, widthCm: 15.5, heightCm: 8 };
const single: ListingAttempt = {
  id: 7, ean: "4000000000017", price: 19.99, quantity: 5, condition: "NEW", status: "published", createdAt: "", updatedAt: "",
  sku: "LG-4000000000017-7", title: "Testbecher Edelstahl 700 ml", description: "<p>Hält warm</p>",
  imageUrls: ["https://i.example/a.jpg", "https://i.example/b.jpg"],
  aspects: { Marke: ["Testmarke"], Produktart: ["Thermobecher"], Farbe: ["Blau"] },
  gpsr: { manufacturer: { companyName: "Testmarke GmbH", addressLine1: "Teststr. 1", postalCode: "10115", city: "Berlin", country: "DE" }, responsiblePersons: [], sourceItemId: "x" },
};

describe("Temu-Angebot aus eBay", () => {
  it("einfaches Angebot: SKU = eBay-SKU, Preis in %, Menge aus der Wawi, EAN, Herstellerangaben", () => {
    const g = temuGoodsFromAttempt(single, { pricePercent: 90, pack, quantities: new Map([["LG-4000000000017-7", 3]]) });
    const p = temuGoodsPayload(g) as { goodsBasic: Record<string, unknown>; attributes: { name: string; value: string[] }[]; skuList: Record<string, unknown>[] };
    expect(p.goodsBasic).toMatchObject({
      externalGoodsId: "LG-4000000000017-7",
      goodsName: "Testbecher Edelstahl 700 ml",
      productType: 1,
      extCatName: "Thermobecher",
      goodsCarouselImage: ["https://i.example/a.jpg", "https://i.example/b.jpg"],
    });
    expect(String(p.goodsBasic.goodsDesc)).toBe("<p>Hält warm</p><p>Hersteller: Testmarke GmbH, Teststr. 1, 10115 Berlin, DE</p>");
    expect(p.attributes).toEqual([{ name: "Marke", value: ["Testmarke"] }, { name: "Produktart", value: ["Thermobecher"] }, { name: "Farbe", value: ["Blau"] }]);
    expect(p.skuList).toEqual([{
      externalSkuId: "LG-4000000000017-7",
      images: ["https://i.example/a.jpg", "https://i.example/b.jpg"],
      price: { basePrice: { amount: "17.99", currency: "EUR" } },
      quantity: 3,
      packageInfo: { weight: "350", length: "20", width: "15.5", height: "8" },
      barCode: { barCodeType: "EAN", barCodeId: ["4000000000017"] },
    }]);
  });

  it("Varianten: je Sorte eine SKU mit Variante, eigenem Bild zuerst, ohne Variantenmerkmal in den Merkmalen", () => {
    const a: ListingAttempt = {
      ...single, sku: "LG-7-G", ean: "",
      aspects: { Marke: ["Testmarke"], Sorte: ["Kirsche"] },
      variants: { name: "Sorte", items: [
        { value: "Kirsche", sku: "LG-7-V1", price: 2.49, quantity: 4, imageUrl: "https://i.example/k.jpg", ean: "4000000000024" },
        { value: "Komplettset", sku: "LG-7-V2", price: 9.99, quantity: 2, set: [{ sku: "LG-7-V1", qty: 1 }] },
      ] },
    };
    const g = temuGoodsFromAttempt(a, { pricePercent: 100, pack, quantities: new Map() });
    const p = temuGoodsPayload(g) as { attributes: { name: string }[]; skuList: { externalSkuId: string; images: string[]; variations: unknown; quantity: number; barCode?: unknown }[] };
    expect(p.attributes.map((x) => x.name)).toEqual(["Marke"]);
    expect(p.skuList.map((s) => [s.externalSkuId, s.images[0], s.variations, s.quantity])).toEqual([
      ["LG-7-V1", "https://i.example/k.jpg", [{ name: "Sorte", value: "Kirsche" }], 4],
      ["LG-7-V2", "https://i.example/a.jpg", [{ name: "Sorte", value: "Komplettset" }], 2],
    ]);
    expect(p.skuList[1].barCode).toBeUndefined();
  });

  it("prüft vor dem Senden: Maße, Bilder, öffentliche Links", () => {
    const g = temuGoodsFromAttempt(single, { pricePercent: 100, pack: { weightG: 0, lengthCm: 10, widthCm: 0, heightCm: 5 }, quantities: new Map() });
    expect(temuGoodsProblems(g)).toEqual(["Gewicht (g) fehlt.", "Paketmaße (Länge, Breite, Höhe in cm) fehlen."]);
    const http = temuGoodsFromAttempt({ ...single, imageUrls: ["http://localhost/a.jpg"] }, { pricePercent: 100, pack, quantities: new Map() });
    expect(temuGoodsProblems(http).join(" ")).toMatch(/öffentlich erreichbar/);
    expect(temuGoodsProblems(http, { allowHttp: true })).toEqual([]);
    expect(temuGoodsProblems(temuGoodsFromAttempt({ ...single, imageUrls: [] }, { pricePercent: 100, pack, quantities: new Map() }))).toEqual(["LG-4000000000017-7: kein Bild."]);
  });

  it("Zahlen als Text, Barcode-Arten, Herstellertext", () => {
    expect(temuMoney(12.5)).toBe("12.50");
    expect(temuMoney(17.991)).toBe("17.99");
    expect(temuMeasure(22.0, 1)).toBe("22");
    expect(temuMeasure(350, 0)).toBe("350");
    expect(temuMeasure(0, 1)).toBe("");
    expect(temuMeasure(0.01, 0)).toBe("");
    expect(temuBarcodeType("4000000000017")).toBe("EAN");
    expect(temuBarcodeType("012345678905")).toBe("UPC");
    expect(temuBarcodeType("12345")).toBeNull();
    expect(gpsrText(null)).toBe("");
  });

  it("Temu-Stand → Wawi-Angebot", () => {
    expect(temuListingState("ACTIVE")).toEqual({ status: "active", lastError: null });
    expect(temuListingState("DRAFT").lastError).toMatch(/Seller Center/);
    expect(temuListingState("INCOMPLETE")).toMatchObject({ status: "draft", lastError: expect.stringMatching(/prüft/) });
    expect(temuListingState("DELETED").status).toBe("ended");
    expect(temuListingState(null).status).toBe("draft");
  });
});
