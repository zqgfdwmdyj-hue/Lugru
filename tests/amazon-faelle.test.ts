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

// B17: Routinemails nie als Fall, Marke nur bei echten Rechte-/Echtheitsmails, Marktplatz aus Absender/Inhalt.
describe("B17 – Routinemails, Marke, Marktplatz, Steuer-Hinweise", () => {
  const com = "Amazon <donotreply@amazon.com>";
  const fuss = "\n\n© 2026 Amazon.com, Inc. oder Tochtergesellschaften. Copyright, Marken und Patente siehe Nutzungsbedingungen.\nAbmelden";
  const ROUTINE = [
    { from: com, subject: "Verkauft, Jetzt liefern: Testartikel", text: `Bestellnummer 302-5555555-6666666. Bitte versenden Sie den Artikel.${fuss}`, land: "DE" },
    { from: com, subject: "Amazon hat Ihren Artikel versandt", text: `Ihre Artikel sind unterwegs.${fuss}`, land: "DE" },
    { from: com, subject: "Amazon a expédié vos articles", text: `Votre commande a été expédiée. Authenticité garantie.${fuss}`, land: "FR" },
    { from: com, subject: "Amazon ha enviado tus artículos", text: `Tu pedido está en camino.${fuss}`, land: "ES" },
    { from: com, subject: "Tu pago está en camino", text: `Hemos enviado tu pago. Puede tardar unos días.${fuss}`, land: "ES" },
    { from: com, subject: "Ihre Auszahlung wurde veranlasst", text: `Die Zahlung ist unterwegs.${fuss}`, land: "DE" },
  ];

  it("Bestell-, Versand- und Zahlungsmails: Routine, Info, nie Marke/rot, Marktplatz nicht US", () => {
    for (const m of ROUTINE) {
      const e = einordnen({ ...m, date: D }, { heute: HEUTE });
      expect(e.routine, m.subject).toBe(true);
      expect(e.bereich, m.subject).toBe("info");
      expect(e.dringlichkeit, m.subject).toBe("grau");
      expect(e.marktplatz, m.subject).toBe(m.land);
    }
  });

  it("Fußzeile mit Copyright/Patent macht keine Markenbeschwerde", () => {
    const e = einordnen({ from: com, subject: "Neue Funktionen in Seller Central", text: `Entdecken Sie neue Berichte.${fuss}`, date: D }, { heute: HEUTE });
    expect(e.bereich).not.toBe("marke");
    expect(e.dringlichkeit).not.toBe("rot");
  });

  it("Echte Rechte-/Echtheitsmails bleiben Markenbeschwerde (rot)", () => {
    for (const m of [
      { from: "Amazon <seller-performance@amazon.de>", subject: "Hinweis: Richtlinienwarnung", text: "Wir haben eine Mitteilung über eine Markenrechtsverletzung zu ASIN B0TESTIP03 erhalten. Rechteinhaber: Testmarke." },
      { from: "Amazon <seller-performance@amazon.com>", subject: "Notice: Policy Warning", text: "We received a report of intellectual property infringement (copyright infringement) for ASIN B0TESTIP04 on www.amazon.fr." },
      { from: "Amazon <seller-performance@amazon.it>", subject: "Reclamo per contraffazione", text: "Abbiamo ricevuto un reclamo per contraffazione relativo all'ASIN B0TESTIP05." },
    ]) {
      const e = einordnen({ ...m, date: D }, { heute: HEUTE });
      expect(e.bereich, m.subject).toBe("marke");
      expect(e.dringlichkeit, m.subject).toBe("rot");
    }
  });

  it("Marktplatz: amazon.com-Absender → Inhalt (Domain oder Sprache), sonst offen statt US", () => {
    expect(einordnen({ from: com, subject: "Notice", text: "See https://sellercentral.amazon.it/home for details.", date: D }).marktplatz).toBe("IT");
    expect(einordnen({ from: com, subject: "Update on your account", text: "Please review the details in Seller Central.", date: D }).marktplatz).toBeNull();
    expect(einordnen({ from: com, subject: "Order shipped", text: "Total US$ 12.00 – sellercentral.amazon.com", date: D }).marktplatz).toBe("US");
    expect(einordnen({ from: "Amazon <seller-notification@amazon.nl>", subject: "Info", text: "", date: D }).marktplatz).toBe("NL");
    expect(einordnen({ from: com, subject: "Your listing update", text: "Your offer price AED 120.00 is now live in the United Arab Emirates store.", date: D }).marktplatz).toBe("AE");
  });

  it("VAT-Hinweis ohne Frist in der Mail: Info ohne erfundene Frist; mit Frist: prüfen mit Frist aus der Mail", () => {
    const ohne = einordnen({ from: com, subject: "Wichtige Informationen zu Ihrer VAT auf Amazon.de", text: "Ab dem nächsten Quartal berechnet Amazon die Umsatzsteuer für bestimmte Verkäufe. Bitte prüfen Sie Ihre Einstellungen.", date: "2026-10-02T08:00:00Z" }, { heute: "2026-10-02" });
    expect(ohne.bereich).toBe("info");
    expect(ohne.frist).toBeNull();
    expect(ohne.marktplatz).toBe("DE");
    const mit = einordnen({ from: com, subject: "Wichtige Informationen zu Ihrer VAT auf Amazon.de", text: "Bitte hinterlegen Sie Ihre USt-IdNr. bis zum 20.10.2026, damit die Umsatzsteuer korrekt berechnet wird.", date: "2026-10-02T08:00:00Z" }, { heute: "2026-10-02" });
    expect(mit.frist).toBe("2026-10-20");
    expect(mit.fristQuelle).toBe("mail");
    expect(mit.sicherheit).toBeLessThan(0.6);
  });
});

