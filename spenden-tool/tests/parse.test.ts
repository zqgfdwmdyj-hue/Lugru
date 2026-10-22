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

describe("Datum aus Formularfeldern", () => {
  it("nimmt nur echte Kalendertage", async () => {
    const { parseIsoDate } = await import("@/lib/numbers");
    expect(parseIsoDate("2026-10-12")).toBe("2026-10-12");
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("2028-02-29")).toBe("2028-02-29");
    expect(parseIsoDate("12.10.2026")).toBeNull();
  });
});

describe("Passwörter und Anmeldenamen", () => {
  it("speichert Passwörter nur als Hash und prüft sie", async () => {
    const { hashPassword, verifyPassword, normalizeLogin } = await import("@/lib/password");
    const h = await hashPassword("geheim-123");
    expect(h).not.toContain("geheim");
    expect(await verifyPassword("geheim-123", h)).toBe(true);
    expect(await verifyPassword("geheim-124", h)).toBe(false);
    expect(await hashPassword("geheim-123")).not.toBe(h);
    expect(normalizeLogin("  Anna Müller ")).toBe("anna.müller");
    expect(normalizeLogin("Ben<script>")).toBe("benscript");
  });
});

describe("Ideen", () => {
  it("ordnet Produktnamen der KI den Produkten der Verteilung zu", async () => {
    const { matchProducts, themeSuggestions, productLines } = await import("@/lib/ideas");
    const items = [
      { name: "Getrocknete Tomaten", variant: "500 g", price: 0.9 },
      { name: "Hafer Porridge", variant: null, price: 0.4 },
    ];
    const m = matchProducts(["getrocknete tomaten 500 g", "Porridge", "Schokolade"], items);
    expect(m.map((x) => x.item?.price ?? null)).toEqual([0.9, 0.4, null]);
    expect(themeSuggestions(10)[0]).toBe("Halloween");
    expect(themeSuggestions(12)[0]).toBe("Weihnachten");
    expect(productLines([{ name: "Kimchi", variant: null, category: "Lebensmittel", price: 0.5, priceNote: "je", quantity: 12, bestBefore: "2026-10-30" }])).toBe("- Kimchi (Lebensmittel, Spendenempfehlung je 50 Cent, Menge 12, MHD 30.10.2026)");
    expect(productLines([{ name: "Bifi", variant: null, category: "Lebensmittel", price: 0.4, priceNote: null, quantity: null, bestBefore: null, packNote: "ganzer Karton", packPrice: 5 }])).toBe("- Bifi (Lebensmittel, Spendenempfehlung 40 Cent, Packung: ganzer Karton 5€)");
  });
});
