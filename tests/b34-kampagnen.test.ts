import { describe, expect, it } from "vitest";
import { adressePruefen, beilageLint, beilageVollstaendig, briefKosten, entfernungKm, kostenVorschau, lagerkosten, leadImFilter, limitPruefen, mhdNorm, mhdPruefen, nachfassFaellig, plusMonate, ustIdFormat, ZIELGRUPPEN } from "@/lib/abverkauf/kampagne-logic";
import { kampagneAnschreiben, leadsAusTabelle } from "@/lib/abverkauf/logic";

// B34.3.6/3a/3b – nur erfundene Werte (Testfirmen, example.invalid, DE00…).

const ohne = { flaeche: false, zaehlung: false, nda: false, gefahrgut: false };

describe("B34.3.6 AdelPrep-Beilage: Textprüfung", () => {
  it("„all-in“/„Komplettpreis“ sperren, Preise netto, Hinweis „je Artikel“", () => {
    expect(beilageLint("FBA-Prep all-in für 1 € pro Artikel", ohne).fehler).toEqual(["„all-in“ vermeiden – stattdessen „ab … € netto je Artikel“", "Preise als netto kennzeichnen (zzgl. USt.)"]);
    expect(beilageLint("Komplettpreis auf Anfrage", ohne).fehler[0]).toContain("Komplettpreis");
    expect(beilageLint("FBA-Prep ab 0,40 € netto", ohne)).toEqual({ fehler: [], hinweise: ["Preis „je Artikel“ angeben"] });
    expect(beilageLint("FBA-Prep ab 0,40 € netto je Artikel", ohne)).toEqual({ fehler: [], hinweise: [] });
  });
  it("unbelegte Angaben nur nach Rückfrage (bestätigt)", () => {
    const t = "Lager mit 500 m² und 120 Palettenstellplätzen, kostenlose Zählung, NDA möglich, Gefahrgut (LQ) auf Anfrage.";
    const f = beilageLint(t, ohne).fehler;
    expect(f).toHaveLength(4);
    expect(f[0]).toContain("Fläche/Palettenplätze");
    expect(beilageLint(t, { flaeche: true, zaehlung: true, nda: true, gefahrgut: true }).fehler).toEqual([]);
    // „m²“ allein (ohne Palettenplätze) wird erkannt
    expect(beilageLint("FBA-Prep, 500 m² Lagerfläche.", ohne).fehler).toEqual(["Angabe „Fläche/Palettenplätze“ nicht belegt – erst nach Rückfrage verwenden (in den Einstellungen bestätigen)"]);
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
