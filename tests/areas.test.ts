import { describe, expect, it } from "vitest";
import { areaForPath, brandAllowed, canAccess, homeFor } from "@/lib/auth/areas";

describe("Bereiche und Rechte", () => {
  it("ordnet Pfade Bereichen zu", () => {
    expect(areaForPath("/")).toBe("start");
    expect(areaForPath("/marken/ideen/123")).toBe("marken");
    expect(areaForPath("/api/ebay/invoices")).toBe("ebay");
    expect(areaForPath("/ebay")).toBe("ebay");
    expect(areaForPath("/einkaufsliste")).toBeNull(); // nur ganze Pfadteile
    expect(areaForPath("/einstellungen")).toBeNull();
    expect(areaForPath("/login")).toBeNull();
  });

  it("prüft Zugriff und Startseite", () => {
    const staff = { role: "staff" as const, areas: ["marken", "kalender"] };
    expect(canAccess(staff, "marken")).toBe(true);
    expect(canAccess(staff, "geld")).toBe(false);
    expect(canAccess(staff, null)).toBe(true);
    expect(canAccess({ role: "staff", areas: null }, "geld")).toBe(true);
    expect(canAccess({ role: "owner", areas: [] }, "geld")).toBe(true);
    expect(homeFor(staff)).toBe("/kalender");
    expect(homeFor({ role: "staff", areas: ["marken"] })).toBe("/marken");
    expect(homeFor({ role: "staff", areas: [] })).toBe("/kein-zugriff");
    expect(brandAllowed(["a"], "staff", "b")).toBe(false);
    expect(brandAllowed(null, "staff", "b")).toBe(true);
  });
});

describe("Einträge mit Links", () => {
  it("prüft Bereich und Marke", async () => {
    const { linkAllowed } = await import("@/lib/auth/areas");
    const a = { role: "staff" as const, areas: ["marken", "kalender"], brandIds: ["zeit"] };
    expect(linkAllowed(a, "/marken?marke=zeit&anlass=halloween")).toBe(true);
    expect(linkAllowed(a, "/marken?marke=grulu&anlass=halloween")).toBe(false);
    expect(linkAllowed(a, "/gewinn")).toBe(false);
    expect(linkAllowed(a, "/kalender")).toBe(true);
  });
});

import { areaForPath as afp, canAccess as ca } from "@/lib/auth/areas";

describe("Lieferanten-Feeds als eigener Bereich", () => {
  it("eigener Pfad, eigene Freigabe, WaWi behält Zugriff", () => {
    expect(afp("/lieferanten/abc")).toBe("lieferanten");
    expect(ca({ role: "staff", areas: ["marken", "lieferanten"] }, "lieferanten")).toBe(true);
    expect(ca({ role: "staff", areas: ["marken", "lieferanten"] }, "wawi")).toBe(false);
    expect(ca({ role: "staff", areas: ["wawi"] }, "lieferanten")).toBe(true);
    expect(ca({ role: "staff", areas: ["marken"] }, "lieferanten")).toBe(false);
  });
});
