import { describe, expect, it } from "vitest";
import { adressePruefen, beilageLint, beilageVollstaendig, briefKosten, entfernungKm, kostenVorschau, lagerkosten, leadImFilter, limitPruefen, mhdNorm, mhdPruefen, nachfassFaellig, plusMonate, ustIdFormat, ZIELGRUPPEN } from "@/lib/abverkauf/kampagne-logic";
import { kampagneAnschreiben, leadsAusTabelle } from "@/lib/abverkauf/logic";

// B34.3.6/3a/3b – nur erfundene Werte (Testfirmen, example.invalid, DE00…).

const ohne = { flaeche: false, nda: false, gefahrgut: false };

describe("B34.3.6 AdelPrep-Beilage: Textprüfung (Regeln 11.11.; Preise erfunden)", () => {
  const ZAEHLUNG = "„kostenlose/inklusive Zählung“ nicht schreiben – stattdessen: beim direkten FBA-Versand ist die Stückzahl durch das Verpacken erfasst, bei Einlagerung ist die Mengenzählung optional zubuchbar";
  const KARTON = "Karton gesondert nennen (wird extra berechnet), getrennt vom Preis je Artikel";
  it("„all-in“ nur mit Aufzählung, „Komplettpreis“ gesperrt, Preise netto, Hinweise „je Artikel“ und Karton", () => {
    expect(beilageLint("FBA-Prep all-in für 1 € pro Artikel", ohne).fehler).toEqual(["„all-in“ nur zusammen mit der Aufzählung der enthaltenen Leistungen („Enthalten: …“) – nie allein als Komplettpreis", "Preise als netto kennzeichnen (zzgl. USt.)"]);
    expect(beilageLint("Komplettpreis auf Anfrage", ohne).fehler[0]).toContain("Komplettpreis");
    expect(beilageLint("FBA-Prep ab 0,40 € netto", ohne)).toEqual({ fehler: [], hinweise: ["Preis „je Artikel“ angeben", KARTON] });
    expect(beilageLint("FBA-Prep ab 0,40 € netto je Artikel", ohne)).toEqual({ fehler: [], hinweise: [KARTON] });
    // Wortlaut nach dem Muster der Website: all-in mit Aufzählung, Karton getrennt → keine Fehler, keine Hinweise
    const muster = "FNSKU-Etikett inkl. FBA-Prep: 0,40 € netto pro Artikel (all-in). Enthalten: Etikett drucken und anbringen, in den FBA-Karton packen, Versandlabel drucken und übergeben. Karton inkl. Füllmaterial 2,90 € netto, von uns gestellt.";
    expect(beilageLint(muster, ohne)).toEqual({ fehler: [], hinweise: [] });
  });
  it("unbelegte Angaben nur nach Rückfrage (bestätigt) – Fläche, NDA, Gefahrgut, EAN-Prüfung inklusive", () => {
    const t = "Lager mit 500 m² und 120 Palettenstellplätzen, kostenlose Zählung, NDA möglich, Gefahrgut (LQ) auf Anfrage.";
    const f = beilageLint(t, ohne).fehler;
    expect(f).toHaveLength(4);
    expect(f[0]).toContain("Fläche/Palettenplätze");
    // Fläche/NDA/Gefahrgut nach Rückfrage erlaubt – „kostenlose Zählung“ bleibt immer gesperrt
    expect(beilageLint(t, { flaeche: true, zaehlung: true, nda: true, gefahrgut: true }).fehler).toEqual([ZAEHLUNG]);
    expect(beilageLint("Lager mit 500 m², NDA möglich, Gefahrgut (LQ) auf Anfrage.", { flaeche: true, nda: true, gefahrgut: true }).fehler).toEqual([]);
    expect(beilageLint("FBA-Prep, 500 m² Lagerfläche.", ohne).fehler).toEqual(["Angabe „Fläche/Palettenplätze“ nicht belegt – erst nach Rückfrage verwenden (in den Einstellungen bestätigen)"]);
    // EAN-Prüfung inklusive (noch nicht bestätigt) – mit Preis ist sie eine Zusatzleistung und erlaubt
    expect(beilageLint("Beim direkten FBA-Versand ist die EAN-Prüfung inklusive.", ohne).fehler).toEqual(["Angabe „EAN-Prüfung inklusive“ nicht belegt – erst nach Rückfrage verwenden (in den Einstellungen bestätigen)"]);
    expect(beilageLint("Beim direkten FBA-Versand ist die EAN-Prüfung inklusive.", { ...ohne, eanFba: true }).fehler).toEqual([]);
    expect(beilageLint("Mengenzählung 0,15 € netto pro Artikel, inkl. EAN-Prüfung 0,25 € netto pro Artikel.", ohne).fehler).toEqual([]);
  });
  it("Zählung nie „kostenlos/inklusive“, nie „Pflicht“ – empfohlene Formulierung erlaubt", () => {
    for (const t of [
      "Zählung und EAN-Prüfung bei direktem FBA-Versand kostenlos.",
      "Kostenfreie Mengenzählung bei Einlagerung.",
      "Inklusive Zählung der Ware.",
      "Die Zählung ist gratis.",
      "Die Mengenzählung ist im Preis enthalten.",
    ]) expect(beilageLint(t, ohne).fehler, t).toContain(ZAEHLUNG);
    expect(beilageLint("Mengenzählung bei Einlagerung (Pflicht), Preis auf Anfrage.", ohne).fehler).toEqual(["Mengenzählung ist optional zubuchbar, nicht Pflicht (Regel vom 11.11.)"]);
    const empfohlen = "Beim direkten FBA-Versand ist die Stückzahl durch das Verpacken erfasst, bei Einlagerung ist die Mengenzählung optional zubuchbar (0,15 €, mit EAN-Prüfung 0,25 € netto pro Artikel).";
    expect(beilageLint(empfohlen, ohne).fehler).toEqual([]);
    expect(beilageLint("Karton inkl. Füllmaterial 2,90 € netto, von uns gestellt. Mengenzählung zubuchbar.", ohne).fehler).toEqual([]);
    expect(beilageLint("Mengenzählung inkl. EAN-Prüfung 0,25 € netto pro Artikel.", ohne).fehler).toEqual([]);
    expect(beilageLint("Keine Mindestlaufzeit, kostenlose Beratung.", ohne).fehler).toEqual([]);
  });
  it("eigener Brief braucht Firma, Anschrift, Kontakt, Impressum, Text", () => {
    expect(beilageVollstaendig({ firma: "", strasse: "", plz: "", ort: "", email: "", telefon: "", web: "", impressum: "", datenschutz: "" }, "")).toEqual(["Firmenname", "Anschrift", "Kontakt (E-Mail oder Telefon)", "Impressum", "Textbaustein"]);
    expect(beilageVollstaendig({ firma: "Testlogistik GmbH", strasse: "Testweg 1", plz: "12345", ort: "Musterstadt", email: "info@example.invalid", telefon: "", web: "", impressum: "Amtsgericht Musterstadt HRB 0", datenschutz: "" }, "Text")).toEqual([]);
  });
});

