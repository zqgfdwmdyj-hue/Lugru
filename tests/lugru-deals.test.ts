import { describe, expect, it } from "vitest";
import { MIN_SCHLUESSEL, schluesselAusHeader, schluesselPasst } from "@/lib/lugru-deals/schluessel";

describe("Verbindungsschlüssel Lugru Deals", () => {
  const gut = "x".repeat(MIN_SCHLUESSEL);

  it("liest den Bearer-Header", () => {
    expect(schluesselAusHeader(`Bearer ${gut}`)).toBe(gut);
    expect(schluesselAusHeader("bearer abc")).toBe("abc");
    expect(schluesselAusHeader(null)).toBe("");
    expect(schluesselAusHeader("Basic abc")).toBe("");
  });

  it("prüft den Schlüssel", () => {
    expect(schluesselPasst(gut, gut)).toBe(true);
    expect(schluesselPasst(gut + "y", gut)).toBe(false);
    expect(schluesselPasst("", gut)).toBe(false);
    // Ein zu kurzer gespeicherter Schlüssel gilt nie.
    expect(schluesselPasst("kurz", "kurz")).toBe(false);
    expect(schluesselPasst(gut, undefined)).toBe(false);
  });
});
