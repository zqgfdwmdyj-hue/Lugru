import { describe, expect, it } from "vitest";
import { parseAddress, parseItems, parsePackingSlip, shipChoice, slipDate } from "@/lib/shipping/packing-slip";

// Amazon-Lieferscheine – Aufbau wie der Text aus Seller Central, alle Namen, Adressen und Nummern erfunden.

const item = (q: number, title: string[], sku: string, lineId: string, price = "9,99 €") =>
  [`${q} ${title[0]}`, ...title.slice(1), `SKU: ${sku}`, "ASIN: B000TEST01", "Zustand: Neu", "Bestellposten-ID:", lineId, price, "Enthaltene Umsatzsteuer", `Zwischensumme Artikel ${price} 1,00 €`, `Gesamtbetrag Artikel ${price} 1,00 €`];

const page = (o: { no: string; addr: string[]; items: string[][]; n?: number }) =>
  [
    "Lieferanschrift:", ...o.addr, "Bestellt am:", "Versandart:", "Name des Käufers:", "Name des Verkäufers:", "Mi., 28. Okt. 2026", "Standard", "Erika", "Testfirma GmbH",
    "Liefern an:", ...o.addr,
    `Bestellnummer: ${o.no}`, "Vielen Dank für Ihren Einkauf bei Testfirma GmbH auf Amazon.de Marketplace.",
    "Menge Produktdetails Preis pro Einheit Gesamtbestellsumme",
    ...o.items.flat(),
    "Gesamtbetrag: 9,99 €",
    "Vielen Dank für Ihren Einkauf bei Amazon Marketplace! Unter www.amazon.de/feedback können Sie",
    `Seite ${o.n ?? 1} von 3`,
  ].join("\n");

describe("Adresse", () => {
  it("Name, Straße mit Hausnummer, PLZ/Ort, Deutschland", () => {
    const { address, warnings } = parseAddress(["Erika Musterfrau", "Musterstr. 12a", "12345 Musterstadt (Ems)", "Deutschland"]);
    expect(address).toEqual({ name1: "Erika Musterfrau", street: "Musterstr.", houseNo: "12a", zip: "12345", city: "Musterstadt (Ems)", country: "DEU" });
    expect(warnings).toEqual([]);
  });
  it("Zusatzzeile (Firma, c/o) wird zu name2", () => {
    const { address } = parseAddress(["Max Mustermann", "c/o Beispiel GmbH", "Hauptstraße 5", "54321 Beispielort", "Deutschland"]);
    expect(address.name2).toBe("c/o Beispiel GmbH");
    expect(address.street).toBe("Hauptstraße");
    expect(address.houseNo).toBe("5");
  });
  it("Packstation: Postnummer als Zusatz, keine Hausnummer-Warnung", () => {
    const { address, warnings } = parseAddress(["Max Mustermann", "1234567890", "Packstation 123", "10115 Berlin", "Deutschland"]);
    expect(address).toMatchObject({ name2: "1234567890", street: "Packstation", houseNo: "123", zip: "10115" });
    expect(warnings).toEqual([]);
  });
  it("Österreich mit vierstelliger PLZ, unbekanntes Land als Warnung", () => {
    expect(parseAddress(["Anna Test", "Testgasse 7", "1010 Wien", "Österreich"]).address).toMatchObject({ zip: "1010", city: "Wien", country: "AUT" });
    expect(parseAddress(["Anna Test", "Testweg 1", "12345 Ort", "Atlantis"]).warnings[0]).toContain("Atlantis");
  });
  it("unvollständige Adresse wird gemeldet", () => {
    expect(parseAddress(["Nur Name", "Deutschland"]).warnings[0]).toContain("unvollständig");
  });
});

