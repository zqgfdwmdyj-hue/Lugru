import { describe, expect, it } from "vitest";
import { bestandTreffer, chargeSperre, domainAus, dublettenGruppen, impressumFakten, istCaptcha, laufBudget, leadBewerten, leadsMorgenZeile, placesSuchenLesen, rechtsformAus, registerAus, robotsErlaubt, stufe2Sperre, ustNorm, zusammenfuehren, type BewertungKontext, type BewertungLead } from "@/lib/abverkauf/lead-maschine-logic";

// B35 Lead-Maschine – nur erfundene Firmen (Test…, example.invalid), erfundene Nummern (DE000…).

const basis: BewertungLead = { firma: "Testhandel GmbH", kategorie: null, marken: null, strasse: "Testweg 1", plz: "12345", ort: "Musterstadt", website: null, ustId: null, quelleTyp: "csv", lat: null, lng: null, groesse: null, stueckJeArtikel: null, anzahlAsins: null, mitarbeiter: null, letzteAktivitaet: null, adelprep: false, konfliktFreigabe: false };
const ctx: BewertungKontext = { heute: "2026-11-11", lager: { lat: 48.0, lng: 11.0 }, ladenhueter: [{ titel: "Testpuzzle Holz 1000 Teile", kapital: 800 }, { titel: "Testshampoo Glanz 500 ml", kapital: 400 }], bestand: [{ art: "lieferant", name: "Testlieferant GmbH" }, { art: "b2b_kunde", name: "Testkunde AG", ustId: "DE000000001" }], adelprepAbStueck: 80, konfliktbranchen: ["Testbranche Kinder"], grossmarken: ["Testgrossmarke"], lagerbedingungen: ["lebensmittel", "wein", "kosmetik"], umkreisLokalKm: 50, umkreisLagerKm: 100 };

describe("B35.2 Anreichern", () => {
  it("Rechtsform, Domain, USt-IdNr., Handelsregister", () => {
    expect(rechtsformAus("Testhandel GmbH & Co. KG")).toBe("GmbH & Co. KG");
    expect(rechtsformAus("Test UG (haftungsbeschränkt)")).toBe("UG");
    expect(rechtsformAus("Testsalon Petra")).toBeNull();
    expect(domainAus("https://www.testhandel.example/impressum")).toBe("testhandel.example");
    expect(domainAus("testhandel.example")).toBe("testhandel.example");
    expect(domainAus("")).toBeNull();
    expect(ustNorm("DE 000 000 001")).toBe("DE000000001");
    expect(ustNorm("DE12")).toBeNull();
    expect(registerAus("Amtsgericht Musterstadt HRB 12345")).toEqual({ typ: "HRB", nr: "12345", gericht: "musterstadt" });
    expect(registerAus("HRB 999")).toEqual({ typ: "HRB", nr: "999", gericht: null });
  });
  it("Impressum: USt-IdNr., Register, Adresse", () => {
    const html = "<h1>Impressum</h1><p>Testhandel GmbH<br>Testweg 7<br>12345 Musterstadt</p><p>Amtsgericht Musterstadt HRB 4711</p><p>USt-IdNr.: DE 000 000 002</p>";
    expect(impressumFakten(html)).toEqual({ ustId: "DE000000002", registerNr: "HRB 4711 (AG musterstadt)", strasse: "Testweg 7", plz: "12345", ort: "Musterstadt" });
    // Folgezeile („E-Mail“) direkt nach der Nummer wird nicht mitgelesen
    expect(impressumFakten("<p>Umsatzsteuer-Identifikationsnummer: DE000000099</p><p>E-Mail: info@test.example.invalid</p>").ustId).toBe("DE000000099");
  });
});

describe("B35.4.1 / B35.9.2 Dubletten", () => {
  it("Name+PLZ, Website, USt-IdNr. und Register (mit Gericht) führen zusammen", () => {
    const g = dublettenGruppen([
      { firma: "Testhandel GmbH", plz: "12345" },
      { firma: "Testhandel", plz: "12345" }, // gleicher Name ohne Rechtsform
      { firma: "Anderer Test GmbH", plz: "54321", website: "https://www.testweb.example" },
      { firma: "Ganz anders KG", plz: "99999", website: "testweb.example/kontakt" }, // gleiche Domain
      { firma: "Firma Eins GmbH", plz: "11111", ustId: "DE000000003" },
      { firma: "Firma Zwei GmbH", plz: "22222", ustId: "DE 000000003" }, // gleiche USt-IdNr.
      { firma: "Reg A GmbH", plz: "33333", registerNr: "Amtsgericht Musterstadt HRB 1" },
      { firma: "Reg B GmbH", plz: "44444", registerNr: "AG Musterstadt HRB 1" },
      { firma: "Reg C GmbH", plz: "55555", registerNr: "HRB 1" }, // ohne Gericht: keine Zusammenführung
    ]);
    expect(g).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8]]);
  });
  it("Zusammenführen füllt nur leere Felder", () => {
    expect(zusammenfuehren<Record<string, unknown>>({ firma: "A", website: null, ustId: "DE000000004" }, { firma: "B", website: "a.example", ustId: "DE000000005" })).toEqual({ ergebnis: { firma: "A", website: "a.example", ustId: "DE000000004" }, ergaenzt: ["website"] });
  });
});

