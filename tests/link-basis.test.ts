import { describe, expect, it } from "vitest";
import { linkBasis } from "@/lib/public-url";

// Links fürs Handy (Schnellerfassung, Deal-Eingang): nie „localhost“, solange eine öffentliche Adresse bekannt ist.
// Erfundene Adressen (example.invalid).

const anfrage = (headers: Record<string, string> = {}) => new Request("https://localhost:3000/api/mobil/erfassen", { method: "POST", headers });

describe("linkBasis", () => {
  it("eingestellte Hauptadresse (APP_URL) vor allem anderen", () => {
    expect(linkBasis(anfrage({ host: "localhost:3000" }), { APP_URL: "https://seller.example.invalid/" })).toBe("https://seller.example.invalid");
  });
  it("APP_URL intern → Adresse, unter der die Anfrage ankam (X-Forwarded-Host)", () => {
    expect(linkBasis(anfrage({ host: "localhost:3000", "x-forwarded-host": "seller.example.invalid", "x-forwarded-proto": "https" }), { APP_URL: "http://localhost:3000" })).toBe("https://seller.example.invalid");
  });
  it("nie die Claude-Adresse (PUBLIC_URL), wenn es eine andere öffentliche gibt – dort sind Seiten gesperrt", () => {
    const env = { APP_URL: "https://seller.example.invalid", PUBLIC_URL: "https://claude.example.invalid" };
    expect(linkBasis(anfrage({ "x-forwarded-host": "claude.example.invalid" }), env)).toBe("https://seller.example.invalid");
  });
  it("nur interne Adressen bekannt → bleibt intern (Testbetrieb), kein Absturz bei kaputten Kopfzeilen", () => {
    expect(linkBasis(anfrage({ host: "localhost:3000" }), {})).toBe("https://localhost:3000");
    expect(linkBasis(anfrage({ host: "evil host/../" }), { APP_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
  });
});