describe("Positionen", () => {
  it("Menge, mehrzeiliger Titel, SKU, ASIN, Posten-ID – Titel darf mit Zahlen weitergehen", () => {
    const items = parseItems(item(2, ["Testsocken 6 X Paar 2 X 3er", "Pack Farbe: Weiß,", "Größe: L = 42-46"], "TEST-SKU-1", "11112222333344"));
    expect(items).toEqual([{ quantity: 2, title: "Testsocken 6 X Paar 2 X 3er Pack Farbe: Weiß, Größe: L = 42-46", sku: "TEST-SKU-1", asin: "B000TEST01", lineId: "11112222333344" }]);
  });
  it("mehrere Positionen werden addiert", () => {
    const items = parseItems([...item(1, ["Artikel A"], "SKU-A", "10000000000001"), ...item(3, ["Artikel B"], "SKU-B", "10000000000002")]);
    expect(items.map((i) => [i.quantity, i.sku])).toEqual([[1, "SKU-A"], [3, "SKU-B"]]);
  });
});

describe("Lieferschein", () => {
  const addr = ["Erika Musterfrau", "Musterstr. 12a", "12345 Musterstadt", "Deutschland"];
  it("je Seite eine Bestellung; Stückzahl entscheidet die Versandart", () => {
    const orders = parsePackingSlip([
      page({ no: "301-1111111-1111111", addr, items: [item(1, ["Artikel A"], "SKU-A", "10000000000001")] }),
      page({ no: "302-2222222-2222222", addr, items: [item(2, ["Artikel A"], "SKU-A", "10000000000002")], n: 2 }),
      page({ no: "303-3333333-3333333", addr, items: [item(1, ["Artikel A"], "SKU-A", "10000000000003"), item(1, ["Artikel B"], "SKU-B", "10000000000004")], n: 3 }),
    ]);
    expect(orders.map((o) => [o.orderNo, o.quantity, shipChoice(o)])).toEqual([
      ["301-1111111-1111111", 1, "warensendung"],
      ["302-2222222-2222222", 2, "dhl"],
      ["303-3333333-3333333", 2, "dhl"],
    ]);
    expect(orders[0].shipTo).toMatchObject({ name1: "Erika Musterfrau", zip: "12345", country: "DEU" });
    expect(orders[0].orderDate).toBe("2026-10-28");
    expect(orders[0].warnings).toEqual([]);
  });
  it("Bestellung über zwei Seiten wird zusammengefasst, gleiche Posten nur einmal", () => {
    const p1 = page({ no: "304-4444444-4444444", addr, items: [item(1, ["Artikel A"], "SKU-A", "10000000000005")] });
    const p2 = ["Menge Produktdetails Preis pro Einheit Gesamtbestellsumme", ...item(1, ["Artikel B"], "SKU-B", "10000000000006"), ...item(1, ["Artikel A"], "SKU-A", "10000000000005"), "Gesamtbetrag: 9,99 €"].join("\n");
    const [o] = parsePackingSlip([p1, p2]);
    expect(o.pages).toEqual([1, 2]);
    expect(o.quantity).toBe(2);
    expect(shipChoice(o)).toBe("dhl");
  });
  it("unsichere Daten → prüfen statt automatisch; Ausland mit 1 Stück → DHL", () => {
    const [bad] = parsePackingSlip([page({ no: "305-5555555-5555555", addr: ["Nur Name", "Deutschland"], items: [item(1, ["Artikel A"], "SKU-A", "10000000000007")] })]);
    expect(shipChoice(bad)).toBe("pruefen");
    const [noItems] = parsePackingSlip([page({ no: "306-6666666-6666666", addr, items: [] })]);
    expect(shipChoice(noItems)).toBe("pruefen");
    const [at] = parsePackingSlip([page({ no: "307-7777777-7777777", addr: ["Anna Test", "Testgasse 7", "1010 Wien", "Österreich"], items: [item(1, ["Artikel A"], "SKU-A", "10000000000008")] })]);
    expect(shipChoice(at)).toBe("dhl");
  });
  it("Seiten ohne Bestellnummer vor der ersten Bestellung werden ignoriert", () => {
    expect(parsePackingSlip(["Deckblatt\nirgendwas"])).toEqual([]);
  });
});

describe("Bestelldatum", () => {
  it("deutsche Monatsnamen, auch März und ausgeschrieben", () => {
    expect(slipDate("Mi., 28. Okt. 2026")).toBe("2026-10-28");
    expect(slipDate("Mo., 3. März 2026")).toBe("2026-03-03");
    expect(slipDate("Fr., 1. Mai 2026")).toBe("2026-05-01");
    expect(slipDate("kein Datum")).toBeNull();
  });
});
