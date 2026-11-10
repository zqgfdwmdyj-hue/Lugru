import { describe, expect, it } from "vitest";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { VA_BEREICHE } from "@/lib/auth/rollen";
import { activeItem, badgeSumme, HANDY_TABS, MAX_BLOCK, MAX_FAVORITEN, NAV, navBloecke, navCounters, navOrt, NEBENSEITEN, offeneAusCookie, sichtbareNebenseiten, startZustand, SUBPAGES, visibleNav, zustandAlsCookie } from "@/lib/nav";

// Menü-Umbau 06.11.: 11 Gruppen, 82 Einträge (+1 „Privat › Nachrichten“ aus B32 = 83; 35 in Untergruppen), kein Block über 8 Zeilen, Nebenseiten als Reiter,
// Akkordeon-Zustand, Zähler-Chips, Sichtbarkeit nach Rollen wie vorher.

const act = (url: string) => {
  const u = new URL(url, "http://x");
  const a = activeItem(NAV, u.pathname, u.searchParams);
  return a && `${navOrt(a.section, a.item)} › ${a.item.label}`;
};

// Alle 100 Einträge der alten Leiste (Abschnitt 5 des Auftrags): Pfad → neuer Ort.
const ALT: [string, string][] = [
  ["/", "Heute"], ["/kalender/tagesplan", "Heute"], ["/kalender", "Heute"], ["/posteingang", "Heute"], ["/uploads", "Heute"], ["/schnell", "Heute"], ["/kalender/feierabend", "Heute"], ["/kalender/fahrten", "Heute"],
  ["/rechtsfaelle", "Team & Verwaltung"],
  ["/deal-eingang", "Einkauf & Deals"], ["/deal-eingang/lugru", "Einkauf & Deals"], ["/einkauf/vorschlaege", "Einkauf & Deals"], ["/einkauf/ek-import", "Einkauf & Deals"], ["/scan", "Einkauf & Deals"], ["/lieferanten/deal-ampel", "Einkauf & Deals"], ["/einkauf", "Einkauf & Deals"], ["/einkauf/beschaffungsanalyse", "Einkauf & Deals"],
  ["/lieferanten", "Einkauf & Deals › Lieferanten"], ["/lieferanten/abfrage", "Einkauf & Deals › Lieferanten"], ["/lieferanten/chancen", "Einkauf & Deals › Lieferanten"], ["/lieferanten/finden", "Einkauf & Deals › Lieferanten"], ["/board", "Einkauf & Deals › Lieferanten"],
  ["/amazon-faelle", "Amazon › Fälle & Erstattungen"], ["/amazon-todos", "Amazon › Fälle & Erstattungen"], ["/ansprueche", "Amazon › Fälle & Erstattungen"], ["/faelle", "Amazon › Fälle & Erstattungen"], ["/echtheit", "Amazon › Fälle & Erstattungen"],
  ["/repricer", "Amazon › Angebote & Lager"], ["/listings", "Amazon › Angebote & Lager"], ["/sas", "Amazon › Angebote & Lager"], ["/inbound", "Amazon › Angebote & Lager"], ["/bewertungen", "Amazon › Angebote & Lager"], ["/amazon-business", "Amazon › Angebote & Lager"],
  ["/ebay", "eBay & Temu"], ["/ebay/pruefen", "eBay & Temu"], ["/listings/temu", "eBay & Temu"],
  ["/gewinn", "Finanzen"], ["/cashflow", "Finanzen"], ["/buchhaltung", "Finanzen"], ["/import", "Finanzen"], ["/verlust", "Finanzen"], ["/hebel", "Finanzen"], ["/kapital", "Finanzen"], ["/export", "Finanzen"],
  ["/rechnungen", "Finanzen › Rechnungen"], ["/rechnungen/belege", "Finanzen › Rechnungen"], ["/rechnungsstation", "Finanzen › Rechnungen"], ["/rechnungsstation/pruefen", "Finanzen › Rechnungen"], ["/rechnungen/ausgang", "Finanzen › Rechnungen"], ["/rechnungen/kunden", "Finanzen › Rechnungen"],
  ["/bestand", "Lager & Versand › Lager"], ["/paletten", "Lager & Versand › Lager"], ["/produkte", "Lager & Versand › Lager"], ["/chargen", "Lager & Versand › Lager"], ["/artikel", "Lager & Versand › Lager"],
  ["/auftraege", "Lager & Versand › Versand"], ["/auftraege/lieferschein", "Lager & Versand › Versand"], ["/versand/label", "Lager & Versand › Versand"], ["/versand/abholung", "Lager & Versand › Versand"], ["/auftraege/prep-center", "Lager & Versand › Versand"],
  ["/remissionen/pruefungen", "Lager & Versand › Retouren"], ["/retouren", "Lager & Versand › Retouren"], ["/remissionen", "Lager & Versand › Retouren"],
  ["/b2b", "B2B"], ["/b2b/preislisten", "B2B"], ["/b2b/kunden", "B2B"], ["/b2b/lieferanten", "B2B"], ["/b2b/bilanz", "B2B"],
  ["/marken", "Marken & Content"], ["/marken/content", "Marken & Content"], ["/marken/shop", "Marken & Content"], ["/marken/profile", "Marken & Content"], ["/marken/uhren", "Marken & Content"],
  ["/delegation", "Team & Verwaltung"], ["/wissen", "Team & Verwaltung"], ["/calls", "Team & Verwaltung"],
  ["/privat", "Privat"], ["/privat/kalender", "Privat"], ["/privat/eintragen", "Privat"], ["/privat/rueckblick", "Privat"], ["/privat/einstellungen", "Privat"],
  ["/einstellungen", "Einstellungen"],
];
// Entfallen als eigener Eintrag (Abschnitt 6) – Reiter/Kachel auf ihrer Hauptseite, über Strg+K findbar.
const ENTFALLEN = ["/?ansicht=liste", "/kalender/tagesplan?anrufe=1", "/ebay?ansicht=artikel", "/ebay?ansicht=verlauf", "/ebay?ansicht=rechnungen", "/ebay?ansicht=einstellungen", "/listings/temu#rechner", "/anbindungen", "/einstellungen/claude", "/einstellungen/handy", "/einstellungen/watch", "/einstellungen/benachrichtigungen", "/einstellungen/shop-profile"];

