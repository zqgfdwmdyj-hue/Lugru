import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: { priceChecks: {}, products: {}, files: {} } }));

describe("KI-Antwort lesen", () => {
  it("liest den JSON-Block, sortiert nach Preis, entfernt doppelte Links", async () => {
    const { parseResearch } = await import("@/lib/price-research");
    const text = `Ich habe gesucht.\n\`\`\`json\n${JSON.stringify({
      name: "Bio Kimchi",
      variant: "500 g",
      category: "Lebensmittel",
      offers: [
        { shop: "B", title: "Kimchi", price: 3.29, url: "https://b.example/k" },
        { shop: "A", title: "Kimchi", price: 2.49, unit: "4,98 €/kg", url: "https://a.example/k" },
        { shop: "A2", title: "Kimchi", price: 2.49, url: "https://a.example/k" },
      ],
      summary: "Passt.",
    })}\n\`\`\``;
    const r = parseResearch(text);
    expect(r.name).toBe("Bio Kimchi");
    expect(r.offers.map((o) => o.price)).toEqual([2.49, 3.29]);
  });
  it("lehnt kaputte Antworten ab", async () => {
    const { parseResearch } = await import("@/lib/price-research");
    expect(() => parseResearch("keine Ahnung")).toThrow();
  });
});

describe("Bildprüfung", () => {
  it("erkennt JPG/PNG und lehnt anderes ab", async () => {
    const { looksLikeImage } = await import("@/lib/service");
    expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode("\0\0\0\x18ftypheic"))).toBe(false);
    expect(looksLikeImage(new TextEncoder().encode("hallo"))).toBe(false);
  });
});

describe("KI-Antwort tolerant", () => {
  it("sortiert kaputte Angebote aus und liest Preise als Text", async () => {
    const { parseResearch } = await import("@/lib/price-research");
    const r = parseResearch('{"name":"Kaugummi","offers":[{"shop":"dm","title":"x","price":"1,49 €","url":"https://dm.de/a"},{"shop":"B","price":2,"url":"kein link"},{"shop":"C"}]}');
    expect(r.offers).toEqual([{ shop: "dm", title: "x", price: 1.49, url: "https://dm.de/a" }]);
    expect(parseResearch('```json\n{"name":"X","offers":null}\n```').offers).toEqual([]);
  });
});

describe("Kameranamen", () => {
  it("iPhone-UUIDs und Kameranamen gelten als ohne Namen", async () => {
    const { isPlaceholderName, nameFromFilename } = await import("@/lib/layout");
    expect(nameFromFilename("21B33D03-B668-4E79-AB60-841D27E9D8BC.jpeg")).toBe("");
    expect(nameFromFilename("IMG_E1234.HEIC")).toBe("");
    expect(nameFromFilename("20260930_101112.jpg")).toBe("");
    expect(nameFromFilename("Bildschirmfoto 2026-09-30 um 10.11.12.png")).toBe("");
    expect(nameFromFilename("kimchi-organics.jpg")).toBe("Kimchi organics");
    expect(isPlaceholderName("21b33d03 b668 4e79 ab60 841d27e9d8bc")).toBe(true);
    expect(isPlaceholderName("Neues Produkt")).toBe(true);
    expect(isPlaceholderName("Kaugummi")).toBe(false);
    expect(isPlaceholderName("7Up")).toBe(false);
  });
});

describe("MHD lesen", () => {
  it("versteht übliche Schreibweisen", async () => {
    const { normalizeMhd } = await import("@/lib/mhd-parse");
    expect(normalizeMhd("12.10.26")).toBe("2026-10-12");
    expect(normalizeMhd("mindestens haltbar bis: 12.10.2026 L1234")).toBe("2026-10-12");
    expect(normalizeMhd("2026-10-12")).toBe("2026-10-12");
    expect(normalizeMhd("12/10/2026")).toBe("2026-10-12");
    expect(normalizeMhd("10.2026")).toBe("2026-10-31");
    expect(normalizeMhd("02/27")).toBe("2027-02-28");
    expect(normalizeMhd("OKT 2026")).toBe("2026-10-31");
    expect(normalizeMhd("12 OCT 26")).toBe("2026-10-12");
    expect(normalizeMhd("31.02.2026")).toBe(null);
    expect(normalizeMhd("keine Angabe")).toBe(null);
  });
});
