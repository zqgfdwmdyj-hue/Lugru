import { describe, expect, it } from "vitest";
import { anrufErledigtLesen, anrufFinden, anrufName, anrufeFuerFahrt, briefingText, euroSprechen, fahrtAnsage, fahrtVorschlag, istAnruf, scanAnsage, smsAntwort, smsErlaubt, smsText, telefonAus, verspaetung, zielArt, type Orte } from "@/lib/mobil/logic";

// Erfundene Namen, Orte und Nummern.
const H = "2026-10-30";
const O: Orte = { lager: ["Lagerweg 1, 12345 Teststadt"], prep: ["Prepstraße 5"], palettenlager: [], zuhause: "Wohnweg 9, 12345 Teststadt", lieferanten: [{ id: "l1", name: "Testgroßhandel", adresse: "Handelsallee 3, 54321 Musterort" }] };

describe("Anrufe in der Fahrzeit", () => {
  it("erkennen, Name, Nummer", () => {
    expect(istAnruf("DHL Geschäftskunden anrufen")).toBe(true);
    expect(istAnruf("Rechnung prüfen")).toBe(false);
    expect(anrufName("DHL Geschäftskunden anrufen")).toBe("DHL Geschäftskunden");
    expect(anrufName("Konrad zurückrufen wegen Preisliste")).toBe("Konrad");
    expect(telefonAus("Tel. +49 170 1234567 bitte")).toBe("+491701234567");
    expect(telefonAus("0170/1234567")).toBe("01701234567");
    expect(telefonAus("Bestellung 123")).toBeNull();
  });
  it("Auswahl nach Zeit und Wichtigkeit; Ansage", () => {
    const a = [
      { id: "1", titel: "Konrad zurückrufen", prioritaet: "normal" as const, faellig: H, telefon: null },
      { id: "2", titel: "DHL Geschäftskunden anrufen", prioritaet: "critical" as const, faellig: null, telefon: "+49301234567" },
      { id: "3", titel: "Testlieferant anrufen", prioritaet: "low" as const, faellig: null, telefon: null },
    ];
    const f = anrufeFuerFahrt(a, 12, H);
    expect(f.map((x) => x.id)).toEqual(["2", "1"]);
    expect(fahrtAnsage(20, f)).toBe("20 Minuten Fahrt. 2 Anrufe: DHL Geschäftskunden und Konrad.");
    expect(fahrtAnsage(null, [])).toBe("Gute Fahrt. Keine Anrufe offen.");
  });
  it("„Anruf erledigt: Konrad, Notiz: …“", () => {
    expect(anrufErledigtLesen("Anruf erledigt: Konrad, Notiz: nimmt 60 Stück")).toEqual({ name: "Konrad", notiz: "nimmt 60 Stück" });
    expect(anrufErledigtLesen("erledigt DHL")).toEqual({ name: "DHL", notiz: null });
    expect(anrufErledigtLesen("hallo")).toBeNull();
    expect(anrufFinden([{ titel: "Konrad zurückrufen" }, { titel: "DHL anrufen" }], "konrad")?.titel).toBe("Konrad zurückrufen");
  });
});

