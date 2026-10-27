import { describe, expect, it } from "vitest";
import { activeItems, conditionOf, inventoryStatusXml, isInventoryManagedError, legacyItem, matchSpecifics, realGtin, tradingBody, TradingError } from "@/lib/ebay/trading-map";
import { parseXml, xmlAt, xmlList, xmlText } from "@/lib/xml";

// Ältere eBay-Angebote über die Trading API. Fiktive Angebote, Firmen und Nummern.

describe("XML-Leser", () => {
  it("Elemente, Listen, Entities, CDATA, Attribute und Namensräume", () => {
    const x = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
      <r:Root xmlns:r="urn:x"><A>1</A><B currencyID="EUR">2,50</B><L><I>x</I><I>y &amp; z</I></L><D><![CDATA[<p>roh</p>]]></D><E/><T>&lt;b&gt;fett&lt;/b&gt; &#252; &#xFC;</T></r:Root>`);
    const root = x.Root;
    expect(xmlText(xmlAt(root, "A"))).toBe("1");
    expect(xmlText(xmlAt(root, "B"))).toBe("2,50");
    expect(xmlList(xmlAt(root, "L", "I")).map((v) => xmlText(v))).toEqual(["x", "y & z"]);
    expect(xmlText(xmlAt(root, "D"))).toBe("<p>roh</p>");
    expect(xmlList(xmlAt(root, "E"))).toEqual([]);
    expect(xmlText(xmlAt(root, "T"))).toBe("<b>fett</b> ü ü");
    expect(xmlAt(root, "Fehlt", "Auch")).toBeUndefined();
  });

  it("kaputtes XML → Fehler", () => {
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(() => parseXml("<a>")).toThrow(/nicht geschlossen/);
  });
});

const ACTIVE = `<?xml version="1.0" encoding="UTF-8"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><ActiveList><ItemArray>
  <Item><ItemID>220000000001</ItemID><Title>Testkanne 1 l</Title><Quantity>6</Quantity><QuantityAvailable>4</QuantityAvailable><SellingStatus><CurrentPrice currencyID="EUR">24.9</CurrentPrice><QuantitySold>2</QuantitySold></SellingStatus><PictureDetails><GalleryURL>https://i.example/k.jpg</GalleryURL></PictureDetails><ListingDetails><ViewItemURL>https://www.ebay.de/itm/220000000001</ViewItemURL></ListingDetails></Item>
  <Item><ItemID>220000000002</ItemID><Title>Testshirt</Title><SKU>SHIRT</SKU><SellingStatus><CurrentPrice currencyID="EUR">12.99</CurrentPrice></SellingStatus><Variations>
    <Variation><SKU>S-R</SKU><StartPrice>12.99</StartPrice><Quantity>3</Quantity><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus></Variation>
    <Variation><StartPrice>11.49</StartPrice><Quantity>2</Quantity><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus></Variation>
  </Variations></Item>
</ItemArray><PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages><TotalNumberOfEntries>5</TotalNumberOfEntries></PaginationResult></ActiveList></GetMyeBaySellingResponse>`;

const ITEM = `<?xml version="1.0" encoding="UTF-8"?><GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Warning</Ack><Errors><ShortMessage>Hinweis</ShortMessage><SeverityCode>Warning</SeverityCode></Errors><Item>
  <ItemID>220000000002</ItemID><Title>Testshirt Herren</Title><Description>&lt;p&gt;Shirt &amp;amp; mehr&lt;/p&gt;</Description><ConditionID>1000</ConditionID>
  <PrimaryCategory><CategoryID>15687</CategoryID></PrimaryCategory>
  <PictureDetails><PictureURL>https://i.example/1.jpg</PictureURL><PictureURL>https://i.example/2.jpg</PictureURL></PictureDetails>
  <ItemSpecifics><NameValueList><Name>Marke</Name><Value>Testmarke</Value></NameValueList><NameValueList><Name>Farbe</Name><Value>Rot</Value><Value>Blau</Value></NameValueList><NameValueList><Name>EAN</Name><Value>Nicht zutreffend</Value></NameValueList></ItemSpecifics>
  <Regulatory><Manufacturer><CompanyName>Testmarke GmbH</CompanyName><Street1>Teststr. 1</Street1><CityName>Berlin</CityName><PostalCode>10115</PostalCode><Country>DE</Country></Manufacturer></Regulatory>
  <Variations>
    <Variation><SKU>S-R-M</SKU><StartPrice currencyID="EUR">12.99</StartPrice><Quantity>3</Quantity><VariationSpecifics><NameValueList><Name>Farbe</Name><Value>Rot</Value></NameValueList><NameValueList><Name>Größe</Name><Value>M</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus><VariationProductListingDetails><EAN>4000000000945</EAN></VariationProductListingDetails></Variation>
    <Variation><StartPrice currencyID="EUR">13.99</StartPrice><Quantity>2</Quantity><VariationSpecifics><NameValueList><Name>Farbe</Name><Value>Blau</Value></NameValueList><NameValueList><Name>Größe</Name><Value>L</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus></Variation>
    <Pictures><VariationSpecificName>Farbe</VariationSpecificName><VariationSpecificPictureSet><VariationSpecificValue>Rot</VariationSpecificValue><PictureURL>https://i.example/rot.jpg</PictureURL></VariationSpecificPictureSet></Pictures>
  </Variations>
  <SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><ListingDetails><ViewItemURL>https://www.ebay.de/itm/220000000002</ViewItemURL></ListingDetails>
</Item></GetItemResponse>`;

