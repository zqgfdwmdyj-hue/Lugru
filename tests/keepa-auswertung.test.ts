import { describe, expect, it } from "vitest";
import { buyboxAnteile, fenster, keepaMs, MARKTPLAETZE, reihe, standAusKeepa, tagesende, wertBei } from "@/lib/keepa/auswertung";

// Erfundene Keepa-Antworten (Aufbau wie bei der Keepa-API: Keepa-Minuten, Cent, −1 = nicht verfügbar).
const NOW = Date.parse("2026-10-28T12:00:00Z");
const TAG = 86_400_000;
/** Keepa-Minuten für „vor n Tagen“. */
const km = (tageZurueck: number) => Math.round((NOW - tageZurueck * TAG) / 60_000) - 21_564_000;
const AMZ = MARKTPLAETZE.DE.amazonId;

describe("Keepa-Grundlagen", () => {
  it("Keepa-Minuten → Unix-Zeit: (t + 21564000) × 60000", () => {
    expect(new Date(keepaMs(0)).toISOString()).toBe("2011-01-01T00:00:00.000Z");
    expect(keepaMs(km(0))).toBe(NOW);
  });
  it("Buy Box = Preis + Versand; −1 = kein Angebot; negativer Versand zählt als 0", () => {
    expect(reihe([km(10), 1000, 299, km(5), -1, 0, km(1), 1500, -1], true)).toEqual([
      [NOW - 10 * TAG, 1299],
      [NOW - 5 * TAG, null],
      [NOW - TAG, 1500],
    ]);
    expect(reihe([km(3), 12, km(2), -1])).toEqual([
      [NOW - 3 * TAG, 12],
      [NOW - 2 * TAG, null],
    ]);
    expect(reihe(null)).toEqual([]);
  });
  it("Wert zu einem Zeitpunkt: vor dem ersten Wert „unbekannt“, danach der zuletzt gültige", () => {
    const r = reihe([km(10), 100, km(5), 200]);
    expect(wertBei(r, NOW - 20 * TAG)).toBeUndefined();
    expect(wertBei(r, NOW - 7 * TAG)).toBe(100);
    expect(wertBei(r, NOW)).toBe(200);
  });
  it("Zeitraum: zeitgewichteter Schnitt, Min/Max, Anteil ohne Angebot", () => {
    // 20 Tage 10,00 €, dann 10 Tage nicht auf Lager, dann 10 Tage 20,00 € (Fenster 40 Tage)
    const r = reihe([km(40), 1000, km(20), -1, km(10), 2000]);
    const f = fenster(r, NOW - 40 * TAG, NOW);
    expect(f.min).toBe(1000);
    expect(f.max).toBe(2000);
    expect(f.schnitt).toBeCloseTo((1000 * 20 + 2000 * 10) / 30, 6);
    expect(f.ohneProzent).toBe(25);
    // Fenster beginnt mitten in einem Abschnitt: Stand am Fensterbeginn zählt
    expect(fenster(r, NOW - 30 * TAG, NOW - 25 * TAG)).toMatchObject({ min: 1000, max: 1000, ohneProzent: 0 });
  });
  it("Tagesende in Berlin (Winter- und Sommerzeit)", () => {
    expect(new Date(tagesende("2026-01-15")).toISOString()).toBe("2026-01-15T22:59:59.999Z");
    expect(new Date(tagesende("2026-07-15")).toISOString()).toBe("2026-07-15T21:59:59.999Z");
  });
});

describe("Buy-Box-Anteile", () => {
  const stats = { A1FBA00000001: { anteil: 30, fba: true }, A2FBM00000002: { anteil: 10, fba: false } };
  it("aus dem Verlauf, zeitgewichtet: Amazon / FBA / FBM / niemand", () => {
    // 100 Tage: 50 Amazon, 25 FBA, 15 FBM, 10 niemand
    const h: [number, string][] = [
      [NOW - 100 * TAG, AMZ],
      [NOW - 50 * TAG, "A1FBA00000001"],
      [NOW - 25 * TAG, "A2FBM00000002"],
      [NOW - 10 * TAG, "-1"],
    ];
    const a = buyboxAnteile(h, stats, AMZ, NOW - 100 * TAG, NOW)!;
    expect(a).toMatchObject({ zeitraum_tage: 100, grundlage: "verlauf", amazon_prozent: 50, fba_prozent: 25, fbm_prozent: 15, keine_buybox_prozent: 10, unbekannt_prozent: 0 });
    expect(a.verkaeufer.map((v) => [v.art, v.anteil_prozent])).toEqual([
      ["Amazon", 50],
      ["FBA", 25],
      ["FBM", 15],
    ]);
  });
  it("Verkäufer ohne Keepa-Statistik = „unbekannt“ (nicht geraten)", () => {
    const a = buyboxAnteile([[NOW - 10 * TAG, "AXNEU0000000"]], stats, AMZ, NOW - 10 * TAG, NOW)!;
    expect(a.unbekannt_prozent).toBe(100);
  });
  it("ohne Verlauf: Keepa-Statistik der letzten 180 Tage; ohne beides: null", () => {
    const a = buyboxAnteile([], { [AMZ]: { anteil: 60, fba: true }, ...stats }, AMZ, NOW - 90 * TAG, NOW)!;
    expect(a).toMatchObject({ grundlage: "keepa_statistik_180_tage", zeitraum_tage: 180, amazon_prozent: 60, fba_prozent: 30, fbm_prozent: 10 });
    expect(buyboxAnteile([], null, AMZ, NOW - 90 * TAG, NOW)).toBeNull();
  });
});

