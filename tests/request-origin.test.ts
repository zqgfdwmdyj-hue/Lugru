import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Rücksprung-Adresse für sellerboard: die Adresse, die der Browser benutzt – nicht APP_URL (interne Tailscale-IP).
describe("requestOrigin", () => {
  const before = process.env.APP_URL;
  beforeEach(() => {
    process.env.APP_URL = "http://100.72.182.44:3020";
  });
  afterEach(() => {
    process.env.APP_URL = before;
  });
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("hinter Caddy: Domain und https aus X-Forwarded-*", async () => {
    const { requestOrigin } = await import("@/lib/oauth/state");
    expect(requestOrigin(req("http://100.72.182.44:3020/api/sellerboard/start", { host: "lugruseller.de", "x-forwarded-host": "lugruseller.de", "x-forwarded-proto": "https" }))).toBe("https://lugruseller.de");
  });

  it("direkt über Tailscale: diese Adresse", async () => {
    const { requestOrigin } = await import("@/lib/oauth/state");
    expect(requestOrigin(req("http://100.72.182.44:3020/api/sellerboard/start", { host: "100.72.182.44:3020" }))).toBe("http://100.72.182.44:3020");
  });

  it("unbrauchbarer Host → APP_URL", async () => {
    const { requestOrigin } = await import("@/lib/oauth/state");
    expect(requestOrigin(req("http://x/api", { host: "evil.example/path", "x-forwarded-host": "evil.example/path" }))).toBe("http://100.72.182.44:3020");
    expect(requestOrigin(req("http://x/api", { host: "lugruseller.de", "x-forwarded-proto": "javascript" }))).toBe("http://100.72.182.44:3020");
  });
});