describe("B34.3a Briefversand: Kosten, Limits, Adressprüfung", () => {
  const p = { grund: 0.9, jeWeitereSeite: 0.1 };
  it("Kostenvorschau = Grundpreis + je weitere Seite; ohne Preis gesperrt", () => {
    expect(briefKosten(1, p)).toBe(0.9);
    expect(briefKosten(2, p)).toBe(1);
    expect(kostenVorschau([1, 2, 1], p)).toEqual({ jeBrief: [0.9, 1, 0.9], summe: 2.8 });
    expect(kostenVorschau([1], { grund: null, jeWeitereSeite: null }).summe).toBeNull();
  });
  it("Tageslimit und Gesamtbudget", () => {
    expect(limitPruefen({ heute: 18, tageslimit: 20, bisherKosten: 0, budget: null, neu: 3, neuKosten: 2.7 })).toEqual({ ok: false, grund: "Tageslimit 20 Briefe (heute schon 18)" });
    expect(limitPruefen({ heute: 0, tageslimit: 20, bisherKosten: 9, budget: 10, neu: 3, neuKosten: 2.7 }).grund).toContain("Gesamtbudget 10,00 €");
    expect(limitPruefen({ heute: 0, tageslimit: 20, bisherKosten: 0, budget: 10, neu: 3, neuKosten: 2.7 }).ok).toBe(true);
  });
  it("Pflichtfelder, PLZ je Land, Sperrliste, Rechtsgrundlage, Dublette", () => {
    const l = { firma: "Testspielwaren GmbH", strasse: "Testweg 1", plz: "12345", ort: "Musterstadt", land: "DE", status: "neu", rechtsgrundlage: "Art. 6 Abs. 1 lit. f DSGVO" };
    expect(adressePruefen(l, { gesperrt: false, dublette: false })).toEqual({ ok: true, fehler: [] });
    expect(adressePruefen({ ...l, plz: "1234" }, { gesperrt: false, dublette: false }).fehler).toEqual(["PLZ 1234 passt nicht zu DE"]);
    expect(adressePruefen({ ...l, land: "AT", plz: "1010" }, { gesperrt: false, dublette: false }).ok).toBe(true);
    expect(adressePruefen({ ...l, strasse: null, rechtsgrundlage: "" }, { gesperrt: true, dublette: true }).fehler).toEqual(["Straße fehlt", "auf der Sperrliste", "Rechtsgrundlage fehlt", "gleiche Anschrift ist schon im Versand (Dublette)"]);
  });
});

