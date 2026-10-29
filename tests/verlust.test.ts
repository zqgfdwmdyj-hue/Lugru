import { describe, expect, it } from "vitest";
import { ausnahmeAktiv, fensterTage, pruefeVerlust, verlustAufgabe, wochenSumme, type TagWert } from "@/lib/money/verlust";

// Verlust-Stopp: Auslöser 2 von 3 Tagen im Minus oder ≥ 5 Stück mit Verlust. Erfundene Werte.

const w = (day: string, sku: string, units: number, netProfit: number | null, avgPrice: number | null = 10): TagWert => ({ day, sku, asin: "B0TEST0001", name: `Test ${sku}`, units, netProfit, avgPrice });
const HEUTE = "2026-10-29";

describe("Fenster", () => {
  it("die letzten 3 abgeschlossenen Tage, ältester zuerst", () => {
    expect(fensterTage(HEUTE)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
  });
});

describe("Auslöser", () => {
  it("2 von 3 Tagen im Minus → Fall", () => {
    const f = pruefeVerlust([w("2026-10-26", "A", 1, -2), w("2026-10-27", "A", 1, 3), w("2026-10-28", "A", 1, -1.5)], HEUTE);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ sku: "A", verlustTage: 2, stueckMitVerlust: 2, summe: -0.5, grund: "2 von 3 Tagen im Minus" });
  });
  it("nur 1 Tag im Minus, aber 5 Stück mit Verlust → Fall", () => {
    const f = pruefeVerlust([w("2026-10-28", "B", 5, -4)], HEUTE);
    expect(f[0]).toMatchObject({ sku: "B", verlustTage: 1, stueckMitVerlust: 5, grund: "5 Stück mit Verlust" });
  });
  it("1 Tag im Minus mit 4 Stück → kein Fall; Tage außerhalb des Fensters zählen nicht", () => {
    expect(pruefeVerlust([w("2026-10-28", "C", 4, -4), w("2026-10-25", "C", 9, -20), w("2026-10-29", "C", 9, -20)], HEUTE)).toEqual([]);
  });
  it("Kanäle je Tag zusammengezählt; Tag ohne Gewinnwert zählt nicht als Verlust", () => {
    const f = pruefeVerlust([w("2026-10-27", "D", 1, -3), w("2026-10-27", "D", 1, 5), w("2026-10-28", "D", 1, -1), w("2026-10-26", "D", 2, null)], HEUTE);
    expect(f).toEqual([]);
  });
  it("sortiert nach größtem Verlust zuerst", () => {
    const f = pruefeVerlust([w("2026-10-27", "X", 5, -5), w("2026-10-27", "Y", 6, -30)], HEUTE);
    expect(f.map((x) => x.sku)).toEqual(["Y", "X"]);
  });
});

describe("Ausnahmen und Wochensumme", () => {
  it("Wochensumme: letzte 7 abgeschlossene Tage", () => {
    const werte = [w("2026-10-22", "A", 2, -4), w("2026-10-28", "A", 1, -1), w("2026-10-21", "A", 9, -99), w("2026-10-29", "A", 9, -99)];
    expect(wochenSumme(werte, "A", HEUTE)).toEqual({ summe: -5, stueck: 3, tageMitDaten: 2 });
  });
  it("Ausnahme gilt bis einschließlich Datum, leer = unbefristet", () => {
    expect(ausnahmeAktiv({ bis: null }, HEUTE)).toBe(true);
    expect(ausnahmeAktiv({ bis: "2026-10-29" }, HEUTE)).toBe(true);
    expect(ausnahmeAktiv({ bis: "2026-10-28" }, HEUTE)).toBe(false);
  });
});

describe("Aufgabentext", () => {
  it("nennt Break-even, Buy Box und BQool-Regel; warnt bei Min unter Break-even", () => {
    const [f] = pruefeVerlust([w("2026-10-27", "A", 3, -2, 11), w("2026-10-28", "A", 3, -2, 11)], HEUTE);
    const a = verlustAufgabe(f, { breakEven: 12.5, buybox: { preis: 10.99, quelle: "Keepa" }, bqool: { regel: "Buy Box", min: 10.5, max: 19.99, marktplatz: "DE" } });
    expect(a.titel).toBe("Verlust-Stopp: Test A – 2 von 3 Tagen im Minus · 6 Stück mit Verlust");
    expect(a.notiz).toContain("Break-even 12,50 € – Preis liegt darunter");
    expect(a.notiz).toContain("Buy Box 10,99 € laut Keepa");
    expect(a.notiz).toContain("Min 10,50 €");
    expect(a.notiz).toContain("Min liegt unter Break-even");
    const ohne = verlustAufgabe(f, { breakEven: null, buybox: null, bqool: null });
    expect(ohne.notiz).toContain("Break-even unbekannt");
    expect(ohne.notiz).toContain("BQool: SKU nicht im letzten Export");
  });
});
