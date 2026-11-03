import { describe, expect, it } from "vitest";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { activeItem, HANDY_TABS, MAX_FAVORITEN, NAV, navCounters, offeneAusCookie, startOffen, visibleNav } from "@/lib/nav";

// Navigation links: Reihenfolge der Gruppen, aktiver Bereich und Unterpunkt, Sichtbarkeit nach Rechten, gemerkte Gruppen.

const act = (url: string) => {
  const u = new URL(url, "http://x");
  const a = activeItem(NAV, u.pathname, u.searchParams);
  return a && `${a.section.key} › ${a.item.label}`;
};

describe("Gruppen in der Reihenfolge des Bauauftrags", () => {
  it("Heute · Einkauf · Amazon · … · Finanzen · Produkte & Lager · B2B · … · Delegation · Wissen & Calls · Privat · Einstellungen", () => {
    expect(NAV.map((s) => s.label)).toEqual(["Heute", "Einkauf", "Amazon", "eBay & Temu", "Finanzen", "Produkte & Lager", "B2B", "Marken & Content", "Delegation", "Wissen & Calls", "Privat", "Einstellungen"]);
    const labels = (k: string) => NAV.find((s) => s.key === k)!.items.map((i) => i.label);
    expect(labels("einkauf").slice(0, 5)).toEqual(["Deal-Eingang", "Lugru Deals", "Bestellvorschläge", "EK-Import (→ sellerboard)", "Scanner (Barcode mit Ampel)"]);
    expect(labels("amazon").slice(0, 5)).toEqual(["Fall-Zentrale", "Amazon-ToDos", "Repricer (BQool)", "Listungen (alle Kanäle)", "SAS-Programm"]);
    expect(labels("finanzen").slice(0, 5)).toEqual(["Gewinn", "Liquidität", "Buchhaltung (Abgleich, DATEV)", "Importe (Daten importieren)", "Verlust-Stopp"]);
    expect(labels("produkte").slice(0, 3)).toEqual(["Bestand & Inventur", "Paletten-Lager (Kunden)", "Retouren-Station & Fälle"]);
    expect(labels("delegation")).toEqual(["VA & Delegation", "Alle Aufgaben", "Anrufe (im Tagesplan)"]);
    expect(labels("wissen")).toEqual(["Wissen", "Calls (Consultant & Gruppe)"]);
    expect(MAX_FAVORITEN).toBe(6);
    expect(HANDY_TABS.map((t) => t.label)).toEqual(["Heute", "Scan", "Deals", "Aufgaben"]);
  });
});

describe("aktiver Menüpunkt", () => {
  it("längster Pfad und passende Ansicht gewinnen – alte Adressen bleiben gültig", () => {
    expect(act("/")).toBe("heute › Tagesübersicht");
    expect(act("/?ansicht=liste&zeit=heute")).toBe("delegation › Alle Aufgaben");
    expect(act("/?kat=geld")).toBe("delegation › Alle Aufgaben");
    expect(act("/kalender/tagesplan")).toBe("heute › Tagesplan");
    expect(act("/kalender/tagesplan?anrufe=1")).toBe("delegation › Anrufe (im Tagesplan)");
    expect(act("/deal-eingang/lugru")).toBe("einkauf › Lugru Deals");
    expect(act("/deal-eingang/abc")).toBe("einkauf › Deal-Eingang");
    expect(act("/einkauf/vorschlaege")).toBe("einkauf › Bestellvorschläge");
    expect(act("/scan")).toBe("einkauf › Scanner (Barcode mit Ampel)");
    expect(act("/ebay")).toBe("marktplaetze › Neues eBay-Angebot");
    expect(act("/ebay?ansicht=artikel")).toBe("marktplaetze › eBay-Artikel & Gewinn");
    expect(act("/ebay?ansicht=rechnungen")).toBe("finanzen › eBay-Rechnungen");
    expect(act("/ebay?ansicht=einstellungen")).toBe("einstellungen › eBay-Einstellungen");
    expect(act("/ebay/pruefen/123")).toBe("marktplaetze › eBay-Angebote prüfen");
    expect(act("/rechnungen/abc")).toBe("finanzen › Eingangsrechnungen");
    expect(act("/rechnungen/ausgang/neu")).toBe("finanzen › Ausgangsrechnungen");
    expect(act("/listings/temu")).toBe("marktplaetze › eBay → Temu / Wawi");
    expect(act("/listings/xyz")).toBe("amazon › Listungen (alle Kanäle)");
    expect(act("/auftraege/123")).toBe("produkte › Aufträge & Versand");
    expect(act("/auftraege/lieferschein")).toBe("produkte › Labels: Warensendung & DHL");
    expect(act("/remissionen/pruefungen/7")).toBe("produkte › Retouren-Station & Fälle");
    expect(act("/ansprueche")).toBe("amazon › Ansprüche");
    expect(act("/sas")).toBe("amazon › SAS-Programm");
    expect(act("/inbound/abc")).toBe("amazon › FBA-Inbound");
    expect(act("/calls/offen")).toBe("wissen › Calls (Consultant & Gruppe)");
    expect(act("/b2b/neu")).toBe("b2b › Deals");
    expect(act("/paletten/sendungen")).toBe("produkte › Paletten-Lager (Kunden)");
    expect(act("/einkauf/123")).toBe("einkauf › Einkauf & Wareneingang");
    expect(act("/marken/ideen/5")).toBe("marken › Ideen & Saison");
    expect(act("/privat/tagebuch")).toBe("privat › Übersicht");
    expect(act("/privat/kalender?ansicht=monat")).toBe("privat › Kalender");
    expect(act("/import")).toBe("finanzen › Importe (Daten importieren)");
    expect(act("/einstellungen/shop-profile")).toBe("einstellungen › Shop-Profile & Payback");
    expect(act("/login")).toBeNull();
  });
});

