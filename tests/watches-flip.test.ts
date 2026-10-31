import { describe, expect, it } from "vitest";
import { breakEven, daysBetween, flipCalc, maxBuy, vatShare } from "@/lib/watches/calc";
import { LESSONS, lessonByKey, nextLesson, scoreQuiz } from "@/lib/watches/lessons";
import { dealHints, dealResult, dealStats, defaultChecklist, normRef, parseCosts, parseEuro, parsePct, priceSummary, type DealLike, type PriceNote } from "@/lib/watches/logic";

// Uhren Buy & Flip – nur erfundene Zahlen.

describe("Rechner: Steuerarten", () => {
  it("privat: keine Umsatzsteuer, Gewinn = Verkauf − alles", () => {
    const r = flipCalc({ mode: "privat", buy: 4000, costs: 300, sell: 5000, feePct: 5, feeFixed: 10, shipping: 40 });
    expect(r.fees).toBe(260);
    expect(r.vat).toBe(0);
    expect(r.profit).toBe(400);
    expect(r.marginPct).toBe(8);
    expect(r.capital).toBe(4300);
    expect(r.roiPct).toBe(9.3);
  });

  it("§ 25a: Steuer nur auf die Differenz, Nebenkosten mindern sie nicht", () => {
    const a = flipCalc({ mode: "differenz", buy: 4000, sell: 5000 });
    expect(a.vat).toBe(159.66);
    expect(a.margin25a).toBe(1000);
    const b = flipCalc({ mode: "differenz", buy: 4000, costs: 300, sell: 5000 });
    expect(b.vat).toBe(159.66);
    expect(b.profit).toBe(540.34);
    // Verlust: keine Steuer.
    expect(flipCalc({ mode: "differenz", buy: 5000, sell: 4500 }).vat).toBe(0);
  });

  it("Regelbesteuerung: USt auf vollen Preis minus Vorsteuer – bei Verlust Erstattung", () => {
    expect(flipCalc({ mode: "regel", buy: 10000, sell: 11000 }).vat).toBe(159.66);
    expect(flipCalc({ mode: "regel", buy: 10000, sell: 9520 }).vat).toBe(-76.64);
    expect(vatShare(19)).toBeCloseTo(0.159664, 5);
  });

  it("Rendite je Monat aus der Standzeit", () => {
    const r = flipCalc({ mode: "privat", buy: 6000, sell: 6600, days: 60 });
    expect(r.roiPct).toBe(10);
    expect(r.roiPerMonthPct).toBe(5);
    expect(flipCalc({ mode: "privat", buy: 6000, sell: 6600 }).roiPerMonthPct).toBeNull();
  });

  it("Break-even: Gewinn genau 0", () => {
    for (const mode of ["privat", "differenz", "regel"] as const) {
      const i = { mode, buy: 3000, costs: 250, feePct: 6.5, feeFixed: 5, shipping: 30 };
      const be = breakEven(i);
      expect(Math.abs(flipCalc({ ...i, sell: be }).profit)).toBeLessThan(0.05);
    }
  });

  it("Höchster Ankaufspreis rückwärts – passt zum Vorwärtsrechnen", () => {
    expect(maxBuy({ mode: "privat", sell: 6000, feePct: 6.5, costs: 210, targetProfit: 500 })).toBe(4900);
    for (const mode of ["privat", "differenz", "regel"] as const) {
      const i = { mode, sell: 8000, costs: 300, feePct: 5, feeFixed: 10, shipping: 40 };
      const mb = maxBuy({ ...i, targetProfit: 600 });
      expect(Math.abs(flipCalc({ ...i, buy: mb }).profit - 600)).toBeLessThan(0.05);
    }
    expect(maxBuy({ mode: "privat", sell: 1000, costs: 2000 })).toBeLessThan(0);
  });

  it("Tage zwischen Daten", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBeNull();
    expect(daysBetween(null, "2026-10-01")).toBeNull();
  });
});

describe("Eingaben", () => {
  it("Euro mit deutschen und englischen Trennzeichen", () => {
    expect(parseEuro("4.000")).toBe(4000);
    expect(parseEuro("4000")).toBe(4000);
    expect(parseEuro("4.250,50")).toBe(4250.5);
    expect(parseEuro("4,250.50")).toBe(4250.5);
    expect(parseEuro("1.299 €")).toBe(1299);
    expect(parseEuro("99,9")).toBe(99.9);
    expect(parseEuro("12.5")).toBe(12.5);
    expect(parseEuro("")).toBeNull();
    expect(parseEuro("abc")).toBeNull();
    expect(parseEuro("-5")).toBeNull();
    expect(parseEuro("1.2.3")).toBeNull();
  });
  it("Prozent", () => {
    expect(parsePct("6,5")).toBe(6.5);
    expect(parsePct("6.5 %")).toBe(6.5);
    expect(parsePct("120")).toBeNull();
    expect(parsePct("")).toBeNull();
  });
  it("Nebenkosten-Zeilen", () => {
    const r = parseCosts("Revision: 350\nAnreise 25 €\n\nEchtheitsprüfung; 1.200,50\nnur Text");
    expect(r.items).toEqual([{ label: "Revision", amount: 350 }, { label: "Anreise", amount: 25 }, { label: "Echtheitsprüfung", amount: 1200.5 }]);
    expect(r.bad).toEqual(["nur Text"]);
  });
  it("Referenzen vergleichbar", () => {
    expect(normRef(" 116610 ln ")).toBe("116610LN");
    expect(normRef("310.30.42.50.01.001")).toBe("310.30.42.50.01.001");
  });
});

const deal = (x: Partial<DealLike> = {}): DealLike => ({ status: "beobachtet", practice: false, taxMode: "privat", buyPrice: null, buyDate: null, costs: 0, sellPrice: null, sellDate: null, targetSell: null, feePct: 0, feeFixed: 0, shipping: 0, ...x });

