import { describe, expect, it } from "vitest";
import { ABO_MAX_FEHLER, MELDE_ARTEN, artAn, inRuhezeit, istMeldeArt, morgenText, uhrBerlin, zustellung } from "@/lib/push/logic";

// Push aufs Handy (Bauauftrag Push-Handy, Teil A): Arten, Ruhezeit 22–6 Uhr nur „kritisch“, Morgenbericht.

const berlin = (iso: string) => new Date(iso); // Zeiten unten in UTC; November = MEZ (UTC+1)

describe("Ruhezeit", () => {
  it("über Mitternacht (22–6)", () => {
    expect(inRuhezeit("22:00")).toBe(true);
    expect(inRuhezeit("23:59")).toBe(true);
    expect(inRuhezeit("03:10")).toBe(true);
    expect(inRuhezeit("05:59")).toBe(true);
    expect(inRuhezeit("06:00")).toBe(false);
    expect(inRuhezeit("12:00")).toBe(false);
    expect(inRuhezeit("21:59")).toBe(false);
  });
  it("am Tag (13–14) und keine Ruhezeit (von = bis)", () => {
    expect(inRuhezeit("13:30", "13:00", "14:00")).toBe(true);
    expect(inRuhezeit("14:00", "13:00", "14:00")).toBe(false);
    expect(inRuhezeit("03:00", "00:00", "00:00")).toBe(false);
  });
  it("Uhrzeit in Berlin", () => {
    expect(uhrBerlin(berlin("2026-11-03T22:30:00Z"))).toBe("23:30");
    expect(uhrBerlin(berlin("2026-07-03T22:30:00Z"))).toBe("00:30");
  });
});

describe("Zustellung", () => {
  const nachts = berlin("2026-11-03T23:00:00Z"); // 00:00 Berlin
  const tags = berlin("2026-11-03T10:00:00Z"); // 11:00 Berlin
  it("am Tag: senden", () => {
    expect(zustellung("deal", false, null, tags)).toBe("senden");
  });
  it("nachts: nur kritisch, Rest zurückhalten", () => {
    expect(zustellung("deal", false, null, nachts)).toBe("zurueckhalten");
    expect(zustellung("amazon_kritisch", false, null, nachts)).toBe("senden");
    expect(zustellung("sonstiges", true, null, nachts)).toBe("senden");
    expect(zustellung("test", false, null, nachts)).toBe("senden");
  });
  it("Art aus → nur Protokoll (auch kritisch); Test immer", () => {
    expect(zustellung("deal", false, { aus: ["deal"] }, tags)).toBe("ausgeschaltet");
    expect(zustellung("amazon_kritisch", true, { aus: ["amazon_kritisch"] }, nachts)).toBe("ausgeschaltet");
    expect(artAn("test", { aus: ["test"] })).toBe(true);
  });
  it("eigene Ruhezeit je Person", () => {
    expect(zustellung("deal", false, { ruheVon: "00:00", ruheBis: "00:00" }, nachts)).toBe("senden");
    expect(zustellung("deal", false, { ruheVon: "10:00", ruheBis: "12:00" }, tags)).toBe("zurueckhalten");
  });
});

describe("Arten und Texte", () => {
  it("alle Arten des Bauauftrags vorhanden, Standard an", () => {
    for (const k of ["deal", "amazon_kritisch", "frist_heute", "paletten_heute", "morgenbericht", "va_rueckfrage"]) {
      expect(MELDE_ARTEN.some((a) => a.key === k && a.standard)).toBe(true);
      expect(istMeldeArt(k)).toBe(true);
    }
    expect(istMeldeArt("unsinn")).toBe(false);
    expect(ABO_MAX_FEHLER).toBe(3);
  });
  it("Morgenbericht kurz, Wichtigstes vorne", () => {
    expect(morgenText({ ueberNacht: 3, fristen: 1, wichtig: 2, paletten: 0 })).toBe("1 Frist heute · 2 wichtige Aufgaben · 3 Meldungen über Nacht.");
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 1 })).toBe("1 Paletten-Sendung heute.");
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0 })).toBe("Nichts Dringendes – guten Start!");
  });
});
