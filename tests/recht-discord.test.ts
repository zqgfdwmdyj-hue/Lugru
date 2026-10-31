import { describe, expect, it } from "vitest";
import { aktenzeichenAus, amZugAus, behoerdenMail, fristenAus, unterlagenVorschlag, istAnwalt, istPrivat, morgenZeile, nachfrageEntwurf, passtZuFall, stillstand, statusAus } from "@/lib/recht/logic";
import { anonym, dublette, fruehwarnungen, istDeal, kanaeleAus, zusammenfassungFaellig, zusammenfassungLesen } from "@/lib/discord-wissen/logic";

// Erfundene Fälle, Kanzleien und Chat-Nachrichten.
const H = "2026-10-30";

describe("Rechtsfälle", () => {
  it("Aktenzeichen erkennen und zuordnen", () => {
    expect(aktenzeichenAus("Ihr Zeichen: 123/26, Unser Zeichen: KAN-2026-0012")).toBe("123/26");
    expect(aktenzeichenAus("Aktenzeichen: 45 O 123/26 – Markenstreit")).toBe("45 O 123/26");
    expect(aktenzeichenAus("Hallo")).toBeNull();
    expect(passtZuFall("Re: Ihre Sache Az. 45 O 123/26", { aktenzeichen: "45 O 123/26" })).toBe(true);
    expect(passtZuFall("Re: Ihre Sache Az. 45 O 124/26", { aktenzeichen: "45 O 123/26" })).toBe(false);
  });
  it("Fristen und wer am Zug ist", () => {
    const f = fristenAus("Bitte senden Sie uns die Unterlagen bis 14.11. zu. Danke.", H);
    expect(f).toEqual([{ tag: "2026-11-14", text: "Bitte senden Sie uns die Unterlagen bis 14.11. zu." }]);
    expect(fristenAus("Wir hatten am 14.11. telefoniert.", H)).toEqual([]);
    expect(amZugAus("Bitte senden Sie uns die Rechnungen.")).toBe("wir");
    expect(amZugAus("Bitte bis 14.11. Unterlagen senden.")).toBe("wir");
    expect(amZugAus("Wir haben den Schriftsatz eingereicht.")).toBe("anwalt");
    expect(behoerdenMail({ from: "Amtsgericht Teststadt <poststelle@ag-test.example>", subject: "Ladung", body: "" })).toBe(true);
    expect(behoerdenMail({ from: "Kanzlei X <a@x.example>", subject: "Abmahnung wegen Markenverletzung", body: "" })).toBe(true);
    expect(behoerdenMail({ from: "Lieferant <a@y.example>", subject: "Preisliste November", body: "Anbei die Liste." })).toBe(false);
    expect(unterlagenVorschlag("Bitte Rechnungen und Nachweise zur Lieferkette der Marke senden").map((u) => u.link)).toEqual(["/rechnungen", "/echtheit"]);
    expect(amZugAus("Die mündliche Verhandlung beim Gericht ist am 3.12.")).toBe("gericht");
    expect(amZugAus("Ich habe die Gegenseite angeschrieben.")).toBe("gegenseite");
    expect(amZugAus("Ich prüfe das.")).toBe("anwalt");
  });
  it("privat, Status, Stillstand, Anwalts-Domain", () => {
    expect(istPrivat({ projektGid: "111", projektName: "Mandat LuGru", abschnitt: null }, ["111"])).toBe(true);
    expect(istPrivat({ projektGid: "222", projektName: "Privat – Mietsache", abschnitt: null }, [])).toBe(true);
    expect(istPrivat({ projektGid: "333", projektName: "LuGru Markenrecht", abschnitt: "In Bearbeitung" }, [])).toBe(false);
    expect(statusAus(true, "x")).toBe("abgeschlossen");
    expect(statusAus(false, "Wartet auf Mandant")).toBe("Wartet auf Mandant");
    const jetzt = new Date("2026-10-30T10:00:00Z");
    expect(stillstand({ letzteBewegung: new Date("2026-10-01T10:00:00Z"), abgeschlossen: null, createdAt: jetzt }, jetzt, 21)).toBe(true);
    expect(stillstand({ letzteBewegung: new Date("2026-10-20T10:00:00Z"), abgeschlossen: null, createdAt: jetzt }, jetzt, 21)).toBe(false);
    expect(istAnwalt("Kanzlei <post@kanzlei-test.example>", ["kanzlei-test.example"])).toBe(true);
    expect(istAnwalt("x@andere.example", ["kanzlei-test.example"])).toBe(false);
  });
  it("Morgenbericht: privat nur Anzahl; Nachfrage-Entwurf", () => {
    expect(morgenZeile([{ bereich: "geschaeft", titel: "Markenstreit Test", tag: "2026-11-02" }, { bereich: "privat", titel: "GEHEIM", tag: "2026-11-03" }])).toBe("Rechtsfristen in 7 Tagen: „Markenstreit Test“ 02.11., 1 private Rechtsfrist");
    expect(morgenZeile([])).toBeNull();
    expect(nachfrageEntwurf({ titel: "Markenstreit Test", aktenzeichen: "45 O 1/26" }, 21).betreff).toBe("Sachstand Az. 45 O 1/26");
  });
});

