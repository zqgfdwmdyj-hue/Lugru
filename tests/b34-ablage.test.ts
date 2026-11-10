import { describe, expect, it } from "vitest";
import { leseKontoauszug, leseMt940, lesePaypal } from "@/lib/bank/logic";
import { abgleichCsv, abgleichen, type Beleg, type Zahlung } from "@/lib/buchhaltung/abgleich";
import { dubletteVon, entgeltAusText, entgeltSeite, lieferantAusText, namensTeil, zielName, zielOrdner } from "@/lib/belege/ablage-logic";
import { istKontoauszugText, pdfArt, tabellenArt } from "@/lib/uploads/erkennen";

// B34.2 Download-Ordner, Dubletten, Zahlungsabgleich – nur erfundene Daten (Testlieferant, Testbank, DE00…).

describe("B34.2 Umbenennen und Ordner", () => {
  it("Zielname JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr", () => {
    expect(zielName({ datum: "2026-11-03", lieferant: "Testlieferant GmbH", betrag: 119, nummer: "RE-1001" }, ".PDF")).toBe("2026-11-03_Testlieferant-GmbH_119,00_RE-1001.pdf");
    expect(zielName({ datum: null, lieferant: null, betrag: null, nummer: null }, "jpg")).toBe("ohne-Datum_unbekannt_ohne-Betrag_ohne-Nr.jpg");
    expect(zielName({ datum: "2026-11-05", lieferant: "Test/Shop: A*B", betrag: -12.5, nummer: "2026/77" }, ".pdf")).toBe("2026-11-05_Test-Shop-A-B_12,50_2026-77.pdf");
  });
  it("Ordner je Monat und Lieferant", () => {
    expect(zielOrdner({ datum: "2026-11-03", lieferant: "Testlieferant GmbH", betrag: 1, nummer: null }, "2026-12-01")).toBe("2026-11/Testlieferant-GmbH");
    expect(zielOrdner({ datum: null, lieferant: null, betrag: null, nummer: null }, "2026-12-01")).toBe("2026-12/unbekannt");
    expect(namensTeil("  a.. ")).toBe("a");
  });
});

describe("B34.2 Dubletten", () => {
  const alt = [{ id: "a", hash: "h1", nummer: "RE-1001", betrag: 119 }, { id: "b", hash: "h2", nummer: "RE 2002", betrag: 50 }];
  it("gleiche Prüfsumme", () => expect(dubletteVon({ hash: "h1", nummer: null, betrag: null }, alt)).toEqual({ id: "a", grund: "gleiche Datei (Prüfsumme)" }));
  it("gleiche Nummer + Betrag (Schreibweise egal)", () => expect(dubletteVon({ hash: "x", nummer: "re2002", betrag: -50 }, alt)?.id).toBe("b"));
  it("gleiche Nummer, anderer Betrag → keine Dublette", () => expect(dubletteVon({ hash: "x", nummer: "RE-1001", betrag: 120 }, alt)).toBeNull());
});

describe("B34.2 Lieferant aus dem Text", () => {
  const text = "Rechnung\nTestlieferant GmbH · Handelsweg 1 · 12345 Musterstadt\nRechnung an:\nTestfirma GmbH\nRechnungsnummer RE-1001";
  it("erste Firma mit Rechtsform, eigene Firma übersprungen", () => {
    expect(lieferantAusText(text, { eigene: ["Testfirma"] })).toBe("Testlieferant GmbH");
    expect(lieferantAusText("Testfirma GmbH\nAndere Test AG\n", { eigene: ["Testfirma"] })).toBe("Andere Test AG");
  });
  it("bekannter Lieferant aus den Stammdaten geht vor", () => expect(lieferantAusText(text, { bekannt: ["Testlieferant"], eigene: ["Testfirma"] })).toBe("Testlieferant"));
});

