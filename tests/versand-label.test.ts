import { describe, expect, it } from "vitest";
import { adresseAusKi, adresseAusText, gefahrgutPruefen, kosten, paketFuerGewicht, pflichtFehlend, trackingLink, versandText } from "@/lib/versand-label/logic";

// DHL-Label aus Chat/Screenshot (Teil B) – erfundene Adressen.

describe("Adresse aus Text", () => {
  it("WhatsApp-Nachricht mit Zeitstempel und Gruß", () => {
    const r = adresseAusText("[03.11., 14:22] Max: Hallo, hier meine Adresse:\n[03.11., 14:22] Max: Max Mustermann\n[03.11., 14:23] Max: Teststraße 12a\n[03.11., 14:23] Max: 12345 Musterstadt\n[03.11., 14:23] Max: Tel 0151 23456789\nDanke!");
    expect(r.adresse).toMatchObject({ name: "Max Mustermann", strasse: "Teststraße", hausnummer: "12a", plz: "12345", ort: "Musterstadt", land: "DE", telefon: "015123456789" });
    expect(r.unsicher).toEqual([]);
  });
  it("Kleinanzeigen mit Beschriftungen und Mail", () => {
    const r = adresseAusText("Name: Erika Beispiel\nStraße: Probeweg 7\nPLZ/Ort: 54321 Beispielstadt\nE-Mail: erika@example.invalid");
    expect(r.adresse).toMatchObject({ name: "Erika Beispiel", strasse: "Probeweg", hausnummer: "7", plz: "54321", ort: "Beispielstadt", email: "erika@example.invalid" });
    expect(r.unsicher).toEqual([]);
  });
  it("eine Zeile mit Kommas, Österreich", () => {
    const r = adresseAusText("Anna Test, Musterg. 3/2, 1010 Wien, Österreich");
    expect(r.adresse).toMatchObject({ name: "Anna Test", hausnummer: "3/2", plz: "1010", ort: "Wien", land: "AT" });
  });
  it("Packstation mit Postnummer", () => {
    const r = adresseAusText("Paul Paket\nPackstation 123\nPostnummer 12345678\n12345 Musterstadt");
    expect(r.adresse).toMatchObject({ name: "Paul Paket", packstation: "Packstation 123", postnummer: "12345678", strasse: "Packstation 123", hausnummer: "123", plz: "12345" });
    expect(r.unsicher).toEqual([]);
  });
  it("Fehlendes wird gelb markiert", () => {
    const r = adresseAusText("Teststraße\n12345 Musterstadt");
    expect(r.unsicher).toEqual(expect.arrayContaining(["name", "hausnummer"]));
    expect(pflichtFehlend({ name: "A B", strasse: "Packstation 1", hausnummer: "1", plz: "12345", ort: "X", land: "DE" })).toEqual(["postnummer"]);
  });
  it("KI-Antwort übernehmen, unsichere Felder behalten", () => {
    const r = adresseAusKi({ name: "Max Mustermann", strasse: "Teststraße", hausnummer: "12a", plz: "12345", ort: "Musterstadt", land: "DE", unsicher: ["hausnummer"] })!;
    expect(r.quelle).toBe("ki");
    expect(r.unsicher).toEqual(["hausnummer"]);
    expect(adresseAusKi({ name: "", strasse: "", plz: "" })).toBeNull();
    expect(adresseAusKi({ name: "X Y", strasse: "A", hausnummer: "1", plz: "123", ort: "B", land: "DE" })!.unsicher).toContain("plz");
  });
});

describe("Produkte und Kosten", () => {
  it("Gewichtsklassen", () => {
    expect(paketFuerGewicht(1.2)).toBe("paket_2");
    expect(paketFuerGewicht(2)).toBe("paket_2");
    expect(paketFuerGewicht(2.01)).toBe("paket_5");
    expect(paketFuerGewicht(31.5)).toBe("paket_31_5");
    expect(paketFuerGewicht(32)).toBeNull();
  });
  it("Kosten laut Preisliste, fehlend = null", () => {
    const p = { paket_5: 5.5, versicherung: 3, alterssicht: 2 };
    expect(kosten("paket_5", {}, p)).toBe(5.5);
    expect(kosten("paket_5", { versicherung: 1500, alterssicht: "A18" }, p)).toBe(10.5);
    expect(kosten("paket_5", { versicherung: 400 }, p)).toBe(5.5);
    expect(kosten("paket_10", {}, p)).toBeNull();
  });
});

describe("Gefahrgut", () => {
  it("LQ mit Pflichtangaben → erlaubt, LQ-Kennzeichen", () => {
    const r = gefahrgutPruefen({ lq: true, un: "UN1950", klasse: "2.1", mengeJePackstueck: "6 × 0,4 L" }, 4);
    expect(r).toMatchObject({ erlaubt: true, kennzeichen: ["lq"] });
    expect(r.hinweise.join(" ")).toContain("nur begrenzte Mengen (LQ)");
  });
  it("LQ ohne Angaben / über 30 kg → Fehler", () => {
    const r = gefahrgutPruefen({ lq: true }, 31);
    expect(r.erlaubt).toBe(false);
    expect(r.fehler.join(" ")).toMatch(/UN-Nummer.*Klasse.*Menge.*30 kg/);
  });
  it("Klasse 1, 6.2, 7 und Vollgefahrgut gesperrt: per Spedition", () => {
    for (const k of ["1", "1.4S", "6.2", "7"]) expect(gefahrgutPruefen({ lq: true, un: "0012", klasse: k, mengeJePackstueck: "1" }, 1).fehler.join(" ")).toContain("per Spedition");
    expect(gefahrgutPruefen({ vollgefahrgut: true }, 1).erlaubt).toBe(false);
    expect(gefahrgutPruefen({ lq: true, un: "1263", klasse: "3", mengeJePackstueck: "1 L" }, 1).erlaubt).toBe(true);
  });
  it("Lithium in Ausrüstung → Batterie-Kennzeichen", () => {
    expect(gefahrgutPruefen({ lithium: "UN3481" }, 2)).toMatchObject({ erlaubt: true, kennzeichen: ["lithium"] });
  });
});

describe("Tracking-Text", () => {
  it("Link + Text mit Vorname", () => {
    expect(trackingLink("00340434")).toContain("piececode=00340434");
    const t = versandText({ name: "Max Mustermann", nr: "00340434", kanal: "kleinanzeigen" });
    expect(t).toContain("Hallo Max,");
    expect(t).toContain("dein Paket ist unterwegs: https://");
  });
});