describe("B34.3b Kampagnen: MHD, Umkreis, USt-ID, Lager, Nachfassen", () => {
  const heute = "2026-11-10";
  it("MHD-Formate und Mindestrestlaufzeit", () => {
    expect(mhdNorm("2027-05")).toBe("2027-05-31");
    expect(mhdNorm("05/2027")).toBe("2027-05-31");
    expect(mhdNorm("31.05.2027")).toBe("2027-05-31");
    expect(plusMonate("2026-08-31", 6)).toBe("2027-02-28");
    expect(mhdPruefen({ mhd: "2027-12", charge: "L123" }, heute, 6, true)).toEqual({ ok: true, grund: null });
    expect(mhdPruefen({ mhd: "2027-02", charge: "L123" }, heute, 6, true).grund).toBe("MHD 28.02.2027 unter Mindestrestlaufzeit 6 Monate (bis 10.05.2027) – nicht angeboten");
    expect(mhdPruefen({ mhd: null, charge: null }, heute, 6, true).grund).toBe("MHD fehlt – nicht angeboten");
    expect(mhdPruefen({ mhd: "2027-12", charge: "" }, heute, 6, true).grund).toBe("Charge fehlt – nicht angeboten");
    expect(mhdPruefen({ mhd: null, charge: null }, heute, 6, false).ok).toBe(true);
  });
  it("Umkreis um das Lager (Luftlinie) und weitere Filter", () => {
    const lager = { lat: 50.0, lng: 8.0 };
    expect(entfernungKm(lager, { lat: 50.3, lng: 8.0 })).toBeCloseTo(33.4, 0);
    const lead = { kategorie: "Friseursalon", plz: "60311", lat: 50.3, lng: 8.0, groesse: null, status: "neu", adelprep: false };
    const f = { branche: "friseur", umkreisKm: 50, status: ["neu"] };
    expect(leadImFilter(lead, f, lager)).toEqual({ ok: true, km: 33.4, grund: null });
    expect(leadImFilter({ ...lead, lat: 51.1 }, f, lager)).toMatchObject({ ok: false, grund: "122.3 km entfernt" });
    expect(leadImFilter({ ...lead, lat: null, lng: null }, f, lager).grund).toBe("ohne Koordinaten");
    expect(leadImFilter({ ...lead, kategorie: "Spielwaren" }, f, lager).grund).toBe("andere Branche");
    expect(leadImFilter(lead, f, null).grund).toBe("Lager-Standort fehlt (Einstellungen)");
    expect(leadImFilter({ ...lead, status: "gesperrt" }, {}, lager).ok).toBe(false);
  });
  it("USt-ID-Format (Gewerbenachweis)", () => {
    expect(ustIdFormat("DE 000 000 000")).toEqual({ ok: true, norm: "DE000000000", land: "DE", grund: null });
    expect(ustIdFormat("ATU00000000").ok).toBe(true);
    expect(ustIdFormat("NL000000000B00").ok).toBe(true);
    expect(ustIdFormat("DE12345").grund).toBe("Format für DE passt nicht");
    expect(ustIdFormat("").grund).toBe("USt-ID fehlt");
  });
  it("Lagerkostenrechner: Europalette 1,44 m³", () => {
    expect(lagerkosten({ paletten: 10, preisJePaletteMonat: 7.2 })).toEqual({ m3: 14.4, jeM3Monat: 5, jePaletteMonat: 7.2, monat: 72 });
    expect(lagerkosten({ paletten: 2, preisJePaletteMonat: null, preisJeM3Monat: 5 })).toEqual({ m3: 2.88, jeM3Monat: 5, jePaletteMonat: 7.2, monat: 14.4 });
  });
  it("Nachfassen nach 21 Tagen ohne Antwort", () => {
    const vor = new Date("2026-10-15T10:00:00Z");
    expect(nachfassFaellig(vor, false, new Date("2026-11-10T10:00:00Z"), 21)).toBe(true);
    expect(nachfassFaellig(vor, true, new Date("2026-11-10T10:00:00Z"), 21)).toBe(false);
    expect(nachfassFaellig(vor, false, new Date("2026-10-20T10:00:00Z"), 21)).toBe(false);
    expect(nachfassFaellig(vor, false, new Date("2026-11-10T10:00:00Z"), null)).toBe(false);
  });
  it("Zielgruppen: Lager-Kampagne als eigener Brief der Logistik-Firma, Friseure mit MHD-Pflicht", () => {
    expect(ZIELGRUPPEN.adelprep_lager.absender).toBe("adelprep");
    expect(ZIELGRUPPEN.friseure.mhdPflicht).toBe(true);
    expect(ZIELGRUPPEN.friseure.umkreisKm).toBe(50);
    for (const z of Object.values(ZIELGRUPPEN)) expect(z.textVorlage).not.toMatch(/all[\s-]?in|komplettpreis/i);
  });
  it("Kampagnen-Brief: Positionen netto, Hinweis auf QR-Code mit Bezug", () => {
    const b = kampagneAnschreiben({ betreff: "Haarpflege-Restposten", brieftext: "für Ihren Salon …", absender: { name: "Testfirma", strasse: "", plz: "", ort: "", email: "info@example.invalid", telefon: "" }, positionen: [{ titel: "Testshampoo 250 ml", menge: 24, preis: 3.2 }], code: "AV-ABC123", firma: "Testsalon" });
    expect(b.betreff).toBe("Haarpflege-Restposten (AV-ABC123)");
    expect(b.text).toContain("– Testshampoo 250 ml: 24 Stück, 3,20 € netto je Stück");
    expect(b.text).toContain("über den QR-Code bzw. den Link unten an (Bezug AV-ABC123)");
  });
  it("CSV: Zielgruppe AdelPrep, Koordinaten, Größe", () => {
    const r = leadsAusTabelle(["Firma", "PLZ", "Ort", "Zielgruppe AdelPrep", "Latitude", "Longitude", "Größe"], [["Testhandel GmbH", "12345", "Musterstadt", "ja", "50,1", "8.2", "Klein"], ["Zweiter Test GmbH", "12345", "Musterstadt", "nein", "", "", ""]]);
    expect(r.leads.map((l) => [l.adelprep, l.lat, l.lng, l.groesse])).toEqual([[true, 50.1, 8.2, "klein"], [false, null, null, null]]);
  });
});
