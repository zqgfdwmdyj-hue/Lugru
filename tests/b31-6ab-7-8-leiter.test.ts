// B31.6a/b Regel-Leiter + Dauer der Liquidation, B31.7 Zustand, B31.8 Schnelldreher – reine Logik. Erfundene Werte.
import { describe, expect, it } from "vitest";
import { KATALOG_STANDARD } from "@/lib/bqool/export-logic";
import {
  ablaufStand,
  ebayVergleich,
  fruehereRueckkehr,
  istGebraucht,
  LEITER_STANDARD,
  leiterMitStandard,
  leiterMorgenZeilen,
  leiterPruefen,
  liquidationBis,
  liquidationsMin,
  rueckkehrZiel,
  schnelldreherEnde,
  schnelldreherKandidat,
  stufenZeile,
  stufeVonRegel,
  ueberSeitFortschreiben,
  zielpreisGebraucht,
  zustandAusBefund,
  zustandAusText,
  zustandBestimmen,
  type LeiterEingabe,
} from "@/lib/bqool/leiter-logic";

const ABV = { DE: "Abverkauf DE", sonst: "Abverkauf" };
const E = LEITER_STANDARD;
const basis: LeiterEingabe = {
  land: "DE",
  stufe: 1,
  regel: "ia",
  effMin: 50,
  effMinStufe1: 50,
  effMinStufe2: 46,
  breakEven: 40,
  buybox: 52,
  ueberSeit: null,
  heute: "2026-11-08",
  reichweite: 40,
  alterTage: 45,
  kapital: 200,
  ladenhueter: false,
  bbQuote: 50,
  schnelldreher: false,
  gebraucht: false,
};
const pruefe = (x: Partial<LeiterEingabe>, e = E) => leiterPruefen({ ...basis, ...x }, e, ABV, "Liquidation", "ia");

