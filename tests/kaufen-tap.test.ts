import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/next-path";
import { amazonProfil, gutscheinAus, istAmazon, kaufLink, kaufMenge, kaufNrGueltig, kaufNummerFrei, monatsrahmenText, profileZusammen, profilFuer, shopLinkAus, STANDARD_SHOPS, type ShopProfil } from "@/lib/deal-eingang/shop-logic";

// Kaufen mit einem Tap · Shop-Profile – reine Logik mit erfundenen ASINs, Shops und Codes.

describe("Warenkorb-Link (Amazon) je Land", () => {
  it("amazon.de/.fr/.it/.es mit ASIN und Menge; Produktseite als Rückfall", () => {
    const de = amazonProfil("DE", STANDARD_SHOPS)!;
    expect(kaufLink(de, { asin: "B0TESTKT01", menge: 4, produktUrl: null })).toEqual({
      url: "https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=B0TESTKT01&Quantity.1=4",
      fallbackUrl: "https://www.amazon.de/dp/B0TESTKT01",
      art: "warenkorb_link",
      warenkorb: true,
      hinweis: null,
    });
    for (const [land, tld] of [["FR", "fr"], ["IT", "it"], ["ES", "es"]]) expect(kaufLink(amazonProfil(land, STANDARD_SHOPS)!, { asin: "B0TESTKT01", menge: 2, produktUrl: null })?.url).toBe(`https://www.amazon.${tld}/gp/aws/cart/add.html?ASIN.1=B0TESTKT01&Quantity.1=2`);
  });
  it("ohne ASIN kein Warenkorb-Link; Amazon auf „Produktseite“ umgestellt → Produktseite mit Menge-Hinweis", () => {
    const de = amazonProfil("DE", STANDARD_SHOPS)!;
    expect(kaufLink(de, { asin: null, menge: 4, produktUrl: null })).toBeNull();
    const umgestellt = profileZusammen([{ ...de, linkArt: "produktseite", linkMuster: null }]);
    const l = kaufLink(amazonProfil("DE", umgestellt)!, { asin: "B0TESTKT01", menge: 4, produktUrl: null })!;
    expect(l).toMatchObject({ url: "https://www.amazon.de/dp/B0TESTKT01", warenkorb: false, art: "produktseite" });
    expect(l.hinweis).toBe("Menge 4 auf der Seite wählen");
  });
});

describe("Shop-Profile", () => {
  it("Domain (auch Unterdomain/www) → Profil; Nicht-Amazon = Produktseite + Hinweis, ehrlich kein Warenkorb", () => {
    const p = profilFuer("https://www.mediamarkt.de/de/product/_test-123.html", STANDARD_SHOPS)!;
    expect(p.kuerzel).toBe("MEDIA");
    expect(istAmazon(p)).toBe(false);
    const l = kaufLink(p, { asin: "B0TESTKT02", menge: 3, produktUrl: "https://www.mediamarkt.de/de/product/_test-123.html" })!;
    expect(l).toMatchObject({ url: "https://www.mediamarkt.de/de/product/_test-123.html", warenkorb: false, hinweis: "Menge 3 auf der Seite wählen" });
    expect(profilFuer("shop.notino.de", STANDARD_SHOPS)?.kuerzel).toBe("NOTIN");
    expect(profilFuer("https://unbekannt.example.test/x", STANDARD_SHOPS)).toBeNull();
    expect(STANDARD_SHOPS.map((s) => s.kuerzel)).toEqual(expect.arrayContaining(["AMZDE", "AMZFR", "AMZIT", "AMZES", "MEDIA", "NOTIN", "DOUGL", "FLACO", "MUELL", "PARFU"]));
  });
  it("eigenes Profil überschreibt das Start-Profil; Shopify-Muster mit unbekannter Variante → Produktseite", () => {
    const eigen: ShopProfil = { kuerzel: "tests", name: "Testshop", domains: ["testshop.example.test"], linkArt: "warenkorb_link", linkMuster: "https://testshop.example.test/cart/{variante}:{menge}", hinweis: "Gutschein im Warenkorb", payback: "Karte an der Kasse", aktiv: true };
    const alle = profileZusammen([eigen, { ...STANDARD_SHOPS.find((s) => s.kuerzel === "DOUGL")!, hinweis: "Versand ab 2 Stk frei" }]);
    expect(alle.find((p) => p.kuerzel === "DOUGL")?.hinweis).toBe("Versand ab 2 Stk frei");
    const p = profilFuer("https://testshop.example.test/p/1", alle)!;
    expect(p.kuerzel).toBe("TESTS");
    expect(kaufLink(p, { asin: null, menge: 2, produktUrl: "https://testshop.example.test/p/1" })).toMatchObject({ url: "https://testshop.example.test/p/1", art: "produktseite", hinweis: "Menge 2 auf der Seite wählen · Gutschein im Warenkorb" });
    // Inaktive Profile zählen nicht
    expect(profilFuer("https://testshop.example.test/p/1", profileZusammen([{ ...eigen, aktiv: false }]))).toBeNull();
  });
  it("erster Shop-Link der Nachricht ohne Amazon/Discord/Keepa/Werkzeuge", () => {
    expect(shopLinkAus("VK https://www.amazon.de/dp/B0TESTKT01 · Keepa https://keepa.com/x · Shop: https://www.flaconi.de/p/test-1. Ende")).toBe("https://www.flaconi.de/p/test-1");
    expect(shopLinkAus("nur https://www.amazon.fr/dp/B0TESTKT01")).toBeNull();
  });
});

