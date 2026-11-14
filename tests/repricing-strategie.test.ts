// Soll-Strategie je SKU und Land (seit der BQool-Ablösung neutral, Repricer ProfitGuard) – reine Logik. Erfundene
// SKUs, Marken und Preise.
import { describe, expect, it } from "vitest";
import {
  ABVERKAUF_NACH_ALTER,
  abverkaufVorschlagen,
  ausnahmeTrifft,
  breakEvenMin,
  effektiverMin,
  istStrategie,
  KATALOG_STANDARD,
  katalogRegel,
  MARGE_NACH_ALTER,
  margeNachAlter,
  maxPreis,
  minEntscheidung,
  neutraleStrategie,
  regelFuer,
  STRATEGIEN,
  strategieKatalog,
  systemMinMax,
  titelHatMarke,
  UST,
  vergleiche,
  warnungen,
  type SollZeile,
} from "@/lib/repricing/strategie-logic";

const K = KATALOG_STANDARD;
const standard = katalogRegel(K, "Standard");
const abverkauf = katalogRegel(K, "Abverkauf");
const liquidation = katalogRegel(K, "Liquidation");
const schnell = katalogRegel(K, "Schnelldreher");

describe("Strategien und Katalog", () => {
  it("vier neutrale Strategien", () => {
    expect(STRATEGIEN).toEqual(["Standard", "Abverkauf", "Liquidation", "Schnelldreher"]);
    expect(istStrategie("Abverkauf")).toBe(true);
    expect(istStrategie("ia")).toBe(false);
    expect(K.map((k) => k.name)).toEqual(STRATEGIEN);
  });

  it("neutraleStrategie: alte BQool-Namen werden abgebildet", () => {
    expect(neutraleStrategie("ia")).toBe("Standard");
    expect(neutraleStrategie("mbb")).toBe("Standard");
    expect(neutraleStrategie("Abverkauf DE")).toBe("Abverkauf");
    expect(neutraleStrategie("abverkauf")).toBe("Abverkauf");
    expect(neutraleStrategie("AI Win Sales Booster")).toBe("Liquidation");
    expect(neutraleStrategie("Liquidation IT")).toBe("Liquidation");
    expect(neutraleStrategie("  liquidation ")).toBe("Liquidation");
    expect(neutraleStrategie("Schnelldreher 7 %")).toBe("Schnelldreher");
    expect(neutraleStrategie("Standard")).toBe("Standard");
  });

  it("neutraleStrategie: eingestellter Schnelldreher-Name, leer → null", () => {
    expect(neutraleStrategie("PG Fast Mover", "PG Fast Mover")).toBe("Schnelldreher");
    expect(neutraleStrategie("pg fast mover", " PG Fast Mover ")).toBe("Schnelldreher");
    expect(neutraleStrategie("PG Fast Mover")).toBe("Standard");
    expect(neutraleStrategie("")).toBeNull();
    expect(neutraleStrategie("   ")).toBeNull();
    expect(neutraleStrategie(null)).toBeNull();
    expect(neutraleStrategie(undefined)).toBeNull();
  });

  it("Katalog: Staffeln Standard/Abverkauf, Liquidation mit fester Untergrenze, Schnelldreher mit Boden-Marge", () => {
    expect(standard!.staffel).toEqual(MARGE_NACH_ALTER);
    expect(abverkauf!.staffel).toEqual(ABVERKAUF_NACH_ALTER);
    expect(liquidation).toMatchObject({ staffel: null, festeUntergrenze: true });
    expect(schnell!.staffel!.every((s) => s.marge === 7)).toBe(true);
    expect(schnell!.staffel!.map((s) => s.bisTage)).toEqual(MARGE_NACH_ALTER.map((s) => s.bisTage));
    expect(katalogRegel(K, "abverkauf")?.name).toBe("Abverkauf");
    expect(katalogRegel(K, "ia")).toBeNull();
    expect(katalogRegel(K, null)).toBeNull();
  });

  it("Katalog aus den Einstellungen; leere Staffeln fallen auf den Standard zurück", () => {
    const eigen = [{ bisTage: 60, marge: 12 }, { bisTage: null, marge: 2 }];
    const k = strategieKatalog({ standard: eigen, abverkauf: [], schnellBoden: 9 });
    expect(katalogRegel(k, "Standard")!.staffel).toEqual(eigen);
    expect(katalogRegel(k, "Abverkauf")!.staffel).toEqual(ABVERKAUF_NACH_ALTER);
    expect(katalogRegel(k, "Schnelldreher")!.staffel!.every((s) => s.marge === 9)).toBe(true);
    expect(katalogRegel(k, "Schnelldreher")!.strategie).toBe("alle Stufen 9 % Mindestmarge");
  });

  it("Marge nach Lagerdauer: Standard 10/8/7/5/3/1/0 %, Abverkauf 5/4/3/1/0 %", () => {
    expect([null, 10, 45, 80, 120, 200, 300, 400].map((t) => margeNachAlter(t))).toEqual([10, 10, 8, 7, 5, 3, 1, 0]);
    expect([0, 31, 61, 91, 181].map((t) => margeNachAlter(t, ABVERKAUF_NACH_ALTER))).toEqual([5, 4, 3, 1, 0]);
  });
});