describe("B19.4: Einkauf/Versand/Zahlung sind keine Fälle, Gruppierung je Bestellung, VA nur bei echten Fällen", () => {
  const mail = (subject: string, text = "Garanzia dalla A alla Z – Informationen in der Fußzeile.") => einordnen({ from: "Amazon <no-reply@amazon.it>", subject, text, date: "2026-10-30T10:00:00Z" }, { heute: "2026-10-31" });

  it("Amazon-Business-Einkauf, „Amazon a expédié“, „Pagamento rifiutato“ → Routine, kein Fall", async () => {
    const { routineArt } = await import("@/lib/amazon-faelle/logic");
    expect(mail("Ihre Amazon Business-Bestellung #302-1234567-1234567").routine).toBe(true);
    expect(mail("Your Amazon Business order has been placed").routine).toBe(true);
    expect(mail("Amazon a expédié votre colis").routine).toBe(true);
    expect(routineArt("Amazon a expédié votre colis")).toBe("versand");
    expect(routineArt("Il tuo ordine è stato spedito")).toBe("versand");
    const abgelehnt = mail("Pagamento rifiutato per l'ordine 405-1234567-7654321");
    expect(abgelehnt.routine).toBe(true);
    expect(abgelehnt.routineArt).toBe("zahlung_fehler");
    expect(abgelehnt.bestellnummer).toBe("405-1234567-7654321");
    expect(routineArt("Zahlung abgelehnt")).toBe("zahlung_fehler");
    expect(routineArt("Votre paiement a été refusé")).toBe("zahlung_fehler");
    expect(routineArt("Paiement refusé")).toBe("zahlung_fehler");
  });

  it("„Pagamento elaborato con successo“ ist nie A-bis-z", () => {
    const e = mail("Pagamento elaborato con successo", "Il tuo pagamento è stato elaborato. Garanzia dalla A alla Z: ...");
    expect(e.bereich).not.toBe("a_bis_z");
    expect(e.routine).toBe(true);
    expect(e.routineArt).toBe("zahlung");
    // auch ohne Zahlungswort im Betreff: „erfolgreich“ + A-bis-z-Text → kein A-bis-z
    const f = einordnen({ from: "Amazon <seller@amazon.de>", subject: "Vorgang erfolgreich abgeschlossen", text: "A-bis-z-Garantie: Ihr Antrag …", date: "2026-10-30T10:00:00Z" }, { heute: "2026-10-31" });
    expect(f.bereich).not.toBe("a_bis_z");
  });

  it("echter A-bis-z-Fall zu „Ihre Bestellung“ bleibt ein Fall", () => {
    const e = einordnen({ from: "Amazon <seller@amazon.de>", subject: "A-bis-z-Garantieantrag zu Ihrer Bestellung 302-1111111-2222222", text: "Ein Käufer hat einen A-bis-z-Garantieantrag gestellt. Bitte antworten Sie bis 03.11.2026.", date: "2026-10-30T10:00:00Z" }, { heute: "2026-10-31" });
    expect(e.routine).toBe(false);
    expect(e.bereich).toBe("a_bis_z");
  });

  it("Mails zur selben Bestellnummer landen im selben Vorgang – auch „Sonstiges“", () => {
    const v: VorgangKurz[] = [{ id: "v1", bereich: "sonstiges", status: "offen", fallnummer: null, asins: [], shipmentId: null, bestellnummer: "405-1234567-7654321", letzteMailAm: "2026-10-29T10:00:00Z" }];
    expect(zuordnen({ bereich: "sonstiges", fallnummer: null, asins: [], shipmentId: null, bestellnummer: "405-1234567-7654321" }, v, "2026-10-30")).toBe("v1");
    // über Bereiche hinweg (Erstattung zur selben Bestellung)
    expect(zuordnen({ bereich: "erstattung_kunde", fallnummer: null, asins: [], shipmentId: null, bestellnummer: "405-1234567-7654321" }, v, "2026-10-30")).toBe("v1");
    expect(zuordnen({ bereich: "sonstiges", fallnummer: null, asins: [], shipmentId: null, bestellnummer: "405-0000000-0000000" }, v, "2026-10-30")).toBeNull();
  });

  it("zuständig VA nur bei echten Fällen", async () => {
    const { echterFall } = await import("@/lib/amazon-faelle/logic");
    expect(echterFall({ status: "offen", bereich: "a_bis_z", unsicher: false })).toBe(true);
    expect(echterFall({ status: "offen", bereich: "sonstiges", unsicher: false })).toBe(false);
    expect(echterFall({ status: "offen", bereich: "fall", unsicher: true })).toBe(false);
    expect(echterFall({ status: "info", bereich: "info", unsicher: false })).toBe(false);
  });
});

