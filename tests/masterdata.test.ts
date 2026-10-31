import { describe, expect, it } from "vitest";
import { countryKey, unknownCountry } from "@/lib/leads/logic";
import { nameKey, spellingGroups, suspiciousName } from "@/lib/masterdata";

// Stammdaten: Länder, Schreibweisen, auffällige Angaben – erfundene Namen.
describe("Länder vereinheitlicht", () => {
  it("MY und Malaysia sind dasselbe Land", () => {
    expect(countryKey("MY")).toBe("Malaysia");
    expect(countryKey("Malaysia")).toBe("Malaysia");
    expect(countryKey("MYS")).toBe("Malaysia");
    expect(countryKey("Singapore")).toBe("Singapur");
    expect(unknownCountry("MY")).toBe(false);
    expect(unknownCountry("ZZ")).toBe(true);
    expect(unknownCountry("")).toBe(false);
  });
});

describe("Schreibweisen", () => {
  it("Rechtsform, Groß/klein, Umlaute und Satzzeichen zählen nicht", () => {
    expect(nameKey("Testhandel GmbH")).toBe(nameKey("TESTHANDEL Gmbh."));
    expect(nameKey("Müller & Söhne KG")).toBe(nameKey("Mueller Soehne"));
    const g = spellingGroups(["Testhandel GmbH", "TESTHANDEL Gmbh.", "Testhandel GmbH", "Andere AG", null, ""]);
    expect(g).toEqual([{ key: "testhandel", names: [{ name: "Testhandel GmbH", n: 2 }, { name: "TESTHANDEL Gmbh.", n: 1 }] }]);
  });
  it("auffällige Angaben", () => {
    expect(suspiciousName("n/a")).toBe("Platzhalter statt Name");
    expect(suspiciousName("X")).toBe("Platzhalter statt Name");
    expect(suspiciousName("7")).toBe("nur ein Zeichen");
    expect(suspiciousName("12345")).toBe("nur Ziffern");
    expect(suspiciousName("Testmarke")).toBeNull();
  });
});