describe("Sichtbarkeit", () => {
  const keys = (owner: boolean, areas: string[] | null, privateAccess = false) =>
    visibleNav((p) => canAccess({ role: owner ? "owner" : "staff", areas, privateAccess }, areaForPath(p)), owner).map((s) => `${s.key}:${s.items.length}`);
  it("Inhaber ohne Privat-Recht sieht alle Geschäftsbereiche, Privat nicht", () => {
    const k = keys(true, null);
    expect(k.some((x) => x.startsWith("privat"))).toBe(false);
    expect(k).toContain("einstellungen:8");
  });
  it("Mitarbeiter nur mit „Geld“: Finanzen mit Gewinn, Liquidität, Hebel, Kapital-Ampel, Verlust-Stopp und Buchhaltung, keine Inhaber-Punkte", () => {
    const sections = visibleNav((p) => canAccess({ role: "staff", areas: ["geld"] }, areaForPath(p)), false);
    const fin = sections.find((s) => s.key === "finanzen")!;
    expect(fin.items.map((i) => i.label)).toEqual(["Gewinn", "Liquidität", "Buchhaltung (Abgleich, DATEV)", "Verlust-Stopp", "Hebel: Umsatz & Marge", "Kapital-Ampel"]);
    expect(sections.find((s) => s.key === "produkte")).toBeUndefined();
    // Einstellungen nur für Inhaber – die Gruppe fehlt ganz.
    expect(sections.find((s) => s.key === "einstellungen")).toBeUndefined();
    expect(sections.find((s) => s.key === "privat")).toBeUndefined();
  });
  it("Mitarbeiter nur „Amazon“: nur die freigegebenen Amazon-Punkte, keine Inhaber-Punkte", () => {
    const amazonStaff = visibleNav((p) => canAccess({ role: "staff", areas: ["amazon"] }, areaForPath(p)), false);
    expect(amazonStaff.find((s) => s.key === "amazon")!.items.map((i) => i.label)).toEqual(["SAS-Programm", "FBA-Inbound", "Ansprüche", "Amazon Business", "Echtheits-Ordner"]);
    expect(amazonStaff.some((s) => s.key === "marktplaetze" || s.key === "einstellungen")).toBe(false);
  });
  it("Privat-Block nur mit Privat-Zugriff", () => {
    expect(keys(true, null, true)).toContain("privat:5");
    expect(keys(false, ["verkauf"], false).some((x) => x.startsWith("privat"))).toBe(false);
  });
  it("jede Adresse kommt nur einmal vor", () => {
    const hrefs = NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("verdichtete Seitenleiste", () => {
  const counts = { tasks: 5, inbox: 0, orders: 12, claims: 3, invoices: 2262, amazonTodos: 1, pallets: 0 };
  it("Zählerzeile: nur Punkte mit Zähler, Handlungsbedarf zuerst, dann nach Anzahl", () => {
    const c = navCounters(NAV, counts);
    expect(c.map((x) => `${x.label}:${x.n}`)).toEqual(["Aufgaben:5", "Amazon-ToDos:1", "Belege prüfen:2262", "Versand:12", "Ansprüche:3"]);
    expect(c.every((x) => x.n > 0)).toBe(true);
    expect(c[0]).toMatchObject({ href: "/", alert: true, section: "heute" });
  });
  it("Zählerzeile berücksichtigt nur sichtbare Bereiche", () => {
    const staff = visibleNav((p) => canAccess({ role: "staff", areas: ["verkauf"], privateAccess: false }, areaForPath(p)), false);
    const c = navCounters(staff, counts);
    expect(c.some((x) => x.label === "Belege prüfen")).toBe(false);
    expect(c.some((x) => x.label === "Amazon-ToDos")).toBe(false);
  });
  it("gemerkte Gruppen + aktuelle; im Privatbereich nur der Privat-Block", () => {
    expect(offeneAusCookie("heute,einkauf,b2b, 1x ,<script>")).toEqual(["heute", "einkauf", "b2b"]);
    expect([...startOffen(["finanzen"], "amazon", false)].sort()).toEqual(["amazon", "finanzen"]);
    expect([...startOffen(["finanzen", "privat"], null, false)]).toEqual(["finanzen"]);
    expect([...startOffen(["finanzen"], "privat", true)]).toEqual(["privat"]);
  });
});
