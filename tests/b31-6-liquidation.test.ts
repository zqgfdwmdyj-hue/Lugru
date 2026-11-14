// B31.6 Min unter Mindestmarge nur mit Strategie „Liquidation“ – reine Logik mit neutralen Strategien. Erfundene Werte.
import { describe, expect, it } from "vitest";
import {
  KATALOG_STANDARD,
  katalogRegel,
  liquidationsName,
  liquidationsZeile,
  minEntscheidung,
  RUECKKEHR_AUFSCHLAG,
  RUECKKEHR_TAGE,
  rueckkehrStand,
} from "@/lib/repricing/strategie-logic";
import { morgenText } from "@/lib/push/logic";

const K = KATALOG_STANDARD;
const std = katalogRegel(K, "Standard");
const abv = katalogRegel(K, "Abverkauf");
const liq = katalogRegel(K, "Liquidation");
const schnell = katalogRegel(K, "Schnelldreher");

describe("Min-Entscheidung für die Datei", () => {
  it("Regel 1: gewünschter Min ≥ effektiver Min → Strategie bleibt, Min als Sicherheitsnetz", () => {
    const e = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 52, effMin: 50, breakEven: 45 });
    expect(e).toMatchObject({ regel: "Standard", min: 52, art: "marge", regelVorher: null, unterBreakEven: false });
  });
  it("ohne Wunsch: effektiver Min der Margen-Regel", () => {
    expect(minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: null, effMin: 50, breakEven: 45 }).min).toBe(50);
  });
  it("Regel 2: gewünschter Min < effektiver Min und Buy Box darunter → Strategie „Liquidation“ und fester Min", () => {
    const e = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 47, effMin: 50, breakEven: 45, buybox: 48 });
    expect(e).toMatchObject({ regel: "Liquidation", min: 47, art: "liquidation_neu", regelVorher: "Standard", angehoben: false, unterBreakEven: false });
  });
  it("nie Min unter effektivem Min ohne Strategiewechsel – egal welche Werte", () => {
    for (const g of [10, 30, 44.99, 49.99]) {
      const e = minEntscheidung({ regelName: "Abverkauf", regel: abv, gewuenscht: g, effMin: 50, breakEven: 45, buybox: g < 45 ? 44 : 49 });
      if (e.min !== null && e.min < 50) expect(e.regel).toBe("Liquidation");
    }
  });
  it("Untergrenze Break-even: Wunsch darunter ohne Freigabe → auf Break-even angehoben", () => {
    const e = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 40, effMin: 50, breakEven: 45, buybox: 46 });
    expect(e).toMatchObject({ regel: "Liquidation", min: 45, angehoben: true, unterBreakEven: false, verlustFreigegeben: false });
  });
  it("„Mindest-Verlust akzeptiert bis 3 €“ → Min bis Break-even − 3 €, als freigegeben markiert", () => {
    const e = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 40, effMin: 50, breakEven: 45, verlustBis: 3, buybox: 44 });
    expect(e).toMatchObject({ regel: "Liquidation", min: 42, angehoben: true, unterBreakEven: true, verlustFreigegeben: true });
    const innen = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 43, effMin: 50, breakEven: 45, verlustBis: 3, buybox: 44 });
    expect(innen).toMatchObject({ min: 43, angehoben: false, unterBreakEven: true, verlustFreigegeben: true });
  });
  it("Hinweis B31.6: Buy Box über dem effektiven Min (oder unbekannt) → kein Strategiewechsel, Min-Korrektur reicht", () => {
    const ueber = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 47, effMin: 50, breakEven: 45, buybox: 55 });
    expect(ueber).toMatchObject({ regel: "Standard", art: "marge", keinWechsel: "buybox_ueber" });
    expect(ueber.min).toBeGreaterThanOrEqual(45);
    expect(minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 47, effMin: 50, breakEven: 45 })).toMatchObject({ regel: "Standard", keinWechsel: "buybox_unbekannt" });
  });
  it("B31.8: Schnelldreher bekommt nie Liquidation, sondern Boden Break-even + 7 %", () => {
    const e = minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 40, effMin: 50, breakEven: 45, buybox: 44, schnelldreher: true, boden: 48.15 });
    expect(e).toMatchObject({ regel: "Standard", keinWechsel: "schnelldreher" });
    expect(e.min).toBeGreaterThanOrEqual(48.15);
  });
  it("Strategie ist schon Liquidation: Min = Untergrenze, unter Break-even ohne Freigabe nur warnen", () => {
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: 48, effMin: null, breakEven: 45 })).toMatchObject({ regel: "Liquidation", min: 48, art: "liquidation", unterBreakEven: false });
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: null, effMin: null, breakEven: 45 }).min).toBe(45);
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: 30, effMin: null, breakEven: 45 })).toMatchObject({ min: 30, unterBreakEven: true, verlustFreigegeben: false });
  });
  it("unbekannte Strategie (ohne Katalogeintrag): kein Strategiewechsel, Min = Wunsch bzw. Break-even", () => {
    expect(minEntscheidung({ regelName: "Standard", regel: null, gewuenscht: 20, effMin: null, breakEven: 45 })).toMatchObject({ regel: "Standard", art: "sonst", min: 20, unterBreakEven: true, verlustFreigegeben: false });
    expect(minEntscheidung({ regelName: "Standard", regel: null, gewuenscht: null, effMin: null, breakEven: 45 }).min).toBe(45);
    expect(minEntscheidung({ regelName: "Standard", regel: null, gewuenscht: 43, effMin: null, breakEven: 45, verlustBis: 3 })).toMatchObject({ unterBreakEven: true, verlustFreigegeben: true });
  });
  it("Schnelldreher-Strategie (Staffel 7 %) wechselt nie auf Liquidation", () => {
    const e = minEntscheidung({ regelName: "Schnelldreher", regel: schnell, gewuenscht: 40, effMin: 50, breakEven: 45, buybox: 44, schnelldreher: true, boden: 48.15 });
    expect(e).toMatchObject({ regel: "Schnelldreher", art: "marge", keinWechsel: "schnelldreher", min: 50 });
  });
  it("Schnelldreher mit Liquidation ohne festen Min → Min = Boden (Break-even + 7 %)", () => {
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: null, effMin: null, breakEven: 20, boden: 21.5, schnelldreher: true })).toMatchObject({ art: "liquidation", min: 21.5 });
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: 23, effMin: null, breakEven: 20, boden: 21.5, schnelldreher: true }).min).toBe(23);
    // ohne Schnelldreher gilt der Break-even
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: null, effMin: null, breakEven: 20, boden: 21.5 }).min).toBe(20);
  });
  it("Liquidations-Name ist neutral", () => {
    expect(liquidationsName(K)).toBe("Liquidation");
    expect(liquidationsName()).toBe("Liquidation");
  });
});

