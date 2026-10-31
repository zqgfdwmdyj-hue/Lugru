import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ansageBefund,
  ansageEtikett,
  ansageProdukt,
  eanGueltig,
  entscheide,
  erkenneBefehl,
  erkenneCode,
  fallDateien,
  fehlendeFotos,
  kiWarnung,
  LPN_RE,
  naechsterZaehler,
  retSku,
  vergleicheLieferschein,
  verbleibVorschlag,
  zusammenfassung,
} from "@/lib/retouren-station/logic";
import { EtikettSchema, falltextVorlage, jsonAus, LieferscheinSchema, ProduktSchema } from "@/lib/retouren-station/ki";
import { crc32, zipErstellen } from "@/lib/zip";
import { parseSku } from "@/lib/sku/parse";

// Erfundene LPNs nach dem Muster aus den eigenen Daten (LPN + 2 Buchstaben + 9 Ziffern).

describe("LPN und andere Codes", () => {
  it.each(["LPNHK535208835", "LPNHe052177380", "LPNWE422288008", "LPNRP096798384"])("%s passt zum LPN-Muster", (l) => {
    expect(LPN_RE.test(l)).toBe(true);
    expect(erkenneCode(l)).toEqual({ art: "lpn", wert: l });
  });
  it.each(["LPNHK53520883", "LPNH1535208835", "LPN535208835", "XPNHK535208835"])("%s ist keine LPN", (l) => expect(LPN_RE.test(l)).toBe(false));
  it("LPN mit Scanner-Präfix, Leerzeichen und kleingeschriebenem Anfang", () => {
    expect(erkenneCode("]C1LPNHK535208835\r")).toEqual({ art: "lpn", wert: "LPNHK535208835" });
    expect(erkenneCode("lpnhk535208835")).toEqual({ art: "lpn", wert: "LPNhk535208835" });
    expect(erkenneCode(" LPNWE 422288008 ")).toEqual({ art: "lpn", wert: "LPNWE422288008" });
  });
  it("FNSKU, ASIN, EAN (mit Prüfziffer)", () => {
    expect(erkenneCode("x00test001")).toEqual({ art: "fnsku", wert: "X00TEST001" });
    expect(erkenneCode("B0TEST0001")).toEqual({ art: "asin", wert: "B0TEST0001" });
    expect(eanGueltig("4006381333931")).toBe(true);
    expect(eanGueltig("4006381333932")).toBe(false);
    expect(erkenneCode("4006381333931")).toEqual({ art: "ean", wert: "4006381333931" });
    expect(erkenneCode("036000291452")).toEqual({ art: "ean", wert: "0036000291452" });
    expect(erkenneCode("1234567")).toBeNull();
    expect(erkenneCode("")).toBeNull();
  });
});