describe("Break-even und System-Min je Land", () => {
  const basis = { ek: 10, fba: 3.5, fix: 0, zusatz: 0, provision: 0.15, margeProzent: 10 };
  it("Break-even: P = (FBA + Fix + EK + Zusatz) / (1/(1+USt) − Provision − Marge), aufgerundet", () => {
    // DE: 13,5 / (1/1,19 − 0,15 − 0,10) = 13,5 / 0,590336… = 22,868 → 22,87
    expect(breakEvenMin({ ...basis, ust: UST.DE })).toBe(22.87);
    // IT: 13,5 / (1/1,22 − 0,25) = 23,697 → 23,70
    expect(breakEvenMin({ ...basis, ust: UST.IT })).toBe(23.7);
    // Fix- und Zusatzkosten gehen ein
    expect(breakEvenMin({ ...basis, fix: 0.5, zusatz: 1, ust: UST.DE })).toBe(25.41);
  });
  it("FR/IT/ES mit landeseigener USt – höher als mit 19 %", () => {
    const [de, fr, it_, es] = (["DE", "FR", "IT", "ES"] as const).map((l) => breakEvenMin({ ...basis, ust: UST[l] })!);
    expect(fr).toBeGreaterThan(de);
    expect(es).toBeGreaterThan(fr);
    expect(it_).toBeGreaterThan(es);
  });
  it("Nenner ≤ 0 → kein Preis", () => {
    expect(breakEvenMin({ ...basis, ust: 0.19, provision: 0.5, margeProzent: 40 })).toBeNull();
  });

  const sys = { ek: 10, fba: 3.5, satz: 0.15, ust: UST.DE, minGewinn: 1, maxFaktor: 2, zielVk: null };
  it("System-Min = (EK + FBA + Mindestgewinn) / (1/(1+USt) − Provision), aufgerundet; Max = Min × Faktor", () => {
    // 14,5 / 0,690336 = 21,004 → 21,01
    expect(systemMinMax(sys)).toEqual({ min: 21.01, max: 42.02 });
    // IT: 14,5 / (1/1,22 − 0,15) = 21,652 → 21,66
    expect(systemMinMax({ ...sys, ust: UST.IT })!.min).toBe(21.66);
  });
  it("Max = Ziel-VK, wenn größer; nie unter Min", () => {
    expect(systemMinMax({ ...sys, zielVk: 50 })).toEqual({ min: 21.01, max: 50 });
    expect(systemMinMax({ ...sys, zielVk: 30 })!.max).toBe(42.02);
    expect(systemMinMax({ ...sys, maxFaktor: 0.5 })).toEqual({ min: 21.01, max: 21.01 });
  });
  it("Provision zu hoch → null", () => {
    expect(systemMinMax({ ...sys, satz: 0.9 })).toBeNull();
  });
  it("Höchstpreis: Min × Faktor bzw. Ziel-VK, nie unter Min", () => {
    expect(maxPreis({ min: 20, faktor: 1.5, zielVk: null })).toBe(30);
    expect(maxPreis({ min: 20, faktor: 1.5, zielVk: 49.99 })).toBe(49.99);
    expect(maxPreis({ min: 50, faktor: 0.5, zielVk: null })).toBe(50);
  });
});