describe("Rückkehr auf die ursprüngliche Strategie", () => {
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

describe("Texte: Kapital-Ampel, Morgenbericht", () => {
  it("Zeile „n SKUs auf Liquidation (Min unter Marge), davon m unter Break-even“", () => {
    expect(liquidationsZeile({ anzahl: 0, unterBreakEven: 0 })).toBeNull();
    expect(liquidationsZeile({ anzahl: 1, unterBreakEven: 0 })).toBe("1 SKU auf Liquidation (Min unter Marge), davon 0 unter Break-even");
    expect(liquidationsZeile({ anzahl: 3, unterBreakEven: 1 })).toBe("3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even");
  });
  it("Morgenbericht übernimmt die Zeile", () => {
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0, liquidation: "3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even" })).toBe("3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even.");
  });
});

describe("B31.6a laufende Liquidation", () => {
  it("bleibt bis „Liquidation bis“ stehen, auch wenn die Buy Box über den effektiven Min steigt", () => {
    expect(minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 47, effMin: 50, breakEven: 45, buybox: 60, laeuft: true })).toMatchObject({ regel: "Liquidation", min: 47, art: "liquidation_neu" });
    expect(minEntscheidung({ regelName: "Standard", regel: std, gewuenscht: 47, effMin: 50, breakEven: 45, buybox: null, laeuft: true }).regel).toBe("Liquidation");
  });
});
