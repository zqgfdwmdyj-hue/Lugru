import { describe, expect, it } from "vitest";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { activeItem, NAV, visibleNav } from "@/lib/nav";

// Navigation: aktiver Bereich und Unterpunkt, Sichtbarkeit nach Rechten.

const act = (url: string) => {
  const u = new URL(url, "http://x");
  const a = activeItem(NAV, u.pathname, u.searchParams);
  return a && `${a.section.key} › ${a.item.label}`;
};

describe("aktiver Menüpunkt", () => {
  it("längster Pfad und passende Ansicht gewinnen", () => {
    expect(act("/")).toBe("heute › Tagesübersicht");
    expect(act("/?ansicht=liste&zeit=heute")).toBe("heute › Alle Aufgaben");
    expect(act("/?kat=geld")).toBe("heute › Alle Aufgaben");
    expect(act("/ebay")).toBe("verkauf › Neues eBay-Angebot");
    expect(act("/ebay?ansicht=artikel")).toBe("verkauf › eBay-Artikel & Gewinn");
    expect(act("/ebay?ansicht=rechnungen")).toBe("finanzen › eBay-Rechnungen");
    expect(act("/ebay/pruefen/123")).toBe("verkauf › eBay-Angebote prüfen");
    expect(act("/rechnungen/abc")).toBe("finanzen › Eingangsrechnungen");
    expect(act("/rechnungen/ausgang/neu")).toBe("finanzen › Ausgangsrechnungen");
    expect(act("/listings/temu")).toBe("verkauf › eBay → Temu / Wawi");
    expect(act("/listings/xyz")).toBe("verkauf › Angebote (alle Kanäle)");
    expect(act("/einkauf/beschaffungsanalyse")).toBe("einkauf › Dropship-Trackings");
    expect(act("/einkauf/123")).toBe("einkauf › Einkauf & Wareneingang");
    expect(act("/marken/ideen/5")).toBe("marken › Ideen & Saison");
    expect(act("/lieferanten/finden?land=DE")).toBe("einkauf › Großhändler finden");
    expect(act("/privat/tagebuch")).toBe("privat › Privat");
    expect(act("/import")).toBe("hilfe › Daten importieren");
    expect(act("/login")).toBeNull();
  });
});

describe("Sichtbarkeit", () => {
  const keys = (owner: boolean, areas: string[] | null, privateAccess = false) =>
    visibleNav((p) => canAccess({ role: owner ? "owner" : "staff", areas, privateAccess }, areaForPath(p)), owner).map((s) => `${s.key}:${s.items.length}`);
  it("Inhaber ohne Privat-Recht sieht alle Geschäftsbereiche, Privat nicht", () => {
    const k = keys(true, null);
    expect(k.some((x) => x.startsWith("privat"))).toBe(false);
    expect(k).toContain("hilfe:5");
  });
  it("Mitarbeiter nur mit „Geld“: Finanzen mit Gewinn, Cash Flow und Hebel, keine Inhaber-Punkte", () => {
    const sections = visibleNav((p) => canAccess({ role: "staff", areas: ["geld"] }, areaForPath(p)), false);
    const fin = sections.find((s) => s.key === "finanzen")!;
    expect(fin.items.map((i) => i.label)).toEqual(["Gewinn", "Cash Flow", "Hebel: Umsatz & Marge"]);
    expect(sections.find((s) => s.key === "verkauf")).toBeUndefined();
    // Wissen und Importe sind eigene Bereiche, Einstellungen nur für Inhaber – also keine Hilfsfunktionen.
    expect(sections.find((s) => s.key === "hilfe")).toBeUndefined();
  });
  it("jede Adresse kommt nur einmal vor", () => {
    const hrefs = NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