describe("Sprachbefehle", () => {
  it.each([
    ["Neues Paket", "neues_paket"],
    ["neuer Karton", "neues_paket"],
    ["Etikett", "etikett"],
    ["Label", "etikett"],
    ["Aufkleber", "etikett"],
    ["Etiket", "etikett"],
    ["Lieferschein", "lieferschein"],
    ["Packzettel", "lieferschein"],
    ["Lieferschain", "lieferschein"],
    ["Produkt", "produkt"],
    ["Artikel", "produkt"],
    ["Inhalt", "foto"],
    ["Foto", "foto"],
    ["Nächstes Produkt", "naechstes"],
    ["nächster Artikel", "naechstes"],
    ["Fertig", "fertig"],
    ["Paket fertig", "fertig"],
    ["Nochmal", "nochmal"],
    ["Löschen", "loeschen"],
    ["Abbrechen", "abbrechen"],
    ["Wiederholen", "wiederholen"],
    ["Hilfe", "hilfe"],
    ["äh Etikett", "etikett"],
  ])("„%s“ → %s", (s, b) => expect(erkenneBefehl(s)?.befehl).toBe(b));

  it.each([
    ["Zustand OK", "ok"],
    ["Zustand okay", "ok"],
    ["in Ordnung", "ok"],
    ["leer", "leer"],
    ["Zustand leer", "leer"],
    ["falsches Produkt", "falsches_produkt"],
    ["falscher Artikel", "falsches_produkt"],
    ["benutzt", "benutzt"],
    ["gebraucht", "benutzt"],
    ["beschädigt", "beschaedigt"],
    ["kaputt", "beschaedigt"],
    ["unvollständig", "unvollstaendig"],
    ["Teile fehlen", "unvollstaendig"],
  ])("Befund „%s“ → %s", (s, b) => expect(erkenneBefehl(s)).toEqual({ befehl: "zustand", befund: b }));

  it("„OK“ allein löst nichts aus (fällt im Gespräch ständig)", () => {
    expect(erkenneBefehl("okay")).toBeNull();
    expect(erkenneBefehl("ok danke")).toBeNull();
  });

  it("alles nach „Notiz“ ist Freitext – auch Wörter, die sonst Befehle wären", () => {
    expect(erkenneBefehl("Notiz Karton war offen, Etikett fehlt")).toEqual({ befehl: "notiz", text: "Karton war offen, Etikett fehlt" });
    expect(erkenneBefehl("Anmerkung: Kunde hat Steine reingelegt")).toEqual({ befehl: "notiz", text: "Kunde hat Steine reingelegt" });
    expect(erkenneBefehl("Notiz")).toBeNull();
  });

  it("SKU buchstabiert, Remission manuell, Verbleib", () => {
    expect(erkenneBefehl("SKU x null null test null null eins")).toEqual({ befehl: "code", wert: "X00TEST001" });
    expect(erkenneBefehl("Remission manuell")).toEqual({ befehl: "remission", wert: null });
    expect(erkenneBefehl("Remission zwei")).toEqual({ befehl: "remission", wert: "2" });
    expect(erkenneBefehl("Verbleib B-Ware")).toEqual({ befehl: "verbleib", verbleib: "b_ware" });
    expect(erkenneBefehl("Verbleib einlagern")).toEqual({ befehl: "verbleib", verbleib: "fba" });
    expect(erkenneBefehl("Verbleib entsorgen")).toEqual({ befehl: "verbleib", verbleib: "entsorgen" });
  });

  it("gesprochene LPN wird als Code erkannt", () => expect(erkenneBefehl("LPNHK535208835")).toEqual({ befehl: "code", wert: "LPNHK535208835" }));

  it("Unbekanntes → null (Station sagt „Nicht verstanden“)", () => {
    expect(erkenneBefehl("wo ist der Kaffee")).toBeNull();
    expect(erkenneBefehl("")).toBeNull();
  });

  it("mit Aktivierungswort: nur nach „Station“", () => {
    const o = { aktivierungswort: "Station" };
    expect(erkenneBefehl("Etikett", o)).toBeNull();
    expect(erkenneBefehl("Station Etikett", o)).toEqual({ befehl: "etikett" });
    expect(erkenneBefehl("also Station leer", o)).toEqual({ befehl: "zustand", befund: "leer" });
    expect(erkenneBefehl("Station Notiz Klebeband aufgeschnitten", o)).toEqual({ befehl: "notiz", text: "Klebeband aufgeschnitten" });
    expect(erkenneBefehl("Station", o)).toBeNull();
  });
});

describe("Entscheidung: Fall ja/nein", () => {
  const basis = { befund: "leer" as const, bestellnummer: "302-1234567-1234567", erstattet: 34.99, amazonGezahlt: 0, laufenderFall: false, schwelle: 15 };
  it("Befund ≠ OK, über Schwelle, nicht erstattet → Fall", () => expect(entscheide(basis)).toBe("fall"));
  it("genau auf der Schwelle → Fall", () => expect(entscheide({ ...basis, erstattet: 15 })).toBe("fall"));
  it("unter der Schwelle → nur dokumentieren", () => expect(entscheide({ ...basis, erstattet: 14.99 })).toBe("zu_klein"));
  it("Amazon hat schon erstattet → kein Fall", () => expect(entscheide({ ...basis, amazonGezahlt: 12.5 })).toBe("schon_erstattet"));
  it("Fall läuft schon → kein zweiter", () => expect(entscheide({ ...basis, laufenderFall: true })).toBe("laeuft_schon"));
  it("ohne Kundenretoure (nur FNSKU) → kein Fall", () => expect(entscheide({ ...basis, bestellnummer: null })).toBe("ohne_retoure"));
  it("Erstattung noch nicht in den Daten → warten", () => expect(entscheide({ ...basis, erstattet: null })).toBe("warten"));
  it("OK → kein Fall, auch bei hoher Erstattung", () => expect(entscheide({ ...basis, befund: "ok" })).toBe("kein_fall"));
  it("ohne Befund → noch nichts", () => expect(entscheide({ ...basis, befund: null })).toBeNull());
  it("Schwelle einstellbar", () => expect(entscheide({ ...basis, erstattet: 20, schwelle: 25 })).toBe("zu_klein"));
});