describe("Wissen aus Discord-Kanälen", () => {
  it("Kanäle, Rhythmus, Anonymisierung", () => {
    expect(kanaeleAus("900000000000000001 | Amazon | täglich\n900000000000000002 | Temu | wöchentlich\nquatsch\n900000000000000003 | Aktien | aus")).toEqual([
      { id: "900000000000000001", name: "Amazon", rhythmus: "taeglich" },
      { id: "900000000000000002", name: "Temu", rhythmus: "woechentlich" },
      { id: "900000000000000003", name: "Aktien", rhythmus: "aus" },
    ]);
    const j = new Date("2026-10-30T10:00:00Z");
    expect(zusammenfassungFaellig("taeglich", new Date("2026-10-29T08:00:00Z"), j)).toBe(true);
    expect(zusammenfassungFaellig("woechentlich", new Date("2026-10-27T08:00:00Z"), j)).toBe(false);
    expect(zusammenfassungFaellig("aus", null, j)).toBe(false);
    expect(anonym([{ autorId: "1", text: "Hallo <@123>" }, { autorId: "2", text: "Hi" }, { autorId: "1", text: "Nochmal" }])).toBe("Nutzer A: Hallo @Nutzer\nNutzer B: Hi\nNutzer A: Nochmal");
  });
  it("Frühwarnung ab 3 Nutzern in 48 h; Deal; Dublette; KI-Antwort", () => {
    const j = new Date("2026-10-30T10:00:00Z");
    const n = (a: string, t: string, h = 1) => ({ autorId: a, text: t, gesendetAm: new Date(j.getTime() - h * 3_600_000) });
    const w = fruehwarnungen([n("1", "Bei mir Batterie-Registrierungsnummer fehlt, Angebote in IE weg"), n("2", "Auch EPR Batterie Mail bekommen"), n("3", "Battery registration number requested"), n("4", "Batterie alt", 72)], j);
    expect(w.map((x) => [x.key, x.nutzer])).toEqual([["batterie", 3]]);
    expect(fruehwarnungen([n("1", "Batterie"), n("1", "Batterie nochmal"), n("2", "Batterie")], j)).toEqual([]);
    expect(istDeal("B0TEST0001 für 12,50 €")).toBe(true);
    expect(istDeal("Wie geht ihr mit Retouren um?")).toBe(false);
    expect(dublette("Batterie-Registrierung für Irland nötig", ["Batterie Registrierung für Irland nötig"])).toBeTruthy();
    expect(dublette("Neue Gebühr ab Januar", ["Batterie Registrierung"])).toBeNull();
    const z = zusammenfassungLesen('{"ueberblick":"Viel zu Batterien.","themen":[{"name":"EPR","punkte":["IE"]}],"tipps":[],"warnungen":["Frist"],"fragen":[],"tools":[],"erkenntnisse":[{"titel":"Batterie-Nr. für IE","text":"Ohne Nummer wird deaktiviert.","art":"warnung"}]}');
    expect(z?.erkenntnisse[0]).toMatchObject({ art: "warnung" });
    expect(zusammenfassungLesen("kein json")).toBeNull();
  });
});
