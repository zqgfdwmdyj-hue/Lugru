import { describe, expect, it } from "vitest";
import { alterUeber180, fehlendeListungen, landVonId, leseBestandsplanung, leseListings, leseSalesTraffic, MARKTPLATZ_IDS, verdichteAngebote, type ListingZeile } from "@/lib/amazon-markt/logic";

// Erfundene Amazon-Berichte und -Antworten (Aufbau wie bei der SP-API, Werte ausgedacht).

describe("Marktplätze", () => {
  it("ID ↔ Land", () => {
    expect(landVonId(MARKTPLATZ_IDS.FR)).toBe("FR");
    expect(landVonId("A1PA6795UKMFR9")).toBe("DE");
    expect(landVonId("UNBEKANNT")).toBeNull();
  });
});

describe("Sales and Traffic (Buy-Box-Anteil)", () => {
  const doc = {
    reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT", dataStartTime: "2026-09-28", dataEndTime: "2026-10-27T00:00:00Z", marketplaceIds: ["A13V1IB3VIYZZH"] },
    salesAndTrafficByAsin: [
      { parentAsin: "B0TESTPAR1", childAsin: "B0TEST0001", sku: "TEST-SOCKEN", salesByAsin: { unitsOrdered: 8, orderedProductSales: { amount: 83.923, currencyCode: "EUR" } }, trafficByAsin: { sessions: 95, pageViews: 124, buyBoxPercentage: 63, unitSessionPercentage: 8.4 } },
      { parentAsin: "B0TEST0002", salesByAsin: {}, trafficByAsin: { sessions: 3 } },
      { salesByAsin: { unitsOrdered: 1 } },
    ],
  };

  it("liest Land, Zeitraum und Zeilen; ohne ASIN wird übersprungen", () => {
    const r = leseSalesTraffic(doc);
    expect(r).toMatchObject({ land: "FR", von: "2026-09-28", bis: "2026-10-27" });
    expect(r.zeilen).toHaveLength(2);
    expect(r.zeilen[0]).toEqual({ asin: "B0TEST0001", elternAsin: "B0TESTPAR1", sku: "TEST-SOCKEN", sitzungen: 95, seitenaufrufe: 124, buyboxProzent: 63, kaufquoteProzent: 8.4, einheiten: 8, umsatz: 83.92, waehrung: "EUR" });
    // nur Eltern-ASIN: gilt als ASIN, fehlende Werte bleiben leer statt 0
    expect(r.zeilen[1]).toMatchObject({ asin: "B0TEST0002", sitzungen: 3, buyboxProzent: null, einheiten: null, umsatz: null });
  });

  it("leeres Dokument → keine Zeilen, kein Absturz", () => expect(leseSalesTraffic(null)).toEqual({ land: null, von: null, bis: null, zeilen: [] }));
});

