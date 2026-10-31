import { describe, expect, it } from "vitest";
import { beobachtungTeile, beobachtungText, letzteSitzung, therapieBogen, vergleichVorwoche, wochePrivat, type WocheDaten } from "@/lib/private/rueckblick-logic";

// Wochenrückblick privat (B16) und Therapie-Bogen – erfundene Namen und Einträge.

const namen = { a: "Testperson A", b: "Testperson B" };

describe("Beobachtung im Format des Therapie-Bogens", () => {
  it("eigene Felder haben Vorrang", () => {
    expect(beobachtungTeile({ text: "x", situation: "Abendessen", problematik: "laut geworden", veraenderung: "kurz rausgehen" })).toEqual({ situation: "Abendessen", problematik: "laut geworden", veraenderung: "kurz rausgehen", unvollstaendig: false });
  });
  it("Text mit „|“ bzw. mit Beschriftungen je Zeile wird zerlegt; sonst alles Situation", () => {
    expect(beobachtungTeile({ text: "Situation: Abendessen | Problematik: laut | Veränderung: Pause" })).toMatchObject({ situation: "Abendessen", problematik: "laut", veraenderung: "Pause" });
    expect(beobachtungTeile({ text: "Beim Zubettbringen\nProblematik: Streit über Handy\nGewünschte Veränderung: feste Zeit" })).toMatchObject({ situation: "Beim Zubettbringen", problematik: "Streit über Handy", veraenderung: "feste Zeit" });
    expect(beobachtungTeile({ text: "Mittags ruhiger, abends gereizt" })).toEqual({ situation: "Mittags ruhiger, abends gereizt", problematik: null, veraenderung: null, unvollstaendig: false });
  });
  it("„[?]“ markiert unvollständig", () => {
    expect(beobachtungTeile({ text: "Montag früh | Problematik: [?]" }).unvollstaendig).toBe(true);
    expect(beobachtungTeile({ text: "", situation: "Sonntag", veraenderung: "[?] noch klären" }).unvollstaendig).toBe(true);
  });
  it("Text aus Feldern für ältere Leser – und wieder zurück lesbar", () => {
    const t = beobachtungText("Abendessen", "laut geworden", "kurz rausgehen");
    expect(t).toBe("Abendessen | Problematik: laut geworden | Gewünschte Veränderung: kurz rausgehen");
    expect(beobachtungTeile({ text: t })).toMatchObject({ situation: "Abendessen", problematik: "laut geworden", veraenderung: "kurz rausgehen" });
    expect(beobachtungText("Nur Situation")).toBe("Nur Situation");
  });
});

describe("Therapie-Bogen", () => {
  it("letzte Sitzung: nur Paartherapie, nicht ausgefallen; heute nur wenn stattgefunden", () => {
    const termine = [
      { day: "2026-10-01", with: "paar" as const },
      { day: "2026-10-15", with: "paar" as const, status: "ausgefallen" as const },
      { day: "2026-10-20", with: "arzt" as const },
      { day: "2026-10-31", with: "paar" as const, status: "geplant" as const },
    ];
    expect(letzteSitzung(termine, "2026-10-31")).toBe("2026-10-01");
    expect(letzteSitzung([...termine, { day: "2026-10-31", with: "paar", status: "stattgefunden" }], "2026-10-31")).toBe("2026-10-31");
    expect(letzteSitzung([], "2026-10-31")).toBeNull();
  });
  it("Zeilen im Zeitraum, nach Tag sortiert", () => {
    const b = [
      { day: "2026-10-28", aboutUserId: "u", text: "später" },
      { day: "2026-10-02", aboutUserId: "u", text: "früh | Problematik: [?]" },
      { day: "2026-09-30", aboutUserId: "u", text: "zu alt" },
    ];
    const z = therapieBogen(b, "2026-10-01", "2026-10-31");
    expect(z.map((x) => x.tag)).toEqual(["2026-10-02", "2026-10-28"]);
    expect(z[0]).toMatchObject({ situation: "früh", unvollstaendig: true });
  });
});

const woche = (o: Partial<WocheDaten> = {}): WocheDaten => ({ beobachtungen: [], zuwendung: [], gespraeche: [], danke: [], stimmung: [], dateideen: [], aufgaben: [], ...o });