describe("Verbleib, RET-SKU", () => {
  it("Verbleib-Vorschläge", () => {
    expect(verbleibVorschlag("ok")).toBe("fba");
    expect(verbleibVorschlag("ok", { gebrauchsspuren: "leicht" })).toBe("b_ware");
    expect(verbleibVorschlag("benutzt")).toBe("ebay");
    expect(verbleibVorschlag("benutzt", { gebrauchsspuren: "deutlich" })).toBe("b_ware");
    expect(verbleibVorschlag("beschaedigt", { grund: "DEFECTIVE" })).toBe("hersteller");
    expect(verbleibVorschlag("beschaedigt")).toBe("entsorgen");
    expect(verbleibVorschlag("leer")).toBeNull();
    expect(verbleibVorschlag("falsches_produkt")).toBeNull();
  });
  it("RET-SKU nach bestehendem Schema – und das System liest sie wieder richtig", () => {
    const s = retSku({ zaehler: 3, lpn: "LPNHK535208835", datum: "2026-04-14", kanal: "FBA" });
    expect(s).toBe("RET_3_LPNHK535208835_14APR26_FBA");
    const p = parseSku(s, { reference: new Date("2026-10-29") });
    expect(p).toMatchObject({ schema: "RET", date: "2026-04-14", ret: { code: "3", lpn: "LPNHK535208835", channel: "FBA" } });
    expect(retSku({ zaehler: 1, lpn: null, fnsku: "X00TEST001", datum: "2026-10-29", kanal: "FBA" })).toBe("RET_1_X00TEST001_29OCT26_FBA");
  });
  it("Zähler: höchster vorhandener + 1", () => {
    expect(naechsterZaehler([])).toBe(1);
    expect(naechsterZaehler(["RET_3_LPNHK1_14APR26_FBA", "RET_7_LPNX_1JAN26_FBA", "KAUFL_1_2_3"])).toBe(8);
  });
});

describe("Lieferschein-Abgleich, Ansagen, KI-Warnung", () => {
  it("fehlende, abweichende und unerwartete Positionen", () => {
    const erwartet = [
      { fnsku: "X00TEST001", sku: "TEST-SOCKEN", titel: "Testsocken (erfunden)", menge: 2 },
      { fnsku: "X00TEST002", sku: "TEST-TASSE", titel: "Tefal Testpfanne 28", menge: 1 },
    ];
    expect(vergleicheLieferschein(erwartet, [{ fnsku: "X00TEST001", menge: 2 }, { fnsku: "X00TEST002", menge: 1 }])).toEqual([]);
    expect(vergleicheLieferschein(erwartet, [{ fnsku: "x00test001", menge: 1 }, { sku: "FREMD-1", titel: "Fremdartikel Muster", menge: 1 }])).toEqual([
      "Position Testsocken (erfunden): Lieferschein 1, erwartet 2",
      "Position Tefal Testpfanne 28 fehlt auf dem Lieferschein",
      "Unerwartete Position Fremdartikel Muster auf dem Lieferschein",
    ]);
  });
  it("Ansagen kurz in einem Satz", () => {
    expect(ansageEtikett("ZtwgdOGck9", 5)).toBe("Remission ZtwgdOGck9, 5 Positionen erwartet.");
    expect(ansageEtikett(null, null)).toContain("Remission manuell");
    expect(ansageProdukt({ titel: "Tefal Infinite 28 Pfanne", grund: "DEFECTIVE", erstattet: 34.99, zuordnung: "lpn" })).toBe("Tefal Infinite 28, Grund: defekt, erstattet 34,99 €.");
    expect(ansageProdukt({ titel: null, grund: null, erstattet: null, zuordnung: "unbekannt" })).toContain("Kein Code");
    expect(ansageBefund("leer", "fall", 34.99, null)).toBe("leer gespeichert. Fall über 34,99 €.");
    expect(ansageBefund("leer", "zu_klein", 9.99, null)).toBe("leer gespeichert. unter der Schwelle – nur dokumentiert.");
    expect(ansageBefund("ok", "kein_fall", 34.99, "Bild zeigt anderes Produkt – bitte bestätigen.")).toBe("OK gespeichert. Achtung: Bild zeigt anderes Produkt – bitte bestätigen.");
    expect(zusammenfassung([{ befund: "ok", entscheidung: "kein_fall", erstattet: 10 }, { befund: "ok", entscheidung: "kein_fall", erstattet: null }, { befund: "leer", entscheidung: "fall", erstattet: 34.99 }])).toBe("2 OK, 1 Fall über 34,99 €.");
  });
  it("KI widerspricht dem Befund → Warnung, sonst nichts", () => {
    expect(kiWarnung("ok", { passt: "nein" })).toContain("anderes Produkt");
    expect(kiWarnung("falsches_produkt", { passt: "ja" })).toContain("passt");
    expect(kiWarnung("ok", { passt: "ja", gebrauchsspuren: "deutlich" })).toContain("Gebrauchsspuren");
    expect(kiWarnung("ok", { passt: "unklar" })).toBeNull();
    expect(kiWarnung("benutzt", { passt: "ja", gebrauchsspuren: "leicht" })).toBeNull();
    expect(kiWarnung("ok", null)).toBeNull();
  });
});

