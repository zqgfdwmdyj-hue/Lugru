import { describe, expect, it } from "vitest";
import { einkommenJahr, erinnerungErledigt, faelligeErinnerungen, fixkostenMonat, letzteMonate, monatsUebersicht, ruecklageStand, vermoegen, type Einkommen } from "@/lib/private/geld";

// Privates Geld: Monatswerte, Rücklagen, Erinnerungen, Kontoübersicht. Erfundene Beträge.

describe("Einkommen, Fixkosten, Vermögen", () => {
  it("Einkommen je Jahr: geplant/erhalten, Gehalt/Ausschüttung", () => {
    const e: Einkommen[] = [
      { typ: "einkommen", art: "gehalt", betrag: 3000, monat: "2026-09", status: "erhalten" },
      { typ: "einkommen", art: "gehalt", betrag: 3000, monat: "2026-10", status: "geplant" },
      { typ: "einkommen", art: "ausschuettung", betrag: 10000, monat: "2026-12", status: "geplant" },
      { typ: "einkommen", art: "gehalt", betrag: 2500, monat: "2025-12", status: "erhalten" },
    ];
    expect(einkommenJahr(e, "2026")).toEqual({ geplant: 16000, erhalten: 3000, gehalt: 6000, ausschuettung: 10000 });
  });
  it("Fixkosten je Monat: Quartal ÷ 3, Jahr ÷ 12", () => {
    expect(fixkostenMonat([{ typ: "fixkosten", name: "Miete", betrag: 1000, rhythmus: "monatlich" }, { typ: "fixkosten", name: "Versicherung", betrag: 120, rhythmus: "jaehrlich" }, { typ: "fixkosten", name: "Strom", betrag: 300, rhythmus: "quartal" }])).toBe(1110);
  });
  it("Rücklage: Anteil, fehlt, Monate bis Ziel", () => {
    expect(ruecklageStand({ typ: "ruecklage", name: "Notgroschen", ziel: 10000, stand: 4000, monatlich: 500 })).toEqual({ prozent: 40, fehlt: 6000, monateBisZiel: 12 });
    expect(ruecklageStand({ typ: "ruecklage", name: "Steuern", ziel: 5000, stand: 6000 })).toEqual({ prozent: 100, fehlt: 0, monateBisZiel: 0 });
    expect(ruecklageStand({ typ: "ruecklage", name: "X", ziel: 1000, stand: 0 }).monateBisZiel).toBeNull();
    expect(vermoegen([{ typ: "anlage", name: "ETF", art: "etf", wert: 20000, standAm: "2026-10-01" }], [{ typ: "ruecklage", name: "N", ziel: 1, stand: 4000 }])).toBe(24000);
  });
});

describe("Erinnerungen", () => {
  it("fällig in 14 Tagen; erledigt → nächstes Jahr", () => {
    const e = [{ typ: "erinnerung" as const, titel: "Freistellungsauftrag", faellig: "2026-11-05", wiederholung: "jaehrlich" as const }, { typ: "erinnerung" as const, titel: "Später", faellig: "2026-12-30", wiederholung: "einmal" as const }];
    expect(faelligeErinnerungen(e, "2026-10-29").map((x) => x.titel)).toEqual(["Freistellungsauftrag"]);
    expect(erinnerungErledigt(e[0], "2026-11-05").faellig).toBe("2027-11-05");
    expect(erinnerungErledigt(e[1], "2026-10-29")).toMatchObject({ erledigtAm: "2026-10-29" });
  });
});

describe("Privatkonto", () => {
  it("Monatsübersicht mit größten Ausgaben je Empfänger", () => {
    const u = [
      { buchungstag: "2026-10-01", betrag: 3000, gegenpartei: "Testfirma GmbH", gruppe: "g1" },
      { buchungstag: "2026-10-02", betrag: -950, gegenpartei: "Vermieter Test", gruppe: "g2" },
      { buchungstag: "2026-10-10", betrag: -50.5, gegenpartei: "Supermarkt Test", gruppe: "g3" },
      { buchungstag: "2026-10-20", betrag: -49.5, gegenpartei: "Supermarkt Test", gruppe: "g3" },
      { buchungstag: "2026-09-30", betrag: -999, gegenpartei: "Vormonat", gruppe: "g4" },
    ];
    const m = monatsUebersicht(u, "2026-10");
    expect(m).toMatchObject({ einnahmen: 3000, ausgaben: 1050, saldo: 1950, buchungen: 4 });
    expect(m.groessteAusgaben).toEqual([{ name: "Vermieter Test", betrag: 950, anzahl: 1 }, { name: "Supermarkt Test", betrag: 100, anzahl: 2 }]);
  });
  it("letzte Monate", () => expect(letzteMonate("2026-01-15", 3)).toEqual(["2026-01", "2025-12", "2025-11"]));
});
