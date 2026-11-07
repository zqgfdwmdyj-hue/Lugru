// B28.6–B28.8 – reine Logik: Umschlagszeit/ROI p. a., eigene Durchlaufzeiten, Lernschleife Verlustprodukte.
// Alle Werte erfunden.
import { describe, expect, it } from "vitest";
import { STANDARD_VORLAUF, umschlagKurz, umschlagSchaetzen, vorlaufTage } from "@/lib/deal-eingang/umschlag-logic";
import { abverkaufTage, cashToCash, durchlaufAuswerten, kapitalMonate, median, tageZwischen, vorlaufAus, zuBereinigen } from "@/lib/money/durchlauf-logic";
import { fehlkaufBeitraege, istLernTag, trefferquoteMonate, trefferZeile, verlustProdukte, vormonat } from "@/lib/deal-eingang/lernschleife-logic";
import { dealWert, kennzahlenWert } from "@/lib/deal-eingang/wert-logic";
import { pushText } from "@/lib/deal-eingang/logic";
import { MELDE_ARTEN, morgenText } from "@/lib/push/logic";

describe("B28.6 Umschlagszeit und ROI p. a.", () => {
  it("Spanne aus Verkäufen, Angeboten, Menge und Vorlauf; ROI p. a. = ROI × 365 / Umschlag", () => {
    // 60 Verkäufe/Monat, 3 Angebote → eigener Anteil 15/Monat (mitte), 20 (schnell), 12 (langsam)
    const u = umschlagSchaetzen({ verkaeufeMonat: 60, angebote: 3, amazonProzent: 0, menge: 30, roi: 30 })!;
    expect(u.eigeneProMonat).toEqual({ max: 20, mitte: 15, min: 12 });
    expect(u.verkaufsTage).toEqual({ min: 45, mitte: 60, max: 75 });
    const fest = vorlaufTage(STANDARD_VORLAUF) + STANDARD_VORLAUF.auszahlung;
    expect(u.tage).toEqual({ min: fest + 45, mitte: fest + 60, max: fest + 75 });
    expect(u.roiPa).toBe(Math.round((30 * 365) / (fest + 60)));
    expect(u.text).toMatch(/^ca\. \d+–\d+ Tage$/);
    expect(u.warnung).toBeNull();
    expect(umschlagKurz(u)).toContain(`ROI p. a. ${u.roiPa} %`);
  });
  it("Reichweiten-Warnung über 60 Tage mit Menge für 45 Tage; Amazon-Anteil bremst; ohne Verkäufe keine Schätzung", () => {
    const u = umschlagSchaetzen({ verkaeufeMonat: 40, angebote: 1, amazonProzent: 50, menge: 84, roi: 20 })!;
    expect(u.eigeneProMonat.mitte).toBe(10);
    expect(u.verkaufsTage.mitte).toBe(252);
    expect(u.warnung).toBe("Menge reicht ca. 252 Tage – kleinere Menge (15 Stk für 45 Tage) oder höherer Abschlag?");
    expect(u.menge45).toBe(15);
    expect(umschlagSchaetzen({ verkaeufeMonat: null, angebote: 3, menge: 10, roi: 20 })).toBeNull();
    const ohneMenge = umschlagSchaetzen({ verkaeufeMonat: 30, angebote: 2, menge: null, roi: 25 })!;
    expect(ohneMenge.mengeAngenommen).toBe(true);
    expect(ohneMenge.warnung).toBeNull();
  });
  it("Deal-Wert: ROI p. a. unter dem Mindestwert zieht ab, darüber gibt es Punkte", () => {
    const schwach = kennzahlenWert({ roi: 30, roiPa: 60 }, 20, 100);
    const stark = kennzahlenWert({ roi: 30, roiPa: 240 }, 20, 100);
    expect(schwach.beitraege.some((b) => b.text === "ROI p. a. nur 60 %" && b.punkte < 0)).toBe(true);
    expect(stark.beitraege.some((b) => b.text === "ROI p. a. 240 %" && b.punkte > 0)).toBe(true);
    expect(stark.wert).toBeGreaterThan(schwach.wert);
  });
});

