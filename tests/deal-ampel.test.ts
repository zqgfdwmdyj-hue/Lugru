import { describe, expect, it } from "vitest";
import { abverkauf, DEAL_AMPEL_STANDARD, dealAmpel, ekNettoAus, leseCode, rechneLand, verkaeufeSchaetzen, type LandMarkt } from "@/lib/deal-ampel/logic";

// Deal-Ampel – erfundene Marktwerte.

const markt = (o: Partial<LandMarkt> & { land: string }): LandMarkt => ({ vkEur: null, vk90Eur: null, tief12Eur: null, mwstSatz: 0.19, verkaeufeMonat: null, angebote: null, amazonProzent: null, aktionsmuster: null, fehler: null, ...o });
const geb = { provision: 0.15, fba: 5 };

describe("Eingabe", () => {
  it("ASIN, EAN und Amazon-Link erkennen", () => {
    expect(leseCode("B0DT6N95XH")).toEqual({ asin: "B0DT6N95XH" });
    expect(leseCode("https://www.amazon.de/Philips-Rasierer/dp/B0DT6N95XH/ref=sr_1_1")).toEqual({ asin: "B0DT6N95XH" });
    expect(leseCode("4006381333931")).toEqual({ ean: "4006381333931" });
    expect(leseCode("hallo")).toBeNull();
  });
  it("brutto → netto mit 19 %", () => {
    expect(ekNettoAus(299.63, false)).toBe(251.79);
    expect(ekNettoAus(100, true)).toBe(100);
  });
});

describe("Gewinn je Land (USt des Landes)", () => {
  it("aktuell und beim 90-Tage-Mittel", () => {
    const l = rechneLand(markt({ land: "IT", vkEur: 122, vk90Eur: 110, mwstSatz: 0.22 }), geb, 60, 1);
    // 122 / 1,22 = 100 netto − 18,30 Provision − 5 FBA − 61 Kosten = 15,70
    expect(l.aktuell).toMatchObject({ vkNetto: 100, gewinn: 15.7 });
    expect(l.schnitt90!.gewinn).toBeLessThan(l.aktuell!.gewinn);
  });
});

describe("Abverkauf und Menge", () => {
  it("unser Anteil = Verkäufe ÷ (Angebote + 1), Menge für 30–45 Tage", () => {
    expect(abverkauf(100, 4, 60)).toEqual({ unsProMonat: 20, empfohlen: { von: 20, bis: 30 }, tage: 90 });
    expect(abverkauf(null, 4, 10)).toEqual({ unsProMonat: null, empfohlen: null, tage: null });
  });
});

describe("Ampel", () => {
  it("Abnahme: Rasierer mit EK 299,63 brutto bei Aktionspreisen 320–360 € und vielen Angeboten → Rot mit Begründung", () => {
    const ek = ekNettoAus(299.63, false);
    const de = rechneLand(markt({ land: "DE", vkEur: 329.99, vk90Eur: 349, tief12Eur: 319, verkaeufeMonat: 300, angebote: 24, amazonProzent: 40, aktionsmuster: "regelmäßige Tiefs um 320–360 €" }), geb, ek, 0);
    const fr = rechneLand(markt({ land: "FR", vkEur: 339, vk90Eur: 355, mwstSatz: 0.2, verkaeufeMonat: 80, angebote: 18 }), geb, ek, 0);
    const a = dealAmpel([de, fr], 50, DEAL_AMPEL_STANDARD);
    expect(["rot", "gelb"]).toContain(a.ampel);
    expect(a.ampel).toBe("rot");
    expect(a.rot.join(" ")).toMatch(/Marge beim 90-Tage-Mittel/);
    expect(a.bestes!.land).toBe("FR");
    // B20.2: zu viele Angebote sind kein Rot-Grund mehr, sondern Gelb.
    expect(a.gelb.join(" ")).toMatch(/18 Angebote \(mehr als 15\)/);
    expect(a.rot.join(" ")).not.toMatch(/Angebote/);
    expect(a.gelb.join(" ")).toMatch(/Aktionsmuster DE: regelmäßige Tiefs um 320–360 €/);
    expect(a.begruendung.split(". ").length).toBeGreaterThanOrEqual(2);
  });
  it("gute Marge, wenige Angebote, stabiler Preis, schneller Abverkauf → Grün", () => {
    const de = rechneLand(markt({ land: "DE", vkEur: 59.5, vk90Eur: 59.5, verkaeufeMonat: 200, angebote: 4, amazonProzent: 0 }), geb, 20, 0);
    const a = dealAmpel([de], 40, DEAL_AMPEL_STANDARD);
    expect(a.ampel).toBe("gruen");
    expect(a.abverkauf.empfohlen).toEqual({ von: 40, bis: 60 });
  });
  it("Preis gerade 12 % unter dem Mittel → Gelb; Amazon 85 % → Gelb, über 90 % → Rot (B20.2)", () => {
    const g = dealAmpel([rechneLand(markt({ land: "DE", vkEur: 52.8, vk90Eur: 60, verkaeufeMonat: 200, angebote: 3 }), geb, 20, 0)], 20, DEAL_AMPEL_STANDARD);
    expect(g.ampel).toBe("gelb");
    expect(g.gelb.join(" ")).toMatch(/12 % unter dem 90-Tage-Mittel/);
    const y = dealAmpel([rechneLand(markt({ land: "DE", vkEur: 60, vk90Eur: 60, verkaeufeMonat: 200, angebote: 3, amazonProzent: 85 }), geb, 20, 0)], 20, DEAL_AMPEL_STANDARD);
    expect(y.ampel).toBe("gelb");
    const r = dealAmpel([rechneLand(markt({ land: "DE", vkEur: 60, vk90Eur: 60, verkaeufeMonat: 200, angebote: 3, amazonProzent: 91 }), geb, 20, 0)], 20, DEAL_AMPEL_STANDARD);
    expect(r.ampel).toBe("rot");
    const g90 = dealAmpel([rechneLand(markt({ land: "DE", vkEur: 60, vk90Eur: 60, verkaeufeMonat: 200, angebote: 3, amazonProzent: 90 }), geb, 20, 0)], 20, DEAL_AMPEL_STANDARD);
    expect(g90.ampel).toBe("gelb");
  });
  it("B20.2: gute Marge, aber 40 Angebote → Gelb statt Rot (alle Quellen)", () => {
    const a = dealAmpel([rechneLand(markt({ land: "DE", vkEur: 59.5, vk90Eur: 59.5, verkaeufeMonat: 2000, angebote: 40, amazonProzent: 10 }), geb, 20, 0)], 10, DEAL_AMPEL_STANDARD);
    expect(a.ampel).toBe("gelb");
    expect(a.gelb.join(" ")).toMatch(/40 Angebote/);
  });
  it("ohne Marktdaten → Rot mit Grund", () => {
    const a = dealAmpel([rechneLand(markt({ land: "DE", fehler: "Keepa kennt die ASIN hier nicht." }), geb, 20, 0)], null, DEAL_AMPEL_STANDARD);
    expect(a).toMatchObject({ ampel: "rot", bestes: null });
    expect(a.begruendung).toMatch(/Keepa kennt die ASIN/);
  });
});

