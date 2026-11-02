import { describe, expect, it } from "vitest";
import { auswahlNummer, bestandLesen, dealLesen, dealZeile, dringendZeilen, euroK, fristKurz, notizLesen, pushKurz, sprechbar, standZeilen, watchAntwort, WATCH_MAX_ZEICHEN } from "@/lib/mobil/watch-logic";
import { kaufText } from "@/lib/deal-eingang/kauf-logic";

// Apple Watch (Bauauftrag Handy-Tesla §10): Kurzantworten ≤ 3 Zeilen / 160 Zeichen, sprich/zeige, „Stand HH:MM“,
// Sprachbefehle, Push ≤ 120 Zeichen. Erfundene Werte.

describe("Antwortformat", () => {
  it("Beispiel aus dem Auftrag: 3 Zeilen, unter 160 Zeichen, vorlesbar", () => {
    const z = standZeilen({ heute: "2026-10-31", umsatzHeute: 2680, umsatzMonat: 100_400, gewinnMonat: 4512, roteFaelle: 2, termin: { tag: "heute", von: "15:00", titel: "Termin außer Haus" } });
    const a = watchAntwort(z, { stand: new Date(), jetzt: new Date() });
    expect(a.zeige).toBe("Heute 2.680 €, Oktober 100 k€, Gewinn 4,5 k€.\n2 rote Fälle.\n15:00 Termin außer Haus.");
    expect(a.zeilen).toHaveLength(3);
    expect(a.zeige.length).toBeLessThanOrEqual(WATCH_MAX_ZEICHEN);
    expect(a.sprich).toBe("Heute 2.680 Euro, Oktober 100 tausend Euro, Gewinn 4,5 tausend Euro. 2 rote Fälle. 15:00 Termin außer Haus.");
    expect(a.stand).toBeNull();
  });
  it("Daten älter als 30 Minuten → „Stand HH:MM“ vorne", () => {
    const jetzt = new Date("2026-11-01T14:45:00Z");
    const a = watchAntwort(["Heute 100 €."], { stand: new Date("2026-11-01T14:12:00Z"), jetzt });
    expect(a.zeige).toBe("Stand 15:12: Heute 100 €.");
    expect(watchAntwort(["x"], { stand: new Date("2026-11-01T14:20:00Z"), jetzt }).stand).toBeNull();
  });
  it("nie mehr als 3 Zeilen / 160 Zeichen, keine Links und Tabellen", () => {
    const lang = "Sehr lange Zeile mit vielen Wörtern ".repeat(10);
    const a = watchAntwort([lang, lang, lang, "vierte"]);
    expect(a.zeilen.length).toBeLessThanOrEqual(3);
    expect(a.zeige.length).toBeLessThanOrEqual(160);
    const b = watchAntwort(["Siehe https://example.invalid/x | Tabelle | **fett** /deal-eingang/123 14,96 €/Stk"]);
    expect(b.zeige).not.toMatch(/https?:|\||\*\*|\/deal-eingang/);
    expect(b.zeige).toContain("14,96 €/Stk");
  });
  it("Beträge und Vorlesen", () => {
    expect(euroK(850)).toBe("850 €");
    expect(euroK(4512)).toBe("4,5 k€");
    expect(euroK(100_400)).toBe("100 k€");
    expect(sprechbar("🟢 Grün, ROI 28 %, 14,96 €/Stk")).toBe("Grün, R O I 28 Prozent, 14,96 Euro pro Stück");
  });
  it("Frist kurz", () => {
    expect(fristKurz("2026-10-30", "2026-11-01")).toBe("überfällig");
    expect(fristKurz("2026-11-01", "2026-11-01")).toBe("heute");
    expect(fristKurz("2026-11-02", "2026-11-01")).toBe("morgen");
    expect(fristKurz("2026-11-04", "2026-11-01")).toBe("bis Mi");
    expect(fristKurz("2026-11-20", "2026-11-01")).toBe("bis 20.11.");
    expect(fristKurz(null, "2026-11-01")).toBe("ohne Frist");
  });
  it("Dringend: höchstens 3 Zeilen je mit Frist, passt in 160 Zeichen", () => {
    const z = dringendZeilen([
      { text: "Versandbestätigung bei Amazon hochladen: 3 Aufträge mit Frist heute", frist: "heute" },
      { text: "2 FBM-Versände überfällig", frist: "sofort" },
      { text: "Anspruch FBA15TEST einreichen – Frist läuft ab", frist: "morgen" },
      { text: "vierter Punkt", frist: "bald" },
    ]);
    expect(z).toHaveLength(3);
    expect(z.every((x) => / – (heute|sofort|morgen)$/.test(x))).toBe(true);
    expect(watchAntwort(z).zeilen).toHaveLength(3);
    expect(dringendZeilen([])).toEqual(["Nichts Dringendes."]);
  });
});