describe("Deals", () => {
  it("geplant mit Ziel-Verkauf, verkauft mit tatsächlichem Preis und Standzeit", () => {
    expect(dealResult(deal())).toBeNull();
    const p = dealResult(deal({ buyPrice: 4000, targetSell: 4600, buyDate: "2026-10-01" }), "2026-10-11")!;
    expect(p.planned).toBe(true);
    expect(p.profit).toBe(600);
    expect(p.days).toBe(10);
    const s = dealResult(deal({ status: "verkauft", buyPrice: 4000, buyDate: "2026-09-01", sellPrice: 4500, sellDate: "2026-10-01", costs: 100 }))!;
    expect(s.planned).toBe(false);
    expect(s.profit).toBe(400);
    expect(s.days).toBe(30);
    expect(s.roiPerMonthPct).toBe(9.8);
  });

  it("Auswertung: Gewinn, Marge, Standzeit, gebundenes Geld", () => {
    const st = dealStats([
      deal({ status: "verkauft", buyPrice: 1000, buyDate: "2026-09-01", sellPrice: 1200, sellDate: "2026-09-11" }),
      deal({ status: "verkauft", buyPrice: 2000, buyDate: "2026-09-01", sellPrice: 1900, sellDate: "2026-10-01" }),
      deal({ status: "gekauft", buyPrice: 3000, costs: 150 }),
      deal({ status: "beobachtet", askPrice: 500 } as Partial<DealLike>),
    ]);
    expect(st).toMatchObject({ sold: 2, profit: 100, avgDays: 20, openCapital: 3150, open: 1, losses: 1, best: 200, worst: -100 });
    expect(st.avgMarginPct).toBe(5.7);
  });

  it("Prüfliste je Zustand", () => {
    expect(defaultChecklist("gebraucht").some((c) => /Diebstahl/.test(c.text))).toBe(true);
    expect(defaultChecklist("neu").some((c) => /Garantiekarte/.test(c.text))).toBe(true);
    expect(defaultChecklist("neu").every((c) => !c.done)).toBe(true);
  });

  it("Lern-Hinweise: fehlende Vergleiche, zu optimistisches Ziel, kein Gewinn", () => {
    const notes: PriceNote[] = [3800, 4000, 4200].map((price, i) => ({ reference: "TEST 1", kind: "verkauft", price, day: `2026-10-0${i + 1}`, condition: "gebraucht", fullSet: true }));
    const prices = priceSummary(notes, "test1");
    expect(prices.verkauft).toMatchObject({ n: 3, min: 3800, median: 4000, max: 4200, last: "2026-10-03" });
    const base = { checklist: [{ text: "x", done: false }], reference: "TEST 1" };
    expect(dealHints({ ...deal(), ...base, reference: null }, {})).toEqual(expect.arrayContaining([expect.stringMatching(/Referenznummer/), expect.stringMatching(/3 verkaufte/)]));
    expect(dealHints({ ...deal({ buyPrice: 3900, targetSell: 4500 }), ...base }, prices)).toEqual(expect.arrayContaining([expect.stringMatching(/über dem Median/)]));
    expect(dealHints({ ...deal({ buyPrice: 4100, targetSell: 4000 }), ...base }, prices)).toEqual(expect.arrayContaining([expect.stringMatching(/kein Gewinn/)]));
    expect(dealHints({ ...deal({ buyPrice: 3900, targetSell: 4000 }), ...base }, prices)).toEqual(expect.arrayContaining([expect.stringMatching(/Weniger als 5 %/)]));
  });
});

describe("Lernpfad", () => {
  it("jede Lektion hat Inhalt, Übung und ein gültiges Quiz", () => {
    expect(new Set(LESSONS.map((l) => l.key)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(l.sections.length).toBeGreaterThan(0);
      expect(l.practice.href.startsWith("/marken/uhren")).toBe(true);
      expect(l.quiz.length).toBeGreaterThanOrEqual(2);
      for (const q of l.quiz) {
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(q.why.length).toBeGreaterThan(10);
      }
    }
  });

  it("Rechenfragen im Quiz stimmen mit dem Rechner überein", () => {
    const neu = lessonByKey("neu")!.quiz[1];
    expect(neu.options[neu.answer]).toBe("159,66 €");
    expect(flipCalc({ mode: "regel", buy: 10000, sell: 11000 }).vat).toBe(159.66);
    const st = lessonByKey("steuern")!.quiz;
    expect(st[0].options[st[0].answer]).toBe("159,66 €");
    expect(flipCalc({ mode: "differenz", buy: 4000, sell: 5000 }).vat).toBe(159.66);
    const k = lessonByKey("kalkulation")!.quiz;
    expect(k[0].options[k[0].answer]).toBe("4.900 €");
    expect(maxBuy({ mode: "privat", sell: 6000, feeFixed: 390, costs: 210, targetProfit: 500 })).toBe(4900);
    expect(k[1].options[k[1].answer]).toBe("5 %");
  });

  it("Quiz auswerten und nächste Lektion", () => {
    const l = LESSONS[0];
    expect(scoreQuiz(l, l.quiz.map((q) => q.answer))).toEqual({ correct: l.quiz.length, total: l.quiz.length, passed: true });
    expect(scoreQuiz(l, [null]).passed).toBe(false);
    expect(nextLesson([])?.key).toBe("grundlagen");
    expect(nextLesson([{ lesson: "grundlagen", done: true, bestCorrect: 3, total: 3 }])?.key).toBe("markt");
    expect(nextLesson(LESSONS.map((x) => ({ lesson: x.key, done: true, bestCorrect: 0, total: 0 })))).toBeNull();
  });
});