describe("Effektiver Min: Marge je Altersstufe (wie in ProfitGuard)", () => {
  const basis = { untergrenze: null, ek: 10, fba: 3.5, fix: 0, zusatz: 0, ust: UST.DE, provision: 0.15, alterTage: 45 };
  it("Standard: Break-even mit der Marge der Altersstufe", () => {
    // 45 Tage → 8 %: 13,5 / (0,840336 − 0,15 − 0,08) = 22,119 → 22,12
    expect(effektiverMin({ ...basis, regel: standard })).toEqual({ min: 22.12, marge: 8, art: "marge", stufe: { bisTage: 60, marge: 8 } });
    expect(effektiverMin({ ...basis, regel: standard, alterTage: 10 })).toMatchObject({ min: 22.87, marge: 10 });
    expect(effektiverMin({ ...basis, regel: standard, alterTage: null })).toMatchObject({ marge: 10 });
  });
  it("kein Boden aus dem Mindestgewinn: alte Ware mit 0 % liegt unter dem System-Min (nur Vergleichswert)", () => {
    // Abverkauf ab 181 Tagen 0 % → Break-even 19,56; System-Min mit 1 € Mindestgewinn wäre 21,01
    expect(effektiverMin({ ...basis, regel: abverkauf, alterTage: 200 })).toMatchObject({ min: 19.56, marge: 0, art: "marge" });
    expect(effektiverMin({ ...basis, regel: standard, alterTage: 400 })).toMatchObject({ min: 19.56, marge: 0 });
    const sys = systemMinMax({ ek: 10, fba: 3.5, satz: 0.15, ust: UST.DE, minGewinn: 1, maxFaktor: 2, zielVk: null })!;
    expect(effektiverMin({ ...basis, regel: abverkauf, alterTage: 200 }).min!).toBeLessThan(sys.min);
  });
  it("landeseigene USt geht ein", () => {
    expect(effektiverMin({ ...basis, regel: standard, ust: UST.IT, alterTage: 10 }).min).toBe(23.7);
  });
  it("Schnelldreher: alle Stufen 7 %, auch für alte Ware", () => {
    // 13,5 / (0,840336 − 0,15 − 0,07) = 21,762 → 21,77
    expect(effektiverMin({ ...basis, regel: schnell, alterTage: 400 })).toMatchObject({ min: 21.77, marge: 7 });
  });
  it("Liquidation: feste Untergrenze", () => {
    expect(effektiverMin({ ...basis, regel: liquidation, untergrenze: 6.99 })).toEqual({ min: 6.99, marge: null, art: "untergrenze", stufe: null });
    expect(effektiverMin({ ...basis, regel: liquidation }).min).toBeNull();
  });
  it("unbekannte Strategie: Break-even ohne Marge", () => {
    expect(effektiverMin({ ...basis, regel: null })).toMatchObject({ min: 19.56, marge: 0, art: "unbekannte_regel", stufe: null });
  });
});