describe("Wochenrückblick privat", () => {
  const daten = woche({
    beobachtungen: [{ day: "2026-10-27", aboutUserId: "u", text: "Abend | Problematik: müde" }],
    zuwendung: [
      { day: "2026-10-26", kind: "streicheln", giver: "a", receiver: "b", status: "stattgefunden" },
      { day: "2026-10-28", kind: "streicheln", giver: "a", receiver: "b", status: "stattgefunden" },
      { day: "2026-10-29", kind: "massage", giver: "b", receiver: "a", status: "stattgefunden" },
      { day: "2026-10-30", kind: "massage", giver: "a", receiver: "b", status: "ausgefallen" },
      { day: "2026-10-31", kind: "massage", giver: "a", receiver: "b", status: "geplant" },
    ],
    gespraeche: [{ day: "2026-10-29", topic: "Wochenende planen", agreed: "Samstag frei" }],
    danke: [{ day: "2026-10-27", from: "b", text: "Danke fürs Kochen" }],
    stimmung: [{ day: "2026-10-26", person: "a", value: 3 }, { day: "2026-10-30", person: "a", value: 4 }, { day: "2026-10-30", person: "b", value: 1 }],
    dateideen: [{ data: { text: "Picknick" }, createdAt: new Date("2026-10-28T10:00:00Z") }, { data: { text: "alt" }, createdAt: new Date("2026-09-01T10:00:00Z") }],
    aufgaben: [
      { title: "Liste schreiben", source: "paar", forWhom: "a", repeat: "einmal", done: true, doneAt: "2026-10-28" },
      { title: "Ich-Botschaften", source: "paar", forWhom: "beide", repeat: "taeglich", checks: ["2026-10-27"] },
      { title: "Brief", source: "paar", forWhom: "a", repeat: "einmal" },
      { title: "Nur für B", source: "paar", forWhom: "b", repeat: "einmal" },
    ],
  });
  const w = wochePrivat(daten, { von: "2026-10-25", bis: "2026-10-31", ich: "a", namen });
  it("Beobachtungen, Zuwendung je Art und Richtung (nur stattgefunden), Gespräche, Danke", () => {
    expect(w.beobachtungen).toHaveLength(1);
    expect(w.beobachtungen[0]).toMatchObject({ situation: "Abend", problematik: "müde" });
    expect(w.zuwendung).toEqual([
      { art: "streicheln", anzahl: 2, wer: [{ richtung: "Testperson A → Testperson B", anzahl: 2 }] },
      { art: "massage", anzahl: 1, wer: [{ richtung: "Testperson B → Testperson A", anzahl: 1 }] },
    ]);
    expect(w.zuwendungAusgefallen).toBe(1);
    expect(w.gespraeche).toEqual([{ tag: "2026-10-29", thema: "Wochenende planen", vereinbart: "Samstag frei" }]);
    expect(w.danke).toEqual([{ tag: "2026-10-27", von: "Testperson B", text: "Danke fürs Kochen" }]);
  });
  it("Stimmung nur der eigenen Person (Ø + Verlauf), Dateideen der Woche, Aufgaben erledigt/offen", () => {
    expect(w.stimmung).toEqual({ schnitt: 3.5, verlauf: [{ tag: "2026-10-26", wert: 3 }, { tag: "2026-10-30", wert: 4 }] });
    expect(w.dateideen).toEqual([{ text: "Picknick", umgesetzt: false }]);
    expect(w.aufgaben).toEqual({ erledigt: ["Liste schreiben", "Ich-Botschaften"], offen: ["Brief"] });
  });
  it("Vergleich zur Vorwoche: mehr/weniger/gleich, leere Werte fallen weg", () => {
    const vorher = wochePrivat(woche({ zuwendung: [{ day: "2026-10-20", kind: "massage", giver: "a", receiver: "b", status: "stattgefunden" }, { day: "2026-10-21", kind: "massage", giver: "a", receiver: "b", status: "stattgefunden" }], stimmung: [{ day: "2026-10-20", person: "a", value: 2 }] }), { von: "2026-10-18", bis: "2026-10-24", ich: "a", namen });
    const v = vergleichVorwoche(w, vorher);
    expect(v.find((x) => x.was === "streicheln")).toEqual({ was: "streicheln", diese: 2, vorwoche: 0, tendenz: "mehr" });
    expect(v.find((x) => x.was === "massage")).toEqual({ was: "massage", diese: 1, vorwoche: 2, tendenz: "weniger" });
    expect(v.find((x) => x.was === "stimmung")).toEqual({ was: "stimmung", diese: 3.5, vorwoche: 2, tendenz: "mehr" });
    expect(v.find((x) => x.was === "beobachtungen")?.tendenz).toBe("mehr");
  });
});
