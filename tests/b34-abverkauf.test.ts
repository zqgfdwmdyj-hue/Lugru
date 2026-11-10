import { describe, expect, it } from "vitest";
import { ABVERKAUF_STANDARD, anschreibenVorlage, chargeErfolg, codeAus, datenschutzHinweis, istAbmeldung, istKandidat, kiAuftrag, leadSchluessel, leadsAusTabelle, mailErlaubt, mailSchluessel, preisPosition, tagesRest } from "@/lib/abverkauf/logic";

// B34.3 B2B-Abverkauf – nur erfundene Händler (Testspielwaren …, example.invalid).

const abs = { name: "Testfirma Handel", strasse: "Handelsweg 1", plz: "12345", ort: "Musterstadt", email: "info@example.invalid", telefon: "0000 000" };

describe("B34.3 Ladenhüter und Preise", () => {
  it("Kandidat: Reichweite > 90 T oder Lager > 60 T, Kapital > 300 €", () => {
    expect(istKandidat({ reichweite: 120, aeltesteTage: 10, kapital: 400 }).ja).toBe(true);
    expect(istKandidat({ reichweite: 30, aeltesteTage: 75, kapital: 301 }).ja).toBe(true);
    expect(istKandidat({ reichweite: 9999, aeltesteTage: null, kapital: 500 })).toEqual({ ja: true, grund: "keine Verkäufe · 500 € Kapital" });
    expect(istKandidat({ reichweite: 120, aeltesteTage: 90, kapital: 300 }).ja).toBe(false);
    expect(istKandidat({ reichweite: 60, aeltesteTage: 30, kapital: 2000 }).ja).toBe(false);
  });
  it("Preis = Break-even + Aufschlag, Staffeln nie unter Break-even", () => {
    expect(preisPosition(10, 10, ABVERKAUF_STANDARD.staffeln)).toEqual({ preis: 11, staffel: [{ ab: 10, preis: 10.67 }, { ab: 50, preis: 10.34 }] });
    expect(preisPosition(10, 2, [{ ab: 10, rabattProzent: 5 }]).staffel).toEqual([{ ab: 10, preis: 10 }]);
  });
});

describe("B34.3 Leads aus CSV", () => {
  const kopf = ["title", "address", "categoryName", "emails", "E-Mail-Quelle", "website"];
  const rows = [
    ["Testspielwaren Alpha GmbH", "Spielweg 1, 12345 Musterstadt", "Spielwarengeschäft", "info@alpha.example.invalid", "Impressum", "https://alpha.example.invalid"],
    ["Testspielwaren Beta", "Ladenstr. 2, 54321 Beispielort", "Spielwaren", "kontakt@beta.example.invalid", "Kontaktseite", ""],
    ["", "Ohne Name 3, 11111 Ort", "", "", "", ""],
    ["Testladen Gamma", "", "Geschenke", "", "", ""],
  ];
  it("übernimmt Firma, Anschrift (PLZ/Ort aus „address“), Kategorie; E-Mail nur mit Quelle Impressum", () => {
    const r = leadsAusTabelle(kopf, rows);
    expect(r.leads).toHaveLength(2);
    expect(r.leads[0]).toMatchObject({ firma: "Testspielwaren Alpha GmbH", strasse: "Spielweg 1", plz: "12345", ort: "Musterstadt", kategorie: "Spielwarengeschäft", email: "info@alpha.example.invalid", emailQuelle: "Impressum" });
    expect(r.leads[1]).toMatchObject({ firma: "Testspielwaren Beta", email: null });
    expect(r.ohneMail).toBe(1);
    expect(r.verworfen).toEqual(["Zeile 4: ohne Firma", "Zeile 5 (Testladen Gamma): ohne Anschrift"]);
  });
  it("Schlüssel für Dubletten/Sperrliste: Rechtsform und Schreibweise egal", () => {
    expect(leadSchluessel("Testspielwaren Alpha GmbH", "12345")).toBe(leadSchluessel("testspielwaren alpha", "12345"));
    expect(leadSchluessel("Testspielwaren Alpha", "12345")).not.toBe(leadSchluessel("Testspielwaren Alpha", "12346"));
    expect(mailSchluessel(" Info@Alpha.example.invalid ")).toBe(mailSchluessel("info@alpha.example.invalid"));
  });
});