describe("Sprachbefehle", () => {
  it("Notiz: VA / privat / Aufgabe", () => {
    expect(notizLesen("Notiz VA bitte Rechnung Tefal prüfen")).toEqual({ art: "va", text: "bitte Rechnung Tefal prüfen" });
    expect(notizLesen("VA: Paket zählen")).toEqual({ art: "va", text: "Paket zählen" });
    expect(notizLesen("privat Blumen kaufen")).toEqual({ art: "privat", text: "Blumen kaufen" });
    expect(notizLesen("Notiz Lieferant anrufen")).toEqual({ art: "aufgabe", text: "Lieferant anrufen" });
    expect(notizLesen("Vase verpacken").art).toBe("aufgabe");
  });
  it("Deal: ASIN, EAN oder Name + Preis", () => {
    expect(dealLesen("Deal prüfen B0TEST0001 19,99")).toEqual({ code: "B0TEST0001", name: null, preis: 19.99 });
    expect(dealLesen("4006381333931 für 12,50 €")).toMatchObject({ code: "4006381333931", preis: 12.5 });
    expect(dealLesen("Tefal Pfanne 24 Euro 90")).toMatchObject({ code: null, name: "Tefal Pfanne", preis: 24.9 });
    expect(dealLesen("Testartikel für 9")).toMatchObject({ name: "Testartikel", preis: 9 });
  });
  it("Bestand: Artikel + Menge, ohne Menge nur nachsehen", () => {
    expect(bestandLesen("Bestand Tefal 12 Stück")).toEqual({ suche: "Tefal", menge: 12 });
    expect(bestandLesen("Tefal Pfanne 28 cm auf 7")).toEqual({ suche: "Tefal Pfanne 28 cm", menge: 7 });
    expect(bestandLesen("Socken")).toEqual({ suche: "Socken", menge: null });
  });
  it("Auswahl per Nummer", () => {
    expect(auswahlNummer("Nummer 2")).toBe(2);
    expect(auswahlNummer("2")).toBe(2);
    expect(auswahlNummer("die zweite")).toBe(2);
    expect(auswahlNummer("drei")).toBe(3);
    expect(auswahlNummer("Tefal 12 Stück")).toBeNull();
    expect(auswahlNummer("")).toBeNull();
  });
  it("Deal-Zeile wie im Auftrag", () => {
    expect(dealZeile({ ampel: "gruen", roi: 28.4, gewinn: 14.96, menge: 3 })).toBe("Grün, ROI 28 %, 14,96 €/Stk, Empfehlung 3 Stück.");
    expect(dealZeile({ ampel: "rot", roi: -5, gewinn: -1, menge: 3, grund: "Kein Gewinn nach Gebühren." })).toBe("Rot, ROI -5 %, -1,00 €/Stk, Kein Gewinn nach Gebühren.");
  });
});

describe("Push auf die Watch", () => {
  it("höchstens 120 Zeichen, Zeilen verbunden, Titel kurz", () => {
    const p = pushKurz({ titel: "Deal 🟢 · ProfitPath · Nr. 17 – mit sehr langem Zusatz, der abgeschnitten werden muss", text: "🟢 Deal 17: OnePlus Buds · DE: ROI 36 %, 9,10 €/Stk · Empf. 4 Stk (80 €) · EK 20,00 €\nAmazon: Warenkorb vorbereitet (4 Stk)\nDiesen Monat eingekauft: 1.200 €" });
    expect(p.text.length).toBeLessThanOrEqual(120);
    expect(p.text.startsWith("🟢 Deal 17: OnePlus Buds · DE: ROI 36 %")).toBe(true);
    expect(p.titel.length).toBeLessThanOrEqual(60);
  });
  it("grüner Deal: Nummer und ROI vorne (für „Kaufen 17“)", () => {
    const t = kaufText({ titel: "OnePlus Buds Pro Testfarbe mit extra langem Namen", name: null, ekNetto: 20, bestesLand: "DE", roi: 36, gewinn: 9.1, empfohlen: 4, kapitalbedarf: 80, maxEk: [], gueltigBis: null }, { nr: 17, ampel: "gruen" });
    expect(t).toMatch(/^🟢 Deal 17: OnePlus Buds Pro Testfarbe mit… · DE: ROI 36 %/);
    expect(pushKurz({ titel: "x", text: t }).text).toContain("Deal 17");
  });
});

describe("Ein Kurzbefehl für alles (watch/frage)", () => {
  it("ordnet freie Sätze dem richtigen Befehl zu", async () => {
    const { watchBefehl } = await import("@/lib/mobil/watch-logic");
    const b = (t: string) => watchBefehl(t).befehl;
    expect(b("Wie läuft's?")).toBe("stand");
    expect(b("Hey Siri, Seller, wie läuft es heute")).toBe("stand");
    expect(b("Was ist dringend")).toBe("dringend");
    expect(b("Was steht heute an?")).toBe("dringend");
    expect(b("Erledigt")).toBe("erledigt");
    expect(b("Nummer 2")).toBe("nummer");
    expect(b("zwei")).toBe("nummer");
    expect(b("Notiz Rechnung Tefal prüfen")).toBe("notiz");
    expect(b("VA bitte Rechnung prüfen")).toBe("notiz");
    expect(b("Bestand Tefal 12 Stück")).toBe("bestand");
    expect(b("Tefal Pfanne 12 Stück")).toBe("bestand");
    expect(b("Deal B0ABC12345 für 19,99")).toBe("deal");
    expect(b("4006381333931 für 12,50")).toBe("deal");
    expect(b("Wie ist der Ladestand vom Tesla")).toBe("tesla");
    expect(b("Kaufen 17")).toBe("kaufen");
    expect(b("Blumen")).toBeNull();
    expect(b("")).toBeNull();
  });
  it("ändernde Befehle sind gekennzeichnet, Hilfe passt auf die Uhr", async () => {
    const { WATCH_AENDERND, WATCH_HILFE, watchAntwort } = await import("@/lib/mobil/watch-logic");
    expect([...WATCH_AENDERND].sort()).toEqual(["bestand", "erledigt", "kaufen", "notiz", "nummer"]);
    expect(watchAntwort([WATCH_HILFE]).zeige.length).toBeLessThanOrEqual(160);
  });
});
