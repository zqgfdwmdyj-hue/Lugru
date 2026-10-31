import { describe, expect, it } from "vitest";
import { antwortText, einordnen, kiLesen, tagAusText, titelAus, zustaendigAus } from "@/lib/schnell/logic";

// Erfundene Diktate und Personen.
const H = "2026-10-30"; // Freitag
const P = [
  { id: "u-bea", name: "Bea Büro" },
  { id: "u-va", name: "Virtual Assistant", va: true },
];

describe("Schnellerfassung – Einordnung", () => {
  it("Tage: heute, morgen, Wochentag, Datum", () => {
    expect(tagAusText("morgen DHL anrufen", H)).toBe("2026-10-31");
    expect(tagAusText("übermorgen", H)).toBe("2026-11-01");
    expect(tagAusText("bis Dienstag erledigen", H)).toBe("2026-11-03");
    expect(tagAusText("am Freitag", H)).toBe("2026-11-06");
    expect(tagAusText("am 3.11. Termin", H)).toBe("2026-11-03");
    expect(tagAusText("irgendwann", H)).toBeNull();
  });
  it("Aufgabe mit Frist und Zuständigkeit; VA", () => {
    const e = einordnen("Aufgabe: Bea soll morgen die Rechnung von Testlieferant prüfen", H, { personen: P, privat: false });
    expect(e).toMatchObject({ art: "aufgabe", tag: "2026-10-31", zustaendigId: "u-bea", sicher: true });
    expect(e.titel.startsWith("Bea soll")).toBe(true);
    expect(einordnen("für die VA: Erstattungen prüfen", H, { personen: P, privat: false }).zustaendigId).toBe("u-va");
    expect(zustaendigAus("an Bea schicken", P)).toBe("u-bea");
  });
  it("Privates nur mit Privat-Zugang direkt; Privat-Zeit immer zur Bestätigung", () => {
    expect(einordnen("Zahnarzt für Kind A anrufen", H, { personen: P, privat: true })).toMatchObject({ art: "privat_aufgabe", sicher: true });
    expect(einordnen("Zahnarzt für Kind A anrufen", H, { personen: P, privat: false })).toMatchObject({ art: "privat_aufgabe", sicher: false });
    expect(einordnen("Paarzeit am Samstag ab 19 Uhr", H, { personen: P, privat: true })).toMatchObject({ art: "privat_zeit", privatArt: "paarzeit", sicher: false });
  });
  it("Termin, Notiz, Einkauf, Unklares", () => {
    expect(einordnen("Termin mit Testspedition am 4.11. um 10:30", H, { personen: P, privat: false })).toMatchObject({ art: "termin", tag: "2026-11-04", uhrzeit: "10:30", sicher: true });
    expect(einordnen("Notiz: Testmarke läuft gut in FR", H, { personen: P, privat: false })).toMatchObject({ art: "notiz", sicher: true, titel: "Testmarke läuft gut in FR" });
    expect(einordnen("Deal 4006381333931 für 12,50 Euro", H, { personen: P, privat: false })).toMatchObject({ art: "einkauf", ean: "4006381333931", preis: 12.5, sicher: true });
    expect(einordnen("blaue Kisten", H, { personen: P, privat: false })).toMatchObject({ art: "unklar", sicher: false });
  });
  it("Titel ohne Präfix; Antworttext kurz", () => {
    expect(titelAus("Aufgabe: dhl anrufen")).toBe("Dhl anrufen");
    const e = einordnen("Aufgabe morgen DHL Geschäftskunden anrufen", H, { personen: P, privat: false });
    expect(antwortText(e, true)).toMatch(/^Aufgabe angelegt für 31\.10\./);
    expect(antwortText(e, false)).toMatch(/Eingangsliste/);
    expect(antwortText({ ...e, art: "privat_aufgabe" }, true)).toBe("Privat-Aufgabe angelegt für 31.10.");
  });
  it("Siri: Weckwort weg, „erinnere mich …“ und „erstelle eine Aufgabe …“ werden direkt angelegt", () => {
    for (const t of ["erinnere mich morgen an die Retouren", "Seller-System, erinnere mich morgen an die Retouren", "Hey Siri, Seller System, erinner mich morgen an die Retouren", "Kannst du mich morgen an die Retouren erinnern? Erinnere mich morgen an die Retouren"].slice(0, 3)) {
      expect(einordnen(t, H, { personen: P, privat: false })).toMatchObject({ art: "aufgabe", titel: "Retouren", tag: "2026-10-31", sicher: true });
    }
    const e = einordnen("Erstelle morgen um 10 Uhr eine Aufgabe: Testlieferant anrufen", H, { personen: P, privat: false });
    expect(e).toMatchObject({ art: "aufgabe", titel: "Testlieferant anrufen", tag: "2026-10-31", uhrzeit: "10:00", sicher: true });
    expect(antwortText(e, true)).toBe("Aufgabe angelegt für 31.10. um 10:00: Testlieferant anrufen");
    expect(einordnen("Leg eine Aufgabe an: Retouren prüfen bis Dienstag", H, { personen: P, privat: false })).toMatchObject({ art: "aufgabe", titel: "Retouren prüfen", tag: "2026-11-03", sicher: true });
    expect(einordnen("Neue Aufgabe Kartons bestellen", H, { personen: P, privat: false })).toMatchObject({ art: "aufgabe", titel: "Kartons bestellen", sicher: true });
    expect(einordnen("Aufgabe für Bea: Paletten zählen", H, { personen: P, privat: false })).toMatchObject({ art: "aufgabe", titel: "Paletten zählen", zustaendigId: "u-bea", sicher: true });
    expect(einordnen("Termin morgen um 10 Uhr mit Testspedition", H, { personen: P, privat: false })).toMatchObject({ art: "termin", titel: "Termin mit Testspedition", uhrzeit: "10:00" });
  });
  it("Siri: ohne Inhalt nachfragen; Unklares und Privates weiter zur Bestätigung", () => {
    const leer = einordnen("Erstelle morgen um 10 Uhr eine Aufgabe", H, { personen: P, privat: false });
    expect(leer).toMatchObject({ titel: "", sicher: false });
    expect(antwortText(leer, false)).toMatch(/^Was soll die Aufgabe sein\?/);
    expect(einordnen("Retouren morgen", H, { personen: P, privat: false })).toMatchObject({ art: "unklar", sicher: false });
    expect(einordnen("Erinnere mich morgen an den Zahnarzt", H, { personen: P, privat: true })).toMatchObject({ art: "privat_aufgabe", titel: "Zahnarzt", sicher: true });
    expect(einordnen("Erinnere mich morgen an den Zahnarzt", H, { personen: P, privat: false })).toMatchObject({ art: "privat_aufgabe", sicher: false });
    expect(einordnen("Erinnere mich an die Paarzeit am Samstag", H, { personen: P, privat: true })).toMatchObject({ art: "privat_zeit", sicher: false });
  });
  it("KI-Antwort: nur geschäftliche Aufgaben/Notizen direkt, Privates ohne Zugang nie", () => {
    const basis = einordnen("blaue Kisten", H, { personen: P, privat: false });
    expect(kiLesen('{"art":"aufgabe","titel":"Blaue Kisten bestellen","tag":"2026-11-02","uhrzeit":null,"sicher":true}', basis, false)).toMatchObject({ art: "aufgabe", sicher: true, tag: "2026-11-02" });
    expect(kiLesen('{"art":"privat_termin","titel":"x","sicher":true}', basis, false)).toMatchObject({ art: "unklar", sicher: false });
    expect(kiLesen('{"art":"termin","titel":"x","sicher":true}', basis, false)).toMatchObject({ art: "termin", sicher: false });
    expect(kiLesen("kein json", basis, false)).toBeNull();
  });
});
