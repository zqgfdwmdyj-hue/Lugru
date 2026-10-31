import { describe, expect, it } from "vitest";
import { DEAL_AMPEL_STANDARD } from "@/lib/deal-ampel/logic";
import { wertSchwelleFuer, wertSchwellenLesen } from "@/lib/deal-eingang/logic";
import { kategorieAus } from "@/lib/keepa/auswertung";
import { reaktionenVon, NUR_KAUFZEICHEN, lugruStatistik } from "@/lib/lugru-deals/auswertung-logic";
import { gebuehrenAusPost, historienRef, historienZeile, istTestKanal, kanalName, landAus, HISTORIE_HINWEIS, type HistorienDeal } from "@/lib/lugru-deals/historie-logic";

// B19.1 mit erfundenen Zahlen: alte Lugru-Deals bekommen eine Ampel nach den Regeln der Deal-Ampel, Kanäle werden
// getrimmt, Testkanäle erkannt, Reaktionen ehrlich angezeigt, Deal-Wert-Schwelle je Quelle.

const jetzt = new Date("2026-10-31T12:00:00Z");
const pauschal = { provision: 0.15, fba: 3.5 };
const keepa = { stand: "2026-10-01T00:00:00Z", art: "verlauf" as const, buyBox: 40, buyBox30: 40, buyBox90: 41, buyBox180: 40, einbrueche12: 0, angebote: 6, angeboteTrend30: 0, amazonAnteil: 0, rang: 1200, gekauftImMonat: 300, marke: "Erfundo", kategorie: "Küche" };
const deal = (x: Partial<HistorienDeal> = {}): HistorienDeal => ({ asin: "B0TEST0001", titel: "Erfundo Pfanne 28 cm", quellmarkt: "DE", zielmarkt: "DE", ekEur: 15, ekNetto: true, vkEur: 40, gewinnEur: 12, margeProzent: 35, verkaeufeMonat: 300, shop: "Testshop", kanal: "A Deals", gepostetAm: new Date("2026-10-01T10:00:00Z"), keepa, ...x });

describe("Lugru-History → Deal-Eingang", () => {
  it("Marktplatz aus dem Post", () => {
    expect(landAus("Amazon.fr")).toBe("FR");
    expect(landAus("amazon.co.uk")).toBe("UK");
    expect(landAus("IT")).toBe("IT");
    expect(landAus("irgendwas")).toBe("DE");
    expect(landAus(null)).toBe("DE");
  });

  it("Kanalnamen getrimmt, Testkanäle erkannt", () => {
    expect(kanalName("B low Marge ")).toBe("B low Marge");
    expect(kanalName("  A   Deals ")).toBe("A Deals");
    expect(kanalName("   ")).toBeNull();
    expect(istTestKanal("test")).toBe(true);
    expect(istTestKanal("test1")).toBe(true);
    expect(istTestKanal(" Test 2 ")).toBe(true);
    expect(istTestKanal("testdeals")).toBe(false);
    expect(istTestKanal("A Deals")).toBe(false);
  });

  it("Gebühren aus dem Gewinn im Post: bei VK 40 / EK 15 / Gewinn 12 → 15 % Provision + 0,61 € fest", () => {
    const g = gebuehrenAusPost({ vk: 40, mwst: 0.19, gewinn: 12, ekNetto: 15 }, pauschal);
    expect(g.ausPost).toBe(true);
    expect(g.provision).toBe(0.15);
    expect(g.fba).toBeCloseTo(0.61, 2);
    // ohne Gewinn im Post: Pauschale
    expect(gebuehrenAusPost({ vk: 40, mwst: 0.19, gewinn: null, ekNetto: 15 }, pauschal)).toEqual({ ...pauschal, ausPost: false });
  });

  it("guter Deal mit Keepa-Stand → grün, Gewinn wie im Post, Hinweis „Historie“", () => {
    const z = historienZeile(deal(), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt });
    expect(z.ampel).toBe("gruen");
    expect(z.bestesLand).toBe("DE");
    expect(z.laender[0].gewinnAktuell).toBeCloseTo(12, 1);
    expect(z.gewinn).toBeGreaterThan(12); // beim 90-Tage-Mittel (41 €) etwas mehr
    expect(z.angebote).toBe(6);
    expect(z.hinweise[0]).toBe(HISTORIE_HINWEIS);
    expect(z.angebot.marke).toBe("Erfundo");
    expect(z.maxEk[0].land).toBe("DE");
  });

  it("dünne Marge → rot nach der Regel „Marge beim 90-Tage-Mittel unter Ziel“", () => {
    const z = historienZeile(deal({ ekEur: 20, ekNetto: false, vkEur: 25, gewinnEur: 1, keepa: { ...keepa, buyBox: 25, buyBox90: 25 } }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt });
    expect(z.ampel).toBe("rot");
    expect(z.gruende[0]).toMatch(/Marge beim 90-Tage-Mittel/);
  });

  it("B20.2: zu viele Angebote → gelb; Amazon über 90 % in der Buy Box → rot, 90 % genau → gelb", () => {
    const viele = historienZeile(deal({ keepa: { ...keepa, angebote: 30 } }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt });
    expect(viele.ampel).toBe("gelb");
    expect(viele.gruende.join(" ")).toMatch(/30 Angebote/);
    expect(viele.regeln).toBe(2);
    expect(historienZeile(deal({ keepa: { ...keepa, amazonAnteil: 95 } }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt }).ampel).toBe("rot");
    expect(historienZeile(deal({ keepa: { ...keepa, amazonAnteil: 90 } }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt }).ampel).toBe("gelb");
  });

  it("B20.2: Marge aus dem Post gerundet (11,1 % statt 11,136491 %)", () => {
    const z = historienZeile(deal({ margeProzent: 11.136491 }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt });
    expect(z.hinweise.join(" ")).toContain("Marge 11,1 %");
    expect(z.hinweise.join(" ")).not.toContain("11,136491");
  });

  it("ohne Keepa-Stand höchstens gelb, ohne EK rot mit Grund", () => {
    const ohneKeepa = historienZeile(deal({ keepa: null }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt });
    expect(ohneKeepa.ampel).toBe("gelb");
    expect(ohneKeepa.gruende.join(" ")).toMatch(/Kein Keepa-Stand/);
    const ohneEk = historienZeile(deal({ ekEur: null }), DEAL_AMPEL_STANDARD, { pauschal, zielRoi: 20, jetzt });
    expect(ohneEk.ampel).toBe("rot");
    expect(ohneEk.gruende[0]).toMatch(/kein EK im Post/);
  });

  it("Kennung wie beim Live-Eingang (keine Dubletten)", () => {
    expect(historienRef({ discordNachrichtId: "123456789012345678", externId: 5, id: "x" })).toBe("lugru:123456789012345678");
    expect(historienRef({ discordNachrichtId: null, externId: 42, id: "x" })).toBe("lugru-app:42");
  });
});

