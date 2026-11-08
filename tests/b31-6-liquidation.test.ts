// B31.6 Min unter Mindestmarge nur mit Regel „Liquidation“ – reine Logik. Erfundene Werte.
import { describe, expect, it } from "vitest";
import {
  breakEvenMin,
  KATALOG_STANDARD,
  katalogRegel,
  liquidationStehtNoch,
  liquidationsName,
  liquidationsZeile,
  margeBeiPreis,
  minEntscheidung,
  RUECKKEHR_AUFSCHLAG,
  RUECKKEHR_TAGE,
  rueckkehrStand,
} from "@/lib/bqool/export-logic";
import { freigabeText } from "@/lib/bqool/kreislauf-logic";
import { morgenText } from "@/lib/push/logic";

const K = KATALOG_STANDARD;
const ia = katalogRegel(K, "ia");
const liq = katalogRegel(K, "Liquidation");
const mbb = katalogRegel(K, "mbb");

describe("Min-Entscheidung für die Datei", () => {
  it("Regel 1: gewünschter Min ≥ effektiver Min → Regel bleibt, Min als Sicherheitsnetz", () => {
    const e = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 52, effMin: 50, breakEven: 45, liquidation: "Liquidation" });
    expect(e).toMatchObject({ regel: "ia", min: 52, art: "marge", regelVorher: null, unterBreakEven: false });
  });
  it("ohne Wunsch: effektiver Min der Margen-Regel", () => {
    expect(minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: null, effMin: 50, breakEven: 45, liquidation: "Liquidation" }).min).toBe(50);
  });
  it("Regel 2: gewünschter Min < effektiver Min → Rule Name „Liquidation“ und fester Min", () => {
    const e = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 47, effMin: 50, breakEven: 45, liquidation: "Liquidation", buybox: 48 });
    expect(e).toMatchObject({ regel: "Liquidation", min: 47, art: "liquidation_neu", regelVorher: "ia", angehoben: false, unterBreakEven: false });
  });
  it("nie Min unter effektivem Min ohne Regelwechsel – egal welche Werte", () => {
    for (const g of [10, 30, 44.99, 49.99]) {
      const e = minEntscheidung({ regelName: "Abverkauf DE", regel: katalogRegel(K, "Abverkauf DE"), gewuenscht: g, effMin: 50, breakEven: 45, liquidation: "Liquidation", buybox: g < 45 ? 44 : 49 });
      if (e.min !== null && e.min < 50) expect(e.regel).toBe("Liquidation");
    }
  });
  it("Untergrenze Break-even: Wunsch darunter ohne Freigabe → auf Break-even angehoben", () => {
    const e = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 40, effMin: 50, breakEven: 45, liquidation: "Liquidation", buybox: 46 });
    expect(e).toMatchObject({ regel: "Liquidation", min: 45, angehoben: true, unterBreakEven: false, verlustFreigegeben: false });
  });
  it("„Mindest-Verlust akzeptiert bis 3 €“ → Min bis Break-even − 3 €, als freigegeben markiert", () => {
    const e = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 40, effMin: 50, breakEven: 45, verlustBis: 3, liquidation: "Liquidation", buybox: 44 });
    expect(e).toMatchObject({ regel: "Liquidation", min: 42, angehoben: true, unterBreakEven: true, verlustFreigegeben: true });
    const innen = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 43, effMin: 50, breakEven: 45, verlustBis: 3, liquidation: "Liquidation", buybox: 44 });
    expect(innen).toMatchObject({ min: 43, angehoben: false, unterBreakEven: true, verlustFreigegeben: true });
  });
  it("Hinweis B31.6: Buy Box über dem effektiven Min (oder unbekannt) → kein Regelwechsel, Min-Korrektur reicht", () => {
    const ueber = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 47, effMin: 50, breakEven: 45, liquidation: "Liquidation", buybox: 55 });
    expect(ueber).toMatchObject({ regel: "ia", art: "marge", keinWechsel: "buybox_ueber" });
    expect(ueber.min).toBeGreaterThanOrEqual(45);
    expect(minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 47, effMin: 50, breakEven: 45, liquidation: "Liquidation" })).toMatchObject({ regel: "ia", keinWechsel: "buybox_unbekannt" });
  });
  it("B31.8: Schnelldreher bekommt nie Liquidation, sondern Boden Break-even + 7 %", () => {
    const e = minEntscheidung({ regelName: "ia", regel: ia, gewuenscht: 40, effMin: 50, breakEven: 45, liquidation: "Liquidation", buybox: 44, schnelldreher: true, boden: 48.15 });
    expect(e).toMatchObject({ regel: "ia", keinWechsel: "schnelldreher" });
    expect(e.min).toBeGreaterThanOrEqual(48.15);
  });
  it("Regel ist schon Liquidation: Min = Untergrenze, unter Break-even ohne Freigabe nur warnen", () => {
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: 48, effMin: null, breakEven: 45, liquidation: "Liquidation" })).toMatchObject({ regel: "Liquidation", min: 48, art: "liquidation", unterBreakEven: false });
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: null, effMin: null, breakEven: 45, liquidation: "Liquidation" }).min).toBe(45);
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: 30, effMin: null, breakEven: 45, liquidation: "Liquidation" })).toMatchObject({ min: 30, unterBreakEven: true, verlustFreigegeben: false });
  });
  it("Regel ohne Staffel (mbb): kein Regelwechsel", () => {
    expect(minEntscheidung({ regelName: "mbb", regel: mbb, gewuenscht: 20, effMin: null, breakEven: 45, liquidation: "Liquidation" })).toMatchObject({ regel: "mbb", art: "sonst", min: 20, unterBreakEven: true });
  });
  it("Liquidations-Name aus dem Katalog (Alias AI Win Sales Booster)", () => {
    expect(liquidationsName(K)).toBe("Liquidation");
    expect(liquidationsName(K.filter((k) => k.name !== "Liquidation"))).toBe("AI Win Sales Booster");
    expect(liquidationsName([])).toBe("Liquidation");
  });
});

