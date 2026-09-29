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
