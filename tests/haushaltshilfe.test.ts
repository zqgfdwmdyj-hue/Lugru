import { describe, expect, it } from "vitest";
import { aufteilen, auswertung, einsaetze, einsaetzeCsv, helferBereinigen, helferFuer, kosten, satzText, STANDARD_HELFER, zeitAusTitel, type Helfer } from "@/lib/private/haushaltshilfe";

// Erfundene Termine und Sätze.
const sitter = STANDARD_HELFER[0];
const putz: Helfer = { ...STANDARD_HELFER[1], satz: 15 };
const helfer = [sitter, putz];

describe("Babysitter: wach bis 20 Uhr, danach schlafend", () => {
  it("17–22 Uhr → 3 Std. wach à 20 € + 2 Std. schlafend à 17 € = 94 €", () => {
    const t = aufteilen("17:00", "22:00", "20:00");
    expect(t).toEqual({ wach: 180, schlaf: 120, gesamt: 300 });
    expect(kosten(sitter, t!)).toBe(94);
  });
  it("Beginn nach der Schlafenszeit → alles schlafend; über Mitternacht bis 06:00", () => {
    expect(aufteilen("20:30", "23:30")).toEqual({ wach: 0, schlaf: 180, gesamt: 180 });
    expect(aufteilen("19:00", "01:00")).toEqual({ wach: 60, schlaf: 300, gesamt: 360 });
    expect(aufteilen("05:00", "08:00")).toEqual({ wach: 120, schlaf: 60, gesamt: 180 });
  });
  it("andere Schlafenszeit (19:30) wird genutzt", () => {
    expect(aufteilen("18:00", "21:00", "19:30")).toEqual({ wach: 90, schlaf: 90, gesamt: 180 });
  });
  it("Putzhilfe: fester Stundenlohn; ohne Satz kein Betrag", () => {
    expect(kosten(putz, { wach: 150, schlaf: 0 })).toBe(37.5);
    expect(kosten(STANDARD_HELFER[1], { wach: 150, schlaf: 0 })).toBeNull();
    expect(satzText(sitter)).toBe("20 €/Std. wach · 17 €/Std. schlafend ab 20:00");
    expect(satzText(STANDARD_HELFER[1])).toBe("Stundenlohn fehlt");
  });
});

