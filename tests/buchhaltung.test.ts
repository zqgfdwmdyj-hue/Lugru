import { describe, expect, it } from "vitest";
import { abgleichen, abstimmungsgrad, amexZeitraum, type Beleg, type Zahlung } from "@/lib/buchhaltung/abgleich";
import { amexDatum, leseAmex } from "@/lib/buchhaltung/amex";
import { alsCp1252, belegfeld, DATEV_SPALTEN, datevBuchungsstapel, datevKopfzeile } from "@/lib/buchhaltung/datev";
import { kontoVorschlag, regelSchluessel, ustSatzAus, wirktEu } from "@/lib/buchhaltung/kontierung";
import { leseUstBericht } from "@/lib/buchhaltung/ust-bericht";

// Modul 5 – Buchhaltung (erfundene Zahlungen und Belege).

const enc = (s: string) => new TextEncoder().encode(s);
const bank = (id: string, datum: string, betrag: number, gegenpartei: string, zweck = ""): Zahlung => ({ id, datum, betrag, gegenpartei, zweck, quelle: "bank" });
const karte = (id: string, datum: string, betrag: number, text: string): Zahlung => ({ id, datum, betrag, gegenpartei: text, zweck: "", quelle: "kreditkarte" });
const beleg = (id: string, datum: string, brutto: number, nummer: string | null, lieferant: string | null, gutschrift = false): Beleg => ({ id, datum, brutto, nummer, lieferant, gutschrift });

describe("Amex-CSV", () => {
  it("deutsches Datum TT/MM/JJJJ, Belastung positiv → negativ gespeichert, Doppelte gezählt", () => {
    const csv = 'Datum,Beschreibung,Karteninhaber,Konto #,Betrag,Betreff\n03/10/2026,TESTSOFTWARE ABO,MAX TEST,-11001,"29,99",\'AT1\'\n03/10/2026,TESTSOFTWARE ABO,MAX TEST,-11001,"29,99",\'AT1\'\n15/10/2026,ZAHLUNG ERHALTEN. VIELEN DANK,MAX TEST,-11001,"-59,98",\n';
    const a = leseAmex(enc(csv));
    expect(a.umsaetze).toHaveLength(3);
    expect(a.umsaetze[0]).toMatchObject({ buchungstag: "2026-10-03", betrag: -29.99, referenz: "AT1" });
    expect(a.umsaetze[0].schluessel).not.toBe(a.umsaetze[1].schluessel);
    expect(a).toMatchObject({ belastungen: 59.98, gutschriften: 59.98, von: "2026-10-03", bis: "2026-10-15" });
    expect(amexDatum("02/11/2026")).toBe("2026-11-02");
    expect(() => leseAmex(enc("foo,bar\n1,2\n"))).toThrow(/Datum/);
  });
});

