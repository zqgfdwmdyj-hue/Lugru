import { describe, expect, it } from "vitest";
import { imAddress, imCheckoutBody, imError, isLabelPrinterFormat, labelPosition, postFormatInfo, WARENSENDUNG } from "@/lib/shipping/internetmarke";
import { untrackedPost } from "@/lib/orders/tracking";

// Deutsche Post INTERNETMARKE: Anfrage für Warensendungen mit Anschrift. Erfundene Adressen.

const sender = { name1: "Testfirma GmbH", street: "Absenderweg", houseNo: "1", zip: "12345", city: "Musterstadt", country: "DEU" };
const to = (n: number) => ({ name1: `Erika Muster ${n}`, name2: n === 2 ? "c/o Beispiel GmbH" : undefined, street: "Musterstr.", houseNo: `${n}a`, zip: "54321", city: "Beispielort", country: "DEU" });

describe("INTERNETMARKE-Anfrage", () => {
  it("Warensendung laut Preisliste: Produkt 290, 2,70 €, bis 1.000 g", () => {
    expect(WARENSENDUNG).toEqual({ productCode: 290, priceCents: 270, maxGrams: 1000 });
  });
  it("Anschrift: Straße mit Nummer in einer Zeile, Zusatz als additionalName, Land ISO-3", () => {
    expect(imAddress(to(2))).toEqual({ name: "Erika Muster 2", additionalName: "c/o Beispiel GmbH", addressLine1: "Musterstr. 2a", postalCode: "54321", city: "Beispielort", country: "DEU" });
    expect(imAddress({ ...to(1), country: "DE" }).country).toBe("DEU");
    expect(() => imAddress({ name1: "Nur Name" })).toThrow(/unvollständig/);
  });
  it("Position auf dem Bogen: links → rechts, oben → unten, dann nächste Seite", () => {
    expect(labelPosition(0, 1, 1)).toEqual({ page: 1, labelX: 1, labelY: 1 });
    expect(labelPosition(1, 1, 1)).toEqual({ page: 2, labelX: 1, labelY: 1 });
    expect(labelPosition(1, 2, 4)).toEqual({ page: 1, labelX: 2, labelY: 1 });
    expect(labelPosition(2, 2, 4)).toEqual({ page: 1, labelX: 1, labelY: 2 });
    expect(labelPosition(8, 2, 4)).toEqual({ page: 2, labelX: 1, labelY: 1 });
  });
  it("Warenkorb: Summe = Preis × Anzahl, Adresszone, Absender in jeder Position", () => {
    const b = imCheckoutBody({ shopOrderId: "123", sender, labels: [{ ref: "A", to: to(1) }, { ref: "B", to: to(2) }, { ref: "C", to: to(3) }], productCode: 290, priceCents: 270, pageFormat: { id: 1, labelX: 1, labelY: 1 } });
    expect(b).toMatchObject({ type: "AppShoppingCartPDFRequest", shopOrderId: "123", total: 810, pageFormatId: 1, createManifest: false, createShippingList: "0", dpi: "DPI300" });
    expect(b.positions).toHaveLength(3);
    expect(b.positions[2]).toMatchObject({ productCode: 290, voucherLayout: "ADDRESS_ZONE", positionType: "AppShoppingCartPDFPosition", position: { page: 3, labelX: 1, labelY: 1 } });
    expect(b.positions[0].address.sender.addressLine1).toBe("Absenderweg 1");
    expect(b.positions[1].address.receiver.additionalName).toBe("c/o Beispiel GmbH");
  });
  it("Fehlermeldungen der Post lesbar", () => {
    expect(imError(401, { statusCode: "401", title: "Unauthorized", detail: "user account is not valid" })).toBe("401 Unauthorized – user account is not valid");
    expect(imError(500, "Gateway Timeout")).toBe("500 Gateway Timeout");
    expect(imError(502, null)).toBe("502");
  });
});

describe("Versandmeldung ohne Sendungsnummer (Warensendung)", () => {
  const base = { channel: "amazon", carrier: "Deutsche Post", trackingNumber: null, status: "shipped" };
  it("nur Warensendung über Amazon/eBay, erst wenn versendet", () => {
    expect(untrackedPost(base)).toBe(true);
    expect(untrackedPost({ ...base, status: "label_created" })).toBe(false);
    expect(untrackedPost({ ...base, carrier: "DHL" })).toBe(false);
    expect(untrackedPost({ ...base, channel: "ebay" })).toBe(true);
    expect(untrackedPost({ ...base, channel: "temu" })).toBe(false);
    expect(untrackedPost({ ...base, trackingNumber: "123" })).toBe(false);
  });
});

describe("Druckformat der Warensendung (Hinweis vor dem Kauf)", () => {
  it("ohne Auswahl: Nr. 1 = DIN A4, kein Etikettendrucker", () => {
    expect(postFormatInfo({ pageFormatId: 1, pageFormatName: "" })).toEqual({ name: "DIN A4 Normalpapier", labelPrinter: false });
    expect(postFormatInfo({ pageFormatId: 17 })).toEqual({ name: "Format Nr. 17", labelPrinter: false });
  });
  it("Brother-Rolle wird als Etikettendrucker erkannt", () => {
    expect(postFormatInfo({ pageFormatId: 99, pageFormatName: "Brother DK-22205 Endlos-Etikett 62mm" })).toEqual({ name: "Brother DK-22205 Endlos-Etikett 62mm", labelPrinter: true });
    expect(isLabelPrinterFormat("DIN A4 Normalpapier")).toBe(false);
    expect(isLabelPrinterFormat("DYMO LabelWriter 99014")).toBe(true);
  });
});