describe("eBay Trading API – ältere Angebote", () => {
  it("Fehler und Warnungen", () => {
    const fail = `<GetItemResponse><Ack>Failure</Ack><Errors><ShortMessage>kurz</ShortMessage><LongMessage>Der Artikel kann nicht aufgerufen werden.</LongMessage><ErrorCode>17</ErrorCode><SeverityCode>Error</SeverityCode></Errors></GetItemResponse>`;
    expect(() => tradingBody(fail, "GetItem")).toThrow("eBay (GetItem): Der Artikel kann nicht aufgerufen werden.");
    try {
      tradingBody(fail, "GetItem");
    } catch (e) {
      expect(e).toBeInstanceOf(TradingError);
      expect((e as TradingError).codes).toEqual(["17"]);
    }
    expect(() => tradingBody("<html>Wartung</html>", "GetItem")).toThrow(/unerwartete Antwort/);
    expect(() => tradingBody(ITEM, "GetItem")).not.toThrow();
  });

  it("Liste der laufenden Angebote: Menge, Preis, Varianten, Seiten", () => {
    const r = activeItems(tradingBody(ACTIVE, "GetMyeBaySelling"));
    expect(r.pages).toBe(3);
    expect(r.total).toBe(5);
    expect(r.items).toEqual([
      { itemId: "220000000001", title: "Testkanne 1 l", sku: null, price: 24.9, quantity: 4, image: "https://i.example/k.jpg", url: "https://www.ebay.de/itm/220000000001", variations: 0 },
      { itemId: "220000000002", title: "Testshirt", sku: "SHIRT", price: 11.49, quantity: 4, image: null, url: null, variations: 2 },
    ]);
  });

  it("Angebot mit Varianten (Farbe + Größe) → Form des eBay-Tools", () => {
    const { attempt: a, skus, active, url } = legacyItem(tradingBody(ITEM, "GetItem"));
    expect(active).toBe(true);
    expect(url).toBe("https://www.ebay.de/itm/220000000002");
    expect(a).toMatchObject({ id: 0, sku: "EB-220000000002", listingId: "220000000002", status: "published", condition: "NEW", price: 12.99, quantity: 4, categoryId: "15687", title: "Testshirt Herren", ean: "" });
    expect(a.description).toBe("<p>Shirt &amp; mehr</p>");
    expect(a.imageUrls).toEqual(["https://i.example/1.jpg", "https://i.example/2.jpg"]);
    expect(a.aspects).toEqual({ Marke: ["Testmarke"], Farbe: ["Rot", "Blau"] });
    expect(a.gpsr?.manufacturer).toEqual({ companyName: "Testmarke GmbH", addressLine1: "Teststr. 1", city: "Berlin", postalCode: "10115", country: "DE" });
    expect(a.variants?.name).toBe("Farbe / Größe");
    expect(a.variants?.items.map((i) => [i.value, i.sku, i.price, i.quantity, i.ean ?? null, i.imageUrl ?? null])).toEqual([
      ["Rot / M", "S-R-M", 12.99, 2, "4000000000945", "https://i.example/rot.jpg"],
      ["Blau / L", "EB-220000000002-V2", 13.99, 2, null, null],
    ]);
    expect(skus).toEqual([
      { sku: "S-R-M", ebaySku: "S-R-M", specifics: [{ name: "Farbe", value: "Rot" }, { name: "Größe", value: "M" }], quantity: 2 },
      { sku: "EB-220000000002-V2", ebaySku: null, specifics: [{ name: "Farbe", value: "Blau" }, { name: "Größe", value: "L" }], quantity: 2 },
    ]);
  });

  it("einfaches Angebot ohne SKU, EAN aus den Merkmalen, gebraucht", () => {
    const xml = `<GetItemResponse><Ack>Success</Ack><Item><ItemID>9</ItemID><Title>Kamera</Title><StartPrice>49.00</StartPrice><Quantity>3</Quantity><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus><ConditionID>3000</ConditionID>
      <ItemSpecifics><NameValueList><Name>EAN</Name><Value>4000000000938</Value></NameValueList></ItemSpecifics></Item></GetItemResponse>`;
    const { attempt: a, skus } = legacyItem(tradingBody(xml, "GetItem"));
    expect(a).toMatchObject({ sku: "EB-9", ean: "4000000000938", price: 49, quantity: 2, condition: "USED_VERY_GOOD" });
    expect(a.aspects).toEqual({});
    expect(skus).toEqual([{ sku: "EB-9", ebaySku: null, specifics: [], quantity: 2 }]);
  });

  it("Zustand, EAN-Prüfung, Mengen-Anfrage, Varianten zu Bestellpositionen", () => {
    expect(conditionOf("1000")).toBe("NEW");
    expect(conditionOf("")).toBe("NEW");
    expect(conditionOf("1500")).toBe("NEW_OTHER");
    expect(conditionOf("6000")).toBe("USED_ACCEPTABLE");
    expect(realGtin("Nicht zutreffend")).toBeUndefined();
    expect(realGtin("0000000000000")).toBeUndefined();
    expect(realGtin(" 4000000000938 ")).toBe("4000000000938");
    expect(inventoryStatusXml("9", 4)).toBe("<InventoryStatus><ItemID>9</ItemID><Quantity>4</Quantity></InventoryStatus>");
    expect(inventoryStatusXml("9", -2, "A&B")).toBe("<InventoryStatus><ItemID>9</ItemID><SKU>A&amp;B</SKU><Quantity>0</Quantity></InventoryStatus>");
    const stored = [{ name: "Farbe", value: "Blau" }, { name: "Größe", value: "L" }];
    expect(matchSpecifics(stored, [{ name: "Größe", value: "L" }, { name: "Farbe", value: "blau" }])).toBe(true);
    expect(matchSpecifics(stored, [{ name: "Farbe", value: "Rot" }, { name: "Größe", value: "L" }])).toBe(false);
    expect(matchSpecifics([], [])).toBe(true);
  });
});