describe("B31.6b Stufen der Regel-Leiter", () => {
  it("Regel → Stufe: Liquidation 3, Abverkauf 2, ia 1, unbekannt null", () => {
    expect(stufeVonRegel("Liquidation", KATALOG_STANDARD, ABV)).toBe(3);
    expect(stufeVonRegel("AI Win Sales Booster", KATALOG_STANDARD, ABV)).toBe(3);
    expect(stufeVonRegel("Abverkauf DE", KATALOG_STANDARD, ABV)).toBe(2);
    expect(stufeVonRegel("abverkauf", KATALOG_STANDARD, ABV)).toBe(2);
    expect(stufeVonRegel("ia", KATALOG_STANDARD, ABV)).toBe(1);
    expect(stufeVonRegel("gibt es nicht", KATALOG_STANDARD, ABV)).toBeNull();
    expect(stufeVonRegel(null, KATALOG_STANDARD, ABV)).toBeNull();
  });
  it("1 → 2 bei Reichweite > 90 Tage, Lagerdauer > 60 mit Kapital > 300 €, Hebel Ladenhüter oder Min 7 Tage über Buy Box bei Quote < 10 %", () => {
    expect(pruefe({})).toBeNull();
    expect(pruefe({ reichweite: 120 })).toMatchObject({ von: 1, nach: 2, regel: "Abverkauf DE", min: null });
    expect(pruefe({ alterTage: 75, kapital: 350 })?.nach).toBe(2);
    expect(pruefe({ alterTage: 75, kapital: 250 })).toBeNull();
    expect(pruefe({ ladenhueter: true })?.gruende.join(" ")).toContain("Ladenhüter");
    expect(pruefe({ ueberSeit: "2026-11-01", bbQuote: 5 })?.nach).toBe(2);
    expect(pruefe({ ueberSeit: "2026-11-03", bbQuote: 5 })).toBeNull();
    expect(pruefe({ ueberSeit: "2026-11-01", bbQuote: 20 })).toBeNull();
  });
  it("Abverkauf je Land (FR → „Abverkauf“)", () => {
    expect(pruefe({ land: "FR", reichweite: 120 })?.regel).toBe("Abverkauf");
  });
  it("Reihenfolge wählbar: Liquidation als Brücke nur, wenn die Buy Box unter dem effektiven Min liegt", () => {
    const e = leiterMitStandard({ reihenfolge: "liquidation_zuerst" });
    expect(pruefe({ reichweite: 120, buybox: 48 }, e)).toMatchObject({ von: 1, nach: 3, regel: "Liquidation", min: 47.52 });
    expect(pruefe({ reichweite: 120, buybox: 55 }, e)).toMatchObject({ nach: 2 });
  });
  it("2 → 3 nur, wenn Stufe 2 seit 7 Tagen über der Buy Box liegt und Kapital > 300 € oder Lagerdauer > 90", () => {
    const s2 = { stufe: 2 as const, regel: "Abverkauf DE", effMin: 46, buybox: 44, ueberSeit: "2026-11-01", alterTage: 100, kapital: 100 };
    const v = pruefe(s2);
    expect(v).toMatchObject({ von: 2, nach: 3, regel: "Liquidation" });
    expect(v!.min).toBe(43.56); // Buy Box − 1 %
    expect(v!.min!).toBeLessThanOrEqual(46);
    expect(pruefe({ ...s2, ueberSeit: "2026-11-04" })).toBeNull();
    expect(pruefe({ ...s2, alterTage: 80, kapital: 100 })).toBeNull();
    expect(pruefe({ ...s2, alterTage: 80, kapital: 400 })?.nach).toBe(3);
    expect(pruefe({ ...s2, buybox: 47 })).toBeNull();
  });
  it("Liquidation-Min = max(Break-even, Buy Box − 1 %), nie über dem effektiven Min der Stufe 2", () => {
    expect(liquidationsMin({ breakEven: 40, buybox: 44, deckel: 46, abschlag: 1 })).toBe(43.56);
    expect(liquidationsMin({ breakEven: 44, buybox: 44, deckel: 46, abschlag: 1 })).toBe(44);
    expect(liquidationsMin({ breakEven: 47, buybox: 44, deckel: 46, abschlag: 1 })).toBeNull();
    expect(liquidationsMin({ breakEven: 40, buybox: null, deckel: 46, abschlag: 1 })).toBeNull();
  });
  it("2 → 1 nur mit frischem Nachschub (Lageralter 0–30 Tage)", () => {
    expect(pruefe({ stufe: 2, alterTage: 12 })).toMatchObject({ von: 2, nach: 1, regel: "ia" });
    expect(pruefe({ stufe: 2, alterTage: 12, gebraucht: true })).toBeNull();
  });
  it("„über Buy Box seit“ fortschreiben", () => {
    expect(ueberSeitFortschreiben({ effMin: 50, buybox: 45, ueberSeit: null, heute: "2026-11-08" })).toBe("2026-11-08");
    expect(ueberSeitFortschreiben({ effMin: 50, buybox: 45, ueberSeit: "2026-11-01", heute: "2026-11-08" })).toBe("2026-11-01");
    expect(ueberSeitFortschreiben({ effMin: 50, buybox: 55, ueberSeit: "2026-11-01", heute: "2026-11-08" })).toBeNull();
    expect(ueberSeitFortschreiben({ effMin: 50, buybox: null, ueberSeit: "2026-11-01", heute: "2026-11-08" })).toBe("2026-11-01");
  });
  it("Rückkehr aus Liquidation: Stufe 2, Stufe 1 nur bei Lageralter ≤ 30", () => {
    expect(rueckkehrZiel({ land: "DE", alterTage: 80, gebraucht: false, abverkauf: ABV, standard: "ia" })).toMatchObject({ regel: "Abverkauf DE", stufe: 2 });
    expect(rueckkehrZiel({ land: "IT", alterTage: null, gebraucht: false, abverkauf: ABV, standard: "ia" })).toMatchObject({ regel: "Abverkauf", stufe: 2 });
    expect(rueckkehrZiel({ land: "DE", alterTage: 10, gebraucht: false, abverkauf: ABV, standard: "ia" })).toMatchObject({ regel: "ia", stufe: 1 });
    expect(rueckkehrZiel({ land: "DE", alterTage: 10, gebraucht: true, abverkauf: ABV, standard: "ia" }).stufe).toBe(2);
  });
  it("Morgenbericht: „Stufe 2: n SKUs, Stufe 3: m SKUs, davon k unter Break-even“", () => {
    expect(stufenZeile({ stufe2: 4, stufe3: 1, unterBe: 0 })).toBe("Stufe 2: 4 SKUs, Stufe 3: 1 SKU, davon 0 unter Break-even");
    expect(stufenZeile({ stufe2: 0, stufe3: 0, unterBe: 0 })).toBeNull();
    const z = leiterMorgenZeilen({ am: "2026-11-08", stufe2: 2, stufe3: 1, unterBe: 1, ueberfaellig: 1, verlaengert: 0, schnellUnterMin: 1, schnellUnterMinTage: 3, gebrauchtNeupreis: 2, zustandUnbekannt: 1, vorschlaege: 3 });
    expect(z.join("\n")).toContain("Liquidation überfällig: 1 SKU");
    expect(z.join("\n")).toContain("Schnelldreher unter Min: 1 SKU, Buy Box seit 3 Tagen darunter");
    expect(z.join("\n")).toContain("2 gebrauchte SKUs werden mit Neupreis-Min geführt");
    expect(leiterMorgenZeilen(null)).toEqual([]);
  });
});

