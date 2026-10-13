import { describe, expect, it } from "vitest";
import { temuAddress, temuCarrierId, temuDate, temuErrorText, temuItems, temuOrderState, temuShipment, temuSign, type TemuLine } from "@/lib/orders/temu";

// Temu Open API: reine Logik. Alle Daten fiktiv; die Signatur stammt aus dem Beispiel der Temu-Doku.

describe("Temu-Signatur", () => {
  it("entspricht dem Beispiel aus der Temu-Doku", () => {
    const params = {
      access_token: "2nifvmpyymvypwmcms5ct4uqqudrwgpmzbcnmkt1jzjkuaf3x56iixym",
      app_key: "f9d5cc9313893a20d5aa85c654e8f503",
      data_type: "JSON",
      sendRequestList: [
        {
          orderSendInfoList: [{ quantity: 1, orderSn: "211-21905473070712792", parentOrderSn: "PO-211-21905452099192792", goodsId: 601099548666279, skuId: 17592352673534 }],
          carrierId: "699272611",
          trackingNumber: "270324232756",
        },
      ],
      sendType: 0,
      timestamp: 1711009072,
      type: "bg.logistics.shipment.confirm",
    };
    expect(temuSign(params, "c7e0a1a63542be4de3cb5488f9fba8149e8fc290")).toBe("4CCF219942D4180C6DDA3CE36C1B838F");
  });
  it("Reihenfolge der Schlüssel egal, „sign“ und leere Werte zählen nicht", () => {
    const a = temuSign({ type: "x", app_key: "k", timestamp: 1, pageNumber: 2 }, "s");
    expect(temuSign({ pageNumber: 2, timestamp: 1, app_key: "k", type: "x", sign: "ALT", leer: undefined }, "s")).toBe(a);
  });
});

const line = (o: Partial<TemuLine> = {}): TemuLine => ({ orderSn: "211-1", goodsId: 11, skuId: 22, goodsName: "Testbecher", spec: "Blau", quantity: 2, productList: [{ extCode: "TB-BLAU" }], ...o });

describe("Temu-Bestellungen", () => {
  it("Status: wartend wird noch nicht übernommen, Storno auch über die Positionen", () => {
    const item = (code: number, lines = [line()]) => ({ parentOrderMap: { parentOrderSn: "PO-1", parentOrderStatus: code }, orderList: lines });
    expect(temuOrderState(item(1))).toBe("pending");
    expect(temuOrderState(item(2))).toBe("open");
    expect(temuOrderState(item(3))).toBe("cancelled");
    expect(temuOrderState(item(4))).toBe("shipped");
    expect(temuOrderState(item(5))).toBe("delivered");
    expect(temuOrderState(item(2, [line({ isCancelledDuringPending: true })]))).toBe("cancelled");
    expect(temuOrderState(item(99))).toBeNull();
  });
  it("Positionen: SKU aus dem Angebot, Variante im Namen, stornierte fallen weg", () => {
    expect(temuItems([line(), line({ orderSn: "211-2", isCancelledDuringPending: true })])).toEqual([{ externalItemId: "211-1", sku: "TB-BLAU", title: "Testbecher (Blau)", quantity: 2 }]);
    expect(temuItems([line({ productList: [], spec: "" })])[0]).toMatchObject({ sku: null, title: "Testbecher" });
  });
  it("Lieferadresse: Straße/Hausnummer, Zusatzzeilen, Land aus der Region", () => {
    const { address, masked } = temuAddress(
      { receiptName: "Erika Musterfrau", addressExtra: { firstName: "Erika", lastName: "Musterfrau" }, addressLine1: "Musterweg 12a", addressLine2: "2. OG", postCode: "10115", regionName1: "Germany", regionName3: "Berlin", mobile: "+49 151 0000000", mail: "kunde@example.org" },
      76,
    );
    expect(masked).toBe(false);
    expect(address).toEqual({ name1: "Erika Musterfrau", name2: "2. OG", street: "Musterweg", houseNo: "12a", zip: "10115", city: "Berlin", country: "DE", phone: "+49 151 0000000", email: "kunde@example.org" });
    expect(temuAddress({ receiptName: "E***", addressLine1: "Mus*****", postCode: "10115" }, 76).masked).toBe(true);
    expect(temuAddress({}, 76).masked).toBe(true);
    // Unbekannte Region: Ländername bleibt (wird beim Label umgesetzt)
    expect(temuAddress({ addressLine1: "Rue Test 1", regionName1: "France", regionName4: "Paris" }).address).toMatchObject({ country: "France", city: "Paris" });
  });
  it("Zeitpunkte in Sekunden oder Millisekunden", () => {
    expect(temuDate(1760000000)?.toISOString()).toBe("2025-10-09T08:53:20.000Z");
    expect(temuDate(1760000000000)?.toISOString()).toBe("2025-10-09T08:53:20.000Z");
    expect(temuDate(0)).toBeNull();
  });
});

describe("Versand an Temu melden", () => {
  const carriers = [
    { logisticsServiceProviderId: 1, logisticsServiceProviderName: "DHL Express" },
    { logisticsServiceProviderId: 2, logisticsServiceProviderName: "DHL Paket Deutschland" },
    { logisticsServiceProviderId: 3, logisticsServiceProviderName: "Deutsche Post" },
    { logisticsServiceProviderId: 4, logisticsServiceProviderName: "DPD", logisticsBrandName: "DPD" },
  ];
  it("Versanddienstleister nach Namen", () => {
    expect(temuCarrierId(carriers, "DHL")).toBe(2);
    expect(temuCarrierId(carriers, null)).toBe(2);
    expect(temuCarrierId(carriers, "DHL Warenpost")).toBe(2);
    expect(temuCarrierId(carriers, "Post")).toBe(3);
    expect(temuCarrierId(carriers, "dpd")).toBe(4);
    expect(temuCarrierId(carriers, "GLS")).toBeNull();
  });
  it("alle gültigen Positionen in einem Paket, Sendungsnummer ohne Leerzeichen", () => {
    expect(temuShipment("PO-1", [line(), line({ orderSn: "211-2", orderStatus: 3 })], 2, "0034 0434 1234", "WH-1")).toEqual({
      sendType: 0,
      sendRequestList: [{ carrierId: 2, trackingNumber: "003404341234", selfShippingWarehouseId: "WH-1", orderSendInfoList: [{ orderSn: "211-1", parentOrderSn: "PO-1", goodsId: 11, skuId: 22, quantity: 2 }] }],
    });
  });
  it("Fehlercodes verständlich", () => {
    expect(temuErrorText(5000003, "NOT_IN_IP_WHITE_LIST")).toMatch(/IP-Adresse/);
    expect(temuErrorText(3000034, "expired")).toMatch(/abgelaufen/);
    expect(temuErrorText(3000032, "x", "bg.order.list.v2.get")).toMatch(/Freigabe.*bg\.order\.list\.v2\.get/);
    expect(temuErrorText(120014022, "x")).toMatch(/passen laut Temu nicht/);
    expect(temuErrorText(123, "Etwas", "bg.test")).toBe("Temu (bg.test): Etwas (Code 123)");
  });
});