describe("B34.2 Kontoauszug nicht als Rechnung", () => {
  const auszug = "Testbank\nKontoauszug Nr. 11/2026\nIBAN DE00 1234 5678 9012 3456 78\nBuchungstag Wert Vorgang Betrag\n03.11.2026 03.11.2026 Lastschrift Testlieferant -119,00\n04.11.2026 04.11.2026 Gutschrift Testkunde 250,00\nNeuer Kontostand 1.234,56";
  const rechnung = "Rechnung\nTestlieferant GmbH\nRechnungsnummer: RE-1001\nRechnungsdatum 03.11.2026\nGesamtbetrag 119,00 EUR\nBankverbindung: Testbank IBAN DE00 1234 5678 9012 3456 78";
  it("Kontoauszug erkannt, Rechnung mit IBAN im Fuß nicht", () => {
    expect(istKontoauszugText(auszug)).toBe(true);
    expect(pdfArt(auszug)).toBe("kontoauszug");
    expect(istKontoauszugText(rechnung)).toBe(false);
    expect(pdfArt(rechnung)).toBe("beleg");
  });
  it("Umsatzübersicht ohne Wort „Kontoauszug“ (Buchungstag/Wert-Spalten, mehrere Buchungen)", () => {
    expect(istKontoauszugText("Umsätze Girokonto\nBuchungstag Wertstellung Text Betrag\n01.11.2026 01.11.2026 Miete -500,00\n02.11.2026 02.11.2026 Testkunde 99,00")).toBe(true);
  });
});

describe("B34.2 Entgeltabschluss als eigener Beleg", () => {
  const seiten = ["Kontoauszug Seite 1 … 03.11.2026 -12,00", "Seite 2", "Testbank Sparkasse Musterstadt\nEntgeltabschluss\nAbrechnungszeitraum 01.10.2026 - 31.10.2026\nKontoführung 6,90\nBuchungen 3,10\nSumme Entgelte 10,00\nAbschluss per 31.10.2026"];
  it("Seite finden und Betrag/Zeitraum lesen", () => {
    expect(entgeltSeite(seiten)).toBe(2);
    expect(entgeltAusText(seiten[2])).toEqual({ betrag: 10, datum: "2026-10-31", zeitraum: "01.10.2026–31.10.2026", bank: "Sparkasse Musterstadt" });
    expect(entgeltSeite(["ohne Abschluss 1,00"])).toBeNull();
  });
  it("Abgleich ordnet die Entgelt-Buchung dem Beleg zu", () => {
    const z: Zahlung[] = [{ id: "z1", datum: "2026-10-31", betrag: -10, gegenpartei: "", zweck: "Entgeltabschluss 10/2026", quelle: "bank" }];
    const b: Beleg[] = [{ id: "b1", datum: "2026-10-31", brutto: 10, nummer: "Entgelt 01.10.2026–31.10.2026", lieferant: "Sparkasse Musterstadt", gutschrift: false }];
    expect(abgleichen(z, b).vorschlaege[0]).toMatchObject({ belegId: "b1", art: "beleg", sicherheit: "hoch" });
    expect(abgleichen(z, []).vorschlaege[0]).toMatchObject({ belegId: null, art: "ohne_beleg" });
  });
});

