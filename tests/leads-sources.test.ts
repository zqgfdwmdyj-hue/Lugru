import { describe, expect, it } from "vitest";
import { assessFinding, countryName, lucidFailureMessage, mailLanguageFor, nameKey, parseAddressLines, parseDistributors, parseLucidPayload } from "@/lib/leads/logic";
import { lucidBookmarkletSource } from "@/lib/leads/lucid-bookmarklet";

describe("Weitere Quellen – Firmen zusammenführen", () => {
  it("gleiche Firma trotz Rechtsform und Schreibweise", () => {
    expect(nameKey("Muster Beauty Handels GmbH & Co. KG")).toBe(nameKey("MUSTER BEAUTY HANDELS GMBH"));
    expect(nameKey("Beispiel Distribution B.V.")).toBe(nameKey("Beispiel Distribution BV"));
    expect(nameKey("Café Großhandel e.K.")).toBe("cafe grosshandel");
    expect(nameKey("Muster Beauty GmbH")).not.toBe(nameKey("Muster Hair GmbH"));
  });

  it("Adresse aus Keepa-Zeilen", () => {
    expect(parseAddressLines(["Muster Beauty GmbH", "Teststraße 12", "12345 Teststadt", "DE"], "Muster Beauty GmbH")).toEqual({ street: "Teststraße 12", zip: "12345", city: "Teststadt", country: "Deutschland" });
    expect(parseAddressLines(["Weg 3", "A-1010 Wien", "AT"])).toEqual({ street: "Weg 3", zip: "1010", city: "Wien", country: "Österreich" });
    expect(parseAddressLines(["Keizersgracht 1", "1015 CJ Amsterdam", "NL"])).toMatchObject({ zip: "1015 CJ", city: "Amsterdam", country: "Niederlande" });
    expect(parseAddressLines(null)).toEqual({ street: null, zip: null, city: null, country: null });
    expect(countryName("de")).toBe("Deutschland");
    expect(countryName("Frankreich")).toBe("Frankreich");
    expect(mailLanguageFor("AT")).toBe("de");
    expect(mailLanguageFor("NL")).toBe("en");
  });
});

describe("Weitere Quellen – Einschätzung", () => {
  it("Amazon-Verkäufer mit vielen Produkten der Marke", () => {
    const a = assessFinding({ companyName: "Muster Beauty Handels GmbH", source: "amazon", offers: 7, email: "einkauf@muster.example", searchBrand: "Wella" });
    expect(a.kind).toBe("haendler");
    expect(a.score).toBeGreaterThanOrEqual(65);
    expect(a.reasons[0]).toMatch(/7 Produkte der Marke auf Amazon/);
  });
  it("GPSR: EU-Verantwortlicher höher als Hersteller", () => {
    const resp = assessFinding({ companyName: "Import Test GmbH", source: "gpsr", role: "responsible", searchBrand: "Wella" });
    const man = assessFinding({ companyName: "Wella Germany GmbH", source: "gpsr", role: "manufacturer", searchBrand: "Wella" });
    expect(resp.score).toBeGreaterThan(man.score);
    expect(man.kind).toBe("hersteller");
    expect(resp.reasons.join()).toMatch(/Importeur/);
  });
  it("Privatperson und Marktplatz", () => {
    expect(assessFinding({ companyName: "Erika Mustermann", source: "ebay", offers: 2, searchBrand: "Wella" }).kind).toBe("privat");
    expect(assessFinding({ companyName: "Amazon EU SARL", source: "web", role: "retailer", searchBrand: "Wella" }).kind).toBe("marktplatz");
  });
  it("Websuche: Distributor", () => {
    const a = assessFinding({ companyName: "Beauty Distribution Test GmbH", source: "web", role: "distributor", searchBrand: "Wella" });
    expect(a.kind).toBe("grosshandel");
  });
});

describe("Weitere Quellen – Auswertung", () => {
  it("Distributoren aus der KI-Antwort", () => {
    const list = parseDistributors(`Hier die Ergebnisse:\n{"companies":[{"name":"Beauty Distribution Test GmbH","role":"distributor","website":"beauty-dist.example","email":"B2B@Beauty-Dist.example","country":"DE","note":"Offizieller Distributor","sourceUrl":"https://marke.example/distributors"},{"name":"Beauty Distribution Test GmbH","role":"wholesaler"},{"name":"Nur Name","role":"quatsch","email":"keine-mail"}]}`);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ website: "https://beauty-dist.example/", email: "b2b@beauty-dist.example", country: "Deutschland", role: "distributor", url: "https://marke.example/distributors" });
    expect(list[1]).toMatchObject({ name: "Nur Name", role: null, email: null });
    expect(parseDistributors("keine Daten")).toEqual([]);
  });

  it("Register-Daten aus dem Browser prüfen", () => {
    const ok = parseLucidPayload(JSON.stringify({ lucidImport: 1, brand: " Wella ", total: 3, producers: [
      { ManufacturerId: "m-1", CompanyName: "Muster Hair GmbH", ZipCode: 12345, brands: ["Wella", "Kao", 5, "Wella"], brandsComplete: true },
      { ManufacturerId: "", CompanyName: "ohne Kennung" },
      { ManufacturerId: "m-3", CompanyName: "Ohne Marken GmbH", brands: null, brandsComplete: false },
    ] }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.brand).toBe("Wella");
    expect(ok.total).toBe(3);
    expect(ok.producers).toHaveLength(2);
    expect(ok.producers[0]).toMatchObject({ ZipCode: "12345", brands: ["Wella", "Kao"], brandsComplete: true });
    expect(ok.producers[1]).toMatchObject({ brands: null, brandsComplete: false });
    expect(parseLucidPayload("{}").ok).toBe(false);
    expect(parseLucidPayload("kaputt").ok).toBe(false);
    expect(parseLucidPayload(JSON.stringify({ lucidImport: 1, brand: "W", producers: [] })).ok).toBe(false);
  });
});

describe("Verpackungsregister nicht erreichbar", () => {
  it("klare Meldung mit Ausweg", () => {
    expect(lucidFailureMessage(403)).toMatch(/lehnt Anfragen von diesem Server ab \(HTTP 403\).*Browser/);
    expect(lucidFailureMessage(503)).toMatch(/drosselt gerade die Anfragen dieses Servers \(HTTP 503\)/);
    expect(lucidFailureMessage(502)).toMatch(/Serverfehler \(HTTP 502\)/);
    expect(lucidFailureMessage(null, Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } }))).toMatch(/Zeitüberschreitung/);
    expect(lucidFailureMessage(null, Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toMatch(/DNS/);
  });
  it("Lesezeichen ist gültiges JavaScript und kennt das Seller-System", () => {
    const src = lucidBookmarkletSource("https://lugruseller.example");
    expect(() => new Function(src.replace(/\n/g, ""))).not.toThrow();
    expect(src).toContain('var O="https://lugruseller.example"');
    expect(src).toContain("/Producer/ManufacturerRead");
    expect(src).not.toMatch(/__ORIGIN__/);
  });
});