describe("Reaktionen ehrlich, Statistik", () => {
  it("Weg A: statt {} genau ✅ und ❌ mit Hinweis; Discord: wie gezählt", () => {
    expect(reaktionenVon({ reaktionen: {}, quelle: "app", kaeufe: 7, nichtVerfuegbar: 2 })).toEqual({ reaktionen: { "✅": 7, "❌": 2 }, nurKaufzeichen: true });
    expect(reaktionenVon({ reaktionen: { "✅": 3, "🔥": 1 }, quelle: "discord", kaeufe: 3, nichtVerfuegbar: 0 })).toEqual({ reaktionen: { "✅": 3, "🔥": 1 }, nurKaufzeichen: false });
    expect(reaktionenVon({ reaktionen: {}, quelle: "discord", kaeufe: 0, nichtVerfuegbar: 0 }).reaktionen).toEqual({});
    expect(NUR_KAUFZEICHEN).toMatch(/nur ✅/);
  });

  it("Statistik zählt die Emojis aus Weg A und nennt den Zeitraum", () => {
    const von = new Date("2026-08-02T00:00:00Z");
    const bis = new Date("2026-10-31T23:59:59Z");
    const s = lugruStatistik(
      [
        { gepostetAm: new Date("2026-10-01T10:00:00Z"), kanal: "A Deals", ampel: "gruen", reaktionen: reaktionenVon({ reaktionen: {}, quelle: "app", kaeufe: 5, nichtVerfuegbar: 1 }).reaktionen, kaeufe: 5, gekauft: false, realerRoi: null, marke: "Erfundo", kategorie: "Küche", titel: null },
        { gepostetAm: new Date("2026-10-02T10:00:00Z"), kanal: "A Deals", ampel: "rot", reaktionen: reaktionenVon({ reaktionen: {}, quelle: "app", kaeufe: 1, nichtVerfuegbar: 0 }).reaktionen, kaeufe: 1, gekauft: false, realerRoi: null, marke: "Erfundo", kategorie: "Küche", titel: null },
      ],
      von,
      bis,
    );
    expect(s.zeitraum).toEqual({ von: "2026-08-02", bis: "2026-10-31" });
    expect(s.emojis).toEqual([{ emoji: "✅", anzahl: 6 }, { emoji: "❌", anzahl: 1 }]);
    expect(s.reaktionenSumme).toBe(7);
    expect(s.besteKategorien[0]).toMatchObject({ name: "Küche", deals: 2 });
  });
});

describe("Keepa-Kategorie und Deal-Wert-Schwelle je Quelle", () => {
  it("oberste Kategorie aus categoryTree", () => {
    expect(kategorieAus([{ catId: 1, name: "Küche, Haushalt & Wohnen" }, { catId: 2, name: "Pfannen" }])).toBe("Küche, Haushalt & Wohnen");
    expect(kategorieAus(null)).toBeNull();
    expect(kategorieAus([])).toBeNull();
  });

  it("Lugru Deals=60 gilt für alle Lugru-Kanäle, sonst die allgemeine Schwelle", () => {
    const s = { wertSchwelle: 70, wertSchwelleJe: wertSchwellenLesen("Lugru Deals=60; ProfitPath · Modul A: 65; kaputt") };
    expect(s.wertSchwelleJe).toEqual({ "Lugru Deals": 60, "ProfitPath · Modul A": 65 });
    expect(wertSchwelleFuer("Lugru Deals · #A Deals", s)).toBe(60);
    expect(wertSchwelleFuer("Lugru Deals", s)).toBe(60);
    expect(wertSchwelleFuer("ProfitPath · Modul A", s)).toBe(65);
    expect(wertSchwelleFuer("Konrad", s)).toBe(70);
    expect(wertSchwelleFuer(null, s)).toBe(70);
    expect(wertSchwelleFuer("x", {})).toBe(70);
  });
});
