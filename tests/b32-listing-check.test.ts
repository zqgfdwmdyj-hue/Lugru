// B32 Listing-Check – reine Logik. Erfundene Werte.
import { describe, expect, it } from "vitest";
import { befundePruefen, CHECK_STANDARD, checkMorgenZeile, median, pushNoetig, schwellenMitStandard, stufeA, stufeFuer, type CheckEingabe } from "@/lib/repricing/listing-check-logic";

const basis: CheckEingabe = {
  land: "DE",
  sku: "TEST-SKU-LC",
  asin: "B0TESTLC01",
  titel: "Testartikel",
  bestand: 20,
  status: "aktiv",
  minIst: 30,
  maxIst: 60,
  preis: 35,
  buybox: 35,
  bb30: 35,
  rang: 5000,
  monatlichVerkauft: 50,
  verkaeufe7: 3,
  verkaeufe30: 12,
  bbUeberMaxTage: 0,
  ohneBuyboxTage: 0,
  breakEven: 25,
  effMin: 28,
  zielMin: 28,
  liquidationFreigegeben: false,
  gebrauchtMitNeupreisMin: false,
  schnelldreher: false,
  schnelldreherKandidat: false,
  reichweite: 40,
  lagerdauer: 30,
  kapital: 200,
  verkaufspreisMedian: null,
  verkaufspreisAnzahl: 0,
};
const nrn = (x: Partial<CheckEingabe>) => befundePruefen({ ...basis, ...x }).map((b) => b.nr);

describe("B32.1 neun Befunde", () => {
  it("unauffälliges Listing → keine Befunde", () => {
    expect(nrn({})).toEqual([]);
  });
  it("1 Min über Buy Box (und über 30-Tage-Schnitt − 3 %) mit Vorschlag und Potenzial", () => {
    const b = befundePruefen({ ...basis, minIst: 40, buybox: 35, bb30: 36 });
    const eins = b.find((x) => x.nr === 1)!;
    expect(eins.vorschlag).toContain("28.00");
    expect(eins.aktion).toBe("min");
    expect(eins.potenzial).toBe(Math.round((20 - 12) * 10 * 100) / 100);
    expect(nrn({ minIst: 36, buybox: 35, bb30: 40 })).not.toContain(1);
  });
  it("2 pausiert trotz Bestand und Nachfrage", () => {
    expect(nrn({ status: "pausiert" })).toContain(2);
    expect(nrn({ status: "pausiert", bestand: 0 })).not.toContain(2);
  });
  it("3 Schnelldreher-Kandidat ohne Kennzeichen", () => {
    expect(nrn({ schnelldreherKandidat: true })).toContain(3);
    expect(nrn({ schnelldreherKandidat: true, schnelldreher: true })).not.toContain(3);
  });
  it("4 keine Verkäufe in 7 Tagen trotz Nachfrage ≥ 30, mit Ursache", () => {
    const b = befundePruefen({ ...basis, verkaeufe7: 0, minIst: 40 }).find((x) => x.nr === 4)!;
    expect(b.vorschlag).toContain("Min über Buy Box");
    expect(nrn({ verkaeufe7: 0, monatlichVerkauft: 10 })).not.toContain(4);
  });
  it("5 Max zu niedrig (Buy Box seit ≥ 3 Tagen über Max) → Max = Buy Box × 1,1", () => {
    const b = befundePruefen({ ...basis, maxIst: 32, buybox: 40, bbUeberMaxTage: 3 }).find((x) => x.nr === 5)!;
    expect(b.wert).toBe(44);
    expect(nrn({ maxIst: 32, buybox: 40, bbUeberMaxTage: 2 })).not.toContain(5);
  });
  it("6 unter Break-even ohne Liquidation-Freigabe", () => {
    expect(nrn({ minIst: 20 })).toContain(6);
    expect(nrn({ minIst: 20, liquidationFreigegeben: true })).not.toContain(6);
  });
  it("7 gebraucht mit Neupreis-Min", () => {
    expect(nrn({ gebrauchtMitNeupreisMin: true })).toContain(7);
  });
  it("8 Preis über Markt und seit 7 Tagen keine Buy Box", () => {
    expect(nrn({ preis: 40, buybox: 35, ohneBuyboxTage: 7 })).toContain(8);
    expect(nrn({ preis: 36, buybox: 35, ohneBuyboxTage: 7 })).not.toContain(8);
  });
  it("9 Ladenhüter (Reichweite > 90 oder Lagerdauer > 60 mit Kapital > 300 €)", () => {
    expect(nrn({ reichweite: 120 })).toContain(9);
    expect(nrn({ lagerdauer: 70, kapital: 400 })).toContain(9);
    expect(nrn({ lagerdauer: 70, kapital: 200 })).not.toContain(9);
  });
  it("10 (B32.4) eigener Verkaufspreis dauerhaft unter Min (≥ 3 Verkäufe)", () => {
    expect(nrn({ verkaufspreisMedian: 28, verkaufspreisAnzahl: 4 })).toContain(10);
    expect(nrn({ verkaufspreisMedian: 28, verkaufspreisAnzahl: 2 })).not.toContain(10);
  });
  it("gespeicherte Schwellen mischen sich mit dem Standard (ungültige Werte ignoriert)", () => {
    const sw = schwellenMitStandard({ reichweite: 120, kapital: -5, stufeA: Number.NaN });
    expect(sw.reichweite).toBe(120);
    expect(sw.kapital).toBe(CHECK_STANDARD.kapital);
    expect(sw.stufeA).toBe(CHECK_STANDARD.stufeA);
    expect(schwellenMitStandard(null)).toEqual(CHECK_STANDARD);
  });
  it("Schwellen sind einstellbar", () => {
    expect(befundePruefen({ ...basis, reichweite: 80 }, { ...CHECK_STANDARD, reichweite: 60 }).map((b) => b.nr)).toContain(9);
  });
});

