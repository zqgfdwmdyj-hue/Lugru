import { describe, expect, it } from "vitest";
import { gpsrText, temuBarcodeType, temuGoodsFromAttempt, temuGoodsPayload, temuGoodsProblems, temuListingState, temuMeasure, temuMoney } from "@/lib/temu/goods";
import { TEMU_PRICE_RULE, temuBasePrice, temuFactor, temuPriceNote } from "@/lib/temu/price";
import { temuComplianceNote, temuComplianceTodos } from "@/lib/orders/temu";
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
  it("einfaches Angebot: SKU = eBay-SKU, Preis nach dem Rechner, Menge aus der Wawi, EAN, Herstellerangaben", () => {
    const g = temuGoodsFromAttempt(single, { rule: TEMU_PRICE_RULE, pack, quantities: new Map([["LG-4000000000017-7", 3]]) });
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
      price: { basePrice: { amount: "11.77", currency: "EUR" } },
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
    const g = temuGoodsFromAttempt(a, { rule: TEMU_PRICE_RULE, prices: new Map([["LG-7-V1", 3.5]]), pack, quantities: new Map() });
    const p = temuGoodsPayload(g) as { attributes: { name: string }[]; skuList: { externalSkuId: string; images: string[]; variations: unknown; quantity: number; barCode?: unknown; price: { basePrice: { amount: string } } }[] };
    expect(p.attributes.map((x) => x.name)).toEqual(["Marke"]);
    expect(p.skuList.map((s) => [s.externalSkuId, s.images[0], s.variations, s.quantity])).toEqual([
      ["LG-7-V1", "https://i.example/k.jpg", [{ name: "Sorte", value: "Kirsche" }], 4],
      ["LG-7-V2", "https://i.example/a.jpg", [{ name: "Sorte", value: "Komplettset" }], 2],
    ]);
    expect(p.skuList[1].barCode).toBeUndefined();
    // eigener Preis für Kirsche, Komplettset nach dem Rechner (9,99 × 0,85 − 2,99) ÷ 1,19
    expect(p.skuList.map((s) => s.price.basePrice.amount)).toEqual(["3.50", "4.62"]);
  });

  it("prüft vor dem Senden: Maße, Bilder, öffentliche Links", () => {
    const g = temuGoodsFromAttempt(single, { rule: TEMU_PRICE_RULE, pack: { weightG: 0, lengthCm: 10, widthCm: 0, heightCm: 5 }, quantities: new Map() });
    expect(temuGoodsProblems(g)).toEqual(["Gewicht (g) fehlt.", "Paketmaße (Länge, Breite, Höhe in cm) fehlen."]);
    const http = temuGoodsFromAttempt({ ...single, imageUrls: ["http://localhost/a.jpg"] }, { rule: TEMU_PRICE_RULE, pack, quantities: new Map() });
    expect(temuGoodsProblems(http).join(" ")).toMatch(/öffentlich erreichbar/);
    expect(temuGoodsProblems(http, { allowHttp: true })).toEqual([]);
    expect(temuGoodsProblems(temuGoodsFromAttempt({ ...single, imageUrls: [] }, { rule: TEMU_PRICE_RULE, pack, quantities: new Map() }))).toEqual(["LG-4000000000017-7: kein Bild."]);
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
    expect(temuListingState("DRAFT").lastError).toMatch(/Entwürfe/);
    expect(temuListingState("incomplete")).toMatchObject({ status: "draft", lastError: expect.stringMatching(/unvollständig – im Seller Center/) });
    expect(temuListingState("INACTIVE").status).toBe("draft");
    expect(temuListingState("DELETED").status).toBe("ended");
    expect(temuListingState(null)).toEqual({ status: "draft", lastError: "Bei Temu angelegt – der Stand wird abgefragt." });
  });

  it("Basispreis-Rechner wie die Excel-Vorlage (Non-Food 19 %, Food 7 %, 2,99 € Versandabzug bis 30 €)", () => {
    expect(temuBasePrice(11.87)).toBe(5.97);
    expect(temuPriceNote(11.87)).toBe("30 € oder darunter – inkl. 2,99 € Versandabzug");
    expect(temuBasePrice(40, { factor: 0.85, food: true })).toBe(31.78);
    expect(temuPriceNote(40)).toBe("Über 30 € – ohne 2,99 € Versandabzug");
    expect(temuBasePrice(40)).toBe(28.57);
    // Grenze: 35,29 × 0,85 = 29,9965 (mit Abzug), 35,30 × 0,85 = 30,005 (ohne)
    expect(temuBasePrice(35.29)).toBe(22.69);
    expect(temuBasePrice(35.3)).toBe(25.21);
    expect(temuBasePrice(19.99, { factor: 0.9, food: false })).toBe(12.61);
    expect(temuBasePrice(3)).toBeLessThanOrEqual(0);
    expect(temuBasePrice(0)).toBe(0);
    expect(temuFactor("85")).toBe(0.85);
    expect(temuFactor(5)).toBeNull();
  });

  it("zu billig für den Rechner: klare Meldung statt 0 €", () => {
    const g = temuGoodsFromAttempt({ ...single, price: 3 }, { rule: TEMU_PRICE_RULE, pack, quantities: new Map() });
    expect(temuGoodsProblems(g).join(" ")).toMatch(/kein Preis \(nach dem Rechner 0 € oder weniger/);
  });

  it("Varianten mit mehreren Merkmalen (ältere eBay-Angebote): alle Merkmale je SKU, nicht bei den Angebotsmerkmalen", () => {
    const a: ListingAttempt = {
      ...single, sku: "EB-1", ean: "",
      aspects: { Marke: ["Testmarke"], Farbe: ["Rot", "Blau"], "Größe": ["M"] },
      variants: { name: "Farbe / Größe", items: [{ value: "Rot / M", sku: "EB-1-V1", price: 40, quantity: 1, specs: [{ name: "Farbe", value: "Rot" }, { name: "Größe", value: "M" }] }] },
    };
    const p = temuGoodsPayload(temuGoodsFromAttempt(a, { rule: TEMU_PRICE_RULE, pack, quantities: new Map(), goodsId: "EB-1" })) as { goodsBasic: { externalGoodsId: string }; attributes: { name: string }[]; skuList: { variations: unknown }[] };
    expect(p.goodsBasic.externalGoodsId).toBe("EB-1");
    expect(p.attributes.map((x) => x.name)).toEqual(["Marke"]);
    expect(p.skuList[0].variations).toEqual([{ name: "Farbe", value: "Rot" }, { name: "Größe", value: "M" }]);
  });

  it("Konformität: was Temu noch verlangt (GPSR-Hersteller, EU-Verantwortliche, Fotos), was in Prüfung ist", () => {
    const t = temuComplianceTodos({
      gpsrInfoList: [{ repType: 3, status: 1 }, { repType: 2, status: 4 }],
      repInfoList: [{ repType: 4, status: 5 }],
      actualPhotoList: [{ status: 2 }],
      certificateInfoList: [{ status: "7" }],
      extraTemplateInfoList: [{ status: 3 }],
    });
    expect(t).toEqual({ open: ["Hersteller (GPSR)", "EU-verantwortliche Person (GPSR)", "Zertifikate/Prüfberichte"], review: ["echte Fotos von Produkt/Etikett", "Pflichtangaben der Kategorie"] });
    expect(temuComplianceNote(t)).toMatch(/^Temu verlangt noch: Hersteller \(GPSR\), EU-verantwortliche Person \(GPSR\), Zertifikate\/Prüfberichte – im Seller Center/);
    expect(temuComplianceNote({ open: [], review: ["echte Fotos von Produkt/Etikett"] })).toBe("Konformitätsangaben in Prüfung bei Temu (echte Fotos von Produkt/Etikett).");
    expect(temuComplianceNote(temuComplianceTodos({}))).toBeNull();
  });
});