describe("Ziel und Briefing", () => {
  it("Ziel erkennen", () => {
    expect(zielArt("Handelsallee 3, Musterort", O)).toEqual({ art: "lieferant", lieferantId: "l1" });
    expect(zielArt("Abholung Testgroßhandel", O).art).toBe("lieferant");
    expect(zielArt("Prepstraße 5", O).art).toBe("prep");
    expect(zielArt("Wohnweg 9", O).art).toBe("zuhause");
    expect(zielArt("DHL Paketshop", O).art).toBe("post");
    expect(zielArt("Kino", O).art).toBe("sonst");
    expect(zielArt("Testgroßhandelszentrum", { ...O, lieferanten: [{ id: "x", name: "Test", adresse: null }] }).art).toBe("sonst");
  });
  it("Briefing-Texte vorlesbar", () => {
    expect(briefingText({ art: "lieferant", name: "Testgroßhandel", bestellvorschlaege: { stueck: 48, summe: 412.5 }, preislisteVom: "2026-10-20", offeneRechnungen: 1 })).toBe("Testgroßhandel. Offene Bestellvorschläge: 48 Stück für 412 Euro. Letzte Preisliste vom 20.10.. 1 offene Rechnung.".replace("20.10..", "20.10.."));
    expect(briefingText({ art: "zuhause", feierabend: { erledigt: 5, offen: 2, morgen: ["Steuerberater 10 Uhr"] } })).toBe("Feierabend. Heute erledigt: 5. Offen: 2. Morgen: Steuerberater 10 Uhr.");
    expect(briefingText({ art: "lager", remissionen: 2, fbmOffen: 1 })).toBe("Lager. Zur Prüfung: 2 Remissionen. 1 offener FBM-Auftrag.");
    expect(euroSprechen(4.2)).toBe("4 Euro 20");
    expect(euroSprechen(1234)).toBe("1.234 Euro");
  });
});

describe("SMS, Verspätung, Fahrtenbuch, Scan", () => {
  it("Antwort-Codes", () => {
    expect(smsAntwort("VA")).toMatchObject({ code: "VA" });
    expect(smsAntwort("Später [F12]")).toMatchObject({ code: "SPAETER", ref: "F12" });
    expect(smsAntwort("kaufen 20")).toMatchObject({ code: "KAUFEN", menge: 20 });
    expect(smsAntwort("was?")).toMatchObject({ code: "unklar" });
    expect(smsText("Angebote in IE deaktiviert (Batterie-Nr.)", "F12")).toBe("Angebote in IE deaktiviert (Batterie-Nr.). Antwort: VA / SPÄTER. [F12]");
  });
  it("Ruhezeit, Familienzeit, Limit; rot geht immer (außer Limit)", () => {
    const b = { ruheVon: "20:00", ruheBis: "08:00", inSperrzeit: false, rot: false, heuteGesendet: 0, limit: 10 };
    expect(smsErlaubt({ ...b, uhrzeit: "21:00" }).ok).toBe(false);
    expect(smsErlaubt({ ...b, uhrzeit: "21:00", rot: true }).ok).toBe(true);
    expect(smsErlaubt({ ...b, uhrzeit: "12:00", inSperrzeit: true })).toEqual({ ok: false, grund: "Familienzeit" });
    expect(smsErlaubt({ ...b, uhrzeit: "12:00", heuteGesendet: 10, rot: true })).toEqual({ ok: false, grund: "Tageslimit erreicht" });
  });
  it("Verspätung nur über Toleranz; Fahrtenbuch-Vorschlag", () => {
    const t = new Date("2026-10-30T10:00:00Z");
    expect(verspaetung(new Date("2026-10-30T10:08:00Z"), t)).toBeNull();
    expect(verspaetung(new Date("2026-10-30T10:16:00Z"), t)).toBe(15);
    expect(fahrtVorschlag({ start: "Wohnweg 9", ziel: "Handelsallee 3, Musterort", beginn: "2026-10-30T08:00:00Z", km: 22 }, O, { titel: "Abholung Testgroßhandel" })).toEqual({ art: "geschaeftlich", zweck: "Abholung Testgroßhandel", zielAnzeige: "Handelsallee 3, Musterort" });
    expect(fahrtVorschlag({ start: "x", ziel: "Kino", beginn: "", km: 5 }, O, null)).toEqual({ art: "privat", zweck: null, zielAnzeige: "privat" });
  });
  it("Scan-Ansage", () => {
    expect(scanAnsage({ ampel: "gruen", land: "FR", gewinnStueck: 4.2, roi: 28.4, angebote: 12, menge: 15 })).toBe("Grün. Frankreich. 4 Euro 20 pro Stück, ROI 28 Prozent. 12 Angebote. Nimm 15.");
    expect(scanAnsage({ ampel: "rot", land: null, gewinnStueck: null, roi: null, angebote: null, menge: null, grund: "Bestand reicht 140 Tage" })).toBe("Rot. Bestand reicht 140 Tage.");
  });
});