describe("B31.6a Liquidation bis", () => {
  it("Standard 45 Tage ab Start, fester Termin hat Vorrang", () => {
    expect(liquidationBis("2026-11-08", E)).toBe("2026-12-23");
    expect(liquidationBis("2026-11-08", { liquidationTage: 45, liquidationBisFest: "2027-01-05" })).toBe("2027-01-05");
    expect(liquidationBis("2027-02-01", { liquidationTage: 45, liquidationBisFest: "2027-01-05" })).toBe("2027-03-18");
  });
  it("Ablauf: läuft / bald (7 Tage vorher) / abgelaufen / dauerhaft", () => {
    expect(ablaufStand({ bis: "2026-12-23", dauerhaft: false, heute: "2026-11-08", vorwarnTage: 7 })).toEqual({ stand: "laeuft", restTage: 45 });
    expect(ablaufStand({ bis: "2026-11-15", dauerhaft: false, heute: "2026-11-08", vorwarnTage: 7 })).toEqual({ stand: "bald", restTage: 7 });
    expect(ablaufStand({ bis: "2026-11-07", dauerhaft: false, heute: "2026-11-08", vorwarnTage: 7 })).toEqual({ stand: "abgelaufen", restTage: -1 });
    expect(ablaufStand({ bis: "2026-11-07", dauerhaft: true, heute: "2026-11-08", vorwarnTage: 7 }).stand).toBe("dauerhaft");
    expect(ablaufStand({ bis: null, dauerhaft: false, heute: "2026-11-08", vorwarnTage: 7 }).stand).toBe("ohne");
  });
  it("frühere Rückkehr: Bestand 0, Margen-Min nicht mehr über Buy Box, Buy Box 14 Tage darüber", () => {
    expect(fruehereRueckkehr({ bestand: 0, effMinZiel: 50, buybox: 45, rueckkehr14: false })).toContain("Bestand 0");
    expect(fruehereRueckkehr({ bestand: 3, effMinZiel: 44, buybox: 45, rueckkehr14: false })).toContain("nicht mehr über der Buy Box");
    expect(fruehereRueckkehr({ bestand: 3, effMinZiel: 50, buybox: 45, rueckkehr14: true })).toContain("14 Tagen");
    expect(fruehereRueckkehr({ bestand: 3, effMinZiel: 50, buybox: 45, rueckkehr14: false })).toBeNull();
  });
});

