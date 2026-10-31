import { describe, expect, it } from "vitest";
import { parseWsMax, warensendungCheck } from "@/lib/shipping/warensendung";

// Warensendung nach den Bedingungen der Post statt nach Stückzahl. Erfundene Artikel.

const item = (quantity: number, wsMax: number | null, title = "Testsocken") => ({ quantity, wsMax, title });

describe("Warensendung – passt oder nicht", () => {
  it("Artikel passt bis 1 Stück: 1 Stück ja, 2 Stück nein", () => {
    expect(warensendungCheck({ country: "DEU", items: [item(1, 1)], weightKg: 0.3 })).toMatchObject({ ok: true });
    const two = warensendungCheck({ country: "DEU", items: [item(2, 1)], weightKg: 0.6 });
    expect(two.ok).toBe(false);
    expect(two.reason).toContain("passen nur 1");
    expect(two.reason).toContain("35,3 × 25 × 5 cm");
  });
  it("Artikel passt bis 3 Stück: 3 ja, 4 nein", () => {
    expect(warensendungCheck({ country: "DEU", items: [item(3, 3)], weightKg: 0.6 }).ok).toBe(true);
    expect(warensendungCheck({ country: "DEU", items: [item(4, 3)], weightKg: 0.8 }).ok).toBe(false);
  });
  it("1 Stück, aber nicht festgelegt → nicht automatisch, Hinweis zum Eintragen", () => {
    const r = warensendungCheck({ country: "DEU", items: [item(1, null, "Kochmesser")], weightKg: 0.4 });
    expect(r).toMatchObject({ ok: false, needsSetup: true });
    expect(r.reason).toContain("Kochmesser");
  });
  it("passt nie (z. B. Gerät zu dick) → nie Warensendung", () => {
    expect(warensendungCheck({ country: "DEU", items: [item(1, 0, "Testgerät")], weightKg: 0.5 }).reason).toContain("passt nicht");
  });
  it("mehrere Artikel teilen sich den Platz", () => {
    expect(warensendungCheck({ country: "DEU", items: [item(1, 2, "A"), item(1, 2, "B")], weightKg: 0.5 }).ok).toBe(true);
    expect(warensendungCheck({ country: "DEU", items: [item(1, 2, "A"), item(1, 1, "B")], weightKg: 0.5 }).ok).toBe(false);
  });
  it("über 1 kg oder Ausland → nein", () => {
    expect(warensendungCheck({ country: "DEU", items: [item(1, 1)], weightKg: 1.2 }).reason).toContain("nur bis 1 kg");
    expect(warensendungCheck({ country: "AUT", items: [item(1, 1)], weightKg: 0.3 }).reason).toContain("Ausland");
  });
  it("Eingabe: leer = nicht festgelegt, Zahl, ungültig", () => {
    expect(parseWsMax("")).toBeNull();
    expect(parseWsMax("0")).toBe(0);
    expect(parseWsMax("3")).toBe(3);
    expect(parseWsMax("drei")).toBeUndefined();
  });
});