describe("Alle Angebote (Listung je Land)", () => {
  it("deutsche Spalten (Amazon.de), Komma-Preise, Status und Versand", () => {
    const z = leseListings(
      ["Artikelbezeichnung", "Angebotsnummer", "Händler-SKU", "Preis", "Menge", "Erstellungsdatum", "ASIN 1", "Versender", "Status"],
      [
        ["Testsocken", "1", "TEST-SOCKEN", "9,99", "", "14.03.2025 10:22:33 MEZ", "b0test0001", "AMAZON_EU", "Aktiv"],
        ["Testtasse", "2", "TEST-TASSE", "1.014,90", "5", "2025-05-02", "B0TEST0002", "DEFAULT", "Inaktiv"],
        ["leer", "3", "", "1", "1", "", "", "", ""],
      ],
    );
    expect(z).toHaveLength(2);
    expect(z[0]).toMatchObject({ sku: "TEST-SOCKEN", asin: "B0TEST0001", preis: 9.99, menge: null, status: "aktiv", versand: "FBA" });
    expect(z[1]).toMatchObject({ sku: "TEST-TASSE", preis: 1014.9, menge: 5, status: "inaktiv", versand: "FBM", erstellt: "2025-05-02" });
  });

  it("englische und französische Spalten", () => {
    expect(leseListings(["item-name", "seller-sku", "price", "quantity", "asin1", "fulfillment-channel", "status"], [["X", "A-1", "10.49", "0", "B0TEST0001", "AMAZON_EU", "Active"]])[0]).toMatchObject({ sku: "A-1", preis: 10.49, status: "aktiv", versand: "FBA" });
    expect(leseListings(["nom-de-l'article", "sku-vendeur", "prix", "asin1", "statut"], [["X", "A-2", "12,50", "B0TEST0002", "Incomplet"]])[0]).toMatchObject({ sku: "A-2", preis: 12.5, status: "unvollstaendig" });
  });

  it("ohne SKU-Spalte → nichts (lieber leer als falsch)", () => expect(leseListings(["asin1", "price"], [["B0TEST0001", "1"]])).toEqual([]));

  it("fehlende und inaktive Länder je SKU", () => {
    const z = (sku: string, status: ListingZeile["status"]): ListingZeile => ({ sku, asin: null, titel: null, preis: null, menge: null, status, versand: null, erstellt: null });
    const r = fehlendeListungen({ DE: [z("A", "aktiv"), z("B", "aktiv"), z("C", "inaktiv")], FR: [z("A", "aktiv"), z("C", "inaktiv")], IT: [z("A", "inaktiv")] }, ["DE", "FR", "IT", "ES"]);
    // ES hat keinen Bericht → zählt nicht als „fehlt“; C ist nirgends aktiv → nicht gemeldet; A überall da, IT inaktiv
    expect(r).toEqual([
      { sku: "B", asin: null, titel: null, aktiv: ["DE"], inaktiv: [], fehlt: ["FR", "IT"] },
      { sku: "A", asin: null, titel: null, aktiv: ["DE", "FR"], inaktiv: ["IT"], fehlt: [] },
    ]);
  });
});

describe("Bestandsplanung (Lageralter, Aufschlag)", () => {
  const head = ["snapshot-date", "sku", "fnsku", "asin", "product-name", "available", "inv-age-0-to-30-days", "inv-age-31-to-60-days", "inv-age-61-to-90-days", "inv-age-0-to-90-days", "inv-age-91-to-180-days", "inv-age-181-to-270-days", "inv-age-181-to-330-days", "inv-age-271-to-365-days", "inv-age-365-plus-days", "currency", "estimated-storage-cost-next-month", "quantity-to-be-charged-ais-181-210-days", "estimated-ais-181-210-days", "quantity-to-be-charged-ais-241-270-days", "estimated-ais-241-270-days", "recommended-action", "fba-inventory-level-health-status"];

  it("grobe und feine Altersspalten nicht doppelt zählen; Aufschlag summieren", () => {
    const [z] = leseBestandsplanung(head, [["2026-10-28T08:00:00", "TEST-SOCKEN", "X00TEST0001", "b0test0001", "Testsocken", "25", "5", "5", "5", "15", "4", "6", "6", "2", "1", "EUR", "0,84", "4", "2.28", "2", "1.143", "Create removal order", "Excess"]]);
    expect(z.alter).toEqual({ "0-90": 15, "91-180": 4, "181-270": 6, "271-365": 2, "365+": 1 });
    expect(z).toMatchObject({ sku: "TEST-SOCKEN", asin: "B0TEST0001", verfuegbar: 25, stueckMitAufschlag: 6, aufschlagGeschaetzt: 3.42, lagerkostenNaechsterMonat: 0.84, empfehlung: "Create removal order", gesundheit: "Excess", stichtag: "2026-10-28" });
    expect(alterUeber180(z.alter)).toBe(9);
  });

  it("nur feine Stufen vorhanden → werden genommen", () => {
    const [z] = leseBestandsplanung(["sku", "inv-age-0-to-30-days", "inv-age-31-to-60-days"], [["A", "2", "3"]]);
    expect(z.alter).toEqual({ "0-30": 2, "31-60": 3 });
    expect(z.aufschlagGeschaetzt).toBeNull();
    expect(alterUeber180(z.alter)).toBe(0);
  });
});

