import { describe, expect, it } from "vitest";
import { parseLooseDate, parseScPage, readScInput, sellerCentralRemovalUrl } from "@/lib/claims/sc-removal";
import { scBookmarkletHref, scBookmarkletSource } from "@/lib/claims/sc-bookmarklet";
import { detectClaims, removalParcels } from "@/lib/claims/rules";
import { CLAIM_TYPES, type ClaimType } from "@/db/schema";

const detail = [
  "Remissionsauftragsdetails",
  "Remissionsauftragsnummer: AbC123xyZ9",
  "Anforderungsdatum: 14. Juli 2026",
  "Alle Einheiten anzeigen  Alle versendeten Einheiten anzeigen",
  "Sendungsverfolgungsnummer(n):",
  "123456781 (TENDRON_VRETURN) Sendungsverfolgungsdetails anzeigen",
  "Händler-SKU\tFNSKU\tTitel\tVersandte Stückzahl",
  "SKU-1\tX00ABCDEF1\tGummibärchen 1 kg\t1",
  "SKU-2\tX00ABCDEF2\tLakritz\t2",
  "Zeit\tStandort\tEvent-Details",
  "Fri, Jul 31, 2026 08:05 PM CEST\tGarbsen, Lower Saxony\tDas Paket ist an einem Amazon-Standort eingetroffen.",
  "Fri, Jul 31, 2026 04:50 PM CEST\t\tPaket hat die Einrichtung des Versandunternehmens verlassen",
  "Sendungsverfolgungsnummer(n):",
  "1Z999AA10123456784 (UPS) Sendungsverfolgungsdetails anzeigen",
  "SKU-1\tX00ABCDEF1\tGummibärchen 1 kg\t3",
].join("\n");

describe("Seller-Central-Auftragsseite lesen", () => {
  it("Pakete mit Versender, FNSKU × Anzahl und letzter Sendungsverfolgung", () => {
    const o = parseScPage({ url: "https://sellercentral.amazon.de/x", text: detail })!;
    expect(o.orderId).toBe("AbC123xyZ9");
    expect(o.requestDate).toBe("2026-07-14");
    expect(o.packages).toHaveLength(2);
    expect(o.packages[0]).toMatchObject({
      tracking: "123456781",
      carrier: "TENDRON_VRETURN",
      items: [{ fnsku: "X00ABCDEF1", quantity: 1 }, { fnsku: "X00ABCDEF2", quantity: 2 }],
      lastEventAt: "2026-07-31",
    });
    expect(o.packages[0].lastEvent).toContain("Amazon-Standort eingetroffen");
    expect(o.packages[1]).toMatchObject({ carrier: "UPS", items: [{ fnsku: "X00ABCDEF1", quantity: 3 }] });
  });

  it("Zellen untereinander (Web-Komponenten) und Auftrags-ID aus der Liste", () => {
    const text = "Sendungsverfolgungsnummer(n):\n987654321(TENDRON_VRETURN)\nSendungsverfolgungsdetails anzeigen\nSKU-9\nX00ZZZZZZ9\nSchoko\n4\n";
    const o = parseScPage({ url: "u", orderId: "Zz9Yy8Xx7W", rowText: "17. Juli 2026 Zz9Yy8Xx7W Remission Abgeschlossen", text })!;
    expect(o).toMatchObject({ orderId: "Zz9Yy8Xx7W", requestDate: "2026-07-17" });
    expect(o.packages[0]).toMatchObject({ tracking: "987654321", carrier: "TENDRON_VRETURN", items: [{ fnsku: "X00ZZZZZZ9", quantity: 4 }] });
  });

  it("nur „Versandte Stückzahl“ ohne FNSKU", () => {
    const o = parseScPage({ url: "u", orderId: "Abcdef1234", text: "Sendungsverfolgungsnummer(n): 123456781 (TENDRON_VRETURN) Sendungsverfolgungsdetails anzeigen\nVersandte Stückzahl\n1\n" })!;
    expect(o.packages[0].items).toEqual([{ fnsku: null, quantity: 1 }]);
  });

  it("Datumsformate", () => {
    expect(parseLooseDate("Fri, Jul 31, 2026 08:05 PM")).toBe("2026-07-31");
    expect(parseLooseDate("am 04.09.2026")).toBe("2026-09-04");
    expect(parseLooseDate("3. März 2026")).toBe("2026-03-03");
    expect(parseLooseDate("2026/07/01")).toBe("2026-07-01");
  });

  it("Eingabe: JSON vom Lesezeichen oder kopierter Text", () => {
    expect(readScInput(JSON.stringify({ scRemoval: 1, pages: [{ url: "a", orderId: "X1", text: "t" }] }))).toEqual([{ url: "a", orderId: "X1", rowText: null, text: "t" }]);
    expect(readScInput("  Seitentext ")).toHaveLength(1);
    expect(readScInput("")).toHaveLength(0);
  });

  it("Link auf den Seller-Central-Bericht wie im Discord", () => {
    const u = sellerCentralRemovalUrl("2026-07-01", "2026-09-04");
    expect(u.startsWith("https://sellercentral.amazon.de/reportcentral/REMOVAL_ORDER_DETAIL/0/")).toBe(true);
    expect(decodeURIComponent(u)).toContain('"filters":["","","","","COMPLETE"]');
    expect(decodeURIComponent(u)).toContain('"startDate":"2026/07/01","endDate":"2026/09/04"');
  });

  it("Lesezeichen ist gültiges JavaScript", () => {
    expect(() => new Function(scBookmarkletSource("https://lugruseller.de").replace(/\n/g, ""))).not.toThrow();
    expect(scBookmarkletHref("https://lugruseller.de").startsWith("javascript:")).toBe(true);
  });

  it("Sendungsverfolgung bewegt sich noch → noch kein Anspruch; danach mit Nachweis", () => {
    const windowDays = { ...(Object.fromEntries(CLAIM_TYPES.map((t) => [t, 60])) as Record<ClaimType, number>), removal_shipment_stuck: 75 };
    const d = {
      adjustments: [], receipts: [], reimbursements: [], returnClaims: [], inbound: [], removals: [],
      removalShipments: [{ orderId: "AbC123xyZ9", requestDate: "2026-07-14", shipmentDate: null, sku: "SKU-1", fnsku: "X00ABCDEF1", quantity: 1, carrier: "TENDRON_VRETURN", trackingNumber: "123456781", lastEvent: "Paket ist an einem Amazon-Standort eingetroffen", lastEventAt: "2026-07-31" }],
      costBySku: new Map([["SKU-1", 5]]), costByAsin: new Map(), asinBySku: new Map(),
    };
    const s = { windowDays, minAmount: 1, problemCarriers: "TENDRON" };
    expect(removalParcels(d, ["tendron"], 75)[0].lastEventAt).toBe("2026-07-31");
    expect(detectClaims(d, s, "2026-08-05").filter((c) => c.type === "removal_shipment_stuck")).toHaveLength(0);
    const [c] = detectClaims(d, s, "2026-08-20").filter((c) => c.type === "removal_shipment_stuck");
    expect(c.evidence.find((e) => e.label === "Letzte Sendungsverfolgung")?.value).toContain("31.07.2026");
  });
});
