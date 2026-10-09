import { describe, expect, it } from "vitest";
import { followUpMail, leadColumn, needsFollowUp, taskColumn } from "@/lib/board/logic";
import { assessFinding, countryName, lucidFailureMessage, mailLanguageFor, nameKey, noRegisterHit, parseAddressLines, parseDistributors, parseLucidPayload, priorContact } from "@/lib/leads/logic";
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

describe("Nicht doppelt anschreiben", () => {
  const sent = { id: "a", companyName: "Muster Beauty Handels GmbH", email: "einkauf@muster-beauty.example", website: "https://www.muster-beauty.example/", mailedAt: new Date("2026-10-01T10:00:00Z"), mailedTo: "einkauf@muster-beauty.example", searchBrands: ["Wella"] };
  const lead = (o: Partial<{ id: string; companyName: string; email: string | null; website: string | null; supplierId: string | null }>) => ({ id: "b", companyName: "Andere Firma GmbH", email: null, website: null, ...o });
  it("gleiche Firma über eine andere Marke/Quelle", () => {
    expect(priorContact(lead({ companyName: "MUSTER BEAUTY HANDELS GMBH & CO. KG" }), [sent])).toMatch(/schon angeschrieben am 01\.10\.2026 als „Muster Beauty Handels GmbH“ \(Wella\) – gleicher Firmenname/);
    expect(priorContact(lead({ email: "Einkauf@Muster-Beauty.example" }), [sent])).toMatch(/gleiche E-Mail-Adresse/);
    expect(priorContact(lead({ email: "info@muster-beauty.example" }), [sent])).toMatch(/gleiche Firmen-Domain \(@muster-beauty\.example\)/);
    expect(priorContact(lead({ website: "https://muster-beauty.example/b2b" }), [sent])).toMatch(/gleiche Website/);
  });
  it("Freemailer und eigener Eintrag zählen nicht", () => {
    const gmail = { ...sent, companyName: "Irgendwer GmbH", website: null, email: "a@gmail.com", mailedTo: "a@gmail.com" };
    expect(priorContact(lead({ email: "b@gmail.com" }), [gmail])).toBeNull();
    expect(priorContact({ ...sent, id: "a" }, [sent])).toBeNull();
    expect(priorContact(lead({ companyName: "Muster Beauty Handels GmbH" }), [{ ...sent, mailedAt: null }])).toBeNull();
  });
  it("schon Lieferant", () => {
    expect(priorContact(lead({ companyName: "Großhandel Test GmbH" }), [], ["Grosshandel Test GmbH"])).toMatch(/schon als Lieferant angelegt/);
    expect(priorContact(lead({ companyName: "Großhandel Test GmbH", supplierId: "s1" }), [], ["Grosshandel Test GmbH"])).toBeNull();
  });
});

describe("Board", () => {
  it("Spalten der Großhändler-Pipeline", () => {
    expect(leadColumn({ status: "neu", kind: "unklar", onBoard: false })).toBeNull();
    expect(leadColumn({ status: "geprueft", kind: "grosshandel", onBoard: false })).toBe("kontakt");
    expect(leadColumn({ status: "neu", kind: "haendler", onBoard: true })).toBe("kontakt");
    expect(leadColumn({ status: "entwurf", kind: "haendler", onBoard: false })).toBe("kontakt");
    expect(leadColumn({ status: "kein_interesse", kind: "grosshandel", onBoard: false })).toBe("nix");
    expect(leadColumn({ status: "ausgeschlossen", kind: "grosshandel", onBoard: true })).toBeNull();
  });
  it("Follow-up nach 7 Tagen ohne Antwort", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(needsFollowUp({ status: "angeschrieben", mailedAt: new Date("2026-10-12T12:00:00Z"), repliedAt: null }, now)).toBe(true);
    expect(needsFollowUp({ status: "angeschrieben", mailedAt: new Date("2026-10-15T12:00:00Z"), repliedAt: null }, now)).toBe(false);
    expect(needsFollowUp({ status: "angeschrieben", mailedAt: new Date("2026-10-01T12:00:00Z"), repliedAt: new Date() }, now)).toBe(false);
  });
  it("Nachfass-Mail mit Zitat", () => {
    const m = followUpMail({ mailSubject: "Anfrage Händlerkonditionen Wella", mailBody: "Guten Tag,\\nwir sind …", mailedAt: new Date("2026-10-01T10:00:00Z"), mailLanguage: "de" });
    expect(m.subject).toBe("AW: Anfrage Händlerkonditionen Wella");
    expect(m.body).toMatch(/Anfrage vom 01\.10\.2026/);
    expect(m.body).toMatch(/> Guten Tag,/);
    expect(followUpMail({ mailSubject: "Re: Inquiry", mailBody: "", mailedAt: null, mailLanguage: "en" }).subject).toBe("Re: Inquiry");
  });
  it("Aufgaben-Spalten", () => {
    expect(taskColumn({ status: "done", boardColumn: "in_arbeit" })).toBe("erledigt");
    expect(taskColumn({ status: "open", boardColumn: "warten" })).toBe("warten");
    expect(taskColumn({ status: "open", boardColumn: null })).toBe("offen");
  });
});

describe("Register ohne Treffer", () => {
  it("schlägt bei mehrteiligen Marken einen Teil vor", () => {
    expect(noRegisterHit("Hugo Boss")).toBe("Keine Einträge zu „Hugo Boss“ im Verpackungsregister. Im Register ist die Marke oft anders gemeldet – mit einem Teil suchen, z. B. „Hugo“.");
    expect(noRegisterHit("Wella")).toMatch(/Schreibweise prüfen oder eine andere Quelle/);
  });
});
