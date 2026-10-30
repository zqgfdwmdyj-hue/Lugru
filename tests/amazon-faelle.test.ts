import { describe, expect, it } from "vitest";
import { belegPruefen, betragAus, einordnen, fallAntwort, fallnummerAus, freischaltungsPaket, freischaltungsQuote, musterVon, wiederOeffnenPaket, zuordnen, type VorgangKurz } from "@/lib/amazon-faelle/logic";

// Amazon-Fall-Zentrale (B8): 20 erfundene Amazon-Mails in mehreren Sprachen → mindestens 18 richtig eingeordnet.
const D = "2026-10-28T09:00:00Z";
const HEUTE = "2026-10-28";
const de = "Amazon Seller Central <seller-notification@amazon.de>";

const MAILS: { from: string; subject: string; text: string; bereich: string; phase: string }[] = [
  { from: de, subject: "Ihr Antrag auf Verkaufsgenehmigung für die Marke Testmarke wurde abgelehnt", text: "Die eingereichte Rechnung ist älter als 180 Tage. Bitte reichen Sie eine Rechnung über mindestens 10 Einheiten ein. ASIN B0TESTFS01", bereich: "freischaltung", phase: "abgelehnt" },
  { from: "Amazon <seller-notification@amazon.co.uk>", subject: "Your selling application for Testbrand has been approved", text: "You can now list ASIN B0TESTFS02.", bereich: "freischaltung", phase: "genehmigt" },
  { from: "Amazon <seller-notification@amazon.fr>", subject: "Demande d'approbation : documents supplémentaires requis", text: "Veuillez fournir des documents supplémentaires. Le nom et l'adresse sur la facture doivent correspondre.", bereich: "freischaltung", phase: "nachreichen" },
  { from: de, subject: "Wichtig: Ihre Verkaufsberechtigung für Testmarke wurde entzogen", text: "Wir haben Ihre Freischaltung für die Marke Testmarke widerrufen. Betroffene ASIN: B0TESTFS03", bereich: "freischaltung", phase: "entzogen" },
  { from: "Amazon <seller-notification@amazon.it>", subject: "Richiesta di approvazione rifiutata", text: "La fattura deve provenire da un produttore o distributore.", bereich: "freischaltung", phase: "abgelehnt" },
  { from: "Amazon Seller Support <sellersupport@amazon.de>", subject: "Ihre Fall-ID: 12345678901 – Wir benötigen weitere Angaben", text: "Bitte stellen Sie den Zustellnachweis (POD) und die Sendungsnummer FBA15TEST001 bereit.", bereich: "fall", phase: "antwort_noetig" },
  { from: "Amazon Seller Support <sellersupport@amazon.co.uk>", subject: "[CASE 23456789012] Update", text: "Thank you for contacting Amazon Seller Support. We have reimbursed 34,50 € to your account. This case is resolved.", bereich: "fall", phase: "geloest" },
  { from: "Amazon Seller Support <sellersupport@amazon.de>", subject: "Fall-ID 34567890123", text: "Der Fall wurde geschlossen. Leider ist keine Erstattung möglich, da die Ware nicht berechtigt ist.", bereich: "fall", phase: "geschlossen_ohne" },
  { from: "Amazon Seller Support <sellersupport@amazon.es>", subject: "ID del caso: 45678901234", text: "Gracias por contactar con Amazon. Hemos revisado su consulta.", bereich: "fall", phase: "beantwortet" },
  { from: "Amazon Seller Support <sellersupport@amazon.nl>", subject: "Zaak-ID: 56789012345 heropend", text: "Uw zaak is heropend.", bereich: "fall", phase: "wieder_offen" },
  { from: de, subject: "Erstattung von Amazon: FBA-Erstattung für verlorene Einheiten", text: "Wir haben Ihnen 12,99 € für ASIN B0TESTRB01 erstattet (FBA-Erstattung).", bereich: "entschaedigung", phase: "info" },
  { from: de, subject: "Rückerstattung veranlasst für Bestellung 302-1111111-2222222", text: "Für die Bestellung wurde eine Rückerstattung veranlasst: 24,90 €.", bereich: "erstattung_kunde", phase: "info" },
  { from: de, subject: "Mitteilung des Rechteinhabers: Markenrechtsverletzung", text: "Ein Rechteinhaber hat eine Beschwerde zu ASIN B0TESTIP01 eingereicht.", bereich: "marke", phase: "offen" },
  { from: "Amazon <seller-notification@amazon.pl>", subject: "Podróbka – zgłoszenie dotyczące autentyczności", text: "Otrzymaliśmy zgłoszenie dotyczące podróbki ASIN B0TESTIP02.", bereich: "marke", phase: "offen" },
  { from: de, subject: "Angebot deaktiviert: Preisfehler bei SKU TEST-PF-1", text: "Ihr Angebot wurde wegen eines möglichen Preisfehlers deaktiviert.", bereich: "angebot", phase: "offen" },
  { from: "Amazon <seller-notification@amazon.se>", subject: "Erbjudanden inaktiverade – GPSR-information saknas", text: "Dina erbjudanden har inaktiverats.", bereich: "angebot", phase: "offen" },
  { from: de, subject: "Handlungsbedarf beim Kontozustand Ihres Verkäuferkontos", text: "Richtlinienverstoß festgestellt.", bereich: "kontozustand", phase: "offen" },
  { from: de, subject: "Neuer A-bis-z-Garantieantrag für Bestellung 302-3333333-4444444", text: "Bitte antworten Sie innerhalb von 3 Tagen.", bereich: "a_bis_z", phase: "antwort_noetig" },
  { from: de, subject: "Sendung FBA15TEST002 geschlossen – Abweichung festgestellt", text: "Für die Sendung wurden 3 Einheiten weniger erfasst.", bereich: "fba_sendung", phase: "offen" },
  { from: de, subject: "Gebührenänderungen 2027 für Versand durch Amazon", text: "Wir informieren Sie über Änderungen an den Gebühren.", bereich: "info", phase: "info" },
];