describe("Angebote live (getItemOffers)", () => {
  const money = (Amount: number) => ({ Amount, CurrencyCode: "EUR" });
  const payload = (offers: object[], bb = true) => ({
    payload: {
      Summary: {
        TotalOfferCount: offers.length,
        NumberOfOffers: [{ condition: "new", fulfillmentChannel: "Amazon", OfferCount: 2 }, { condition: "used", fulfillmentChannel: "Amazon", OfferCount: 5 }, { condition: "new", fulfillmentChannel: "Merchant", OfferCount: 1 }],
        LowestPrices: [{ condition: "new", fulfillmentChannel: "Amazon", LandedPrice: money(9.99) }, { condition: "new", fulfillmentChannel: "Merchant", LandedPrice: money(11.98) }],
        BuyBoxPrices: bb ? [{ condition: "New", LandedPrice: money(9.99) }] : [],
        SalesRankings: [{ Rank: 1234 }],
      },
      Offers: offers,
    },
  });

  it("wir haben die Buy Box (über die eigene Händler-ID)", () => {
    const a = verdichteAngebote(payload([{ SellerId: "MEINEID", ListingPrice: money(9.99), Shipping: money(0), IsFulfilledByAmazon: true, IsBuyBoxWinner: true }, { SellerId: "A3JWKAKR8XB7XF", ListingPrice: money(10.49), Shipping: money(0), IsFulfilledByAmazon: true }]), "DE", "MEINEID");
    expect(a).toMatchObject({ buyboxPreis: 9.99, buyboxBei: "uns", angeboteGesamt: 2, angeboteFba: 2, angeboteFbm: 1, niedrigsterFba: 9.99, niedrigsterFbm: 11.98, amazonBietetMit: true, rang: 1234, waehrung: "EUR" });
    expect(a.angebote[0]).toMatchObject({ wir: true, buybox: true, amazon: false });
    expect(a.angebote[1]).toMatchObject({ wir: false, amazon: true });
  });

  it("Amazon / FBA-Händler / FBM-Händler / niemand", () => {
    const o = (SellerId: string, fba: boolean) => [{ SellerId, ListingPrice: money(8), Shipping: money(fba ? 0 : 3.99), IsFulfilledByAmazon: fba, IsBuyBoxWinner: true }];
    expect(verdichteAngebote(payload(o("A1X6FK5RDHNB96", true)), "FR", null).buyboxBei).toBe("Amazon");
    expect(verdichteAngebote(payload(o("A1ANDERER", true)), "DE", null).buyboxBei).toBe("FBA-Händler");
    expect(verdichteAngebote(payload(o("A2ANDERER", false)), "DE", "MEINEID").buyboxBei).toBe("FBM-Händler");
    // Buy-Box-Preis fehlt im Summary → aus Gewinner-Angebot (Preis + Versand)
    expect(verdichteAngebote(payload(o("A2ANDERER", false), false), "DE", null).buyboxPreis).toBe(11.99);
    expect(verdichteAngebote(payload([], false), "DE", null).buyboxBei).toBe("niemand");
    // MyOffer zählt auch ohne Händler-ID
    expect(verdichteAngebote(payload([{ SellerId: "X", MyOffer: true, IsBuyBoxWinner: true }]), "DE", null).buyboxBei).toBe("uns");
  });

  it("leere Antwort → keine Zahlen erfunden", () => {
    const a = verdichteAngebote({}, "DE", null);
    expect(a).toMatchObject({ buyboxPreis: null, buyboxBei: "niemand", angeboteGesamt: null, angeboteFba: null, angeboteFbm: null, rang: null, angebote: [] });
  });
});