describe("B35.3 Bewertung und Kampagnenvorschlag", () => {
  it("Friseur im Umkreis → Friseure; außerhalb abgewertet", () => {
    const nah = leadBewerten({ ...basis, firma: "Testsalon Haarwerk", kategorie: "Friseur", lat: 48.1, lng: 11.0 }, ctx);
    expect(nah.empfZiel).toBe("friseure");
    expect(nah.punkte.friseure).toBe(100);
    expect(nah.prioritaet).toBeGreaterThan(0);
    const fern = leadBewerten({ ...basis, kategorie: "Friseursalon", lat: 52.5, lng: 13.4 }, ctx);
    expect(fern.punkte.friseure).toBe(30);
  });
  it("Amazon-Händler ab 80 Stück → FBA-Prep mit Beilage; Großmarke/Kleinst/alt abgewertet", () => {
    const fba = leadBewerten({ ...basis, kategorie: "Amazon-Händler", quelleTyp: "keepa", stueckJeArtikel: 300 }, ctx);
    expect(fba.empfZiel).toBe("fba_prep");
    expect(fba.empfBeilage).toBe(true);
    const gross = leadBewerten({ ...basis, firma: "Testgrossmarke GmbH", kategorie: "Amazon", stueckJeArtikel: 300 }, ctx);
    expect(gross.punkte.fba_prep).toBeLessThan(30);
    expect(gross.markierungen.join()).toContain("Großmarke");
    const klein = leadBewerten({ ...basis, kategorie: "Amazon", stueckJeArtikel: 5 }, ctx);
    expect(klein.markierungen.join()).toContain("Kleinst-Händler");
    const alt = leadBewerten({ ...basis, kategorie: "Amazon", stueckJeArtikel: 300, letzteAktivitaet: "2023-01-01" }, ctx);
    expect(alt.markierungen.join()).toContain("> 2 Jahre");
    expect(alt.punkte.fba_prep).toBeLessThan(fba.punkte.fba_prep);
  });
  it("Abverkauf: Kategorie passt zu Ladenhütern", () => {
    const b = leadBewerten({ ...basis, kategorie: "Puzzle und Holzspielzeug Online-Shop" }, ctx);
    expect(b.punkte.abverkauf).toBeGreaterThanOrEqual(55);
    expect(b.nutzen).toBeGreaterThan(0);
  });
  it("Lager & Logistik: Firmen mit Lagerbedarf im Umkreis; Mitbewerber ausgenommen", () => {
    const l = leadBewerten({ ...basis, kategorie: "Hersteller Möbel", lat: 48.2, lng: 11.1 }, ctx);
    expect(l.empfZiel).toBe("lager");
    expect(l.punkte.lager).toBeGreaterThan(60);
    const m = leadBewerten({ ...basis, kategorie: "Fulfillment Logistik", lat: 48.2, lng: 11.1 }, ctx);
    expect(m.punkte.lager).toBe(0);
    expect(m.markierungen).toContain("Mitbewerber (Prep/Logistik)");
  });
  it("ohne Postadresse: Priorität 0 (nicht im Versand)", () => {
    const b = leadBewerten({ ...basis, strasse: null, kategorie: "Friseur", website: "https://salon.example" }, ctx);
    expect(b.erreichbar).toBe(false);
    expect(b.prioritaet).toBe(0);
  });
});

describe("B35.4 Schutzregeln", () => {
  it("Bestand: eigener Lieferant, B2B-Kunde über USt-IdNr. → ausgeschlossen", () => {
    expect(leadBewerten({ ...basis, firma: "Testlieferant", kategorie: "Großhandel" }, ctx).ausschluss).toContain("eigener Lieferant");
    expect(leadBewerten({ ...basis, firma: "Ganz anderer Name GmbH", ustId: "DE000000001" }, ctx).ausschluss).toContain("B2B-Kunde");
    expect(bestandTreffer({ firma: "Nichts GmbH" }, ctx.bestand)).toBeNull();
  });
  it("Konfliktbranche nur per Freigabe, Frischware/Insolvenz nie, Lagerbedingungen markiert", () => {
    expect(leadBewerten({ ...basis, kategorie: "Testbranche Kinder" }, ctx).ausschluss).toContain("Konfliktbranche");
    expect(leadBewerten({ ...basis, kategorie: "Testbranche Kinder", konfliktFreigabe: true }, ctx).ausschluss).toBeNull();
    expect(leadBewerten({ ...basis, kategorie: "Bäckerei" }, ctx).ausschluss).toContain("Frischware");
    expect(leadBewerten({ ...basis, firma: "Testhandel GmbH i. L." }, ctx).ausschluss).toContain("Insolvenz");
    expect(leadBewerten({ ...basis, kategorie: "Weinhandel Online-Shop", lat: 48.1, lng: 11.0 }, ctx).markierungen.join()).toContain("Lagerbedingungen klären");
    expect(leadBewerten({ ...basis, firma: "Max Mustermann", strasse: null, plz: null, ort: null }, ctx).ausschluss).toContain("Unklare Firmenzuordnung");
  });
  it("Charge-Sperre: Sperre, Ausschluss, Adresse, Mindestabstand, Lagerbedingungen, Priorität", () => {
    const ok = { status: "neu", rechtsgrundlage: "Art. 6", ausschluss: null, markierungen: [], erreichbar: true, letzterBriefAm: null, prioritaet: 50, quelleGesperrt: null, offenerEntwurf: false };
    const o = { heute: "2026-11-11", mindestabstandMonate: 12, standard: true };
    expect(chargeSperre(ok, o)).toBeNull();
    expect(chargeSperre({ ...ok, status: "gesperrt" }, o)).toContain("Sperrliste");
    expect(chargeSperre({ ...ok, erreichbar: false }, o)).toContain("Postadresse");
    expect(chargeSperre({ ...ok, letzterBriefAm: "2026-03-01" }, o)).toContain("Mindestabstand");
    expect(chargeSperre({ ...ok, letzterBriefAm: "2025-10-01" }, o)).toBeNull();
    expect(chargeSperre({ ...ok, markierungen: ["Lagerbedingungen klären („wein“)"] }, o)).toContain("Standard-Charge");
    expect(chargeSperre({ ...ok, prioritaet: 0 }, o)).toContain("Priorität 0");
    expect(chargeSperre({ ...ok, rechtsgrundlage: "" }, o)).toContain("Rechtsgrundlage");
  });
});