describe("B28.7 Durchlaufzeiten", () => {
  const e = (id: string, gruppe: string, b: string, er: string, v: string | null, em: string | null, ab: number | null) => ({ id, gruppe, bestellt: b, erhalten: er, versandt: v, empfangen: em, abverkaufTage: ab });
  it("Median je Phase, je Lieferant, Cash-to-Cash und Vorlauf ab drei Einkäufen", () => {
    expect(tageZwischen("2026-10-01", "2026-10-08")).toBe(7);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const r = durchlaufAuswerten([
      e("1", "Testlieferant A", "2026-09-01", "2026-09-05", "2026-09-08", "2026-09-15", 40),
      e("2", "Testlieferant A", "2026-09-10", "2026-09-16", "2026-09-18", "2026-09-27", 60),
      e("3", "Testlieferant B", "2026-09-20", "2026-09-23", "2026-09-26", "2026-10-04", 50),
    ]);
    expect(r.gesamt.wareneingang).toEqual({ median: 4, n: 3 });
    expect(r.gesamt.prep).toEqual({ median: 3, n: 3 });
    expect(r.gesamt.amazonEingang).toEqual({ median: 8, n: 3 });
    expect(r.gesamt.abverkauf).toEqual({ median: 50, n: 3 });
    expect(r.cashToCash).toEqual({ tage: 4 + 3 + 8 + 50 + 14, vollstaendig: true });
    expect(r.jeGruppe.map((g) => [g.gruppe, g.n])).toEqual([["Testlieferant A", 2], ["Testlieferant B", 1]]);
    expect(vorlaufAus(r.gesamt)).toMatchObject({ wareneingang: 4, prep: 3, amazonEingang: 8, quelle: "eigene Daten", basis: 3 });
    expect(vorlaufAus(durchlaufAuswerten([e("1", "X", "2026-09-01", "2026-09-05", null, null, null)]).gesamt)).toMatchObject({ quelle: "Standard", wareneingang: STANDARD_VORLAUF.wareneingang });
    expect(cashToCash(durchlaufAuswerten([]).gesamt)).toEqual({ tage: null, vollstaendig: false });
  });
  it("Abverkauf aus Monatswerten, Kapital ÷ Monatsumsatz, offene Einkäufe zum Bereinigen", () => {
    expect(abverkaufTage([{ month: "2026-09", units: 5 }, { month: "2026-10", units: 6 }], "2026-09-15", 12)).toBe(46);
    expect(abverkaufTage([{ month: "2026-09", units: 5 }], "2026-09-15", 12)).toBeNull();
    expect(kapitalMonate(350_000, 100_000)).toBe(3.5);
    expect(kapitalMonate(1000, 0)).toBeNull();
    const pos = [{ id: "a", status: "ordered", orderDate: "2026-09-01" }, { id: "b", status: "received", orderDate: "2026-08-01" }, { id: "c", status: "shipped", orderDate: "2026-10-30" }, { id: "d", status: "partial", orderDate: "2024-01-01" }];
    expect(zuBereinigen(pos, "2026-11-07").map((p) => p.id)).toEqual(["a", "d"]);
  });
});

