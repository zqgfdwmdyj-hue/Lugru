import { describe, expect, it } from "vitest";
import { addressCheck } from "@/lib/public-url";

// Adressen-Check (Einstellungen, Abnahme „keine 100.72…-Adresse in Links“) – erfundene Adressen.

const bad = (r: ReturnType<typeof addressCheck>) => r.findings.filter((f) => !f.ok).map((f) => f.text);

describe("Adressen-Check", () => {
  it("interne Tailscale-Adresse über http: zwei Probleme, Links zeigen auf die interne Adresse", () => {
    const r = addressCheck({ APP_URL: "http://100.72.1.2:3020", PUBLIC_URL: "https://claude.beispiel.de" }, "http://100.72.1.2:3020");
    expect(bad(r)).toEqual([expect.stringContaining("ohne https"), expect.stringContaining("interne Adresse (100.72.1.2)")]);
    expect(r.links.find((l) => l.label.startsWith("Google"))?.url).toBe("http://100.72.1.2:3020/api/oauth/google/callback");
    // Kunden-Links und Claude gehen über die öffentliche Adresse
    expect(r.links.find((l) => l.label.startsWith("Kunden-Link"))?.url).toBe("https://claude.beispiel.de/sendung/…");
    expect(r.links.find((l) => l.label.startsWith("Claude"))?.url).toBe("https://claude.beispiel.de/api/mcp");
  });
  it("nach dem Absichern: alles in Ordnung, keine interne Adresse in einem Link", () => {
    const r = addressCheck({ APP_URL: "https://seller.beispiel.de/", PUBLIC_URL: "https://claude.beispiel.de" }, "https://seller.beispiel.de");
    expect(bad(r)).toEqual([]);
    expect(r.appUrl).toBe("https://seller.beispiel.de");
    expect(r.links.every((l) => !/\/\/(100\.|10\.|192\.168\.|127\.|localhost)/.test(l.url))).toBe(true);
  });
  it("Aufruf über die öffentliche IP mit http, obwohl APP_URL https ist: Hinweis auf andere Adresse und http", () => {
    const r = addressCheck({ APP_URL: "https://seller.beispiel.de" }, "http://203.0.113.7:3020");
    expect(bad(r)).toEqual([expect.stringContaining("gerade unter http://203.0.113.7:3020"), expect.stringContaining("Aufruf über http")]);
  });
  it("Aufruf über die Claude-Adresse zählt nicht als falsche Adresse", () => {
    const r = addressCheck({ APP_URL: "https://seller.beispiel.de", PUBLIC_URL: "https://claude.beispiel.de" }, "https://claude.beispiel.de");
    expect(bad(r)).toEqual([]);
  });
  it("PUBLIC_URL im privaten Netz und fehlende APP_URL werden gemeldet", () => {
    const r = addressCheck({ PUBLIC_URL: "https://10.0.0.5" }, null);
    expect(bad(r)).toEqual([expect.stringContaining("APP_URL fehlt"), expect.stringContaining("privaten Netz")]);
  });
});