describe("Menge, Gutschein, Kauf-Nummer, Monatsrahmen", () => {
  it("Menge = Empfehlung, begrenzt durch max. Stück und Budget je Deal (0 = keine Grenze), mindestens 1", () => {
    expect(kaufMenge(6, { maxMenge: 4 })).toBe(4);
    expect(kaufMenge(6, { budgetJeDeal: 0, ekNetto: 299 })).toBe(6);
    expect(kaufMenge(6, { budgetJeDeal: 1000, ekNetto: 299 })).toBe(3);
    expect(kaufMenge(null)).toBe(1);
    expect(kaufMenge(5, { budgetJeDeal: 100, ekNetto: 299 })).toBe(1);
  });
  it("Gutscheincode aus dem Post – Großbuchstaben/Ziffern, keine Füllwörter", () => {
    expect(gutscheinAus("🔥 Code: BLACK10 im Warenkorb")).toBe("BLACK10");
    expect(gutscheinAus("Gutscheincode „TESTX25“ gilt bis Sonntag")).toBe("TESTX25");
    expect(gutscheinAus("Coupon im Warenkorb aktivieren")).toBeNull();
    expect(gutscheinAus("Code im Warenkorb, kein Gutschein nötig")).toBeNull();
  });
  it("Kauf-Nummer: kleinste freie, 24 Std. gültig", () => {
    expect(kaufNummerFrei([1, 2, 4])).toBe(3);
    expect(kaufNummerFrei([])).toBe(1);
    const jetzt = new Date("2026-11-01T12:00:00Z");
    expect(kaufNrGueltig("2026-10-31T12:30:00Z", jetzt)).toBe(true);
    expect(kaufNrGueltig("2026-10-31T11:59:00Z", jetzt)).toBe(false);
    expect(kaufNrGueltig(null, jetzt)).toBe(false);
  });
  it("Monatsrahmen nur als Orientierung", () => {
    expect(monatsrahmenText(83_400, 150_000)).toBe("diesen Monat eingekauft: 83.400 € von ~150.000 €");
    expect(monatsrahmenText(151_000, 150_000)).toBe("diesen Monat eingekauft: 151.000 € von ~150.000 € (Rahmen überschritten – nur Hinweis)");
    expect(monatsrahmenText(500, 0)).toBe("diesen Monat eingekauft: 500 €");
  });
  it("Nach dem Login zurück zum Kauf-Kurzlink, sonst kein offener Weiterleiter", () => {
    expect(safeNext("/k/17")).toBe("/k/17");
    expect(safeNext("/k/17?code=1")).toBe("/k/17?code=1");
    expect(safeNext("/k/17?weiter=https://evil.example")).toBeNull();
    expect(safeNext("/k/../admin")).toBeNull();
  });
});