describe("B31.7 Zustand", () => {
  it("Zustand aus Texten (Amazon/ArbitrageOne, deutsch/englisch)", () => {
    expect(zustandAusText("Used - Like New")).toBe("wie_neu");
    expect(zustandAusText("UsedVeryGood")).toBe("sehr_gut");
    expect(zustandAusText("Used Good")).toBe("gut");
    expect(zustandAusText("gebraucht – akzeptabel")).toBe("akzeptabel");
    expect(zustandAusText("New")).toBe("neu");
    expect(zustandAusText("Neu – Sonstige")).toBe("neu_sonstige");
    expect(zustandAusText("Used")).toBe("gebraucht");
    expect(zustandAusText("")).toBeNull();
  });
  it("Befund der Retouren-Station → Zustand", () => {
    expect(zustandAusBefund("ok")).toBe("wie_neu");
    expect(zustandAusBefund("benutzt")).toBe("gut");
    expect(zustandAusBefund("beschaedigt")).toBe("akzeptabel");
    expect(zustandAusBefund("leer")).toBe("unbekannt");
  });
  it("Reihenfolge: Hand → RET_/LPN (Grad aus Berichten) → Berichte → Einkauf → unbekannt", () => {
    const leer = { hand: null, arbitrageone: null, amazon: null, station: null, einkaufNeu: false, retoureCharge: false };
    expect(zustandBestimmen({ ...leer, sku: "RET_3_LPNTEST000001_FBA", hand: "sehr_gut" })).toEqual({ zustand: "sehr_gut", quelle: "hand" });
    expect(zustandBestimmen({ ...leer, sku: "RET_3_LPNTEST000001_FBA", einkaufNeu: true })).toEqual({ zustand: "gebraucht", quelle: "sku_muster" });
    expect(zustandBestimmen({ ...leer, sku: "RET_3_LPNTEST000001_FBA", amazon: "neu", station: "gut" })).toEqual({ zustand: "gut", quelle: "retouren_station" });
    expect(zustandBestimmen({ ...leer, sku: "TEST-SKU-1", arbitrageone: "wie_neu" })).toEqual({ zustand: "wie_neu", quelle: "arbitrageone" });
    expect(zustandBestimmen({ ...leer, sku: "TEST-SKU-1", einkaufNeu: true })).toEqual({ zustand: "neu", quelle: "einkauf" });
    expect(zustandBestimmen({ ...leer, sku: "TEST-SKU-1" })).toEqual({ zustand: "unbekannt", quelle: "keine" });
    expect(istGebraucht("gut")).toBe(true);
    expect(istGebraucht("neu")).toBe(false);
    expect(istGebraucht("unbekannt")).toBe(false);
  });
  it("Zielpreis: Keepa-Gebrauchtpreis des Grades, sonst Neupreis × Faktor (ArbitrageOne-Abschläge)", () => {
    const f = E.zustand.faktoren;
    expect(zielpreisGebraucht({ zustand: "sehr_gut", keepa: { wie_neu: 90, sehr_gut: 80, gut: 70, akzeptabel: 60, buybox: 75 }, neuBuybox: 100, faktoren: f })).toEqual({ preis: 80, quelle: "Keepa Gebrauchtpreis" });
    expect(zielpreisGebraucht({ zustand: "gut", keepa: null, neuBuybox: 100, faktoren: f })).toEqual({ preis: 84, quelle: "Neupreis × 0,84" });
    expect(zielpreisGebraucht({ zustand: "akzeptabel", keepa: null, neuBuybox: 100, faktoren: f }).preis).toBe(80);
    expect(zielpreisGebraucht({ zustand: "wie_neu", keepa: null, neuBuybox: 100, faktoren: f }).preis).toBe(88);
    expect(zielpreisGebraucht({ zustand: "neu_sonstige", keepa: { wie_neu: 95, sehr_gut: null, gut: null, akzeptabel: null, buybox: null }, neuBuybox: 100, faktoren: f }).preis).toBe(90);
    expect(zielpreisGebraucht({ zustand: "unbekannt", keepa: null, neuBuybox: 100, faktoren: f }).preis).toBeNull();
    expect(zielpreisGebraucht({ zustand: "gut", keepa: null, neuBuybox: null, faktoren: f }).preis).toBeNull();
  });
  it("eBay-Vergleich unter Amazon-Break-even", () => {
    const v = ebayVergleich({ preis: 30, ust: 0.19, provision: 0.15, fba: 6, ebayGebuehr: 5, ebayVersand: 5.49 });
    expect(v.besser).toBe("ebay");
    expect(v.ebay).toBeGreaterThan(v.amazon);
  });
  it("Gebrauchte Ware läuft nie mit ia: Stufe 1 → Vorschlag Abverkauf", () => {
    expect(pruefe({ gebraucht: true })).toMatchObject({ von: 1, nach: 2 });
  });
  it("Gebraucht: Liquidation nach 14 Tagen Stillstand auch ohne Kapital/Lagerdauer", () => {
    const g = { stufe: 2 as const, gebraucht: true, effMin: 46, buybox: 44, alterTage: 20, kapital: 50 };
    expect(pruefe({ ...g, ueberSeit: "2026-10-25" })).toMatchObject({ nach: 3 });
    expect(pruefe({ ...g, ueberSeit: "2026-11-01" })).toBeNull();
  });
});

