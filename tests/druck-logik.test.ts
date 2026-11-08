import { describe, expect, it } from "vitest";
import { brotherRaster, KOPF, mediumFuer, MEDIEN, modellFuer, rasterZeile, type Graubild, type Medium } from "@/lib/druck/brother";
import { abgelaufen, agentOnline, darfAgentEinstellen, darfDrucken, druckerSymbol, fnskusImText, pdfArt, pushFaellig, RASTER, rasterRaten, scanEinordnen, sendungsnummer, statusNachMeldung, steuerAnzahl, tokenFormOk, VORLAGEN, zellen, type AgentKurz } from "@/lib/druck/logic";

// Druckagent – reine Logik: Brother-Raster, Rechte, Symbol neben dem Druckknopf, Warteschlange, Scanner, PDF-Erkennung.
// Nur erfundene Werte (X00TEST…, FBA15TEST…).

const m62 = mediumFuer("62x29")!;
const m102 = mediumFuer("102x152")!;
const weiss = (b: number, h: number): Graubild => ({ breite: b, hoehe: h, pixel: new Uint8Array(b * h).fill(255) });

describe("Brother-Raster", () => {
  it("Zeile: gespiegelt, rechter Rand, höchstes Bit zuerst (QL-800, 62 mm)", () => {
    const g = weiss(696, 1);
    g.pixel[0] = 0; // ganz links
    g.pixel[695] = 0; // ganz rechts
    const z = rasterZeile(g, 0, "QL-800", m62);
    expect(z.length).toBe(90);
    // x0 = 720 − 696 − 12 = 12 → links: Spiegelpunkt 707 = Byte 88, Bit 0x10; rechts: 12 = Byte 1, Bit 0x08
    expect(z[88]).toBe(0x10);
    expect(z[1]).toBe(0x08);
    expect([...z].filter((b) => b).length).toBe(2);
  });

  it("QL-1100: 162 Byte je Zeile, zusätzlicher Versatz 44", () => {
    const g = weiss(1164, 1);
    g.pixel[0] = 0;
    const z = rasterZeile(g, 0, "QL-1100", m102);
    expect(z.length).toBe(162);
    const x0 = KOPF["QL-1100"].punkte - 1164 - 12 - 44;
    const m = 1296 - 1 - x0;
    expect(z[m >> 3]).toBe(0x80 >> (m & 7));
  });

  it("Auftrag: Rücksetzen, Initialisieren, Medium, 271 Rasterzeilen je Etikett, Schnitt, Drucken", () => {
    const d = brotherRaster([weiss(696, 271)], "QL-800", m62, { anzahl: 2 });
    expect([...d.slice(0, 200)].every((b) => b === 0)).toBe(true);
    expect([...d.slice(200, 206)]).toEqual([0x1b, 0x40, 0x1b, 0x69, 0x61, 0x01]);
    // ESC i z: gültig (Art|Breite|Länge|Wiederherstellung), Etikett 0x0B, 62 × 29 mm, 271 Zeilen
    expect([...d.slice(206, 216)]).toEqual([0x1b, 0x69, 0x7a, 0x8e, 0x0b, 62, 29, 271 & 0xff, 271 >> 8, 0]);
    let zeilen = 0;
    for (let i = 0; i < d.length - 2; i++) if (d[i] === 0x67 && d[i + 1] === 0x00 && d[i + 2] === 90) zeilen++;
    expect(zeilen).toBeGreaterThanOrEqual(542); // 2 Kopien × 271
    expect(d[d.length - 1]).toBe(0x1a);
    expect([...d].includes(0x0c)).toBe(true); // Seitenwechsel zwischen den Kopien
    // Größe: 200 + 6 + je Etikett (13 + 4 + 4 + 4 + 5 + 2 + 271 × 93 + 1)
    expect(d.length).toBe(200 + 6 + 2 * (13 + 4 + 4 + 4 + 5 + 2 + 271 * 93 + 1));
  });

  it("Endlosband: Länge = Bildhöhe, Vorschub-Rand 35", () => {
    const d = brotherRaster([weiss(696, 100)], "QL-800", mediumFuer("62")!);
    expect([...d.slice(206, 216)]).toEqual([0x1b, 0x69, 0x7a, 0x86, 0x0a, 62, 0, 100, 0, 0]);
    expect([...d.slice(231, 236)]).toEqual([0x1b, 0x69, 0x64, 35, 0]);
  });

  it("102-mm-Etikett passt nicht in den QL-800; zu breites Bild wird abgelehnt", () => {
    expect(() => brotherRaster([weiss(1164, 10)], "QL-800", m102)).toThrow(/passt nicht/);
    expect(() => brotherRaster([weiss(800, 10)], "QL-800", m62)).toThrow(/breiter/);
    expect(() => brotherRaster([], "QL-800", m62)).toThrow();
  });

  it("Medien und Modelle", () => {
    expect(MEDIEN.map((m) => m.id)).toEqual(expect.arrayContaining(["62x29", "102x152", "103x164"]));
    const eigen: Medium = { ...m102, id: "103x164", punkteBreite: 1190 };
    expect(mediumFuer("103x164", [eigen])!.punkteBreite).toBe(1190); // im Agenten konfiguriert geht vor
    expect(mediumFuer("unbekannt")).toBeNull();
    expect(modellFuer("Brother QL-1100")).toBe("QL-1100");
    expect(modellFuer("QL-1110NWB")).toBe("QL-1100");
    expect(modellFuer("Brother QL-800")).toBe("QL-800");
    expect(modellFuer("QL-820NWB")).toBe("QL-800");
    expect(modellFuer("Zebra")).toBeNull();
  });
});

