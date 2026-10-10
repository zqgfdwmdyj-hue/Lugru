import { describe, expect, it } from "vitest";
import { cleanReport, parseCsv } from "@/lib/purchasing/beschaffungsanalyse";

// Aufbau wie der Amazon-Business-Bericht „Sendungen“ (alle Werte erfunden).
const DE = [
  '"Bestellnummer","Bestelldatum","Sendungsverfolgung","Lieferdatum","Liefermenge","Versandadresse","ASIN","Titel","Bestellt von"',
  '"302-0000001-0000001","01.10.2026","900000000001","03.10.2026","3","Ankauf Test GmbH\nHafenstr. 1\n27568 Bremerhaven","B0TEST0001","Konsole Test, weiß","Max Beispiel"',
  '"302-0000002-0000002","01.10.2026","900000000002","04.10.2026","1","Max Beispiel\nWeg 3\n54321 Beispielort","B0TEST0002","Privatkauf ""Test""","Max Beispiel"',
  '"302-0000003-0000003","02.10.2026","","","2","Ankauf Test GmbH, Hafenstr. 1, 27568 BREMERHAVEN","B0TEST0003","Controller Test","Max Beispiel"',
  '"302-0000003-0000003","02.10.2026","","","1","","B0TEST0004","Storniert ohne Adresse","Max Beispiel"',
  '"302-0000004-0000004","02.10.2026","900000000004","05.10.2026","1","Kunde Erika Muster, Musterweg 1, 10115 Berlin","B0TEST0005","Dropship an Kunden","Max Beispiel"',
].join("\r\n");

describe("Beschaffungsanalyse bereinigen", () => {
  it("CSV mit Zeilenumbrüchen und doppelten Anführungszeichen in Feldern", () => {
    const { rows, delimiter, eol } = parseCsv(DE);
    expect(delimiter).toBe(",");
    expect(eol).toBe("\r\n");
    expect(rows).toHaveLength(6);
    expect(rows[1][5]).toBe("Ankauf Test GmbH\nHafenstr. 1\n27568 Bremerhaven");
    expect(rows[2][7]).toBe('Privatkauf "Test"');
  });

  it("nur Bestellungen nach Bremerhaven – inkl. stornierter Zeilen derselben Bestellung", () => {
    const r = cleanReport(DE, ["Bremerhaven"]);
    expect(r.language).toBe("DE");
    expect(r.missing).toEqual([]);
    expect(r).toMatchObject({ total: 5, kept: 3, removed: 2, withoutTracking: 2 });
    expect(r.preview.map((p) => p.asin)).toEqual(["B0TEST0001", "B0TEST0003", "B0TEST0004"]);
    expect(r.csv).not.toMatch(/Beispielort|Erika|Berlin|Privatkauf/);
    // Gleiche Spalten wie das Original, wieder einlesbar.
    const back = parseCsv(r.csv);
    expect(back.rows[0]).toEqual(parseCsv(DE).rows[0]);
    expect(back.rows).toHaveLength(4);
    expect(back.rows[1][5]).toBe("Ankauf Test GmbH\nHafenstr. 1\n27568 Bremerhaven");
  });

  it("mehrere Suchbegriffe (z. B. PLZ), Groß-/Kleinschreibung egal", () => {
    expect(cleanReport(DE, ["27568"]).kept).toBe(3);
    expect(cleanReport(DE, ["berlin", "bremerhaven"]).kept).toBe(4);
    expect(cleanReport(DE, []).kept).toBe(0);
  });

  it("französischer Bericht mit Semikolon und BOM", () => {
    const fr = "﻿" + ["Numéro de la commande;Numéro de suivi du transporteur;Date d'expédition;Quantité expédiée;Adresse d'expédition;ASIN;Titre", "403-1;900000000010;03/10/2026;2;Ankauf Test GmbH, 27568 Bremerhaven, Allemagne;B0TEST0010;Console Test", "403-2;900000000011;04/10/2026;1;Jean Test, 75001 Paris;B0TEST0011;Livre"].join("\n");
    const r = cleanReport(fr, ["Bremerhaven"]);
    expect(r.language).toBe("FR");
    expect(r).toMatchObject({ total: 2, kept: 1, missing: [] });
    expect(r.csv.startsWith("﻿")).toBe(true);
    expect(r.csv.split("\n")[0]).toContain(";");
    expect(r.preview[0]).toMatchObject({ order: "403-1", tracking: "900000000010", qty: "2", date: "03/10/2026" });
  });

  it("fehlende Pflichtspalten werden gemeldet; ohne Adressspalte bleibt nichts drin", () => {
    const r = cleanReport("Bestellnummer,ASIN,Titel\n302-1,B0X,Test", ["Bremerhaven"]);
    expect(r.missing).toEqual(["tracking", "date", "qty", "address"]);
    expect(r.kept).toBe(0);
  });
});