describe("B28.8 Lernschleife Verlustprodukte", () => {
  it("Vormonat, Lerntag am 3., Verlust oder Marge < 3 % nur bei Einkäufen der letzten 6 Monate", () => {
    expect(vormonat("2026-12-03")).toBe("2026-11");
    expect(vormonat("2027-01-03")).toBe("2026-12");
    expect(istLernTag("2026-12-03")).toBe(true);
    expect(istLernTag("2026-12-04")).toBe(false);
    const rows = [
      { sku: "TEST-L-1a", asin: "B0TESTL001", name: "Testartikel Pfanne", units: 3, sales: 90, netProfit: -20 },
      { sku: "TEST-L-1b", asin: "B0TESTL001", name: "Testartikel Pfanne", units: 1, sales: 30, netProfit: -5 },
      { sku: "TEST-L-2", asin: "B0TESTL002", name: "Testartikel Tasse", units: 10, sales: 200, netProfit: 4 },
      { sku: "TEST-L-3", asin: "B0TESTL003", name: "Testartikel Socken", units: 10, sales: 200, netProfit: 40 },
      { sku: "TEST-L-4", asin: "B0TESTL004", name: "Testartikel alt", units: 2, sales: 50, netProfit: -30 },
    ];
    const v = verlustProdukte(rows, { asins: new Set(["B0TESTL001", "B0TESTL002", "B0TESTL003"]), skus: new Set() });
    expect(v.map((p) => [p.asin, p.gewinn, p.marge])).toEqual([["B0TESTL001", -25, -20.8], ["B0TESTL002", 4, 2]]);
    expect(v[0].skus).toEqual(["TEST-L-1a", "TEST-L-1b"]);
  });
  it("Ähnlicher Fehlkauf: Abschlag bei „Nie wieder“, Hinweis bei „Pech“; höchstens −15", () => {
    const f = (antwort: "nie_wieder" | "pech" | "unklar", marke: string | null, kategorie: string | null = null) => ({ datum: "2026-12-03", titel: "Testartikel Pfanne", asin: "B0TESTL001", marke, kategorie, quelle: "Testquelle", angebote: 5, antwort });
    expect(fehlkaufBeitraege({ marke: "Testmarke" }, [f("nie_wieder", "Testmarke")])).toEqual([{ punkte: -10, text: "ähnlicher Fehlkauf am 03.12.2026: Testartikel Pfanne – „Nie wieder kaufen“ (gleiche Marke Testmarke)" }]);
    expect(fehlkaufBeitraege({ marke: "Testmarke" }, [f("pech", "Testmarke")])[0].punkte).toBe(-1);
    expect(fehlkaufBeitraege({ marke: "Andere", kategorie: "Küche", quelle: "Testquelle" }, [f("nie_wieder", "Testmarke", "Küche")])[0].punkte).toBe(-6);
    expect(fehlkaufBeitraege({ quelle: "Testquelle", angebote: 6 }, [f("nie_wieder", null)])[0].punkte).toBe(-3);
    expect(fehlkaufBeitraege({ marke: "Fremd" }, [f("nie_wieder", "Testmarke")])).toEqual([]);
    const summe = fehlkaufBeitraege({ marke: "Testmarke" }, [f("nie_wieder", "Testmarke"), f("nie_wieder", "Testmarke"), f("nie_wieder", "Testmarke")]).reduce((n, b) => n + b.punkte, 0);
    expect(summe).toBe(-15);
  });
  it("Trefferquote je Monat und Morgenbericht-Zeile", () => {
    const t = trefferquoteMonate([{ monat: "2026-10", marge: 12 }, { monat: "2026-10", marge: 4 }, { monat: "2026-10", marge: 15 }, { monat: "2026-10", marge: 11 }, { monat: "2026-09", marge: 2 }, { monat: "2026-09", marge: null }], 10);
    expect(t).toEqual([{ monat: "2026-10", einkaeufe: 4, ueberZiel: 3, quote: 75 }, { monat: "2026-09", einkaeufe: 1, ueberZiel: 0, quote: 0 }]);
    expect(trefferZeile(t[0])).toBe("Trefferquote Oktober 2026: 75 % (Ziel 80 %)");
    expect(trefferZeile(null)).toBeNull();
  });
  it("Morgenbericht mit Trefferquote, Push-Art Lernschleife, Fehlkauf im Deal-Wert", () => {
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0, treffer: "Trefferquote Oktober 2026: 75 % (Ziel 80 %)" })).toBe("Trefferquote Oktober 2026: 75 % (Ziel 80 %).");
    expect(MELDE_ARTEN.some((a) => a.key === "lernschleife" && a.standard)).toBe(true);
    const fk = [{ datum: "2026-10-01", titel: "Testartikel Pfanne", asin: "B0TESTL001", marke: "Testmarke", kategorie: null, quelle: null, angebote: null, antwort: "nie_wieder" as const }];
    const ohne = dealWert({ roi: 30, marke: "Testmarke" }, { zielRoi: 20, ampel: "gruen", historie: [] });
    const mit = dealWert({ roi: 30, marke: "Testmarke" }, { zielRoi: 20, ampel: "gruen", historie: [], fehlkaeufe: fk });
    expect(mit.wert).toBeLessThan(ohne.wert);
    expect(mit.dagegen.some((t) => t.startsWith("ähnlicher Fehlkauf am 01.10.2026"))).toBe(true);
  });
});

describe("B28.6 Push-Text mit Umschlag", () => {
  it("Deal-Meldung nennt Umschlag und ROI p. a.", () => {
    const u = umschlagSchaetzen({ verkaeufeMonat: 60, angebote: 3, menge: 30, roi: 30 })!;
    const t = pushText([{ ampel: "gruen", gruende: [], titel: "Testartikel", asin: "B0TEST0001", bestesLand: "DE", ekNetto: 10, roi: 30, gewinn: 3, angebote: 3, amazonProzent: 0, empfohlen: 30, kapitalbedarf: 300, maxEk: [], name: null, umschlag: u } as unknown as Parameters<typeof pushText>[0][number]]);
    expect(t).toContain(`Umschlag ${u.text.replace(" Tage", " T")} · ROI p. a. ${u.roiPa} %`);
  });
});