describe("Einordnung – 20 Amazon-Mails in mehreren Sprachen", () => {
  it("mindestens 18 von 20 richtig (Bereich und Phase)", () => {
    const falsch: string[] = [];
    for (const m of MAILS) {
      const e = einordnen({ ...m, date: D }, { heute: HEUTE });
      if (e.bereich !== m.bereich || e.phase !== m.phase) falsch.push(`${m.subject} → ${e.bereich}/${e.phase} (erwartet ${m.bereich}/${m.phase})`);
    }
    expect(falsch.length, falsch.join("\n")).toBeLessThanOrEqual(2);
  });

  it("Bezüge: Fall-ID, ASIN, SKU, Sendung, Bestellung, Betrag, Marktplatz, Frist", () => {
    const f = einordnen({ ...MAILS[5], date: D }, { heute: HEUTE });
    expect(f).toMatchObject({ fallnummer: "12345678901", shipmentId: "FBA15TEST001", marktplatz: "DE", verlangt: expect.arrayContaining(["pod", "shipment_id"]) });
    expect(f.frist).toBe("2026-10-31");
    expect(f.dringlichkeit).toBe("gelb");
    const a = einordnen({ ...MAILS[17], date: D }, { heute: HEUTE });
    expect(a).toMatchObject({ bestellnummer: "302-3333333-4444444", frist: "2026-10-31" });
    expect(einordnen({ ...MAILS[11], date: D }).betrag).toBe(24.9);
    expect(einordnen({ ...MAILS[14], date: D }).skus).toEqual(["TEST-PF-1"]);
  });

  it("Ablehnungsgründe und Dringlichkeit", () => {
    expect(einordnen({ ...MAILS[0], date: D }).ablehnungsgruende).toEqual(expect.arrayContaining(["rechnung_zu_alt", "menge_zu_gering"]));
    expect(einordnen({ ...MAILS[2], date: D }).ablehnungsgruende).toContain("adresse_passt_nicht");
    expect(einordnen({ ...MAILS[4], date: D }).ablehnungsgruende).toContain("kein_hersteller");
    expect(einordnen({ ...MAILS[3], date: D }).dringlichkeit).toBe("rot");
    expect(einordnen({ ...MAILS[12], date: D }).dringlichkeit).toBe("rot");
    expect(einordnen({ ...MAILS[19], date: D }).dringlichkeit).toBe("grau");
  });

  it("Gelerntes geht vor den festen Mustern", () => {
    const m = { from: de, subject: "Neue Information zu Ihrem Konto 123", text: "…", date: D };
    expect(einordnen(m).sicherheit).toBeLessThan(0.6);
    const g = einordnen(m, { gelernt: [{ muster: musterVon(m.subject), bereich: "kontozustand", phase: "offen" }] });
    expect(g).toMatchObject({ bereich: "kontozustand", sicherheit: 1 });
  });

  it("Fall-ID und Betrag in verschiedenen Schreibweisen", () => {
    expect(fallnummerAus("Case ID: 1234567890")).toBe("1234567890");
    expect(fallnummerAus("[CASE 98765432101]")).toBe("98765432101");
    expect(fallnummerAus("ID zgłoszenia: 1122334455")).toBe("1122334455");
    expect(betragAus("Betrag: 1.234,56 €")).toBe(1234.56);
    expect(betragAus("EUR 12.30 credited")).toBe(12.3);
    expect(betragAus("kein Betrag")).toBeNull();
  });
});