describe("Stand aus einem Keepa-Produkt", () => {
  const csv: unknown[] = [];
  csv[0] = [km(200), 2499, km(60), -1, km(30), 2299]; // Amazon: 60–30 Tage nicht auf Lager
  csv[3] = [km(200), 5000, km(10), 3000]; // Rang
  csv[11] = [km(200), 8, km(5), 12]; // Neu-Angebote
  csv[18] = [km(200), 2399, 0, km(15), 2199, 100]; // Buy Box + Versand
  csv[34] = [km(5), 9];
  csv[35] = [km(5), 3];
  const produkt = {
    asin: "B0TEST0001",
    title: "Testprodukt",
    csv,
    availabilityAmazon: 0,
    monthlySold: 50,
    lastUpdate: km(0),
    stats: { avg30: Object.assign(new Array(36).fill(-1), { 0: 2300, 3: 3500, 18: 2250 }), outOfStockPercentage30: [0], outOfStockPercentage90: [33], outOfStockPercentageInInterval: [17], buyBoxStats: { [AMZ]: { percentageWon: 70, isFBA: true }, A1FBA00000001: { percentageWon: 30, isFBA: true } } },
    buyBoxSellerIdHistory: [String(km(100)), "A1FBA00000001", String(km(40)), AMZ],
  };
  const s = standAusKeepa(produkt, "DE", NOW)!;

  it("aktuell: Buy Box inkl. Versand, Amazon auf Lager, Angebote gesamt/FBA/FBM, Rang, Verkäufe/Monat", () => {
    expect(s.aktuell).toEqual({ buybox: 22.99, amazon: 22.99, amazon_status: "auf Lager", angebote_neu: 12, angebote_fba: 9, angebote_fbm: 3, verkaufsrang: 3000, monatlich_verkauft: 50 });
    expect(s).toMatchObject({ asin: "B0TEST0001", marktplatz: "DE", waehrung: "EUR", titel: "Testprodukt" });
  });
  it("Kennzahlen: Schnitt von Keepa (wenn vorhanden), Min/Max aus dem Verlauf, Amazon nicht auf Lager in %", () => {
    expect(s.kennzahlen["30"]).toEqual({ buybox: { schnitt: 22.5, min: 22.99, max: 23.99 }, amazon: { schnitt: 23, min: 22.99, max: 22.99 }, rang: { schnitt: 3500, min: 3000, max: 5000 }, amazon_nicht_auf_lager_prozent: 0 });
    expect(s.kennzahlen["90"].buybox).toMatchObject({ min: 22.99, max: 23.99 });
    expect(s.kennzahlen["90"].amazon_nicht_auf_lager_prozent).toBe(33);
    expect(s.kennzahlen["180"].amazon_nicht_auf_lager_prozent).toBe(17);
    // Ohne Keepa-Schnitt: aus dem Verlauf (90 Tage Amazon: 30 Tage 24,99, 30 nicht auf Lager, 30 Tage 22,99)
    expect(s.kennzahlen["90"].amazon.schnitt).toBe(23.99);
  });
  it("ein Wert je Tag für 365 Tage (älteste zuerst), heute = aktueller Stand", () => {
    expect(s.verlauf).toHaveLength(365);
    expect(s.verlauf.at(-1)).toEqual(["2026-10-28", 22.99, 22.99, 12, 3000]);
    expect(s.verlauf.at(-46)?.[2]).toBeNull(); // vor 45 Tagen: Amazon nicht auf Lager
    expect(s.verlauf[0][1]).toBeNull(); // vor 364 Tagen: noch keine Daten
  });
  it("Buy-Box-Verlauf und Keepa-Statistik bleiben für die Anteile erhalten", () => {
    expect(s.buybox_verlauf).toHaveLength(2);
    expect(buyboxAnteile(s.buybox_verlauf, s.buybox_stats, AMZ, NOW - 100 * TAG, NOW)).toMatchObject({ amazon_prozent: 40, fba_prozent: 60 });
  });
  it("Amazon ohne Angebot, keine Verkaufsangabe, unbekannte ASIN", () => {
    const ohne = standAusKeepa({ asin: "B0TEST0002", title: "x", csv: [], availabilityAmazon: -1, monthlySold: 0 }, "UK", NOW)!;
    expect(ohne.aktuell).toMatchObject({ amazon: null, amazon_status: "kein Amazon-Angebot", monatlich_verkauft: null, buybox: null });
    expect(ohne.waehrung).toBe("GBP");
    expect(ohne.kennzahlen["30"].amazon_nicht_auf_lager_prozent).toBeNull();
    expect(standAusKeepa({ asin: "B0TEST0003", csv: [] }, "DE", NOW)).toBeNull();
    expect(standAusKeepa(null, "DE", NOW)).toBeNull();
  });
});