describe("Marge beim neuen Min", () => {
  const p = { ek: 20, fba: 4, fix: 0, zusatz: 0, ust: 0.19, provision: 0.15 };
  it("Umkehrung von Break-even: Preis zur Marge x ergibt wieder x %", () => {
    const preis = breakEvenMin({ ...p, margeProzent: 10 })!;
    expect(margeBeiPreis({ ...p, preis })).toBeCloseTo(10, 0);
    const be = breakEvenMin({ ...p, margeProzent: 0 })!;
    expect(margeBeiPreis({ ...p, preis: be })).toBeCloseTo(0, 0);
  });
  it("unter Break-even negativ, ohne Preis null", () => {
    expect(margeBeiPreis({ ...p, preis: 25 })!).toBeLessThan(0);
    expect(margeBeiPreis({ ...p, preis: 0 })).toBeNull();
  });
});

describe("Rückkehr auf die ursprüngliche Regel", () => {
  it("Schwelle = effektiver Min + 3 %", () => {
    expect(RUECKKEHR_AUFSCHLAG).toBe(0.03);
    expect(RUECKKEHR_TAGE).toBe(14);
    expect(rueckkehrStand({ buybox: 60, effMinVorher: 50, ueberSeit: null, heute: "2026-11-08" }).schwelle).toBe(51.5);
  });
  it("Buy Box darüber startet den Zähler, nach 14 Tagen am Stück → Vorschlag", () => {
    const start = rueckkehrStand({ buybox: 52, effMinVorher: 50, ueberSeit: null, heute: "2026-11-08" });
    expect(start).toMatchObject({ ueberSeit: "2026-11-08", tage: 0, vorschlagen: false });
    expect(rueckkehrStand({ buybox: 52, effMinVorher: 50, ueberSeit: "2026-10-26", heute: "2026-11-08" })).toMatchObject({ tage: 13, vorschlagen: false });
    expect(rueckkehrStand({ buybox: 52, effMinVorher: 50, ueberSeit: "2026-10-25", heute: "2026-11-08" })).toMatchObject({ tage: 14, vorschlagen: true });
  });
  it("Buy Box auf/unter der Schwelle setzt zurück; ohne Buy Box bleibt der Zähler stehen", () => {
    expect(rueckkehrStand({ buybox: 51.5, effMinVorher: 50, ueberSeit: "2026-10-01", heute: "2026-11-08" })).toMatchObject({ ueberSeit: null, vorschlagen: false });
    expect(rueckkehrStand({ buybox: null, effMinVorher: 50, ueberSeit: "2026-11-01", heute: "2026-11-08" })).toMatchObject({ ueberSeit: "2026-11-01", tage: 7, vorschlagen: false });
    expect(rueckkehrStand({ buybox: 80, effMinVorher: null, ueberSeit: null, heute: "2026-11-08" })).toMatchObject({ vorschlagen: false, schwelle: null });
  });
});

describe("Test mit einer SKU", () => {
  const aktiv = new Date("2026-11-07T06:00:00Z");
  it("Liquidation + Min stehen beim nächsten BQool-Lauf (≥ 12 Std.) noch → bestanden", () => {
    expect(liquidationStehtNoch({ aktivSeit: aktiv, istAm: new Date("2026-11-07T18:00:00Z"), istRegelFest: true, istMin: 47, minGesetzt: 47 })).toBe(true);
  });
  it("zu früh, Min zurückgesetzt oder Regel weg → nicht bestanden", () => {
    expect(liquidationStehtNoch({ aktivSeit: aktiv, istAm: new Date("2026-11-07T10:00:00Z"), istRegelFest: true, istMin: 47, minGesetzt: 47 })).toBe(false);
    expect(liquidationStehtNoch({ aktivSeit: aktiv, istAm: new Date("2026-11-08T06:00:00Z"), istRegelFest: true, istMin: 50, minGesetzt: 47 })).toBe(false);
    expect(liquidationStehtNoch({ aktivSeit: aktiv, istAm: new Date("2026-11-08T06:00:00Z"), istRegelFest: false, istMin: 47, minGesetzt: 47 })).toBe(false);
    expect(liquidationStehtNoch({ aktivSeit: null, istAm: new Date("2026-11-08T06:00:00Z"), istRegelFest: true, istMin: 47, minGesetzt: 47 })).toBe(false);
  });
});

describe("Texte: Freigabe, Kapital-Ampel, Morgenbericht", () => {
  it("Freigabe-Text nennt die Liquidations-Wechsel", () => {
    expect(freigabeText({ jeLand: { DE: 3 }, gesamt: 3, regelWechsel: 2, warnungen: 1, unterBreakEven: 0, liquidation: 2 })).toBe("DE 3 Änderungen, 2 Regelwechsel, 1 Warnung (davon 2 auf Liquidation wegen Min unter Marge)");
  });
  it("Zeile „n SKUs auf Liquidation (Min unter Marge), davon m unter Break-even“", () => {
    expect(liquidationsZeile({ anzahl: 0, unterBreakEven: 0 })).toBeNull();
    expect(liquidationsZeile({ anzahl: 1, unterBreakEven: 0 })).toBe("1 SKU auf Liquidation (Min unter Marge), davon 0 unter Break-even");
    expect(liquidationsZeile({ anzahl: 3, unterBreakEven: 1 })).toBe("3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even");
  });
  it("Morgenbericht übernimmt die Zeile", () => {
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0, liquidation: "3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even" })).toBe("3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even.");
  });
});