describe("Angebote aus der Inventory API (anderes Programm)", () => {
  it("erkennt eBays Ablehnung beim Ändern über die Trading API – deutsch und englisch", () => {
    const de = `<ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Failure</Ack><Errors><ShortMessage>Warenbestandsbasierte Angebote</ShortMessage><LongMessage>Die warenbestandsbasierte Angebotsverwaltung wird derzeit von diesem Tool nicht unterstützt. Bitte probieren Sie es mit dem Tool, in dem Sie das Angebot erstellt haben.</LongMessage><ErrorCode>99999</ErrorCode><SeverityCode>Error</SeverityCode></Errors></ReviseFixedPriceItemResponse>`;
    let err: unknown;
    try {
      tradingBody(de, "ReviseFixedPriceItem");
    } catch (e) {
      err = e;
    }
    expect(isInventoryManagedError(err)).toBe(true);
    expect(isInventoryManagedError(new TradingError("eBay (ReviseInventoryStatus): Inventory-based listing management is not currently supported by this tool.", []))).toBe(true);
    expect(isInventoryManagedError(new TradingError("eBay (ReviseFixedPriceItem): Der Titel ist zu lang.", []))).toBe(false);
    expect(isInventoryManagedError("warenbestandsbasiert")).toBe(false);
  });
  it("erkennt die Ablehnung auch an eBays Fehlernummer und trotz unsichtbarer Zeichen", () => {
    expect(isInventoryManagedError(new TradingError("eBay (ReviseFixedPriceItem): Vorgang nicht möglich.", ["21919474"]))).toBe(true);
    expect(isInventoryManagedError(new TradingError("eBay (ReviseFixedPriceItem): Die warenbestands\u00ADbasierte Angebotsverwaltung wird derzeit nicht unterstützt.", []))).toBe(true);
    expect(isInventoryManagedError(new TradingError("eBay (ReviseFixedPriceItem): This operation is not allowed for inventory items.", []))).toBe(true);
    expect(isInventoryManagedError(new TradingError("eBay (ReviseFixedPriceItem): Der Preis ist zu niedrig.", ["21919999"]))).toBe(false);
  });
});
