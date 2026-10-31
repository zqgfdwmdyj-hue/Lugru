import { describe, expect, it } from "vitest";
import { imCsvProblem, imCsvRow, internetmarkeCsv, toCp1252 } from "@/lib/shipping/internetmarke-csv";

// Adressdatei für den Internetmarke-Shop – Vorgaben der Post (CP1252, Semikolon, Kopfzeile, Absender zuerst).
// Alle Adressen erfunden.

const sender = { name1: "Testfirma GmbH", street: "Absenderweg", houseNo: "1", zip: "12345", city: "Musterstadt", country: "DEU" };

describe("Internetmarke-CSV", () => {
  it("Kopfzeile, Absender in Zeile 2, Empfänger danach, CRLF", () => {
    const text = internetmarkeCsv(sender, [{ name1: "Erika Muster", name2: "c/o Beispiel GmbH", street: "Musterstr.", houseNo: "12a", zip: "54321", city: "Beispielort", country: "DE" }]).toString("latin1");
    expect(text.split("\r\n")).toEqual([
      "NAME;ZUSATZ;STRASSE;NUMMER;PLZ;STADT;LAND;ADRESS_TYP",
      "Testfirma GmbH;;Absenderweg;1;12345;Musterstadt;DEU;HOUSE",
      "Erika Muster;c/o Beispiel GmbH;Musterstr.;12a;54321;Beispielort;DEU;HOUSE",
      "",
    ]);
  });
  it("Umlaute und ß in CP1252, Semikolon und Zeilenumbruch im Feld entfernt", () => {
    const buf = internetmarkeCsv(sender, [{ name1: "Jörg Weiß; Test", street: "Großstraße\n", houseNo: "3", zip: "80331", city: "München", country: "DEU" }]);
    expect(buf.includes(Buffer.from([0xf6]))).toBe(true); // ö
    expect(buf.includes(Buffer.from([0xdf]))).toBe(true); // ß
    expect(buf.toString("latin1")).toContain("Jörg Weiß Test;;Großstraße;3;80331;München;DEU;HOUSE");
    expect(toCp1252("–€„“ł")).toEqual(Buffer.from([0x96, 0x80, 0x84, 0x93, 0x6c]));
  });
  it("Packstation: Postnummer als Zusatz, Straße leer, Typ PACKSTATION", () => {
    expect(imCsvRow({ name1: "Max Test", name2: "1234567890", street: "Packstation", houseNo: "123", zip: "10115", city: "Berlin", country: "DEU" })).toEqual(["Max Test", "1234567890", "", "123", "10115", "Berlin", "DEU", "PACKSTATION"]);
  });
  it("Hausnummer in der Straße wird getrennt, Längen werden gekürzt", () => {
    const r = imCsvRow({ name1: "A", street: "Sehr lange Straßenbezeichnung im Musterviertel 7", zip: "12345", city: "Ort", country: "DEU" });
    expect(r[3]).toBe("7");
    expect(r[2].length).toBeLessThanOrEqual(35);
  });
  it("Ausland mit ISO-3, Probleme werden vorher gemeldet", () => {
    expect(imCsvRow({ name1: "Anna", street: "Testgasse", houseNo: "7", zip: "1010", city: "Wien", country: "AUT" })[6]).toBe("AUT");
    expect(imCsvProblem({ name1: "Anna", street: "Testgasse", houseNo: "7", zip: "1234", city: "Ort", country: "DEU" })).toContain("fünfstellig");
    expect(imCsvProblem({ name1: "Anna", street: "Testgasse", zip: "12345", city: "Ort", country: "DEU" })).toContain("Hausnummer");
    expect(imCsvProblem({ name1: "Anna", street: "Testgasse", houseNo: "7", zip: "12345", city: "Ort", country: "DEU" })).toBeNull();
  });
});