describe("Zielstruktur (Abschnitt 4)", () => {
  it("11 Gruppen in der Reihenfolge des Auftrags, 87 Einträge (82 + Privat › Nachrichten + Drucken/Scannen + B34 Download-Ordner/Abverkauf), 38 in Untergruppen, direkt 49", () => {
    expect(NAV.map((s) => s.label)).toEqual(["Heute", "Einkauf & Deals", "Amazon", "eBay & Temu", "Lager & Versand", "Finanzen", "B2B", "Marken & Content", "Team & Verwaltung", "Privat", "Einstellungen"]);
    const alle = NAV.flatMap((s) => s.items);
    expect(alle).toHaveLength(87);
    expect(alle.filter((i) => i.unter)).toHaveLength(38);
    expect(alle.filter((i) => !i.unter)).toHaveLength(49);
    expect(new Set(alle.map((i) => i.href)).size).toBe(87);
    // Druckagent (08.11.): Lager › Drucken und Scannen
    expect(NAV.find((s) => s.key === "lager")!.items.filter((i) => i.unter === "lager").map((i) => i.href)).toEqual(expect.arrayContaining(["/drucken", "/lager/scannen"]));
    expect(NAV.find((s) => s.key === "privat")!.items.map((i) => i.href)).toContain("/privat/nachrichten");
  });
  it("kein Block länger als 8 Zeilen; Untergruppen nur mit eigenem Thema; Gruppen mit weniger als 4 Einträgen nur für eBay & Temu (3 Seiten) und Einstellungen (1)", () => {
    for (const s of NAV) for (const b of navBloecke(s)) expect(b.items.length, `${s.label} › ${b.unter?.label ?? "direkt"}`).toBeLessThanOrEqual(MAX_BLOCK);
    expect(NAV.flatMap((s) => (s.untergruppen ?? []).map((u) => `${s.label} › ${u.label}`))).toEqual(["Einkauf & Deals › Lieferanten", "Amazon › Fälle & Erstattungen", "Amazon › Angebote & Lager", "Lager & Versand › Lager", "Lager & Versand › Versand", "Lager & Versand › Retouren", "Finanzen › Rechnungen"]);
    expect(NAV.filter((s) => s.items.length < 4).map((s) => s.key)).toEqual(["marktplaetze", "einstellungen"]);
    // Jeder Eintrag mit Untergruppe verweist auf eine vorhandene
    for (const s of NAV) for (const it of s.items) if (it.unter) expect(s.untergruppen?.some((u) => u.key === it.unter)).toBe(true);
  });
  it("Bezeichnungen laut Auftrag", () => {
    const labels = (k: string) => NAV.find((s) => s.key === k)!.items.map((i) => i.label);
    expect(labels("heute")).toEqual(["Tagesübersicht", "Tagesplan (Anrufe)", "Termine", "Posteingang", "Uploads", "Schnellerfassung", "Feierabend", "Fahrtenbuch"]);
    expect(labels("einkauf").slice(0, 4)).toEqual(["Deal-Eingang", "Lugru Deals", "Deal-Ampel", "Scanner"]);
    expect(labels("marktplaetze")).toEqual(["eBay", "Angebote prüfen", "Temu / Wawi"]);
    expect(labels("team")).toEqual(["VA & Delegation", "Wissen", "Calls (Consultant & Gruppe)", "Rechtsfälle (Anwalt)"]);
    expect(labels("einstellungen")).toEqual(["Einstellungen"]);
    expect(MAX_FAVORITEN).toBe(8);
    expect(HANDY_TABS.map((t) => t.label)).toEqual(["Heute", "Scan", "Deals", "Aufgaben"]);
  });
});