describe("Rechte und Vorlagen", () => {
  it("VA druckt FNSKU, Retouren, DHL – keine Preisetiketten; Agent-Einstellungen nur Inhaber", () => {
    const va = { role: "va" };
    expect(darfDrucken(va, "fnsku")).toBe(true);
    expect(darfDrucken(va, "retoure")).toBe(true);
    expect(darfDrucken(va, "dhl")).toBe(true);
    expect(darfDrucken(va, "preis")).toBe(false);
    // VA-Konto = Mitarbeiter mit genau den VA-Bereichen (Rollen-Vorlage „VA“)
    const vaKonto = { role: "staff", areas: ["start", "amazon", "service"], privateAccess: false };
    expect(darfDrucken(vaKonto, "fnsku")).toBe(true);
    expect(darfDrucken(vaKonto, "preis")).toBe(false);
    expect(darfDrucken({ role: "staff", areas: ["paletten"] }, "preis")).toBe(true);
    expect(darfDrucken({ role: "owner", readOnly: true }, "fnsku")).toBe(false);
    expect(darfDrucken({ role: "owner" }, "preis")).toBe(true);
    expect(darfAgentEinstellen(va)).toBe(false);
    expect(darfAgentEinstellen({ role: "staff" })).toBe(false);
    expect(darfAgentEinstellen({ role: "owner" })).toBe(true);
  });

  it("Drucker je Vorlage fest: 62 mm → QL-800, 102 mm → QL-1100", () => {
    for (const v of Object.values(VORLAGEN)) {
      const med = mediumFuer(v.medium)!;
      expect(med.modelle).toContain(v.drucker);
      expect(v.drucker).toBe(med.breiteMm >= 100 ? "QL-1100" : "QL-800");
    }
  });
});

describe("Symbol neben dem Druckknopf", () => {
  const jetzt = new Date("2026-11-08T10:00:00Z");
  const agent = (o: Partial<AgentKurz> = {}): AgentKurz => ({ id: "a1", name: "Arbeits-PC", geraet: "LAGER-PC", letzterKontakt: new Date(jetzt.getTime() - 20_000), deaktiviertAm: null, letzterDruck: null, drucker: [{ name: "Brother QL-800", modell: "QL-800", zustand: "bereit", fehler: [] }], ...o });

  it("kein Agent → grau; online + bereit → grün", () => {
    expect(druckerSymbol([], "QL-800", jetzt).farbe).toBe("grau");
    const s = druckerSymbol([agent({ letzterDruck: new Date(jetzt.getTime() - 3600_000) })], "QL-800", jetzt);
    expect(s.farbe).toBe("gruen");
    expect(s.text).toMatch(/bereit.*zuletzt gedruckt/);
  });

  it("Agent offline (> 90 s ohne Heartbeat) → rot „nicht erreichbar seit …“", () => {
    const a = agent({ letzterKontakt: new Date(jetzt.getTime() - 5 * 60_000) });
    expect(agentOnline(a, jetzt)).toBe(false);
    const s = druckerSymbol([a], "QL-800", jetzt);
    expect(s.farbe).toBe("rot");
    expect(s.text).toMatch(/LAGER-PC nicht erreichbar seit 08\.11\., 10:55 – Aufträge warten/);
  });

  it("Papier leer / Deckel offen → rot mit Zustand; Shelly aus → gelb; Drucker fehlt → gelb", () => {
    const leer = druckerSymbol([agent({ drucker: [{ name: "QL-800", modell: "QL-800", zustand: "papier_leer", fehler: ["Etikettenrolle leer"] }] })], "QL-800", jetzt);
    expect(leer.farbe).toBe("rot");
    expect(leer.text).toBe("QL-800: Papier leer (Etikettenrolle leer) – LAGER-PC");
    expect(druckerSymbol([agent({ drucker: [{ name: "QL-800", modell: "QL-800", zustand: "deckel_offen", fehler: ["Deckel offen"] }] })], "QL-800", jetzt).text).toBe("QL-800: Deckel offen – LAGER-PC");
    expect(druckerSymbol([agent({ drucker: [{ name: "QL-800", modell: "QL-800", zustand: "aus", fehler: [] }] })], "QL-800", jetzt).farbe).toBe("gelb");
    expect(druckerSymbol([agent()], "QL-1100", jetzt)).toMatchObject({ farbe: "gelb", text: "QL-1100 am LAGER-PC nicht gefunden" });
  });

  it("deaktivierter Agent zählt nicht (Umzug auf Mini-PC)", () => {
    const alt = agent({ id: "alt", deaktiviertAm: jetzt });
    const neu = agent({ id: "neu", geraet: "MINI-PC" });
    expect(druckerSymbol([alt, neu], "QL-800", jetzt).agentId).toBe("neu");
    expect(druckerSymbol([alt], "QL-800", jetzt).farbe).toBe("grau");
  });
});