describe("Befunde 30.10. (B9)", () => {
  it("Gebühren je Land von Amazon statt Pauschale (Elektronik: 8 % statt 15 %)", () => {
    const pauschal = rechneLand(markt({ land: "DE", vkEur: 119, vk90Eur: 119 }), geb, 60, 0);
    const live = rechneLand(markt({ land: "DE", vkEur: 119, vk90Eur: 119, gebuehren: { provision: 0.08, fba: 3.2 } }), geb, 60, 0);
    expect(live.aktuell!.gewinn).toBeGreaterThan(pauschal.aktuell!.gewinn!);
    // 100 netto − 9,52 Provision − 3,20 FBA − 60 EK = 27,28
    expect(live.aktuell!.gewinn).toBeCloseTo(27.28, 1);
  });

  it("Verkäufe im besten Land unbekannt → aus DE über die Marktgröße geschätzt und gekennzeichnet", () => {
    expect(verkaeufeSchaetzen("ES", [{ land: "DE", verkaeufeMonat: 200 }, { land: "ES", verkaeufeMonat: null }])).toEqual({ wert: 70, aus: "DE" });
    expect(verkaeufeSchaetzen("ES", [{ land: "ES", verkaeufeMonat: null }])).toBeNull();
    const l = [rechneLand(markt({ land: "DE", vkEur: 100, vk90Eur: 100, verkaeufeMonat: 200, angebote: 4 }), geb, 30, 0), rechneLand(markt({ land: "ES", vkEur: 140, vk90Eur: 140, mwstSatz: 0.21, angebote: 4 }), geb, 30, 0)];
    const a = dealAmpel(l, 10, DEAL_AMPEL_STANDARD);
    expect(a.bestes?.land).toBe("ES");
    expect(a.verkaeufeGeschaetzt).toEqual({ wert: 70, aus: "DE" });
    expect(a.begruendung).toContain("geschätzt aus DE");
    expect(a.gelb.join(" ")).not.toContain("Verkäufe je Monat unbekannt");
  });

  it("hoher Amazon-Anteil in einem anderen Land → mindestens Gelb", () => {
    const l = [rechneLand(markt({ land: "DE", vkEur: 150, vk90Eur: 150, verkaeufeMonat: 300, angebote: 3, amazonProzent: 0 }), geb, 40, 0), rechneLand(markt({ land: "IT", vkEur: 120, vk90Eur: 120, mwstSatz: 0.22, verkaeufeMonat: 100, angebote: 3, amazonProzent: 84.7 }), geb, 40, 0)];
    const a = dealAmpel(l, 10, DEAL_AMPEL_STANDARD);
    expect(a.bestes?.land).toBe("DE");
    expect(a.ampel).not.toBe("gruen");
    expect(a.gelb.join(" ")).toContain("Amazon hält in IT die Buy Box 84,7 %");
  });
});