describe("Zuordnung zu Vorgängen", () => {
  const v: VorgangKurz[] = [
    { id: "v1", bereich: "fall", status: "offen", fallnummer: "12345678901", asins: [], shipmentId: null, bestellnummer: null, letzteMailAm: "2026-10-20T10:00:00Z" },
    { id: "v2", bereich: "freischaltung", status: "offen", fallnummer: null, asins: ["B0TESTFS01"], shipmentId: null, bestellnummer: null, letzteMailAm: "2026-10-10T10:00:00Z" },
    { id: "v3", bereich: "freischaltung", status: "erledigt", fallnummer: null, asins: ["B0TESTFS09"], shipmentId: null, bestellnummer: null, letzteMailAm: "2026-06-01T10:00:00Z" },
  ];
  it("gleiche Fall-ID, gleiche ASIN im selben Bereich, nicht nach 60 Tagen", () => {
    expect(zuordnen({ bereich: "fall", fallnummer: "12345678901", asins: [], shipmentId: null, bestellnummer: null }, v, HEUTE)).toBe("v1");
    expect(zuordnen({ bereich: "freischaltung", fallnummer: null, asins: ["B0TESTFS01"], shipmentId: null, bestellnummer: null }, v, HEUTE)).toBe("v2");
    expect(zuordnen({ bereich: "angebot", fallnummer: null, asins: ["B0TESTFS01"], shipmentId: null, bestellnummer: null }, v, HEUTE)).toBeNull();
    expect(zuordnen({ bereich: "freischaltung", fallnummer: null, asins: ["B0TESTFS09"], shipmentId: null, bestellnummer: null }, v, HEUTE)).toBeNull();
  });
});