describe("Zuordnung alt → neu (Abschnitte 5 und 6)", () => {
  it("jede alte Seite hat genau einen Eintrag am neuen Ort", () => {
    for (const [href, ort] of ALT) {
      const treffer = NAV.flatMap((s) => s.items.filter((i) => i.href === href).map((i) => navOrt(s, i)));
      expect(treffer, href).toEqual([ort]);
    }
    // 88 verschiedene alte Seiten: 82 mit Eintrag, dazu /anbindungen und 5 Einstellungs-Unterseiten als Reiter
    const seiten = new Set([...ALT.map(([h]) => h), ...ENTFALLEN.map((h) => h.split(/[?#]/)[0])]);
    expect(seiten.size).toBe(88);
  });
  it("entfallene Einträge: Reiter/Kachel auf der Hauptseite und über Strg+K findbar", () => {
    const hauptmenue = new Set(NAV.flatMap((s) => s.items.map((i) => i.href)));
    const reiter = new Set(Object.values(SUBPAGES).flatMap((l) => l.map((i) => i.href)));
    for (const h of ENTFALLEN) {
      expect(hauptmenue.has(h), h).toBe(false);
      expect(NEBENSEITEN.some((n) => n.href === h), h).toBe(true);
    }
    for (const h of ["/anbindungen", "/einstellungen/claude", "/einstellungen/handy", "/einstellungen/watch", "/einstellungen/benachrichtigungen", "/einstellungen/shop-profile", "/einstellungen/testumgebung", "/einstellungen/hintergrund"]) expect(reiter.has(h), h).toBe(true);
    // Reiter „Hintergrund & Importe“ (neu): direkt nach Anbindungen und KI-Assistent, nur Inhaber, über Strg+K findbar
    expect(SUBPAGES["/einstellungen"].map((i) => i.label).slice(1, 4)).toEqual(["Anbindungen", "KI-Assistent", "Hintergrund & Importe"]);
    expect(NEBENSEITEN.find((n) => n.href === "/einstellungen/hintergrund")?.owner).toBe(true);
    expect(NEBENSEITEN.find((n) => n.href === "/ebay?ansicht=rechnungen")?.wo).toBe("eBay & Temu › eBay (Reiter)");
  });
});

describe("aktiver Eintrag mit Gruppe › Untergruppe", () => {
  it("längster Pfad gewinnt – alte Adressen bleiben gültig", () => {
    expect(act("/")).toBe("Heute › Tagesübersicht");
    expect(act("/?ansicht=liste&zeit=heute")).toBe("Heute › Tagesübersicht");
    expect(act("/kalender/tagesplan?anrufe=1")).toBe("Heute › Tagesplan (Anrufe)");
    expect(act("/deal-eingang/lugru")).toBe("Einkauf & Deals › Lugru Deals");
    expect(act("/deal-eingang/abc")).toBe("Einkauf & Deals › Deal-Eingang");
    expect(act("/lieferanten/deal-ampel")).toBe("Einkauf & Deals › Deal-Ampel");
    expect(act("/lieferanten/123")).toBe("Einkauf & Deals › Lieferanten › Feeds");
    expect(act("/ebay?ansicht=artikel")).toBe("eBay & Temu › eBay");
    expect(act("/ebay?ansicht=rechnungen")).toBe("eBay & Temu › eBay");
    expect(act("/ebay/pruefen/123")).toBe("eBay & Temu › Angebote prüfen");
    expect(act("/listings/temu")).toBe("eBay & Temu › Temu / Wawi");
    expect(act("/listings/xyz")).toBe("Amazon › Angebote & Lager › Listungen (alle Kanäle)");
    expect(act("/ansprueche")).toBe("Amazon › Fälle & Erstattungen › Ansprüche");
    expect(act("/inbound/abc")).toBe("Amazon › Angebote & Lager › FBA-Inbound");
    expect(act("/rechnungen/abc")).toBe("Finanzen › Rechnungen › Eingangsrechnungen");
    expect(act("/rechnungsstation/pruefen?stapel=x")).toBe("Finanzen › Rechnungen › Rechnungsstation: Prüfliste");
    expect(act("/auftraege/123")).toBe("Lager & Versand › Versand › Aufträge & Versand");
    expect(act("/remissionen/pruefungen/7")).toBe("Lager & Versand › Retouren › Retouren-Station & Fälle");
    expect(act("/paletten/sendungen")).toBe("Lager & Versand › Lager › Paletten-Lager");
    expect(act("/calls/offen")).toBe("Team & Verwaltung › Calls (Consultant & Gruppe)");
    expect(act("/rechtsfaelle/5")).toBe("Team & Verwaltung › Rechtsfälle (Anwalt)");
    expect(act("/privat/kalender?ansicht=monat")).toBe("Privat › Kalender");
    expect(act("/einstellungen/shop-profile")).toBe("Einstellungen › Einstellungen");
    expect(act("/anbindungen")).toBe("Einstellungen › Einstellungen");
    expect(act("/login")).toBeNull();
  });
});

describe("Sichtbarkeit nach Rollen (wie vorher)", () => {
  const sicht = (owner: boolean, areas: string[] | null, privateAccess = false) => visibleNav((p) => canAccess({ role: owner ? "owner" : "staff", areas, privateAccess }, areaForPath(p)), owner);
  it("Inhaber ohne Privat-Recht: alle Geschäftsgruppen, Privat nicht", () => {
    const k = sicht(true, null).map((s) => s.key);
    expect(k).toEqual(["heute", "einkauf", "amazon", "marktplaetze", "lager", "finanzen", "b2b", "marken", "team", "einstellungen"]);
    expect(sicht(true, null, true).some((s) => s.key === "privat")).toBe(true);
  });
  it("VA-Rolle: kein Privat, kein Geld, keine Einstellungen; leere Untergruppen fallen weg", () => {
    const va = sicht(false, [...VA_BEREICHE]);
    const hrefs = va.flatMap((s) => s.items.map((i) => i.href));
    expect(va.some((s) => s.key === "privat" || s.key === "einstellungen")).toBe(false);
    for (const h of ["/gewinn", "/cashflow", "/kapital", "/hebel", "/verlust", "/buchhaltung", "/amazon-faelle", "/amazon-todos", "/delegation", "/rechtsfaelle"]) expect(hrefs).not.toContain(h);
    const fin = va.find((s) => s.key === "finanzen")!;
    expect(fin.items.map((i) => i.label)).toEqual(["Rechnungsstation (Kamera)", "Rechnungsstation: Prüfliste", "Belegablage (Drive, Download-Ordner)"]);
    expect(fin.untergruppen?.map((u) => u.key)).toEqual(["rechnungen"]);
    expect(navBloecke(fin).map((b) => b.unter?.key ?? "direkt")).toEqual(["rechnungen"]);
    expect(sichtbareNebenseiten((p) => canAccess({ role: "staff", areas: [...VA_BEREICHE] }, areaForPath(p)), false).some((n) => n.href.startsWith("/einstellungen") || n.href === "/anbindungen")).toBe(false);
  });
  it("nur „Geld“: Finanzen direkt + Rechnungsstation, keine Inhaber-Punkte", () => {
    const fin = sicht(false, ["geld"]).find((s) => s.key === "finanzen")!;
    expect(fin.items.map((i) => i.label)).toEqual(["Gewinn", "Liquidität", "Kapital-Ampel", "Hebel: Umsatz & Marge", "Verlust-Stopp", "Buchhaltung (Abgleich, DATEV)", "Rechnungsstation (Kamera)", "Rechnungsstation: Prüfliste", "Belegablage (Drive, Download-Ordner)"]);
    expect(sicht(false, ["geld"]).some((s) => s.key === "lager" || s.key === "einstellungen")).toBe(false);
  });
  it("Druckagent: Drucken/Scannen für VA, Lager und Amazon – nicht für reine Geld-Konten", () => {
    const hrefs = (areas: string[]) => sicht(false, areas).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs([...VA_BEREICHE])).toEqual(expect.arrayContaining(["/drucken", "/lager/scannen"]));
    expect(hrefs(["paletten"])).toContain("/drucken");
    expect(hrefs(["amazon"])).toContain("/drucken");
    expect(hrefs(["geld"])).not.toContain("/drucken");
  });
  it("nur „Amazon“: nur freigegebene Amazon-Punkte, Untergruppen bleiben", () => {
    const am = sicht(false, ["amazon"]).find((s) => s.key === "amazon")!;
    expect(am.items.map((i) => i.label)).toEqual(["Ansprüche", "Echtheits-Ordner", "FBA-Inbound", "SAS-Programm", "Amazon Business"]);
    expect(am.untergruppen?.map((u) => u.key)).toEqual(["faelle", "angebote"]);
  });
});

describe("Zähler-Chips und Badges", () => {
  const counts = { tasks: 5, inbox: 0, claims: 3, invoices: 2262, amazonTodos: 1 };
  it("fünf feste Chips in fester Reihenfolge, auch bei 0", () => {
    expect(navCounters(NAV, counts).map((c) => `${c.label}:${c.n}`)).toEqual(["Aufgaben:5", "Amazon-ToDos:1", "Posteingang:0", "Belege:2262", "Ansprüche:3"]);
  });
  it("Chips nur für sichtbare Punkte", () => {
    const staff = visibleNav((p) => canAccess({ role: "staff", areas: ["start", "posteingang"] }, areaForPath(p)), false);
    expect(navCounters(staff, counts).map((c) => c.label)).toEqual(["Aufgaben", "Posteingang"]);
  });
  it("Zahlen nur an fünf Einträgen; Summe an zugeklappten Köpfen", () => {
    expect(NAV.flatMap((s) => s.items.filter((i) => i.badge).map((i) => i.label))).toEqual(["Tagesübersicht", "Posteingang", "Amazon-ToDos", "Ansprüche", "Eingangsrechnungen"]);
    const amazon = NAV.find((s) => s.key === "amazon")!;
    expect(badgeSumme(amazon.items, counts)).toEqual({ n: 4, alert: true });
    expect(badgeSumme(amazon.items.filter((i) => i.unter === "angebote"), counts)).toEqual({ n: 0, alert: false });
  });
});

describe("Akkordeon-Zustand", () => {
  it("genau eine Gruppe: aktive, sonst gemerkte, sonst „Heute“; Untergruppe des aktiven Eintrags offen", () => {
    expect(startZustand([], { gruppe: null }, false).gruppe).toBe("heute");
    expect(startZustand(["b2b"], { gruppe: null }, false).gruppe).toBe("b2b");
    const z = startZustand(["b2b", "lager.versand"], { gruppe: "amazon", unter: "angebote" }, false);
    expect(z.gruppe).toBe("amazon");
    expect([...z.unter].sort()).toEqual(["amazon.angebote", "lager.versand"]);
    expect(startZustand(["finanzen"], { gruppe: "privat" }, true)).toEqual({ gruppe: "privat", unter: new Set() });
  });
  it("Cookie: Gruppe und Untergruppen, Privat nie, nur gültige Schlüssel", () => {
    expect(offeneAusCookie("heute,einkauf.lieferanten,b2b, 1x ,<script>,a.b.c")).toEqual(["heute", "einkauf.lieferanten", "b2b"]);
    expect(zustandAlsCookie({ gruppe: "finanzen", unter: new Set(["finanzen.rechnungen"]) })).toBe("finanzen,finanzen.rechnungen");
    expect(zustandAlsCookie({ gruppe: "privat", unter: new Set() })).toBe("");
  });
});
