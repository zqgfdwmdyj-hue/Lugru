import { describe, expect, it } from "vitest";
import { computeHebel, correctedProfit, hebelTask, priceStep, summarize, totals, type StatInput, type StockInput } from "@/lib/hebel/rules";

// Hebel für Umsatz und Marge – fiktive Produkte.

const stat = (o: Partial<StatInput>): StatInput => ({
  channel: "amazon", sku: "T-1", name: "Testprodukt", asin: "B0TEST0001", image: null, link: null,
  units: 100, refunds: 0, sales: 1000, netProfit: 150, fees: -300, productCosts: -400, advertising: 0, vat: -160, refundCost: 0,
  price: 10, sessions: null, conversion: null, daysLeft: 60, timeToReorder: "NO", costMissing: false,
  ...o,
});
const run = (stats: StatInput[], extra: { stock?: StockInput[]; ownCost?: [string, number][]; buyBox?: [string, { price: number | null; hasBuyBox: boolean | null; isAmazon: boolean }][]; dismissed?: string[] } = {}) =>
  computeHebel({ stats, stock: extra.stock ?? [], ownCost: new Map(extra.ownCost ?? []), buyBox: new Map(extra.buyBox ?? []), dismissed: new Set(extra.dismissed ?? []) });

describe("Gewinn mit eigenem EK", () => {
  it("zieht den EK nur ab, wo sellerboard keinen kennt", () => {
    expect(correctedProfit({ netProfit: 99.71, units: 9, costMissing: true }, 6)).toBeCloseTo(45.71, 2);
    expect(correctedProfit({ netProfit: 99.71, units: 9, costMissing: false }, 6)).toBe(99.71);
    expect(correctedProfit({ netProfit: 99.71, units: 9, costMissing: true }, null)).toBeNull();
  });
  it("ersetzt einen abweichenden EK aus sellerboard (z. B. 0,01-€-Platzhalter) durch den gültigen", () => {
    // sellerboard hat 9 × 0,01 € abgezogen, gültig sind 3,90 € je Stück
    expect(correctedProfit({ netProfit: 99.71, units: 9, costMissing: false, productCosts: -0.09 }, 3.9)).toBeCloseTo(64.7, 2);
    expect(correctedProfit({ netProfit: 99.71, units: 9, costMissing: false, productCosts: -0.09 }, null)).toBe(99.71);
  });
  it("Preisschritt für die Zielmarge", () => {
    // 10 € Ø-Preis, −0,50 € je Stück, 35 % variable Abgaben → (1 + 0,5)/(1 − 0,35 − 0,1) ≈ 2,73 €
    expect(priceStep(1000, 100, -50, 0.35, 10)).toBeCloseTo(2.73, 2);
    expect(priceStep(1000, 100, 200, 0.35, 10)).toBe(0);
  });
});

