import { describe, expect, it } from "vitest";
import { adelprepVorschlag, EMAIL_QUELLE_APIFY, leadsAusTabelle, mailErlaubt, quelleDatumAus, quelleErkennen, quelleSperre, stueckZahl } from "@/lib/abverkauf/logic";

// B34.3c Lead-Beschaffung Stufe 1 – nur erfundene Werte (Testfirmen, example.invalid).

const APIFY_KOPF = ["title", "categoryName", "address", "street", "city", "postalCode", "countryCode", "website", "phone", "emails/0", "location/lat", "location/lng", "placeId", "scrapedAt"];
const apifyZeile = (i: number, mail = `info${i}@example.invalid`) => [`Testsalon ${i} GmbH`, "Friseur", `Testweg ${i}, 12345 Musterstadt`, `Testweg ${i}`, "Musterstadt", "12345", "DE", `https://testsalon${i}.example.invalid`, "+49 000 000", mail, "48.1", "11.5", `ChIJtest${i}`, "2026-11-08T10:15:00.000Z"];

describe("B34.3c Quelle erkennen, Datum, Stückzahl", () => {
  it("Apify-Export an Spalten oder Dateiname, sonst LUCID/Keepa/Helium 10/CSV", () => {
    expect(quelleErkennen(APIFY_KOPF, "leads.csv")).toEqual({ typ: "apify", name: "Apify-Export (leads.csv)" });
    expect(quelleErkennen(["Firma", "PLZ", "Ort"], "dataset_google-maps_2026.csv").typ).toBe("apify");
    expect(quelleErkennen(["Registrierungsnummer", "Name", "PLZ", "Ort"], "export.csv").typ).toBe("lucid");
    expect(quelleErkennen(["Firma", "PLZ", "Ort"], "Keepa_Seller.csv").typ).toBe("keepa");
    expect(quelleErkennen(["Firma", "PLZ", "Ort"], "helium10-xray.csv").typ).toBe("helium10");
    expect(quelleErkennen(["Firma", "PLZ", "Ort"], "haendler.csv")).toEqual({ typ: "csv", name: "CSV-Import (haendler.csv)" });
  });
  it("Datum aus „scrapedAt“ bzw. „Datum“ (jüngstes), sonst null", () => {
    expect(quelleDatumAus(APIFY_KOPF, [apifyZeile(1), [...apifyZeile(2).slice(0, 13), "2026-11-09T08:00:00Z"]])).toBe("2026-11-09");
    expect(quelleDatumAus(["Firma", "Datum"], [["A", "07.11.2026"]])).toBe("2026-11-07");
    expect(quelleDatumAus(["Firma"], [["A"]])).toBeNull();
  });
  it("Stückzahl lesen", () => {
    expect(stueckZahl("1.200")).toBe(1200);
    expect(stueckZahl("85")).toBe(85);
    expect(stueckZahl("85,6")).toBe(86);
    expect(stueckZahl("")).toBeNull();
    expect(stueckZahl("viel")).toBeNull();
  });
});