describe("Abgleich Zahlung ↔ Beleg", () => {
  const belege = [
    beleg("b1", "2026-10-01", 119, "RE-2026-0815", "Testlieferant GmbH"),
    beleg("b2", "2026-10-05", 59.5, "A-77", "Kartonwelt Test GmbH"),
    beleg("b3", "2026-10-10", 1000, "INV-9001", "Großhandel Test AG"),
    beleg("b4", "2026-10-12", 42, null, "Unbekannt"),
  ];
  it("1) Rechnungsnummer im Verwendungszweck → hoch; Teilzahlung → mittel", () => {
    const r = abgleichen([bank("z1", "2026-10-20", -119, "Irgendwer", "Rechnung RE 2026 0815"), bank("z2", "2026-10-21", -400, "Großhandel Test AG", "INV9001 Anzahlung")], belege);
    expect(r.vorschlaege.find((v) => v.zahlungId === "z1")).toMatchObject({ belegId: "b1", sicherheit: "hoch" });
    expect(r.vorschlaege.find((v) => v.zahlungId === "z2")).toMatchObject({ belegId: "b3", sicherheit: "mittel", betrag: 400 });
    expect(r.vorschlaege.find((v) => v.zahlungId === "z2")!.regel).toMatch(/Teilzahlung \(600 € offen\)/);
  });
  it("2) Betrag + Lieferant ±3 Tage → hoch, später → mittel; Teilzahlungen ergeben zusammen den Beleg", () => {
    const r = abgleichen([bank("z3", "2026-10-07", -59.5, "KARTONWELT TEST GMBH", "Kd 123")], belege);
    expect(r.vorschlaege[0]).toMatchObject({ belegId: "b2", sicherheit: "hoch" });
    const spaeter = abgleichen([bank("z3", "2026-10-30", -59.5, "Kartonwelt Test", "")], belege);
    expect(spaeter.vorschlaege[0]).toMatchObject({ belegId: "b2", sicherheit: "mittel" });
    const teil = abgleichen([bank("t1", "2026-10-11", -500, "Großhandel Test AG", "Rate 1"), bank("t2", "2026-10-25", -500, "Großhandel Test AG", "Rate 2")], belege);
    expect(teil.vorschlaege.filter((v) => v.belegId === "b3")).toHaveLength(2);
  });
  it("3) Betrag + Datum ±5 Tage ohne Namen → mittel", () => {
    const r = abgleichen([bank("z4", "2026-10-14", -42, "PAYPAL EUROPE", "PP.1234")], belege);
    expect(r.vorschlaege[0]).toMatchObject({ belegId: "b4", sicherheit: "mittel" });
  });
  it("Amex-Sammelabbuchung = Summe der Kartenumsätze des Zeitraums", () => {
    const k = [karte("k0", "2026-08-30", -10, "ALT"), karte("k1", "2026-09-02", -1200, "LIEFERANT A"), karte("k2", "2026-09-15", -1600, "LIEFERANT B"), karte("k3", "2026-09-28", -1000, "LIEFERANT C"), karte("k4", "2026-10-15", 3800, "ZAHLUNG ERHALTEN. VIELEN DANK")];
    const l = bank("a1", "2026-10-15", -3800, "American Express Europe S.A.", "Kartenabrechnung");
    expect(amexZeitraum(l, k)).toEqual({ ids: ["k1", "k2", "k3"], von: "2026-09-02", bis: "2026-09-28" });
    const r = abgleichen([l, k[4]], [], { karte: k });
    expect(r.vorschlaege.find((v) => v.zahlungId === "a1")).toMatchObject({ art: "amex_sammel", sicherheit: "hoch", kartenUmsaetze: ["k1", "k2", "k3"] });
    expect(r.vorschlaege.find((v) => v.zahlungId === "k4")).toMatchObject({ art: "ohne_beleg", sicherheit: "hoch" });
  });
  it("Amazon-Auszahlung mit Abrechnung → hoch; ohne → mittel; Bankentgelt ohne Beleg", () => {
    const z = [bank("m1", "2026-10-09", 4321.09, "AMAZON PAYMENTS EUROPE S.C.A.", "Settlement 123"), bank("m2", "2026-10-23", 1000, "AMAZON PAYMENTS EUROPE S.C.A.", ""), bank("e1", "2026-10-31", -12.9, "Sparkasse Test", "Entgeltabschluss 10/2026")];
    const r = abgleichen(z, [], { abrechnungen: [{ id: "S-1", auszahlung: "2026-10-08", betrag: 4321.09, markt: "amazon" }] });
    expect(r.vorschlaege.map((v) => [v.zahlungId, v.art, v.sicherheit])).toEqual([
      ["m1", "marktplatz", "hoch"],
      ["m2", "marktplatz", "mittel"],
      ["e1", "ohne_beleg", "hoch"],
    ]);
  });
  it("Abnahme: ein Monat mit Sparkasse + Amex → mindestens 80 % automatisch (hoch)", () => {
    const k = [karte("k1", "2026-09-05", -29.99, "TESTSOFTWARE"), karte("k2", "2026-09-12", -70.01, "TESTHOTEL"), karte("k3", "2026-10-16", 100, "ZAHLUNG ERHALTEN")];
    const zahlungen = [
      bank("z1", "2026-10-02", -119, "Testlieferant GmbH", "RE-2026-0815"),
      bank("z2", "2026-10-06", -59.5, "Kartonwelt Test GmbH", ""),
      bank("z3", "2026-10-09", 4321.09, "AMAZON PAYMENTS EUROPE", ""),
      bank("z4", "2026-10-16", -100, "American Express", "Abrechnung"),
      bank("z5", "2026-10-31", -12.9, "Sparkasse", "Entgeltabschluss"),
      karte("k1", "2026-09-05", -29.99, "TESTSOFTWARE"),
      karte("k2", "2026-09-12", -70.01, "TESTHOTEL"),
      k[2],
      bank("z6", "2026-10-20", -77.7, "Unbekannt", ""),
    ];
    const bl = [...belege, beleg("b5", "2026-09-05", 29.99, "SW-1", "Testsoftware Ltd"), beleg("b6", "2026-09-12", 70.01, "H-9", "Testhotel")];
    const r = abgleichen(zahlungen, bl, { karte: k, abrechnungen: [{ id: "S-1", auszahlung: "2026-10-08", betrag: 4321.09, markt: "amazon" }] });
    const hoch = r.vorschlaege.filter((v) => v.sicherheit === "hoch").length;
    expect(abstimmungsgrad(hoch, zahlungen.length)!).toBeGreaterThanOrEqual(80);
    expect(r.ohneZuordnung.map((z) => z.id)).toEqual(["z6"]);
  });
});

