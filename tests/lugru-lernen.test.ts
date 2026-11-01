import { describe, expect, it } from "vitest";
import { wertSchwelleFuer } from "@/lib/deal-eingang/logic";
import { dealWert, lernBericht, lugruHarteGruende, LUGRU_START } from "@/lib/deal-eingang/wert-logic";
import { kaufZuDeal, skuKauf, type EigenerKauf } from "@/lib/lugru-deals/auswertung-logic";

// B22.2 – erfundene SKUs und ASINs.
const jetzt = new Date("2026-11-01T10:00:00Z");

describe("B22.2 – Kauf aus der SKU", () => {
  it("neues Schema LIEFERANT_TTMONJJ_ASIN_EK_VK: Datum, ASIN, EK netto, Lieferant", () => {
    expect(skuKauf("MEDIA_13SEP26_B0TEST2201_299.00_389.00", null, jetzt)).toEqual({ asin: "B0TEST2201", tag: "2026-09-13", ekNetto: 251.26, shop: "MEDIA", geschaetzt: false });
  });
  it("alte Schemata (ohne Jahr) mit geschätztem Jahr; Retouren und Unbekanntes zählen nicht", () => {
    expect(skuKauf("AMZFR_194.83_299.00_08SEP_B0TEST2202", null, jetzt)).toMatchObject({ asin: "B0TEST2202", tag: "2026-09-08", ekNetto: 194.83, shop: "AMZFR", geschaetzt: true });
    expect(skuKauf("CONRA_40.58_26MAY_B0TEST2203_28.56", null, jetzt)).toMatchObject({ asin: "B0TEST2203", tag: "2026-05-26", shop: "CONRA" });
    expect(skuKauf("RET_3_LPNHK100000002_16JUL25_FBA", "B0TEST2204", jetzt)).toBeNull();
    expect(skuKauf("IRGENDWAS-123", "B0TEST2205", jetzt)).toBeNull();
  });
});

describe("B22.2 – Kauf 0–21 Tage nach dem Posten", () => {
  const deal = { asin: "B0TEST2201", gepostetAm: new Date("2026-09-10T18:00:00Z") };
  const k = (tag: string, ref = "sellerboard-SKU X"): EigenerKauf => ({ asin: "B0TEST2201", am: new Date(`${tag}T12:00:00Z`), ref, nurTag: true, menge: 4, ekNetto: 251.26, shop: "MEDIA" });
  it("Tag 20 zählt (mit Menge/EK), Tag 22 und vor dem Posten nicht", () => {
    expect(kaufZuDeal(deal, [k("2026-09-30")])).toMatchObject({ ref: "sellerboard-SKU X", menge: 4, ekNetto: 251.26 });
    expect(kaufZuDeal(deal, [k("2026-10-02")])).toBeNull();
    expect(kaufZuDeal(deal, [k("2026-09-09")])).toBeNull();
  });
  it("frühester Treffer, andere ASIN zählt nicht", () => {
    expect(kaufZuDeal(deal, [k("2026-09-20", "später"), k("2026-09-13", "früher"), { ...k("2026-09-11"), asin: "B0TEST9999" }])?.ref).toBe("früher");
  });
});

describe("B22.2 – Vorwissen Lugru: Start 60, nur harte Rot-Kriterien drücken", () => {
  const schwach = { roi: 22, schwankung90: 30, angeboteTrend30: 40 }; // Kennzahlen allein < 60
  it("Lugru ohne harte Kriterien: mindestens 60, mit Begründung", () => {
    const w = dealWert(schwach, { zielRoi: 20, ampel: "gelb", historie: [], quelle: "Lugru Deals · #deals" });
    expect(w.wert).toBe(LUGRU_START);
    expect(w.dafuer[0]).toContain("Vorwissen");
    expect(dealWert(schwach, { zielRoi: 20, ampel: "gelb", historie: [], quelle: "ProfitPath" }).wert).toBeLessThan(LUGRU_START);
  });
  it("harte Kriterien: Amazon > 90 %, Kapital-Ampel rot, Verlust-Stopp, Marke mit Beschwerde, ROI < 10 %", () => {
    expect(lugruHarteGruende({ amazonAnteil: 95 })).toEqual(["Amazon hält die Buy Box (95 %)"]);
    expect(lugruHarteGruende({ roi: 8 }, { eigen: { kapitalAmpel: "rot", verlustStopp: "Verlust-Stopp offen" }, risiken: ["Marke mit IP-Beschwerde (Fall-Zentrale)"] })).toEqual(["Kapital-Ampel rot (eigener Bestand reicht)", "Verlust-Stopp-Artikel", "Marke mit IP-Beschwerde (Fall-Zentrale)", "ROI nur 8 %"]);
    const w = dealWert({ ...schwach, roi: 8 }, { zielRoi: 20, ampel: "gelb", historie: [], quelle: "Lugru Deals" });
    expect(w.wert).toBeLessThan(LUGRU_START);
    expect(w.dagegen[0]).toBe("ROI nur 8 %");
    expect(dealWert(schwach, { zielRoi: 20, ampel: "rot", historie: [], quelle: "Lugru Deals" }).wert).toBeLessThanOrEqual(30);
  });
});

describe("B22.2 – Schwelle je Quelle und Trefferquote", () => {
  it("Lugru Deals = 60 vorbelegt, eigene Einstellung geht vor", () => {
    expect(wertSchwelleFuer("Lugru Deals · #deals", { wertSchwelle: 70, wertSchwelleJe: {} })).toBe(60);
    expect(wertSchwelleFuer("Lugru Deals", { wertSchwelle: 70, wertSchwelleJe: { "lugru deals": 65 } })).toBe(65);
    expect(wertSchwelleFuer("ProfitPath", { wertSchwelle: 70, wertSchwelleJe: {} })).toBe(70);
  });
  it("Monatsbericht: Schwelle je Deal, Lugru-Block mit Trefferquote", () => {
    const b = lernBericht(
      [
        { id: "1", titel: null, datum: "2026-10-02", wert: 62, status: "gekauft", daumen: null, realerRoi: 25, schwelle: 60, quelle: "Lugru Deals · #deals" },
        { id: "2", titel: null, datum: "2026-10-03", wert: 61, status: "gekauft", daumen: null, realerRoi: -5, schwelle: 60, quelle: "Lugru Deals · #deals" },
        { id: "3", titel: null, datum: "2026-10-04", wert: 65, status: "gekauft", daumen: null, realerRoi: 30, quelle: "ProfitPath" },
      ],
      { schwelle: 70, zielRoi: 20 },
    );
    expect(b.ueberSchwelle).toBe(2);
    expect(b.trefferquote).toBe(50);
    expect(b.lugruDeals).toMatchObject({ deals: 2, gekauft: 2, mitErgebnis: 2, trefferquote: 50, trefferBasis: 2 });
  });
});