describe("B34.3c Apify-Import: E-Mail gespeichert (Quelle Impressum), Mail-Weg gesperrt", () => {
  it("Apify-Spalten werden gelesen, E-Mail mit Quelle „Impressum (Website, Apify-Export)“", () => {
    const r = leadsAusTabelle(APIFY_KOPF, [apifyZeile(1), apifyZeile(2)], { typ: "apify" });
    expect(r.verworfen).toEqual([]);
    expect(r.leads).toHaveLength(2);
    expect(r.leads[0]).toMatchObject({ firma: "Testsalon 1 GmbH", plz: "12345", ort: "Musterstadt", land: "DE", kategorie: "Friseur", email: "info1@example.invalid", emailQuelle: EMAIL_QUELLE_APIFY, lat: 48.1, lng: 11.5 });
  });
  it("ohne Apify und ohne Spalte „E-Mail-Quelle“: E-Mail verworfen (wie bisher)", () => {
    const r = leadsAusTabelle(["Firma", "PLZ", "Ort", "E-Mail"], [["Testhandel GmbH", "12345", "Musterstadt", "a@example.invalid"]], { typ: "csv" });
    expect(r.leads[0].email).toBeNull();
    expect(r.ohneMail).toBe(1);
  });
  it("gefundene Adresse nie für Werbe-E-Mail – auch nicht mit „Rechtlich geprüft“; Antwort, wenn der Händler sich meldet", () => {
    const l = { bestandskunde: false, einwilligung: null, email: "info1@example.invalid" };
    expect(mailErlaubt({ ...l, status: "neu" }, false).erlaubt).toBe(false);
    expect(mailErlaubt({ ...l, status: "neu" }, true)).toEqual({ erlaubt: false, grund: "Adresse aus dem Impressum – nur für Antworten, keine Werbe-E-Mail (UWG § 7); bitte per Brief" });
    expect(mailErlaubt({ ...l, status: "angeschrieben" }, true).erlaubt).toBe(false);
    expect(mailErlaubt({ ...l, status: "geantwortet" }, false)).toEqual({ erlaubt: true, grund: "Händler hat sich gemeldet – Antwort erlaubt (keine Werbe-E-Mail)" });
  });
});

describe("B34.3c Vorschlag „Zielgruppe AdelPrep“ und LUCID-Sperre", () => {
  it("Stück je Artikel ab Schwelle → Vorschlag; schon markiert/gesperrt/zu wenig → keiner", () => {
    const r = leadsAusTabelle(["Firma", "PLZ", "Ort", "Stück je Artikel"], [["Testgroßhandel GmbH", "12345", "Musterstadt", "1.200"], ["Testkleinhandel GmbH", "12345", "Musterstadt", "20"]]);
    expect(r.leads.map((l) => l.stueckJeArtikel)).toEqual([1200, 20]);
    expect(adelprepVorschlag({ adelprep: false, status: "neu", stueckJeArtikel: 1200 }, 80)).toBe("ca. 1.200 Stück je Artikel (ab 80)");
    expect(adelprepVorschlag({ adelprep: false, status: "neu", stueckJeArtikel: 80 }, 80)).toBe("ca. 80 Stück je Artikel (ab 80)");
    expect(adelprepVorschlag({ adelprep: false, status: "neu", stueckJeArtikel: 20 }, 80)).toBeNull();
    expect(adelprepVorschlag({ adelprep: true, status: "neu", stueckJeArtikel: 500 }, 80)).toBeNull();
    expect(adelprepVorschlag({ adelprep: false, status: "gesperrt", stueckJeArtikel: 500 }, 80)).toBeNull();
    expect(adelprepVorschlag({ adelprep: false, status: "neu", stueckJeArtikel: null }, 80)).toBeNull();
  });
  it("„Units“ aus Keepa/Helium-10-Exporten wird als Stückzahl gelesen", () => {
    expect(leadsAusTabelle(["Seller Name", "Postal Code", "City", "Units"], [["Testseller GmbH", "12345", "Musterstadt", "150"]]).leads[0]).toMatchObject({ firma: "Testseller GmbH", stueckJeArtikel: 150 });
  });
  it("LUCID gesperrt, bis die Nutzung geklärt ist", () => {
    expect(quelleSperre({ quelleTyp: "lucid" }, { lucidGeklaert: false, adelprepAbStueck: 80 })).toContain("LUCID");
    expect(quelleSperre({ quelleTyp: "lucid" }, { lucidGeklaert: true, adelprepAbStueck: 80 })).toBeNull();
    expect(quelleSperre({ quelleTyp: "apify" }, { lucidGeklaert: false, adelprepAbStueck: 80 })).toBeNull();
    expect(quelleSperre({ quelleTyp: null }, { lucidGeklaert: false, adelprepAbStueck: 80 })).toBeNull();
  });
});
