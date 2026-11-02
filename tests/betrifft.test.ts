import { describe, expect, it } from "vitest";
import { betrifftAufloesen, betrifftAusTitel, betrifftText, nurAndere, personenVon } from "@/lib/private/betrifft-logic";

// Familienkalender: wen betrifft ein Termin? Erfundene Namen.
const P = { a: "Ina", b: "Tom" };

describe("Familienkalender: Betrifft", () => {
  it("Vorname im Titel als ganzes Wort", () => {
    expect(betrifftAusTitel("Tom Zahnarzt", P)).toBe("b");
    expect(betrifftAusTitel("Yoga (Ina)", P)).toBe("a");
    expect(betrifftAusTitel("ina: Friseur", P)).toBe("a");
    expect(betrifftAusTitel("Tomate kaufen", P)).toBeNull();
    expect(betrifftAusTitel("Elternabend", P)).toBeNull();
  });
  it("beide Namen oder Familie/alle → Familie", () => {
    expect(betrifftAusTitel("Ina und Tom beim Notar", P)).toBe("familie");
    expect(betrifftAusTitel("Familie: Oma Geburtstag", P)).toBe("familie");
    expect(betrifftAusTitel("Alle zum Kinderarzt", P)).toBe("familie");
  });
  it("gesetzt geht vor Titel, ohne Hinweis Familie", () => {
    expect(betrifftAufloesen("a", "Tom Zahnarzt", P)).toEqual({ wert: "a", quelle: "gesetzt" });
    expect(betrifftAufloesen(null, "Tom Zahnarzt", P)).toEqual({ wert: "b", quelle: "titel" });
    expect(betrifftAufloesen(undefined, "Elternabend", P)).toEqual({ wert: "familie", quelle: "standard" });
  });
  it("blockt nur, wenn es mich oder die Familie betrifft", () => {
    expect(nurAndere("b", "a")).toBe(true);
    expect(nurAndere("a", "a")).toBe(false);
    expect(nurAndere("familie", "a")).toBe(false);
    expect(nurAndere("b", null)).toBe(false); // ohne eigene Zuordnung nichts ausblenden
    expect(personenVon("b")).toEqual(["b"]);
    expect(personenVon("familie")).toEqual(["a", "b"]);
    expect(betrifftText("b", P)).toBe("nur Tom");
    expect(betrifftText("familie", P)).toBe("Familie");
  });
  it("Vorname aus vollem Namen, zu kurze Namen ignoriert", () => {
    expect(betrifftAusTitel("Tom Arzt", { a: "Ina Muster", b: "Tom Beispiel" })).toBe("b");
    expect(betrifftAusTitel("A Termin", { a: "A", b: "Tom" })).toBeNull();
  });
});
