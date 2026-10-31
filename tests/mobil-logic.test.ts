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

import { entfernungM, heizAusnahme, standortGrob, statusSatz, vorheizFaellig, zuHause } from "@/lib/mobil/vorheizen";

describe("Tesla vorheizen (Modul 12)", () => {
  const jetzt = new Date("2026-11-02T08:00:00Z");
  const t = (min: number, o: Partial<{ ort: string | null; titel: string; notiz: string }> = {}) => ({ key: `k${min}`, titel: o.titel ?? "Termin", start: new Date(jetzt.getTime() + min * 60_000), ort: o.ort === undefined ? "Musterweg 1, 12345 Musterstadt" : o.ort, notiz: o.notiz ?? null, privat: false });
  it("heizt X Minuten vor der Abfahrt (Termin − Fahrzeit), nicht zu früh und nicht nach der Abfahrt", () => {
    const o = { fahrzeitMin: 20, vorlaufMin: 10 };
    expect(vorheizFaellig([t(25)], jetzt, o)?.key).toBe("k25"); // Abfahrt in 5 Min. → heizen
    expect(vorheizFaellig([t(45)], jetzt, o)).toBeNull(); // Abfahrt in 25 Min. → noch nicht
    expect(vorheizFaellig([t(15)], jetzt, o)).toBeNull(); // Abfahrt war vor 5 Min.
    expect(vorheizFaellig([t(25, { ort: null })], jetzt, o)).toBeNull(); // ohne Ort
    expect(vorheizFaellig([t(25, { notiz: "#nichtheizen" })], jetzt, o)).toBeNull();
    expect(vorheizFaellig([t(25, { titel: "Termin (mit der Bahn)" })], jetzt, o)).toBeNull();
  });
  it("Ausnahmen, zu Hause, Standort grob, Satz", () => {
    expect(heizAusnahme("Zoom mit Lieferant")).toBe(true);
    expect(heizAusnahme("Arzt Dr. Test")).toBe(false);
    expect(Math.round(entfernungM({ lat: 50, lon: 8 }, { lat: 50.001, lon: 8 }))).toBe(111);
    expect(zuHause({ lat: 50.1, lon: 8.6 }, { lat: 50.1005, lon: 8.6 })).toBe(true);
    expect(zuHause({ lat: 50.2, lon: 8.6 }, { lat: 50.1, lon: 8.6 })).toBe(false);
    expect(zuHause({ lat: 50.2, lon: 8.6 }, { lat: null, lon: null })).toBeNull();
    expect(standortGrob({ lat: 50.2, lon: 8.6, ziel: "Handelsallee 3, 54321 Musterort" }, { lat: 50.1, lon: 8.6 })).toBe("unterwegs nach Handelsallee 3");
    expect(statusSatz({ akku: 78, reichweiteKm: 350, innenTemp: 18.4, verriegelt: false, fensterOffen: false, reifenWarnung: false, update: null }, "zu Hause")).toBe("Akku 78 Prozent, 350 Kilometer Reichweite. Auto zu Hause. Innen 18 Grad. Achtung: nicht verriegelt.");
  });
});

// B17: Telefonnummer für Anruf-Aufgaben – Signatur, Suchwort, Rückfrage. Erfundene Nummern.
describe("Anruf-Telefonnummer (B17)", () => {
  it("Nummer nur aus Signaturzeilen, nicht aus Bestellnummern", async () => {
    const { telefonAusSignatur } = await import("@/lib/mobil/logic");
    expect(telefonAusSignatur("Ihre Bestellung 302-1234567-7654321\n\nMit freundlichen Grüßen\nTestservice\nTel.: 0228 555 0100\nFax: 0228 555 0199")).toBe("02285550100");
    expect(telefonAusSignatur("Bestellung 302-1234567-7654321 wurde versandt.")).toBeNull();
    expect(telefonAusSignatur("Hotline: +49 30 5550 1234")).toBe("+493055501234");
  });
  it("Suchwort und Rückfrage", async () => {
    const { namensKern, telefonRueckfrage } = await import("@/lib/mobil/logic");
    expect(namensKern("DHL Geschäftskunden")).toBe("DHL");
    expect(namensKern("Testlieferant GmbH")).toBe("Testlieferant");
    expect(telefonRueckfrage("DHL Geschäftskunden", null)).toContain("fehlt – bitte nennen");
    expect(telefonRueckfrage("DHL Geschäftskunden", { nummer: "02285550100", quelle: "Signatur einer Mail" })).toContain("Vorschlag: 02285550100");
  });
});