describe("Erkennen im Kalender", () => {
  it("Titel → Hilfe (ohne Groß-/Kleinschreibung), Uhrzeit aus dem Titel", () => {
    expect(helferFuer("Babysitterin kommt", helfer)?.id).toBe("babysitter");
    expect(helferFuer("PUTZFRAU", helfer)?.id).toBe("putzhilfe");
    expect(helferFuer("Zahnarzt", helfer)).toBeNull();
    expect(helferFuer("Babysitter", [{ ...sitter, aktiv: false }])).toBeNull();
    expect(zeitAusTitel("Babysitterin 17-22 Uhr")).toEqual({ from: "17:00", to: "22:00" });
    expect(zeitAusTitel("Putzfrau 9:30 bis 12")).toEqual({ from: "09:30", to: "12:00" });
    expect(zeitAusTitel("Putzfrau")).toBeNull();
  });

  it("Einsätze aus Kalender + Korrektur von Hand + Eintrag von Hand; Auswertung zählt nur Stattgefundenes", () => {
    const liste = einsaetze({
      helfer,
      termine: [
        { ref: "a|2026-10-03T15:00:00.000Z", quelle: "kalender", titel: "Babysitterin", day: "2026-10-03", from: "17:00", to: "22:00", kalender: "Familie" },
        { ref: "b|2026-10-10T07:00:00.000Z", quelle: "kalender", titel: "Putzfrau 9-12", day: "2026-10-10" },
        { ref: "c|2026-10-17T15:00:00.000Z", quelle: "kalender", titel: "Babysitter", day: "2026-10-17", from: "18:00", to: "23:00" },
        { ref: "d|2026-10-30T15:00:00.000Z", quelle: "kalender", titel: "Babysitter", day: "2026-10-30", from: "18:00", to: "21:00" },
        { ref: "x|2026-11-02T15:00:00.000Z", quelle: "kalender", titel: "Babysitter", day: "2026-11-02", from: "18:00", to: "21:00" },
      ],
      eintraege: [
        { id: "e1", data: { ref: "c|2026-10-17T15:00:00.000Z", quelle: "kalender", helferId: "babysitter", day: "2026-10-17", betrag: 100, bezahlt: true } },
        { id: "e2", data: { quelle: "hand", helferId: "putzhilfe", day: "2026-10-24", from: "10:00", to: "12:00" } },
        { id: "e3", data: { ref: "d|2026-10-30T15:00:00.000Z", quelle: "kalender", helferId: "babysitter", day: "2026-10-30", status: "ausgefallen" } },
      ],
      von: "2026-10-01",
      bis: "2026-10-31",
      heute: "2026-10-31",
    });
    expect(liste.map((e) => [e.day, e.helferId, e.betrag, e.status])).toEqual([
      ["2026-10-03", "babysitter", 94, "stattgefunden"],
      ["2026-10-10", "putzhilfe", 45, "stattgefunden"],
      ["2026-10-17", "babysitter", 100, "stattgefunden"],
      ["2026-10-24", "putzhilfe", 30, "stattgefunden"],
      ["2026-10-30", "babysitter", 57, "ausgefallen"],
    ]);
    expect(liste[2]).toMatchObject({ vonHand: true, berechnet: 91, bezahlt: true });
    const a = auswertung(liste);
    expect(a).toMatchObject({ anzahl: 4, kosten: 269, offen: 169, ausgefallen: 1 });
    expect(a.helfer.find((h) => h.helferId === "babysitter")).toMatchObject({ anzahl: 2, kosten: 194, stundenWach: 5, stundenSchlaf: 5 });
    expect(a.helfer.find((h) => h.helferId === "putzhilfe")).toMatchObject({ anzahl: 2, kosten: 75, stunden: 5 });
    const csv = einsaetzeCsv(liste, "2026-10");
    expect(csv.startsWith("﻿Datum;Wochentag;Hilfe")).toBe(true);
    expect(csv).toContain("03.10.2026;Sa;Babysitterin;17:00;22:00;3,00;2,00;5,00;94,00;berechnet;stattgefunden;nein;Familienkalender „Familie“");
    expect(csv).toContain("Summe 2026-10 (nur stattgefunden);;;;;;;15,00;269,00");
  });

  it("Termin in der Zukunft = geplant; ohne Uhrzeit Hinweis statt Betrag; Kalender-Termin weg → Angaben bleiben", () => {
    const liste = einsaetze({
      helfer,
      termine: [
        { ref: "f|2026-11-20T16:00:00.000Z", quelle: "kalender", titel: "Babysitter", day: "2026-11-20", from: "17:00", to: "21:00" },
        { ref: "termin:1", quelle: "termin", titel: "Putzfrau", day: "2026-11-05" },
      ],
      eintraege: [{ id: "e9", data: { ref: "weg|2026-11-03T16:00:00.000Z", quelle: "kalender", helferId: "babysitter", day: "2026-11-03", from: "17:00", to: "20:00" } }],
      von: "2026-11-01",
      bis: "2026-11-30",
      heute: "2026-11-10",
    });
    expect(liste.find((e) => e.day === "2026-11-20")).toMatchObject({ status: "geplant", betrag: 77 });
    expect(liste.find((e) => e.day === "2026-11-05")).toMatchObject({ betrag: null, hinweis: expect.stringContaining("Uhrzeit fehlt") });
    expect(liste.find((e) => e.day === "2026-11-03")).toMatchObject({ betrag: 60, hinweis: expect.stringContaining("nicht mehr im Kalender") });
    expect(auswertung(liste)).toMatchObject({ anzahl: 2, kosten: 60, ohneBetrag: 1, geplant: { anzahl: 1, kosten: 77 } });
  });
});

describe("Einstellungen", () => {
  it("bereinigt Sätze, Zeiten, Begriffe und IDs", () => {
    const h = helferBereinigen([
      { id: "", name: " Oma ", art: "sonstiges", begriffe: ["Oma", " x ", "OMA"], satz: -5, satzWach: 10, schlafAb: "8 Uhr" },
      { id: "", name: "Oma", art: "babysitter", begriffe: [], satz: null, satzWach: 18.555, satzSchlaf: null },
    ]);
    expect(h[0]).toMatchObject({ id: "oma", name: "Oma", begriffe: ["oma"], satz: null, satzWach: null, schlafAb: "20:00", aktiv: true });
    expect(h[1]).toMatchObject({ id: "oma-2", satzWach: 18.56 });
  });
});