// B20.5: Auszahlungen, Bewertungsanfragen, Versandmails, Buy-Box-Hinweise und „bitte prüfen“ (erfundene Mails).
import { routineArt } from "@/lib/amazon-faelle/logic";
import { auszahlungAus } from "@/lib/amazon-todos/mail-muster";
import { noiseReason } from "@/lib/amazon-todos/logic";

describe("B20.5 Fall-Zentrale-Regeln", () => {
  const fr = "Amazon <donotreply@amazon.com>";
  it("Auszahlungsmitteilung in allen Sprachen → Routine „auszahlung“, nie A-bis-z (auch mit A-bis-z-Fußzeile)", () => {
    const e = einordnen({ from: fr, subject: "Votre paiement est en cours", text: "Montant : 369,71 € vers le compte bancaire se terminant par 123. Le versement devrait arriver dans 3 à 5 jours ouvrables.\n\nGarantie de A à Z : en savoir plus.", date: D }, { heute: HEUTE });
    expect(e).toMatchObject({ routine: true, routineArt: "auszahlung", bereich: "info" });
    expect(e.bereich).not.toBe("a_bis_z");
    expect(e.frist).toBeNull();
    for (const b of ["Ihre Auszahlung ist unterwegs", "Your payment is on its way", "Il tuo pagamento è in corso", "Tu pago está en camino", "Tentative de versement"]) expect(routineArt(b, fr)).toBe("auszahlung");
  });
  it("Betrag, Konto-Endung und erwarteter Eingang (3–5 Tage) aus der Mitteilung", () => {
    expect(auszahlungAus({ subject: "Votre paiement est en cours", text: "Montant : 369,71 € vers le compte se terminant par 123.", date: "2026-10-31T08:00:00Z" })).toEqual({ betrag: 369.71, waehrung: "EUR", kontoEndung: "123", datum: "2026-10-31", erwartetVon: "2026-11-03", erwartetBis: "2026-11-05" });
    expect(auszahlungAus({ subject: "Your payment is on its way", text: "Amount: EUR 1,115.52 to the bank account ending in 4711", date: "2026-10-31T08:00:00Z" })).toMatchObject({ betrag: 1115.52, kontoEndung: "4711" });
    expect(auszahlungAus({ subject: "Ihre Auszahlung ist unterwegs", text: "Betrag 115,52 € auf das Konto ****4711", date: "2026-10-31T08:00:00Z" })).toMatchObject({ betrag: 115.52, kontoEndung: "4711" });
  });
  it("„paiement en cours / Zahlung wird bearbeitet“ ohne Auszahlungs-Absender → Info, nicht A-bis-z", () => {
    expect(routineArt("Paiement en cours pour la commande 405-1234567-1234567", "Amazon <seller-notification@amazon.fr>")).toBe("zahlung");
    const e = einordnen({ from: de, subject: "Zahlung wird bearbeitet", text: "Ihre Zahlung wird bearbeitet. Informationen zur A-bis-z-Garantie finden Sie hier.", date: D }, { heute: HEUTE });
    expect(e).toMatchObject({ routine: true, bereich: "info" });
  });
  it("Bewertungsanfragen → Routine „bewertung“, nie „Antwort nötig“ – auch mit Fall-ID", () => {
    for (const s of ["Transaktion bewerten", "Recensione del tuo ordine", "How did we do? Rate your support experience"]) {
      const e = einordnen({ from: de, subject: s, text: "Bitte antworten Sie auf diese kurze Umfrage.", date: D }, { heute: HEUTE });
      expect(e.routineArt).toBe("bewertung");
      expect(e.phase).not.toBe("antwort_noetig");
    }
    const mitFall = einordnen({ from: "Amazon Seller Support <sellersupport@amazon.de>", subject: "Bewerten Sie Ihre Erfahrung – Fall-ID 12345678901", text: "Bitte antworten Sie mit einer Bewertung.", date: D }, { heute: HEUTE });
    expect(mitFall).toMatchObject({ routine: true, routineArt: "bewertung" });
  });
  it("„Versendet:“, „expédié“, „Spedito“ → Versand (Archiv)", () => {
    for (const s of ["Versendet: „Erfundo Pfanne 28 cm“", "Votre colis a été expédié", "Spedito: Erfundo Pfanne"]) expect(routineArt(s)).toBe("versand");
  });
  it("Buy-Box-Hinweis in allen Sprachen → „buybox“ (ein ToDo je Land, kein Fall)", () => {
    const faelle = [
      { from: de, subject: "Ihr Angebot ist nicht für das Einkaufswagen-Feld berechtigt", text: "SKU TEST-BB-1 · ASIN B0TESTBB01" },
      { from: "Amazon <seller-notification@amazon.co.uk>", subject: "Action may be needed", text: "Your offer for ASIN B0TESTBB02 is not eligible for the Featured Offer (Buy Box)." },
      { from: "Amazon <seller-notification@amazon.fr>", subject: "Votre offre n'est pas éligible à l'offre mise en avant", text: "ASIN B0TESTBB03" },
      { from: "Amazon <seller-notification@amazon.it>", subject: "La tua offerta non è idonea per l'offerta in evidenza", text: "ASIN B0TESTBB04" },
      { from: "Amazon <seller-notification@amazon.es>", subject: "Tu oferta no es apta para la oferta destacada", text: "ASIN B0TESTBB05" },
    ];
    for (const m of faelle) {
      const e = einordnen({ ...m, date: D }, { heute: HEUTE });
      expect(e.routineArt, m.subject).toBe("buybox");
      expect(e.routine).toBe(true);
    }
    expect(einordnen({ ...faelle[2], date: D }, { heute: HEUTE }).marktplatz).toBe("FR");
  });
  it("A-bis-z/Kontozustand nur im Text (Fußzeile) → „bitte prüfen“ in Sonstiges, ohne Standardfrist", () => {
    const fuell = "Allgemeine Informationen zu Ihrem Verkäuferkonto und zu neuen Funktionen in Seller Central. ".repeat(8);
    const e = einordnen({ from: de, subject: "Hinweis zu Ihrem Konto", text: `${fuell}\n\nMehr zur A-bis-z-Garantie und zum Kontozustand finden Sie in Seller Central.`, date: D }, { heute: HEUTE });
    expect(e.bereich).toBe("sonstiges");
    expect(e.sicherheit).toBeLessThan(0.6);
    expect(e.fristQuelle).not.toBe("standard");
  });
  it("Amazon-ToDos legen dafür keine Einzel-ToDos an", () => {
    expect(noiseReason({ from: fr, subject: "Votre paiement est en cours" })).toMatch(/Auszahlung/);
    expect(noiseReason({ from: de, subject: "Transaktion bewerten" })).toMatch(/Bewertung/);
    expect(noiseReason({ from: de, subject: "Wichtige Information", text: "Ihr Angebot ist nicht für das Einkaufswagen-Feld berechtigt." })).toMatch(/Buy-Box/);
  });
});
