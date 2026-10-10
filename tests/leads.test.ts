import { describe, expect, it } from "vitest";
import { brandMatches, brandSearchKey, brandSearchMatch, contactBlocker, isMarketplaceName, kendoFilter, looksLikePerson, mailLanguageFor, parseResearch, preAssess } from "@/lib/leads/logic";

describe("Großhändler finden – Vorab-Einschätzung", () => {
  it("Marke nur als ganzes Wort", () => {
    expect(brandMatches(["Wella Professionals"], "wella")).toBe(true);
    expect(brandMatches(["WELLA"], "Wella")).toBe(true);
    expect(brandMatches(["Testwella GmbH"], "wella")).toBe(false);
    expect(brandMatches(["Wellandia"], "wella")).toBe(false);
    expect(brandMatches(["L'Oréal Paris"], "loreal")).toBe(true);
  });

  it("Firma, Person, Salon, Marktplatz", () => {
    expect(looksLikePerson("Erika Mustermann")).toBe(true);
    expect(looksLikePerson("Muster Beauty Trading GmbH")).toBe(false);
    expect(looksLikePerson("Haarstudio Muster")).toBe(false);
    expect(isMarketplaceName("Amazon EU SARL")).toBe(true);
    expect(isMarketplaceName("Amazonas Kosmetik GmbH")).toBe(false);
  });

  it("Mehrmarken-Firma mit exakter Marke ganz oben", () => {
    const multi = preAssess({ companyName: "Muster Hair Cosmetics GmbH", brands: ["Wella", "Loreal", "Kao", "Redken", "GHD", "Revlon"], searchBrand: "Wella" });
    const part = preAssess({ companyName: "Bau Testwella GmbH", brands: ["Bau Testwella GmbH"], searchBrand: "Wella" });
    const person = preAssess({ companyName: "Erika Mustermann", brands: ["Wella"], searchBrand: "Wella" });
    const salon = preAssess({ companyName: "Classic Hair Damen und Herrensalon", brands: ["Wella"], searchBrand: "Wella" });
    const ended = preAssess({ companyName: "Muster Beauty Ltd", brands: ["Wella", "Kao", "Moroccanoil"], searchBrand: "Wella", registrationEnd: "04.04.2025" });
    expect(multi).toMatchObject({ kind: "haendler", exactBrand: true });
    expect(multi.score).toBeGreaterThanOrEqual(80);
    expect(part.exactBrand).toBe(false);
    expect(part.score).toBeLessThan(20);
    expect(person.kind).toBe("privat");
    expect(salon.kind).toBe("salon");
    expect(ended.score).toBeLessThan(multi.score);
    // Gekürzte Markenliste eines Großhändlers: fehlende Marke führt nicht zum Ausschluss.
    expect(preAssess({ companyName: "Riesen Beauty Wholesale GmbH", brands: ["Kao", "Redken", "GHD"], searchBrand: "Wella", brandsComplete: false }).exactBrand).toBeNull();
    expect(preAssess({ companyName: "Wella Testvertrieb GmbH", brands: ["Wella"], searchBrand: "Wella" }).kind).toBe("hersteller");
  });

  it("Sprache der Anfrage", () => {
    expect(mailLanguageFor("Deutschland")).toBe("de");
    expect(mailLanguageFor("Österreich")).toBe("de");
    expect(mailLanguageFor("Niederlande")).toBe("en");
  });

  it("nie anschreiben: Privatperson, ohne E-Mail, doppelt", () => {
    const base = { kind: "grosshandel" as const, email: "einkauf@example.com", mailedAt: null, status: "geprueft", registrationEnd: null };
    expect(contactBlocker(base)).toBeNull();
    expect(contactBlocker({ ...base, kind: "privat" })).toMatch(/Privatperson/);
    expect(contactBlocker({ ...base, email: "kein" })).toMatch(/E-Mail/);
    expect(contactBlocker({ ...base, mailedAt: new Date() })).toMatch(/schon/);
    expect(contactBlocker({ ...base, status: "kein_interesse" })).toMatch(/ausgeschlossen/);
  });

  it("KI-Antwort sauber lesen", () => {
    const r = parseResearch('Hier: {"website":"muster-beauty.example","email":"B2B@Muster-Beauty.example","kind":"grosshandel","wholesale":true,"sellsBrand":true,"b2bUrl":"https://muster-beauty.example/haendler","summary":"Großhändler für Friseurbedarf.","evidence":[{"label":"B2B-Shop","value":"Händlerregistrierung mit Gewerbenachweis","url":"https://muster-beauty.example/haendler"},{"label":"x"}]} Ende');
    expect(r).toMatchObject({ website: "https://muster-beauty.example/", email: "b2b@muster-beauty.example", kind: "grosshandel", wholesale: true });
    expect(r!.evidence).toHaveLength(1);
    expect(parseResearch("kein json")).toBeNull();
    expect(parseResearch('{"kind":"quatsch","wholesale":true,"email":"null"}')).toMatchObject({ kind: "grosshandel", email: null });
  });

  it("Registerfilter", () => {
    expect(kendoFilter({ Brand: "Wella", CompanyName: "" })).toBe("Brand~contains~'Wella'");
    expect(kendoFilter({ Brand: "L'Oréal" })).toBe("Brand~contains~'L''Oréal'");
  });
});

describe("Markensuche in der Kontaktliste", () => {
  it("Wortanfang, zusammengeschrieben, ohne Groß/Klein und Akzente", () => {
    expect(brandSearchMatch("AIRHEADS", "airheads")).toBe(true);
    expect(brandSearchMatch("Airheads Xtremes", "airhead")).toBe(true);
    expect(brandSearchMatch("Air Heads", "airheads")).toBe(true);
    expect(brandSearchMatch("AirHeads", "air heads")).toBe(true);
    expect(brandSearchMatch("Hugo Boss", "boss")).toBe(true);
    expect(brandSearchMatch("Müller Milch", "muller")).toBe(true);
    expect(brandSearchMatch("Pawella", "wella")).toBe(false);
    expect(brandSearchMatch("Warheads", "airheads")).toBe(false);
    expect(brandSearchMatch("Airheads", "")).toBe(false);
  });
  it("Treffer aus Markenliste, gesuchten Marken und Fundstellen", async () => {
    const { leadBrandHits } = await import("@/lib/leads/logic");
    expect(leadBrandHits({ brands: ["T-Rex", "AIRHEADS", "Airheads Xtremes"], searchBrands: [], findings: [] }, "airheads")).toEqual(["AIRHEADS", "Airheads Xtremes"]);
    expect(leadBrandHits({ brands: null, searchBrands: ["Airheads"], findings: [{ brand: "Airheads" }] }, "airheads")).toEqual(["Airheads"]);
    expect(leadBrandHits({ brands: ["Wella"], searchBrands: ["Wella"], findings: [] }, "airheads")).toEqual([]);
    expect(brandSearchKey("Air-Heads®")).toBe("airheads");
    expect(brandSearchKey("Großmann")).toBe("grosmann");
  });
});