describe("Vorkontierung SKR04", () => {
  const leer = new Map<string, { konto: string; bu: string | null }>();
  it("Wareneinkauf 19 % → 5400 (Automatik, ohne BU); Versand → 6740 mit BU 9; Bankentgelt-Regel; gelernt geht vor", () => {
    expect(kontoVorschlag({ lieferant: "Großhandel Test AG", text: "", kind: "goods", ustSatz: 0.19 }, leer)).toMatchObject({ konto: "5400", bu: null, sicherheit: "hoch" });
    expect(kontoVorschlag({ lieferant: "DHL Paket GmbH", text: "Versand", kind: "expense", ustSatz: 0.19 }, leer)).toMatchObject({ konto: "6740", bu: "9" });
    expect(kontoVorschlag({ lieferant: "Unbekannt", text: "", kind: "expense", ustSatz: 0.07 }, leer)).toMatchObject({ konto: "6300", bu: "8", sicherheit: "niedrig" });
    const gelernt = new Map([[regelSchluessel("DHL Paket GmbH")!, { konto: "6800", bu: "9" }]]);
    expect(kontoVorschlag({ lieferant: "DHL Paket GmbH", text: "", kind: "expense", ustSatz: 0.19 }, gelernt)).toMatchObject({ konto: "6800", sicherheit: "hoch" });
  });
  it("EU-Lieferant ohne USt → Hinweis Reverse Charge, kein BU", () => {
    expect(wirktEu("Amazon EU S.à r.l.", "Luxembourg")).toBe(true);
    const v = kontoVorschlag({ lieferant: "Amazon EU S.à r.l.", text: "Seller Fees Verkaufsgebühren", kind: "expense", ustSatz: 0, eu: true }, leer);
    expect(v).toMatchObject({ konto: "6770", bu: null });
    expect(v.hinweis).toMatch(/Reverse Charge/);
  });
  it("USt-Satz aus Netto/Brutto", () => {
    expect(ustSatzAus(100, 119)).toBe(0.19);
    expect(ustSatzAus(100, 107)).toBe(0.07);
    expect(ustSatzAus(100, 100)).toBe(0);
    expect(ustSatzAus(100, 112)).toBeNull();
  });
});

