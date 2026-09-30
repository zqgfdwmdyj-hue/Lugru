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