describe("B34.2 MT940 und PayPal", () => {
  const mt = [":20:STARTUMS", ":25:DE00123456789012345678", ":28C:11/1", ":60F:C261031EUR1000,00", ":61:2611031103DR119,00NDDTNONREF", ":86:105?00LASTSCHRIFT?20SVWZ+RE-1001 Testware?32Testlieferant GmbH?31DE11222233334444555566", ":61:2611041104CR250,00NTRFNONREF", ":86:166?00GUTSCHRIFT?20Bestellung 77?32Testkunde", ":62F:C261104EUR1131,00", "-"].join("\r\n");
  it("MT940: Umsätze, Vorzeichen, Gegenpartei, Zweck, Schlusssaldo", () => {
    const a = leseMt940(mt);
    expect(a.format).toBe("mt940");
    expect(a.konto).toBe("DE00123456789012345678");
    expect(a.umsaetze.map((u) => [u.buchungstag, u.betrag, u.gegenpartei, u.zweck])).toEqual([
      ["2026-11-03", -119, "Testlieferant GmbH", "RE-1001 Testware"],
      ["2026-11-04", 250, "Testkunde", "Bestellung 77"],
    ]);
    expect(a.umsaetze[0].iban).toBe("DE11222233334444555566");
    expect(a.salden).toEqual([{ datum: "2026-11-04", saldo: 1131 }]);
    expect(leseKontoauszug(new TextEncoder().encode(mt)).format).toBe("mt940");
  });
  const pp = ['"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Absender E-Mail-Adresse","Empfänger E-Mail-Adresse","Transaktionscode","Artikelbezeichnung","Rechnungsnummer","Guthaben"', '"03.11.2026","10:00:00","CET","Testshop","Handyzahlung","Abgeschlossen","EUR","-49,99","0,00","-49,99","a@example.invalid","shop@example.invalid","1TEST000000000001","Testware","TS-55","0,00"', '"04.11.2026","11:00:00","CET","Testkunde","Zahlung erhalten","Abgeschlossen","EUR","30,00","-0,92","29,08","k@example.invalid","a@example.invalid","1TEST000000000002","","","29,08"', '"04.11.2026","12:00:00","CET","","Bankgutschrift auf PayPal-Konto","Abgeschlossen","EUR","49,99","0,00","49,99","","","1TEST000000000003","","","79,07"'].join("\n");
  it("PayPal: Zahlungen + Gebühr, Bankgutschrift ausgelassen, Konto „PayPal“", () => {
    const bytes = new TextEncoder().encode(pp);
    const a = lesePaypal(bytes);
    expect(a.konto).toBe("PayPal");
    expect(a.umsaetze.map((u) => [u.buchungstag, u.betrag, u.gegenpartei])).toEqual([
      ["2026-11-03", -49.99, "Testshop"],
      ["2026-11-04", 30, "Testkunde"],
      ["2026-11-04", -0.92, "PayPal Gebühr"],
    ]);
    expect(a.umsaetze[0].zweck).toContain("Rechnung TS-55");
    expect(leseKontoauszug(bytes).format).toBe("paypal");
    expect(tabellenArt(pp.split("\n")[0].split(",").map((x) => x.replace(/"/g, "")), "Download.csv")).toBe("kontoauszug");
  });
  it("PayPal-Lastschrift auf dem Bankkonto zählt nicht doppelt", () => {
    const z: Zahlung[] = [
      { id: "pp", datum: "2026-11-03", betrag: -49.99, gegenpartei: "Testshop", zweck: "Testware · Rechnung TS-55", quelle: "bank", konto: "PayPal" },
      { id: "bank", datum: "2026-11-05", betrag: -49.99, gegenpartei: "PayPal Europe S.a.r.l.", zweck: "PayPal Lastschrift", quelle: "bank", konto: "DE00123456789012345678" },
    ];
    const b: Beleg[] = [{ id: "b", datum: "2026-11-03", brutto: 49.99, nummer: "TS-55", lieferant: "Testshop", gutschrift: false }];
    const r = abgleichen(z, b);
    expect(r.vorschlaege.find((v) => v.zahlungId === "bank")).toMatchObject({ art: "ohne_beleg", belegId: null });
    expect(r.vorschlaege.find((v) => v.zahlungId === "pp")).toMatchObject({ art: "beleg", belegId: "b" });
  });
});

describe("B34.2 Export der offenen Liste", () => {
  it("CSV mit beiden Listen", () => {
    const csv = abgleichCsv({ ohneBeleg: [{ datum: "2026-11-03", betrag: -19.9, gegenpartei: "Testladen", zweck: "Kauf \"A\"", karte: false }], belegeOhneZahlung: [{ datum: "2026-11-04", brutto: 50, rest: 50, nummer: "RE-9", lieferant: "Testlieferant GmbH" }] });
    expect(csv.split("\r\n").slice(0, 3)).toEqual(["﻿Liste;Datum;Betrag;Gegenpartei/Lieferant;Verwendungszweck/Rechnungsnr.;Konto", 'Zahlung ohne Beleg;03.11.2026;-19,90;"Testladen";"Kauf ""A""";Bank', 'Beleg ohne Zahlung;04.11.2026;50,00;"Testlieferant GmbH";"RE-9";']);
  });
});