describe("KI-Antworten streng lesen", () => {
  it("JSON mit Text drumherum; unbekannte Werte → sichere Vorgaben", () => {
    expect(jsonAus('Hier: ```json {"sendungsnummer":"JJD000000000001","versender":"DHL","remissions_id":null,"absender":"Amazon","unsicher":false} ```', EtikettSchema)).toEqual({ sendungsnummer: "JJD000000000001", versender: "DHL", remissions_id: null, absender: "Amazon", unsicher: false });
    expect(jsonAus('{"passt":"vielleicht","begruendung":"x","sichtbare_maengel":[],"vollstaendig":"ja","gebrauchsspuren":"keine","vorschlag_befund":"ok"}', ProduktSchema)).toMatchObject({ passt: "unklar", vollstaendig: "ja" });
    expect(jsonAus('{"remissions_id":"A1","positionen":[{"fnsku":"X00TEST001","menge":"2"}],"unsicher":false}', LieferscheinSchema)?.positionen[0]).toMatchObject({ fnsku: "X00TEST001", menge: 2 });
    expect(jsonAus("keine Ahnung", EtikettSchema)).toBeNull();
    expect(jsonAus('{"sendungsnummer":', EtikettSchema)).toBeNull();
  });
  it("Falltext-Vorlage ohne KI: DE/EN mit LPN, Bestellung, Betrag, Fotos", () => {
    const t = falltextVorlage({ lpn: "LPNHK535208835", bestellnummer: "302-0000000-0000001", asin: "B0TEST0001", sku: "TEST-SOCKEN", titel: "Testsocken", rueckgabeDatum: "2026-10-01", erstattet: 34.99, rueckgabegrund: "DEFECTIVE", befund: "leer (kein Artikel in der Verpackung)", notiz: null, remissionId: "ZtestRem01", fotos: ["1_Versandetikett.jpg", "2_Lieferschein.jpg"] });
    expect(t.betreff).toContain("302-0000000-0000001");
    expect(t.text_de).toContain("LPN LPNHK535208835");
    expect(t.text_de).toContain("34,99");
    expect(t.text_de).toContain("1. 1_Versandetikett.jpg");
    expect(t.text_en).toContain("EUR 34.99");
  });
});

describe("Fall-Paket: Dateinamen und ZIP", () => {
  it("feste Reihenfolge und Namen, Video nicht im ZIP", () => {
    const d = (art: string, nr: number) => ({ art: art as "etikett", nr, aufgenommenAm: new Date(2026, 0, nr) });
    const namen = fallDateien([d("inhalt", 2), d("produkt_lpn", 1), d("video", 1), d("lieferschein", 1), d("inhalt", 1), d("etikett", 1), d("lieferschein", 2)]).map((x) => x.name);
    expect(namen).toEqual(["1_Versandetikett.jpg", "2_Lieferschein_1.jpg", "2_Lieferschein_2.jpg", "3_Produkt_LPN.jpg", "4_Inhalt_1.jpg", "4_Inhalt_2.jpg"]);
    expect(fehlendeFotos(["etikett", "inhalt"])).toEqual(["lieferschein", "produkt_lpn"]);
  });

  it("ZIP ist gültig (CRC, Namen mit Umlauten) – geprüft mit unzip", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = zipErstellen([
      { name: "1_Versandetikett.jpg", daten: new Uint8Array([0xff, 0xd8, 1, 2, 3]) },
      { name: "Falltext_Übersicht.txt", daten: new TextEncoder().encode("Hallo Amazon") },
    ]);
    const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
    const f = path.join(dir, "fall.zip");
    writeFileSync(f, zip);
    const out = execFileSync("unzip", ["-t", f]).toString();
    expect(out).toContain("No errors detected");
    // Umlaute im Namen (UTF-8-Kennzeichen) – mit Pythons ZIP-Leser geprüft, unzip hängt dafür von der Spracheinstellung ab.
    const py = 'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); print(json.dumps({"namen": z.namelist(), "text": z.read("Falltext_Übersicht.txt").decode()}))';
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", py, f]).toString())).toEqual({ namen: ["1_Versandetikett.jpg", "Falltext_Übersicht.txt"], text: "Hallo Amazon" });
  });
});