describe("DATEV-Export", () => {
  it("Kopf EXTF 700/21, 116 Spalten, Zeile mit Komma-Betrag und TTMM, CP1252", () => {
    const kopf = { beraternummer: "1001", mandantennummer: "20002", wjBeginn: "2026-01-01", von: "2026-10-01", bis: "2026-10-31", bezeichnung: "Oktober 2026", kontenrahmen: "SKR04" as const, festschreibung: false, erzeugt: new Date("2026-11-02T08:00:00Z") };
    expect(datevKopfzeile(kopf).split(";")).toHaveLength(31);
    expect(datevKopfzeile(kopf)).toMatch(/^"EXTF";700;21;"Buchungsstapel";13;20261102080000000;;"RE";"";"";1001;20002;20260101;4;20261001;20261031;"Oktober 2026"/);
    expect(DATEV_SPALTEN).toHaveLength(116);
    const text = datevBuchungsstapel(kopf, [{ betrag: 59.5, sollHaben: "S", konto: "6710", gegenkonto: "1800", bu: "9", datum: "2026-10-07", belegfeld1: "A-77 / X", text: "Kartonwelt „Test“ – Kartons" }]);
    const zeilen = text.split("\r\n");
    expect(zeilen[2].split(";")).toHaveLength(116);
    expect(zeilen[2]).toMatch(/^59,50;"S";"EUR";;;;6710;1800;"9";0710;"A-77\/X";;;"Kartonwelt „Test“ – Kartons"/);
    expect(belegfeld("RE 2026/08#15")).toBe("RE2026/0815");
    const bytes = alsCp1252("€ „ä“");
    expect([...bytes]).toEqual([0x80, 0x20, 0x84, 0xe4, 0x93]);
  });
});

describe("Amazon-Umsatzsteuerbericht", () => {
  it("Summen je Land/Verfahren, Hinweise zu Auslandslagern, OSS und Verbringen", () => {
    const csv = [
      "TRANSACTION_TYPE,TRANSACTION_COMPLETE_DATE,TAXABLE_JURISDICTION,TAX_REPORTING_SCHEME,TAX_COLLECTION_RESPONSIBILITY,SALE_DEPART_COUNTRY,SALE_ARRIVAL_COUNTRY,PRICE_OF_ITEMS_VAT_RATE_PERCENT,TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL,TOTAL_ACTIVITY_VALUE_VAT_AMT,TRANSACTION_CURRENCY_CODE",
      "SALE,03-10-2026,DE,REGULAR,SELLER,DE,DE,0.19,100.00,19.00,EUR",
      "SALE,04-10-2026,FR,REGULAR,SELLER,FR,FR,0.2,50.00,10.00,EUR",
      "SALE,05-10-2026,IT,UNION-OSS,SELLER,DE,IT,0.22,40.00,8.80,EUR",
      "FC_TRANSFER,06-10-2026,,,,DE,PL,,200.00,0,EUR",
      "REFUND,07-10-2026,DE,REGULAR,SELLER,DE,DE,0.19,-10.00,-1.90,EUR",
    ].join("\n");
    const a = leseUstBericht(enc(csv));
    expect(a.zeilen.find((z) => z.land === "FR")).toMatchObject({ netto: 50, ust: 10, satz: 0.2 });
    expect(a.zeitraum).toEqual({ von: "2026-10-03", bis: "2026-10-07" });
    expect(a.transfers).toEqual([{ von: "DE", nach: "PL", netto: 200, anzahl: 1 }]);
    expect(a.hinweise.join(" ")).toMatch(/Frankreich: Verkäufe mit Steuerpflicht/);
    expect(a.hinweise.join(" ")).toMatch(/OSS/);
    expect(a.hinweise.join(" ")).toMatch(/Deutschland → Polen/);
  });
});