describe("minEntscheidung mit effektivem Min und Buy Box", () => {
  const eff = effektiverMin({ regel: standard, untergrenze: null, ek: 10, fba: 3.5, fix: 0, zusatz: 0, ust: UST.DE, provision: 0.15, alterTage: 45 }).min!; // 22,12
  const be = breakEvenMin({ ek: 10, fba: 3.5, fix: 0, zusatz: 0, ust: UST.DE, provision: 0.15, margeProzent: 0 }); // 19,56
  const basis = { regelName: "Standard" as const, regel: standard, effMin: eff, breakEven: be };

  it("ohne Wunsch bzw. Wunsch über dem effektiven Min: Strategie bleibt", () => {
    expect(minEntscheidung({ ...basis, gewuenscht: null })).toMatchObject({ regel: "Standard", min: 22.12, art: "marge" });
    expect(minEntscheidung({ ...basis, gewuenscht: 24 })).toMatchObject({ regel: "Standard", min: 24, art: "marge" });
  });
  it("Liquidation nur, wenn die Buy Box unter dem effektiven Min liegt", () => {
    expect(minEntscheidung({ ...basis, gewuenscht: 21, buybox: 21.5 })).toMatchObject({ regel: "Liquidation", min: 21, art: "liquidation_neu", regelVorher: "Standard" });
    expect(minEntscheidung({ ...basis, gewuenscht: 21, buybox: 22.12 })).toMatchObject({ regel: "Standard", min: 22.12, art: "marge", keinWechsel: "buybox_ueber" });
    expect(minEntscheidung({ ...basis, gewuenscht: 21, buybox: null })).toMatchObject({ regel: "Standard", keinWechsel: "buybox_unbekannt" });
  });
  it("unter Break-even nur mit Verlust-Freigabe", () => {
    expect(minEntscheidung({ ...basis, gewuenscht: 17, buybox: 18 })).toMatchObject({ regel: "Liquidation", min: 19.56, angehoben: true, unterBreakEven: false, verlustFreigegeben: false });
    expect(minEntscheidung({ ...basis, gewuenscht: 17, buybox: 18, verlustBis: 2 })).toMatchObject({ regel: "Liquidation", min: 17.56, angehoben: true, unterBreakEven: true, verlustFreigegeben: true });
    expect(minEntscheidung({ ...basis, gewuenscht: 18, buybox: 18, verlustBis: 2 })).toMatchObject({ min: 18, angehoben: false, unterBreakEven: true, verlustFreigegeben: true });
  });
});

describe("Strategie je SKU und Land", () => {
  const basis = { titel: null, zuweisung: null, markenRegeln: [{ marke: "Testphil", land: "DE" as const, regel: "Abverkauf" }], aufAbverkaufsListe: false };
  it("ohne alles: Standard", () => expect(regelFuer({ ...basis, land: "DE" })).toEqual({ regel: "Standard", quelle: "standard", untergrenze: null }));
  it("Abverkaufs-Liste → Abverkauf in allen Ländern", () => {
    expect(regelFuer({ ...basis, land: "DE", aufAbverkaufsListe: true })).toMatchObject({ regel: "Abverkauf", quelle: "abverkauf" });
    expect(regelFuer({ ...basis, land: "IT", aufAbverkaufsListe: true }).regel).toBe("Abverkauf");
  });
  it("Markenregel nur im genannten Land und nur als ganzes Wort", () => {
    expect(regelFuer({ ...basis, land: "DE", titel: "TESTPHIL Rasierer 3000 (erfunden)" })).toMatchObject({ regel: "Abverkauf", quelle: "marke" });
    expect(regelFuer({ ...basis, land: "DE", titel: "Testphilosophie Buch" }).regel).toBe("Standard");
    expect(regelFuer({ ...basis, land: "FR", titel: "Testphil Rasierer" }).regel).toBe("Standard");
  });
  it("alte Namen in Markenregeln und Zuweisungen werden neutral", () => {
    expect(regelFuer({ ...basis, land: "DE", titel: "Testphil X", markenRegeln: [{ marke: "Testphil", land: null, regel: "Abverkauf DE" }] }).regel).toBe("Abverkauf");
    expect(regelFuer({ ...basis, land: "DE", zuweisung: { regel: "AI Win Sales Booster", untergrenze: 9.5, quelle: "hand" } })).toEqual({ regel: "Liquidation", quelle: "zuweisung", untergrenze: 9.5 });
    expect(regelFuer({ ...basis, land: "DE", zuweisung: { regel: "ia", untergrenze: null, quelle: "vorlage" } }).regel).toBe("Standard");
  });
  it("feste Zuweisung (Liquidation mit Untergrenze) geht vor Marke und Abverkaufs-Liste", () => {
    expect(regelFuer({ ...basis, land: "DE", titel: "Testphil Rasierer", aufAbverkaufsListe: true, zuweisung: { regel: "Liquidation", untergrenze: 12.5, quelle: "leiter" } })).toEqual({ regel: "Liquidation", quelle: "zuweisung", untergrenze: 12.5 });
  });
  it("Ausnahme je ASIN: genau diese ASIN, nur im genannten Land", () => {
    const r = { ...basis, titel: "Testphil Rasierer (erfunden)", markenRegeln: [{ marke: "B0TESTPH01", land: "DE" as const, regel: "Abverkauf" }] };
    expect(regelFuer({ ...r, land: "DE", asin: "B0TESTPH01" }).regel).toBe("Abverkauf");
    expect(regelFuer({ ...r, land: "DE", asin: "b0testph01" }).regel).toBe("Abverkauf");
    expect(regelFuer({ ...r, land: "FR", asin: "B0TESTPH01" }).regel).toBe("Standard");
    expect(regelFuer({ ...r, land: "DE", asin: "B0TESTPH02" }).regel).toBe("Standard");
  });
  it("Marke im Titel: Sonderzeichen werden nicht als Muster gelesen", () => {
    expect(titelHatMarke("Test+Plus Kabel", "Test+Plus")).toBe(true);
    expect(titelHatMarke("Testplus Kabel", "Test+Plus")).toBe(false);
    expect(titelHatMarke(null, "Test")).toBe(false);
    expect(ausnahmeTrifft({ marke: "Testmarke", land: null, regel: "Abverkauf" }, null, "Ein Testmarke-Produkt")).toBe(true);
  });
  it("Kapital-Vorschlag „Abverkauf“ nur bei Rot und Reichweite über der Grenze", () => {
    expect(abverkaufVorschlagen({ ampel: "rot", reichweite: 200 }, 120)).toBe(true);
    expect(abverkaufVorschlagen({ ampel: "rot", reichweite: 100 }, 120)).toBe(false);
    expect(abverkaufVorschlagen({ ampel: "rot", reichweite: null }, 120)).toBe(false);
    expect(abverkaufVorschlagen({ ampel: "gelb", reichweite: 300 }, 120)).toBe(false);
    expect(abverkaufVorschlagen(null, 120)).toBe(false);
  });
});