describe("B34.3 Kontaktweg und Rechtslage", () => {
  it("E-Mail an Fremdkontakte gesperrt, solange „Rechtlich geprüft“ aus ist", () => {
    expect(mailErlaubt({ bestandskunde: false, einwilligung: "Messe 2026, Visitenkarte", email: "a@example.invalid" }, false)).toEqual({ erlaubt: false, grund: "E-Mail an Fremdkontakte gesperrt – „Rechtlich geprüft“ ist aus (Einstellungen)" });
    expect(mailErlaubt({ bestandskunde: false, einwilligung: null, email: "a@example.invalid" }, true).erlaubt).toBe(false);
    expect(mailErlaubt({ bestandskunde: false, einwilligung: "Messe 2026", email: "a@example.invalid" }, true).erlaubt).toBe(true);
    expect(mailErlaubt({ bestandskunde: true, einwilligung: null, email: "a@example.invalid" }, false)).toEqual({ erlaubt: true, grund: "Bestandskunde" });
    expect(mailErlaubt({ bestandskunde: true, einwilligung: null, email: null }, true).erlaubt).toBe(false);
  });
  it("Datenschutzhinweis nach Art. 14 DSGVO mit Quelle, Zweck, Rechtsgrundlage, Speicherdauer, Widerspruch, Abmelden", () => {
    const t = datenschutzHinweis(abs, { quelle: "Testverzeichnis", quelleDatum: "2026-11-01", loeschenAm: "2027-05-01" });
    for (const x of ["Art. 14 DSGVO", "Verantwortlich: Testfirma Handel", "Testverzeichnis, Stand 01.11.2026", "Art. 6 Abs. 1 lit. f DSGVO", "bis 01.05.2027", "widersprechen", "Abmelden", "Sperrliste"]) expect(t).toContain(x);
  });
  it("Anschreiben und KI-Auftrag ohne Einkaufspreise/Break-even/interne Gründe", () => {
    const v = anschreibenVorlage({ firma: "Testspielwaren Alpha GmbH", kategorie: "Spielwaren", absender: abs, positionen: [{ titel: "Testpuzzle 1000 Teile (erfunden)", menge: 20, preis: 11 }], code: "AV-TEST01" });
    expect(v.betreff).toBe("Restposten-Angebot für Testspielwaren Alpha GmbH (AV-TEST01)");
    expect(v.text).toContain("Testpuzzle 1000 Teile (erfunden): 20 Stück, 11,00 € netto je Stück");
    const k = kiAuftrag({ firma: "Testspielwaren Alpha GmbH", kategorie: "Spielwaren", positionen: [{ titel: "Testpuzzle", menge: 20, preis: 11 }], absender: "Testfirma Handel" });
    for (const t of [v.text, k]) expect(t).not.toMatch(/break-?even|einkaufspreis \d|ladenhüter|reichweite|kapital|call|insider/i);
  });
});

describe("B34.3 Antworten, Tageslimit, Erfolg", () => {
  it("Bezug und Abmeldung erkennen", () => {
    expect(codeAus("Re: Restposten-Angebot für X (av-ab12cd)")).toBe("AV-AB12CD");
    expect(codeAus("ohne Bezug")).toBeNull();
    expect(istAbmeldung("Bitte keine Angebote mehr senden")).toBe(true);
    expect(istAbmeldung("Gerne 10 Stück, bitte Rechnung")).toBe(false);
  });
  it("Tageslimit und Charge höchstens 20", () => {
    expect(tagesRest(0, 20)).toBe(20);
    expect(tagesRest(15, 20)).toBe(5);
    expect(tagesRest(25, 20)).toBe(0);
    expect(tagesRest(0, 50)).toBe(20);
  });
  it("Erfolg je Charge", () => {
    expect(chargeErfolg([{ status: "versendet", umsatz: null, marge: null }, { status: "beantwortet", umsatz: 220, marge: 20.5 }, { status: "freigegeben", umsatz: null, marge: null }])).toEqual({ versendet: 2, beantwortet: 1, ruecklaufProzent: 50, umsatz: 220, marge: 20.5 });
  });
});