describe("Regeln", () => {
  it("Verlustbringer mit Preisvorschlag; über der Buy Box → anderer Rat", () => {
    const [h] = run([stat({ netProfit: -75.42, sales: 2242.26, units: 195, fees: -1236.81, vat: -219.88 })]);
    expect(h.type).toBe("verlust");
    expect(h.impact).toBeCloseTo(75.42, 2);
    expect(h.contribution).toBeCloseTo(75.42, 2);
    expect(h.basis.join(" ")).toMatch(/Absatz bleibt gleich/);
    expect(h.action).toMatch(/Preis um ca\./);
    const [h2] = run([stat({ netProfit: -75.42, sales: 2242.26, units: 195, fees: -1236.81, vat: -219.88 })], { buyBox: [["B0TEST0001", { price: 11.3, hasBuyBox: true, isAmazon: false }]] });
    expect(h2.action).toMatch(/über der Buy Box/);
  });
  it("Marge unter 10 % (ab 10 Stück), sonst nichts", () => {
    const h = run([stat({ netProfit: 50 })]);
    expect(h.map((x) => x.type)).toEqual(["marge"]);
    expect(h[0].impact).toBeCloseTo(50, 2); // 10 % von 1000 € − 50 €
    expect(run([stat({ netProfit: 150 })])).toEqual([]);
    expect(run([stat({ netProfit: 50, units: 8 })])).toEqual([]);
  });
  it("Erstattungen über 5 %: Ersparnis nur für den Teil über der Schwelle", () => {
    const h = run([stat({ refunds: 8, refundCost: -95 })]).find((x) => x.type === "erstattungen")!;
    // 95 € / 8 = 11,875 € je Erstattung; Ziel 5 von 100 → 3 weniger = 35,63 €
    expect(h.saving).toBeCloseTo(35.63, 2);
    expect(h.contribution).toBe(0);
    expect(h.impact).toBeCloseTo(35.63, 2);
    expect(h.basis.join(" ")).toMatch(/3 weniger/);
    expect(run([stat({ refunds: 5 })]).some((x) => x.type === "erstattungen")).toBe(false);
  });
  it("Kaufquote deutlich unter dem eigenen Mittel", () => {
    const peers = [12, 11, 10, 9, 13].map((c, i) => stat({ sku: `P-${i}`, asin: `B0PEER000${i}`, sessions: 1000, conversion: c }));
    const weak = stat({ sku: "W-1", asin: "B0WEAK0001", sessions: 2000, conversion: 4 });
    const h = run([...peers, weak]).find((x) => x.type === "kaufquote");
    expect(h?.sku).toBe("W-1");
    // Mittel aller sechs = 10,5 % → (10,5 − 4) % von 2000 Besuchen = 130 Stück × 1,50 € Gewinn
    expect(h?.impact).toBeCloseTo(195, 1);
  });
  it("Preis-Spielraum: günstiger als die Buy Box oder knappe Reichweite", () => {
    const h = run([stat({ price: 10 })], { buyBox: [["B0TEST0001", { price: 11, hasBuyBox: true, isAmazon: false }]] });
    expect(h[0].type).toBe("spielraum");
    expect(h[0].headline).toMatch(/günstiger als die Buy Box/);
    expect(run([stat({ daysLeft: 12, timeToReorder: "SOON" })])[0].headline).toMatch(/nur 12 Tage/);
  });
  it("Nachbestellen nach entgangenem Gewinn", () => {
    const h = run([stat({ timeToReorder: "YES", daysLeft: 0 })]).find((x) => x.type === "nachbestellen");
    expect(h?.impact).toBeCloseTo(150, 2);
    expect(h?.link).toBe("/einkauf/vorschlaege?q=T-1#sellerboard");
  });
  it("Ladenhüter aus dem Bestand: Reichweite über 120 Tage oder keine Verkäufe (auch „999 Tage“)", () => {
    const stock: StockInput[] = [
      { sku: "L-1", name: "Lager", asin: "B0LAGER001", fbaStock: 200, daysLeft: 400, salesVelocity: 0.5, cost: 6 },
      { sku: "L-2", name: "Steht", asin: null, fbaStock: 50, daysLeft: null, salesVelocity: 0, cost: 4 },
      { sku: "L-3", name: "Läuft", asin: null, fbaStock: 50, daysLeft: 30, salesVelocity: 2, cost: 6 },
      { sku: "L-4", name: "999", asin: null, fbaStock: 30, reserved: 5, inbound: 5, daysLeft: 999, salesVelocity: 0, cost: 10 },
      { sku: "L-5", name: "ohne EK", asin: null, fbaStock: 500, daysLeft: 999, salesVelocity: 0, cost: null },
    ];
    const h = run([], { stock });
    // Sortiert nach Monatswirkung: L-1 28 €, L-4 6,67 €, L-2 6,33 €
    expect(h.map((x) => x.sku)).toEqual(["L-1", "L-4", "L-2"]);
    expect(h.find((x) => x.sku === "L-2")!.headline).toMatch(/keine Verkäufe/);
    const l4 = h.find((x) => x.sku === "L-4")!;
    expect(l4.headline).toMatch(/keine Verkäufe in den letzten 30 Tagen/);
    expect(l4.headline).not.toMatch(/999/);
  });
  it("Ladenhüter: Kapital getrennt (einmalig), Monatswirkung nur Lager- und Kapitalkosten", () => {
    // 200 Stück × 6 € = 1.200 € gebunden; Lager 200 × 0,10 € = 20 €; Zinsen 1.200 × 8 % / 12 = 8 €
    const [h] = run([], { stock: [{ sku: "L-1", name: "Lager", asin: null, fbaStock: 200, daysLeft: 400, salesVelocity: 0.5, cost: 6 }] });
    expect(h.capital).toBe(1200);
    expect(h.saving).toBeCloseTo(28, 2);
    expect(h.impact).toBeCloseTo(28, 2);
    expect(h.contribution).toBe(0);
    expect(h.basis.join(" ")).toMatch(/einmalig, kein Monatswert/);
    const t = totals(summarize([h]));
    expect(t).toEqual({ impact: 28, contribution: 0, saving: 28, capital: 1200 });
  });
  it("eBay ohne EK in sellerboard: mit eigenem EK rechnen, sonst „EK fehlt“", () => {
    const e = stat({ channel: "ebay", sku: "LG-5", asin: null, units: 30, sales: 615, netProfit: 330, costMissing: true });
    expect(run([e], { ownCost: [["LG-5", 12]] }).find((x) => x.type === "verlust")?.impact).toBeCloseTo(30, 2);
    const missing = run([e]);
    expect(missing.map((x) => x.type)).toEqual(["ek_fehlt"]);
  });
  it("Ausgeblendete Hebel fehlen; Sortierung nach Wirkung", () => {
    const a = stat({ sku: "A", netProfit: -10, units: 10 });
    const b = stat({ sku: "B", netProfit: -100, units: 10 });
    expect(run([a, b]).map((x) => x.sku)).toEqual(["B", "A"]);
    expect(run([a, b], { dismissed: ["verlust:amazon:B"] }).map((x) => x.sku)).toEqual(["A"]);
  });
});

describe("Aufgaben", () => {
  it("eine Sammelaufgabe je Art, Titel nur mit Anzahl; Nachbestellen ohne eigene Aufgabe", () => {
    const list = run([stat({ sku: "A", netProfit: -10, units: 10 }), stat({ sku: "B", netProfit: -100, units: 10, timeToReorder: "YES" })]);
    const sum = summarize(list).find((s) => s.type === "verlust")!;
    const t = hebelTask(sum, list.filter((h) => h.type === "verlust"))!;
    expect(t.title).toBe("2 Verlustbringer prüfen – Preis oder Einkauf anpassen");
    expect(t.notes).toMatch(/Wirkung zusammen ca\. 110\s€ im Monat/);
    expect(hebelTask({ type: "nachbestellen", count: 3, impact: 50, contribution: 50, saving: 0, capital: 0 }, [])).toBeNull();
  });
});