describe("B35.1/B35.9.1 Budget, robots.txt, Captcha", () => {
  it("Budget je Lauf und Monat", () => {
    expect(laufBudget({ budgetLauf: 5, budgetMonat: 20, monatBisher: 0 })).toEqual({ erlaubt: 5, grund: null });
    expect(laufBudget({ budgetLauf: 5, budgetMonat: 20, monatBisher: 18 })).toEqual({ erlaubt: 2, grund: null });
    expect(laufBudget({ budgetLauf: 5, budgetMonat: 20, monatBisher: 20 }).grund).toContain("Monatsbudget erreicht");
    expect(laufBudget({ budgetLauf: null, budgetMonat: 20, monatBisher: 0 }).grund).toContain("Budget je Lauf fehlt");
  });
  it("robots.txt: Disallow/Allow, eigener Agent vor „*“", () => {
    const r = "User-agent: *\nDisallow: /intern\nAllow: /intern/impressum\n\nUser-agent: SellerSystem-Leadsuche\nDisallow: /";
    expect(robotsErlaubt(r, "/impressum")).toBe(false);
    expect(robotsErlaubt("User-agent: *\nDisallow: /intern\nAllow: /intern/impressum", "/intern/impressum")).toBe(true);
    expect(robotsErlaubt("User-agent: *\nDisallow: /intern", "/intern/x")).toBe(false);
    expect(robotsErlaubt("User-agent: *\nDisallow:", "/impressum")).toBe(true);
    expect(robotsErlaubt(null, "/impressum")).toBe(true);
  });
  it("Captcha erkennen", () => {
    expect(istCaptcha(403, "<div class='g-recaptcha'></div>")).toBe(true);
    expect(istCaptcha(429, "")).toBe(true);
    expect(istCaptcha(200, "<h1>Impressum</h1>")).toBe(false);
  });
  it("Morgenbericht-Zeile", () => {
    expect(leadsMorgenZeile({ neu7: 12, entwuerfe: 20, kostenMonat: 4.5, anfragen7: 1, ruecklauf7: 2 })).toBe("Leads: 20 Brief-Entwürfe warten auf Freigabe, 12 neue Leads (7 T), 3 Rückmeldungen (7 T), Lead-Kosten Monat 4,50 €");
    expect(leadsMorgenZeile({ neu7: 0, entwuerfe: 0, kostenMonat: 0, anfragen7: 0, ruecklauf7: 0 })).toBeNull();
  });
});

describe("B35.7 Stufe 2: Sperre bis zur rechtlichen Prüfung, Places-Suchen", () => {
  it("ohne Datum der rechtlichen Prüfung kein automatischer Lauf", () => {
    expect(stufe2Sperre({ rechtlichGeprueftAm: null })).toContain("Stufe 2 gesperrt");
    expect(stufe2Sperre({ rechtlichGeprueftAm: "2026-11-11" })).toBeNull();
  });
  it("Suchen je Zeile „Branche | Ort/PLZ | Radius km“", () => {
    expect(placesSuchenLesen("Friseur | 12345 | 30\nSpielwaren\n\n | leer\nGroßhandel | Musterstadt | x")).toEqual([
      { begriff: "Friseur", ort: "12345", radiusKm: 30 },
      { begriff: "Spielwaren", ort: "", radiusKm: null },
      { begriff: "Großhandel", ort: "Musterstadt", radiusKm: null },
    ]);
    expect(placesSuchenLesen(Array.from({ length: 30 }, (_, i) => `Suche ${i}`).join("\n"))).toHaveLength(20);
  });
});