describe("Warteschlange", () => {
  const jetzt = new Date("2026-11-08T10:00:00Z");
  const vor = (min: number) => new Date(jetzt.getTime() - min * 60_000);
  it("Push nach 15 Min. genau einmal; nach 7 Tagen abgelaufen", () => {
    expect(pushFaellig({ status: "wartet", createdAt: vor(14), pushGemeldetAm: null }, jetzt)).toBe(false);
    expect(pushFaellig({ status: "wartet", createdAt: vor(15), pushGemeldetAm: null }, jetzt)).toBe(true);
    expect(pushFaellig({ status: "wartet", createdAt: vor(30), pushGemeldetAm: vor(10) }, jetzt)).toBe(false);
    expect(pushFaellig({ status: "gedruckt", createdAt: vor(30), pushGemeldetAm: null }, jetzt)).toBe(false);
    expect(abgelaufen({ status: "wartet", createdAt: vor(7 * 1440 - 1) }, jetzt)).toBe(false);
    expect(abgelaufen({ status: "wartet", createdAt: vor(7 * 1440 + 1) }, jetzt)).toBe(true);
  });
  it("Meldung des Agenten → Status", () => {
    expect(statusNachMeldung("gedruckt")).toBe("gedruckt");
    expect(statusNachMeldung("wartet")).toBe("wartet");
    expect(statusNachMeldung("fehler")).toBe("fehler");
    expect(statusNachMeldung("egal")).toBeNull();
  });
  it("Gerätetoken-Form", () => {
    expect(tokenFormOk(`da_${"A".repeat(43)}`)).toBe(true);
    expect(tokenFormOk("mk_abc")).toBe(false);
    expect(tokenFormOk(null)).toBe(false);
  });
});

describe("Scanner-Arbeitsplatz", () => {
  it("Steuer-Barcodes, FNSKU, EAN, LPN, Fach, Menge, SKU", () => {
    expect(scanEinordnen("lugru-drucken-5")).toEqual({ art: "steuer", code: "LUGRU-DRUCKEN-5" });
    expect(steuerAnzahl("LUGRU-DRUCKEN-5")).toBe(5);
    expect(steuerAnzahl("LUGRU-DRUCKEN-1")).toBe(1);
    expect(steuerAnzahl("LUGRU-ABBRECHEN")).toBe(0);
    expect(scanEinordnen("x00test001")).toEqual({ art: "fnsku", wert: "X00TEST001" });
    expect(scanEinordnen("4000000000017")).toEqual({ art: "ean", wert: "4000000000017" });
    expect(scanEinordnen("LPNTEST12345")).toEqual({ art: "lpn", wert: "LPNTEST12345" });
    expect(scanEinordnen("FACH-A-01-03")).toEqual({ art: "fach", wert: "A-01-03" });
    expect(scanEinordnen("12")).toEqual({ art: "menge", wert: 12 });
    expect(scanEinordnen("TEST-SKU-1")).toEqual({ art: "sku", wert: "TEST-SKU-1" });
    expect(scanEinordnen("   ")).toBeNull();
  });
});

describe("PDFs aus Seller Central", () => {
  it("Seitengröße → Art", () => {
    expect(pdfArt(288, 432)).toBe("kartonlabel"); // 4 × 6 Zoll
    expect(pdfArt(432, 288)).toBe("kartonlabel"); // quer
    expect(pdfArt(595.28, 841.89)).toBe("a4");
    expect(pdfArt(283, 564)).toBe("unbekannt"); // 100 × 199 mm (DHL) → 102-mm-Label
  });
  it("Sendungsnummer, FNSKUs, Raster", () => {
    expect(sendungsnummer("Sendung fba15test01x Karton 1 von 3")).toBe("FBA15TEST01X");
    expect(sendungsnummer("ohne Nummer")).toBeNull();
    expect(fnskusImText("X00TEST001 X00TEST002 x00test003 X00TOOLONG99")).toBe(3);
    expect(rasterRaten(27).id).toBe("27");
    expect(rasterRaten(40).id).toBe("40");
  });
  it("Zellen der Bögen liegen auf A4 (300 dpi)", () => {
    const a4 = { b: Math.round((210 / 25.4) * 300), h: Math.round((297 / 25.4) * 300) };
    for (const r of [RASTER["27"], RASTER["40"]]) {
      const z = zellen(r, 300);
      expect(z.length).toBe(r.spalten * r.zeilen);
      for (const c of z) {
        expect(c.x + c.b).toBeLessThanOrEqual(a4.b + 1);
        expect(c.y + c.h).toBeLessThanOrEqual(a4.h + 1);
      }
    }
    expect(zellen(RASTER["27"], 300)[0]).toEqual({ x: 86, y: 181, b: 750, h: 350 });
  });
});