describe("B32.2 Stufen und Budget", () => {
  it("Stufe A: Schnelldreher + offene Befunde + die wertvollsten n", () => {
    const zeilen = [
      { key: "a", kapital: 100, nachfrage: 10, schnelldreher: false, offen: false },
      { key: "b", kapital: 1000, nachfrage: 1, schnelldreher: false, offen: false },
      { key: "c", kapital: 5, nachfrage: 1, schnelldreher: true, offen: false },
      { key: "d", kapital: 5, nachfrage: 1, schnelldreher: false, offen: true },
      { key: "e", kapital: 1, nachfrage: 1, schnelldreher: false, offen: false },
    ];
    expect([...stufeA(zeilen, 2)].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("Stufe je SKU: A täglich, B wöchentlich, C ohne Bestand monatlich", () => {
    expect(stufeFuer({ inA: true, bestand: 3, zuletzt: "2026-11-07", heute: "2026-11-08" })).toBe("A");
    expect(stufeFuer({ inA: false, bestand: 3, zuletzt: "2026-11-01", heute: "2026-11-08" })).toBe("B");
    expect(stufeFuer({ inA: false, bestand: 3, zuletzt: "2026-11-05", heute: "2026-11-08" })).toBeNull();
    expect(stufeFuer({ inA: false, bestand: 0, zuletzt: null, heute: "2026-11-08" })).toBe("C");
    expect(stufeFuer({ inA: true, bestand: 0, zuletzt: "2026-11-01", heute: "2026-11-08" })).toBeNull();
  });
  it("Median für das Preisband", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("B32.5 Push und Morgenbericht", () => {
  const b1 = befundePruefen({ ...basis, minIst: 40 }).find((x) => x.nr === 1)!;
  it("Push nur bei Befund 1/2 an Schnelldrehern oder Kapital > 1.000 €", () => {
    expect(pushNoetig(b1, { schnelldreher: true, schnelldreherKandidat: false, kapital: 100 })).toBe(true);
    expect(pushNoetig(b1, { schnelldreher: false, schnelldreherKandidat: false, kapital: 1500 })).toBe(true);
    expect(pushNoetig(b1, { schnelldreher: false, schnelldreherKandidat: false, kapital: 500 })).toBe(false);
    const b9 = befundePruefen({ ...basis, reichweite: 200 }).find((x) => x.nr === 9)!;
    expect(pushNoetig(b9, { schnelldreher: true, schnelldreherKandidat: false, kapital: 5000 })).toBe(false);
  });
  it("Morgenbericht-Zeile „Listing-Check: n neue Befunde …“", () => {
    const st = { am: "2026-11-08T05:10:00Z", dauerMs: 1000, geprueft: 10, stufeA: 5, stufeB: 3, stufeC: 2, keepaAbrufe: 4, unvollstaendig: 1, neu: 2, offen: 3, istAlt: false, istStand: null, top: [{ land: "DE", sku: "TEST-SKU-LC", asin: "B0TESTLC01", titel: "Testartikel", potenzial: 80.4 }] };
    const z = checkMorgenZeile(st)!;
    expect(z).toContain("Listing-Check: 2 neue Befunde (3 offen)");
    expect(z).toContain("B0TESTLC01 Testartikel 80 €");
    expect(z).toContain("Check unvollständig");
    expect(checkMorgenZeile({ ...st, neu: 0, offen: 0, unvollstaendig: 0 })).toBeNull();
    expect(checkMorgenZeile(null)).toBeNull();
  });
  it("alter ProfitGuard-Stand wird genannt, auch ohne Befunde", () => {
    const leer = { am: "2026-11-08T05:10:00Z", dauerMs: 1000, geprueft: 10, stufeA: 5, stufeB: 3, stufeC: 2, keepaAbrufe: 0, unvollstaendig: 0, neu: 0, offen: 0, istAlt: true, istStand: "2026-11-01", top: [] };
    expect(checkMorgenZeile(leer)).toBe("Listing-Check: 0 neue Befunde · ProfitGuard-Stand alt");
  });
});

describe("B33.4 Frischbestand-Falle", () => {
  const fb: CheckEingabe = { ...basis, sku: "TEST-SKU-FB", asin: "B0TESTFB01", bestand: 10, minIst: 30, maxIst: 60, preis: 30, buybox: 26, bb30: 26, monatlichVerkauft: 30, verkaeufe7: 0, verkaeufe30: 0, ohneBuyboxTage: 7, breakEven: 22, effMin: 24, zielMin: 24, lagerdauer: 12, istRegel: "Standard", stufeText: "10 %" };
  it("Stufe 0–30, Min über Buy Box, 7 Tage kein Verkauf → Hinweis mit Strategiewechsel", () => {
    const b = befundePruefen(fb).find((x) => x.nr === 11)!;
    expect(b.titel).toBe("Frischbestand-Falle");
    expect(b.aktion).toBe("hinweis");
    expect(b.vorschlag).toBe("Min 30.00 in Stufe 0–30 (10 %) – über der Buy Box 26.00, 7 Tage kein Verkauf. Strategie wechseln (Schnelldreher mit Boden-Marge bzw. Liquidation) oder Min senken");
    expect(b.zahlen).toMatchObject({ min: 30, buybox: 26, regel: "Standard" });
    // Befund 1 schlägt den effektiven Min vor
    expect(befundePruefen(fb).find((x) => x.nr === 1)).toMatchObject({ vorschlag: "Min senken auf 24.00 (effektiver Min)", wert: 24 });
  });
  it("nicht bei Verkauf in 7 Tagen, älterer Ware, Min unter Buy Box oder unbekannten Verkäufen", () => {
    expect(befundePruefen({ ...fb, verkaeufe7: 1 }).some((x) => x.nr === 11)).toBe(false);
    expect(befundePruefen({ ...fb, lagerdauer: 45 }).some((x) => x.nr === 11)).toBe(false);
    expect(befundePruefen({ ...fb, minIst: 25 }).some((x) => x.nr === 11)).toBe(false);
    expect(befundePruefen({ ...fb, verkaeufe7: null }).some((x) => x.nr === 11)).toBe(false);
  });
  it("Schnelldreher: Vorschlag Break-even + 7 %", () => {
    expect(befundePruefen({ ...fb, schnelldreher: true }).find((x) => x.nr === 1)!.vorschlag).toContain("Break-even + 7 %, nie unter effektivem Min");
  });
});
