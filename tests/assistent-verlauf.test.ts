import { describe, expect, it } from "vitest";
import { eingabeTokens, keinRueckgaengigGrund } from "@/lib/assistant/verlauf-logic";

// B19.5: Rückgängig ehrlich begründen; Eingabe-Tokens samt Zwischenspeicher zählen.
const basis = { ok: true, zurueck: false, undoDaten: true, toolHatUndo: true, stufe: "gruen", alterTage: 0, darf: true, nurAnsehen: false };

describe("Assistent-Verlauf", () => {
  it("Rückgängig nur, wenn alles passt – sonst ein Grund", () => {
    expect(keinRueckgaengigGrund(basis)).toBeNull();
    expect(keinRueckgaengigGrund({ ...basis, toolHatUndo: false })).toMatch(/kein Rückgängig/);
    expect(keinRueckgaengigGrund({ ...basis, undoDaten: false })).toMatch(/keine alten Werte/);
    expect(keinRueckgaengigGrund({ ...basis, stufe: "gelb" })).toMatch(/gelb\/rot/);
    expect(keinRueckgaengigGrund({ ...basis, alterTage: 8 })).toMatch(/älter als 7 Tage/);
    expect(keinRueckgaengigGrund({ ...basis, zurueck: true })).toMatch(/schon rückgängig/);
    expect(keinRueckgaengigGrund({ ...basis, ok: false })).toMatch(/nicht ausgeführt/);
    expect(keinRueckgaengigGrund({ ...basis, darf: false })).toMatch(/nur die Person/);
  });

  it("Eingabe-Tokens: nicht zwischengespeichert + Zwischenspeicher geschrieben + gelesen", () => {
    // so sah es aus: 54 „Eingabe-Tokens“, obwohl 12.000 aus dem Zwischenspeicher kamen
    expect(eingabeTokens({ input_tokens: 54, cache_creation_input_tokens: 0, cache_read_input_tokens: 12_000 })).toBe(12_054);
    expect(eingabeTokens({ input_tokens: 10, cache_creation_input_tokens: 3_000, cache_read_input_tokens: null })).toBe(3_010);
    expect(eingabeTokens(null)).toBe(0);
  });
});