describe("Pakete", () => {
  const belege = [
    { id: "r1", datum: "2026-01-10", lieferant: "Testgroßhandel", nummer: "RE-1", menge: 50, kontakt: true, fileId: "f1" },
    { id: "r2", datum: "2026-09-15", lieferant: "Testgroßhandel", nummer: "RE-2", menge: 24, kontakt: true, fileId: "f2" },
    { id: "r3", datum: "2026-10-01", lieferant: "Testgroßhandel", nummer: "RE-3", menge: 4, kontakt: true, fileId: "f3" },
  ];
  it("Beleg-Prüfung: Alter, Menge, Lieferant", () => {
    expect(belegPruefen(belege[0], HEUTE).gruende).toEqual(["älter als 180 Tage"]);
    expect(belegPruefen(belege[1], HEUTE).ok).toBe(true);
    expect(belegPruefen(belege[2], HEUTE).gruende).toEqual(["nur 4 Stück (mind. 10)"]);
  });
  it("Freischaltung abgelehnt (Rechnung zu alt) → Paket nur mit Rechnung ≤ 180 Tage und ≥ 10 Stück", () => {
    const p = freischaltungsPaket({ marke: "Testmarke", asins: ["B0TESTFS01"], marktplatz: "DE", gruende: ["rechnung_zu_alt"], belege, heute: HEUTE, firma: "Testfirma GmbH" });
    expect(p.belege.map((b) => b.id)).toEqual(["r2"]);
    expect(p.fehlt).toEqual([]);
    expect(p.texte.de).toContain("RE-2");
    expect(p.texte.en).toContain("Application for approval");
  });
  it("ohne passenden Beleg: klare Fehlt-Aufgabe mit Vorschlag statt aussichtslosem Paket", () => {
    const p = freischaltungsPaket({ marke: "Testmarke", asins: [], marktplatz: "DE", gruende: ["rechnung_zu_alt"], belege: [belege[0], belege[2]], heute: HEUTE, firma: null, letzterLieferant: { name: "Testgroßhandel", ek: 5.5 } });
    expect(p.belege).toEqual([]);
    expect(p.fehlt[0]).toMatch(/≥ 10 Stück.*180 Tage.*Testgroßhandel.*5,50 €/);
  });
  it("Fall-Antwort mit Sendungsdaten; POD fehlt ausdrücklich", () => {
    const p = fallAntwort({ fallnummer: "12345678901", verlangt: ["pod", "shipment_id"], sendung: { id: "FBA15TEST001", datum: "2026-10-01", stueck: 40, tracking: ["TESTTRACK0001"], spediteur: "DHL" }, bestellnummer: null, rechnungen: [], heute: HEUTE });
    expect(p.texte.de).toContain("FBA15TEST001");
    expect(p.texte.en).toContain("TESTTRACK0001");
    expect(p.fehlt.join(" ")).toContain("Zustellnachweis");
  });
  it("nur POD verlangt: Sendungsdaten trotzdem im Text", () => {
    const p = fallAntwort({ fallnummer: "1", verlangt: ["pod"], sendung: { id: "FBA15TEST009", datum: null, stueck: null, tracking: [], spediteur: null }, bestellnummer: null, rechnungen: [], heute: HEUTE });
    expect(p.texte.de).toContain("FBA15TEST009");
  });
  it("Wiederöffnen; nach 2 Runden Eskalation an Ludwig", () => {
    expect(wiederOeffnenPaket({ fallnummer: "1", runden: 0, betrag: 20, heute: HEUTE }).checkliste[0]).toContain("erneut öffnen");
    expect(wiederOeffnenPaket({ fallnummer: "1", runden: 2, betrag: 20, heute: HEUTE }).checkliste[0]).toContain("Ludwig");
  });
  it("Erfolgsquote je Marke", () => {
    const q = freischaltungsQuote([
      { marke: "Testmarke", phase: "genehmigt", gruende: [] },
      { marke: "Testmarke", phase: "abgelehnt", gruende: ["rechnung_zu_alt"] },
      { marke: "Testmarke", phase: "abgelehnt", gruende: ["rechnung_zu_alt", "menge_zu_gering"] },
    ]);
    expect(q[0]).toMatchObject({ marke: "Testmarke", genehmigt: 1, abgelehnt: 2, haeufigsteGruende: ["Rechnung zu alt (> 180 Tage)", "Menge zu gering (< 10 Stück)"] });
  });
});