describe("Freigabe: Vergleich mit dem Ist und Warnungen", () => {
  const z = (sku: string, regel: SollZeile["regel"], min: number, max: number): SollZeile => ({ land: "DE", sku, regel, min, max, aktiv: true });
  it("neu / geändert / gleich mit Strategiewechsel und Min-Differenz (cent-genau, Groß-/Kleinschreibung egal)", () => {
    const ist = new Map([
      ["A", { regel: "standard", min: 10.001, max: 20 }],
      ["B", { regel: "Standard", min: 9.5, max: 20 }],
      ["D", { regel: "Standard", min: null, max: 20 }],
    ]);
    const v = vergleiche([z("A", "Standard", 10, 20), z("B", "Abverkauf", 8, 20), z("C", "Standard", 5, 9), z("D", "Standard", 7, 20)], ist);
    expect(v.map((x) => x.art)).toEqual(["gleich", "geaendert", "neu", "geaendert"]);
    expect(v[1]).toMatchObject({ regelWechsel: true, minAlt: 9.5, minNeu: 8, minDiff: -1.5 });
    expect(v[2]).toMatchObject({ minAlt: null, minDiff: null });
    expect(v[3]).toMatchObject({ regelWechsel: false, minDiff: null });
  });
  it("Warnungen: Min über Buy Box × 1,2; Min unter Break-even; Max unter Min", () => {
    expect(warnungen({ min: 25, max: 30 }, { buybox: 20, breakEven: null })).toEqual(["Min 25.00 über Buy Box 20.00 × 1,2 – verliert die Buy Box"]);
    expect(warnungen({ min: 23.9, max: 30 }, { buybox: 20, breakEven: null })).toEqual([]);
    expect(warnungen({ min: 23, max: 30 }, { buybox: 20, breakEven: null, bbFaktor: 1.1 })[0]).toMatch(/× 1,1/);
    expect(warnungen({ min: 9, max: 30 }, { buybox: null, breakEven: 11.2 })).toEqual(["Min 9.00 unter Break-even 11.20"]);
    expect(warnungen({ min: 12, max: 10 }, { buybox: null, breakEven: null })).toEqual(["Max unter Min"]);
  });
});