describe("B31.8 Schnelldreher", () => {
  const S = E.schnell;
  it("Kriterien: ≥ 15 Verkäufe/30 T oder Reichweite ≤ 45, Lageralter ≤ 60, Buy-Box-Quote > 30 %", () => {
    expect(schnelldreherKandidat({ verkaeufe30: 20, reichweite: 60, alterTage: 30, bbQuote: 40 }, S)).toBe(true);
    expect(schnelldreherKandidat({ verkaeufe30: 5, reichweite: 30, alterTage: 30, bbQuote: 40 }, S)).toBe(true);
    expect(schnelldreherKandidat({ verkaeufe30: 20, reichweite: 30, alterTage: 70, bbQuote: 40 }, S)).toBe(false);
    expect(schnelldreherKandidat({ verkaeufe30: 20, reichweite: 30, alterTage: 30, bbQuote: 20 }, S)).toBe(false);
    expect(schnelldreherKandidat({ verkaeufe30: 20, reichweite: 30, alterTage: 30, bbQuote: null }, S)).toBe(false);
  });
  it("gesperrt für 1 → 2 und 2 → 3", () => {
    expect(pruefe({ schnelldreher: true, reichweite: 200 })).toBeNull();
    expect(pruefe({ schnelldreher: true, stufe: 2, effMin: 46, buybox: 40, ueberSeit: "2026-10-01", kapital: 900, alterTage: 100 })).toBeNull();
  });
  it("Ende: 21 Tage ohne Buy Box, < 5 Verkäufe, alt und langsam", () => {
    expect(schnelldreherEnde({ ohneBuyboxSeit: "2026-10-18", heute: "2026-11-08", verkaeufe30: 20, alterTage: 10, reichweite: 20 }, S)).toContain("21 Tage ohne Buy Box");
    expect(schnelldreherEnde({ ohneBuyboxSeit: null, heute: "2026-11-08", verkaeufe30: 3, alterTage: 10, reichweite: 20 }, S)).toContain("nur 3 Verkäufe");
    expect(schnelldreherEnde({ ohneBuyboxSeit: null, heute: "2026-11-08", verkaeufe30: 8, alterTage: 70, reichweite: 120 }, S)).toContain("Lageralter 70");
    expect(schnelldreherEnde({ ohneBuyboxSeit: "2026-11-01", heute: "2026-11-08", verkaeufe30: 20, alterTage: 10, reichweite: 20 }, S)).toBeNull();
  });
  it("Einstellungen mischen Teilwerte mit Standard", () => {
    const e = leiterMitStandard({ schnell: { ...S, margeBoden: 9 } });
    expect(e.schnell.margeBoden).toBe(9);
    expect(e.schnell.verkaeufe30).toBe(15);
    expect(leiterMitStandard(null).liquidationTage).toBe(45);
  });
});
