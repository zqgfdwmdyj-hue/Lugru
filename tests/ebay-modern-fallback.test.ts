import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const recordJob = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/today/jobs", () => ({ recordJob: (...a: unknown[]) => recordJob(...a) }));

const { withModern, MODERN_JOB } = await import("@/lib/ebay/modern");
const { ListingApiError, ListingScopeError } = await import("@/lib/ebay/listing-api");

// Rückfall von der neuen eBay-Schnittstelle auf die Trading API. Fiktive Mandanten.

let n = 0;
const tenant = () => `mandant-test-${++n}`;

beforeEach(() => {
  recordJob.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("withModern", () => {
  it("nimmt den neuen Weg und meldet Erfolg", async () => {
    const t = tenant();
    const legacy = vi.fn(async () => "alt");
    expect(await withModern(t, "Test", async () => "neu", legacy)).toBe("neu");
    expect(legacy).not.toHaveBeenCalled();
    expect(recordJob).toHaveBeenCalledWith(t, MODERN_JOB, null);
  });

  it("fällt bei Fehlern auf die Trading API zurück und schreibt es in den Datenstand", async () => {
    const t = tenant();
    const r = await withModern(t, "Angebot lesen", async () => { throw new ListingApiError("eBay (Listing API): HTTP 500"); }, async () => "alt");
    expect(r).toBe("alt");
    expect(recordJob).toHaveBeenCalledWith(t, MODERN_JOB, expect.stringMatching(/^Angebot lesen: .*HTTP 500.*bisherige Schnittstelle genutzt/));
    // Ein gewöhnlicher Fehler pausiert den neuen Weg nicht.
    const modern = vi.fn(async () => "neu");
    expect(await withModern(t, "Test", modern, async () => "alt")).toBe("neu");
    expect(modern).toHaveBeenCalledOnce();
  });

  it("fehlende Berechtigung: 30 Minuten lang gleich der alte Weg", async () => {
    const t = tenant();
    await withModern(t, "Test", async () => { throw new ListingScopeError("keine Berechtigung"); }, async () => "alt");
    const modern = vi.fn(async () => "neu");
    expect(await withModern(t, "Test", modern, async () => "alt")).toBe("alt");
    expect(modern).not.toHaveBeenCalled();
    // Andere Mandanten sind nicht betroffen.
    expect(await withModern(tenant(), "Test", modern, async () => "alt")).toBe("neu");
  });

  it("Verbindung ohne neue Berechtigung oder Notbremse: alter Weg ohne Fehlermeldung", async () => {
    const modern = vi.fn(async () => "neu");
    expect(await withModern(tenant(), "Test", modern, async () => "alt", false)).toBe("alt");
    vi.stubEnv("EBAY_TRADING_ONLY", "1");
    expect(await withModern(tenant(), "Test", modern, async () => "alt", true)).toBe("alt");
    expect(modern).not.toHaveBeenCalled();
    expect(recordJob).not.toHaveBeenCalled();
  });

  it("schlägt auch der alte Weg fehl, kommt dessen Fehler beim Aufrufer an", async () => {
    await expect(withModern(tenant(), "Test", async () => { throw new Error("neu kaputt"); }, async () => { throw new Error("alt kaputt"); })).rejects.toThrow("alt kaputt");
  });
});
