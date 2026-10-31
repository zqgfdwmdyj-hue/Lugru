import { describe, expect, it } from "vitest";
import { similarSuppliers } from "@/lib/suppliers/duplicates";

// Mögliche doppelte Shops: Vorschläge zur Prüfung. Fiktive Kürzel.

const s = (id: string, code: string, name: string | null = null) => ({ id, code, name });

describe("ähnliche Shops", () => {
  it("Präfix, ein Zeichen Unterschied, gleicher Name", () => {
    const pairs = similarSuppliers([s("1", "SHO", null), s("2", "SHOPX", null), s("3", "MKTDE"), s("4", "MKTES"), s("5", "BAUMA", "Baumarkt GmbH"), s("6", "BMKT", "Baumarkt"), s("7", "TOYSA"), s("8", "TOYSB")]);
    const r = pairs.map((p) => `${p.a.code}~${p.b.code}`);
    expect(r).toContain("SHO~SHOPX");
    expect(r).toContain("BAUMA~BMKT");
    expect(r).toContain("TOYSA~TOYSB");
    expect(r).not.toContain("MKTDE~MKTES");
  });
  it("Kürzel mit Ziffern (ASIN-Reste) nicht als Präfix-Doppel", () => {
    expect(similarSuppliers([s("1", "B07L6"), s("2", "B07")])).toEqual([]);
  });
});
