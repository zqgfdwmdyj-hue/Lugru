import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedHosts, assertOutbound, blockedCalls, installTestGuard, isTestEnv, outboundAllowed, TestEnvBlocked } from "@/lib/testenv";

// Testumgebung: nichts darf nach außen – nur dieser Rechner, die Testdienste und ausdrücklich Erlaubtes.

const env = { TESTUMGEBUNG: "1", TESTDIENSTE_URL: "http://testdienste:4010", TEST_ERLAUBT: "api.example-ki.test, extra.test" };

describe("Testumgebung: Sperre nach außen", () => {
  it("nur mit TESTUMGEBUNG=1 aktiv", () => {
    expect(isTestEnv({})).toBe(false);
    expect(isTestEnv(env)).toBe(true);
    expect(outboundAllowed("https://sellingpartnerapi-eu.amazon.com/orders", {})).toBe(true);
  });
  it("erlaubt: localhost, Testdienste, TEST_ERLAUBT – sonst gesperrt", () => {
    expect([...allowedHosts(env)].sort()).toEqual(["127.0.0.1", "::1", "[::1]", "api.example-ki.test", "extra.test", "localhost", "testdienste"].sort());
    expect(outboundAllowed("http://testdienste:4010/amazon/orders", env)).toBe(true);
    expect(outboundAllowed("http://127.0.0.1:3100/api", env)).toBe(true);
    expect(outboundAllowed("https://api.example-ki.test/v1/messages", env)).toBe(true);
    for (const real of ["https://sellingpartnerapi-eu.amazon.com/orders/v0", "https://api.ebay.com/sell/fulfillment", "https://api-eu.dhl.com/parcel", "https://internetmarke.deutschepost.de/", "https://gmail.googleapis.com/send", "https://api.anthropic.com/v1/messages"])
      expect(outboundAllowed(real, env)).toBe(false);
    expect(outboundAllowed("/api/intern", env)).toBe(true);
  });
  it("IMAP/SMTP: fremder Server wirft, lokaler nicht", () => {
    expect(() => assertOutbound("smtp.gmail.com", env)).toThrow(TestEnvBlocked);
    expect(() => assertOutbound("127.0.0.1", env)).not.toThrow();
    expect(() => assertOutbound("smtp.gmail.com", {})).not.toThrow();
  });
});

describe("Testumgebung: fetch-Sperre", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    (globalThis as { __testGuard?: boolean }).__testGuard = false;
  });
  it("sperrt echte Dienste, lässt Testdienste durch und merkt sich Gesperrtes", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    globalThis.fetch = inner as unknown as typeof fetch;
    installTestGuard(env);
    await expect(fetch("https://api.ebay.com/sell/fulfillment/v1/order/1/shipping_fulfillment", { method: "POST" })).rejects.toThrow("Testumgebung: Verbindung nach außen gesperrt (api.ebay.com/sell/fulfillment/v1/order/1/shipping_fulfillment)");
    expect(inner).not.toHaveBeenCalled();
    expect(blockedCalls()[0]).toMatchObject({ target: "api.ebay.com/sell/fulfillment/v1/order/1/shipping_fulfillment", method: "POST" });
    expect(await (await fetch("http://testdienste:4010/__log")).text()).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(1);
  });
  it("ohne TESTUMGEBUNG bleibt fetch unverändert", () => {
    const f = globalThis.fetch;
    installTestGuard({});
    expect(globalThis.fetch).toBe(f);
  });
});

describe("Testumgebung: gesperrt erkennen", () => {
  it("auch ohne instanceof (getrennt gebündelte Module)", async () => {
    const { isBlockedError } = await import("@/lib/testenv");
    expect(isBlockedError(new TestEnvBlocked("x"))).toBe(true);
    const fremd = new Error("Testumgebung: Verbindung nach außen gesperrt (x)");
    expect(isBlockedError(fremd)).toBe(true);
    expect(isBlockedError(new Error("fetch failed"))).toBe(false);
  });
});
