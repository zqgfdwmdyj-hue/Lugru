import { describe, expect, it } from "vitest";
import { computeHebel, correctedProfit, hebelTask, priceStep, summarize, type StatInput, type StockInput } from "@/lib/hebel/rules";

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
  it("Erstattungen über 5 %", () => {
    const h = run([stat({ refunds: 8, refundCost: -95 })]);
    expect(h.find((x) => x.type === "erstattungen")?.impact).toBe(95);
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
    expect(h?.link).toBe("/einkauf/vorschlaege#sellerboard");
  });
  it("Ladenhüter aus dem Bestand: Reichweite über 120 Tage oder keine Verkäufe", () => {
    const stock: StockInput[] = [
      { sku: "L-1", name: "Lager", asin: "B0LAGER001", fbaStock: 200, daysLeft: 400, salesVelocity: 0.5, stockValue: 1200, cost: 6 },
      { sku: "L-2", name: "Steht", asin: null, fbaStock: 50, daysLeft: null, salesVelocity: 0, stockValue: null, cost: 4 },
      { sku: "L-3", name: "Läuft", asin: null, fbaStock: 50, daysLeft: 30, salesVelocity: 2, stockValue: 300, cost: 6 },
    ];
    const h = run([], { stock });
    expect(h.map((x) => x.sku)).toEqual(["L-1", "L-2"]);
    expect(h[1].headline).toMatch(/keine Verkäufe/);
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
    expect(hebelTask({ type: "nachbestellen", count: 3, impact: 50 }, [])).toBeNull();
  });
});
