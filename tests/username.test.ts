import { describe, expect, it } from "vitest";
import { isEmailLogin, loginNameError, normalizeLogin, passwordError } from "@/lib/auth/username";

// Anmeldung mit Benutzername (oder E-Mail). Fiktive Namen.

describe("Benutzername", () => {
  it("klein geschrieben, ohne Leerzeichen am Rand", () => {
    expect(normalizeLogin("  Lager1 ")).toBe("lager1");
    expect(normalizeLogin("Max.Muster@Firma.DE")).toBe("max.muster@firma.de");
    expect(normalizeLogin("Jürgen")).toBe("jürgen");
    expect(normalizeLogin(null)).toBe("");
  });

  it("erlaubt: Buchstaben (auch Umlaute), Ziffern, . _ - und E-Mail-Adressen", () => {
    for (const ok of ["lager1", "max.muster", "jürgen_2", "aushilfe-sa", "max@firma.de"]) expect(loginNameError(ok)).toBeNull();
  });

  it("abgelehnt: zu kurz, Leerzeichen, Sonderzeichen, halbe E-Mail", () => {
    expect(loginNameError("ab")).toMatch(/mindestens 3/);
    expect(loginNameError("x".repeat(61))).toMatch(/höchstens 60/);
    expect(loginNameError("max muster")).toMatch(/keine Leerzeichen/);
    expect(loginNameError("max/1")).toMatch(/nur Buchstaben/);
    expect(loginNameError("max@firma")).toMatch(/unvollständig/);
  });

  it("E-Mail erkennt man am @", () => {
    expect(isEmailLogin("max@firma.de")).toBe(true);
    expect(isEmailLogin("lager1")).toBe(false);
  });

  it("Passwort vom Inhaber: mindestens 8 Zeichen", () => {
    expect(passwordError("kurz123")).toMatch(/mindestens 8/);
    expect(passwordError("lang-genug")).toBeNull();
    expect(passwordError("zehnzeich", 10)).toMatch(/mindestens 10/);
  });
});
