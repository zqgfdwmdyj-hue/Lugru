import { describe, expect, it } from "vitest";
import { changePlan, durationOf, intakeStatus, medStock, nextSleeper, parseTimes, planFor, type MedPlan } from "@/lib/private/logic";

describe("Dauer prüfen (Kinderzeit, Auszeit, Ausschlafen, Paarzeit)", () => {
  it("von–bis, auch über Mitternacht (zählt am Tag des Beginns)", () => {
    expect(durationOf({ from: "14:00", to: "16:30" })).toEqual({ hours: 2.5, overnight: false });
    expect(durationOf({ from: "22:00", to: "02:00" })).toEqual({ hours: 4, overnight: true });
  });
  it("nur Stunden", () => {
    expect(durationOf({ hours: 3 })).toEqual({ hours: 3, overnight: false });
  });
  it("widersprüchliche Angaben werden nicht still übernommen", () => {
    const r = durationOf({ from: "14:00", to: "16:00", hours: 5 });
    expect("error" in r && r.error).toMatch(/ergibt 2 Std\., angegeben sind 5 Std\./);
    expect(durationOf({ from: "14:00", to: "16:00", hours: 2 })).toEqual({ hours: 2, overnight: false });
  });
  it("gleiche Zeiten, nur eine Seite, nichts, zu lang", () => {
    expect("error" in durationOf({ from: "10:00", to: "10:00" })).toBe(true);
    expect("error" in durationOf({ from: "10:00" })).toBe(true);
    expect("error" in durationOf({})).toBe(true);
    const long = durationOf({ from: "09:00", to: "08:00" });
    expect("error" in long && long.error).toMatch(/23 Std\..*über Mitternacht/);
    expect("error" in durationOf({ from: "07:00", to: "21:00" }, 12)).toBe(true);
  });
});

describe("Wer wäre dran – nur im Wechsel, ohne Ausgleich nach gezählten Stunden", () => {
  it("der andere als beim letzten Eintrag", () => {
    // a hatte im Monat dreimal, b einmal – trotzdem: zuletzt b → als Nächstes a (keine Bewertung über Zählungen)
    expect(nextSleeper([{ day: "2026-10-01", person: "a" }, { day: "2026-10-02", person: "a" }, { day: "2026-10-03", person: "a" }, { day: "2026-10-04", person: "b" }])).toBe("a");
  });
});

describe("Einnahmen: genommen, bewusst nicht genommen, nicht dokumentiert", () => {
  it("unterscheidet die drei Fälle", () => {
    expect(intakeStatus(undefined, 2)).toMatchObject({ times: [], notTaken: 0, undocumented: 2, label: "nicht dokumentiert" });
    expect(intakeStatus({ intakes: ["08:00"] }, 2)).toMatchObject({ undocumented: 1, label: "genommen 08:00 · 1 nicht dokumentiert" });
    expect(intakeStatus({ intakes: ["08:00"], notTaken: 1 }, 2)).toMatchObject({ undocumented: 0, complete: true, label: "genommen 08:00 · 1× bewusst nicht genommen" });
    expect(intakeStatus({ notTaken: 1 }, 1).label).toBe("1× bewusst nicht genommen");
    expect(intakeStatus({ takenAt: "07:30" }, 1).label).toBe("genommen 07:30");
  });
  it("Uhrzeiten aus der Eingabe", () => {
    expect(parseTimes("13:30, 8:00 08:00")).toEqual(["08:00", "13:30"]);
    expect(parseTimes("")).toEqual([]);
    expect(parseTimes("25:00")).toBeNull();
    expect(parseTimes("morgens")).toBeNull();
  });
});

describe("Medikamentenplan: Änderungen gelten ab heute, frühere Tage bleiben", () => {
  const base: MedPlan = { med: "Testmittel", doseMg: 10, piecesPerIntake: 1, intakesPerDay: 1, warnDays: 10, validFrom: "2026-09-01" };
  it("alte Fassung wandert in den Verlauf", () => {
    const next = changePlan(base, { med: "Testmittel", doseMg: 20, piecesPerIntake: 2, intakesPerDay: 2, warnDays: 10 }, "2026-10-10", true);
    expect(next.validFrom).toBe("2026-10-10");
    expect(next.history).toEqual([{ from: "2026-09-01", to: "2026-10-09", med: "Testmittel", doseMg: 10, piecesPerIntake: 1, intakesPerDay: 1 }]);
    expect(planFor(next, "2026-10-05")).toMatchObject({ doseMg: 10, intakesPerDay: 1 });
    expect(planFor(next, "2026-10-10")).toMatchObject({ doseMg: 20, intakesPerDay: 2 });
  });
  it("nur Warnschwelle geändert → kein neuer Abschnitt", () => {
    const next = changePlan(base, { med: "Testmittel", doseMg: 10, piecesPerIntake: 1, intakesPerDay: 1, warnDays: 5 }, "2026-10-10", true);
    expect(next.history ?? []).toHaveLength(0);
    expect(next.validFrom).toBe("2026-09-01");
  });
  it("Vorrat rechnet mit der Stückzahl, die bei der Einnahme galt", () => {
    const plan: MedPlan = { ...base, piecesPerIntake: 2, stock: { count: 20, asOf: "2026-10-01T07:00" } };
    // eine Einnahme mit damals 1 Stück, eine mit 2 Stück
    const r = medStock(plan, [{ day: "2026-10-02", intakes: ["08:00"], pieces: 1 }, { day: "2026-10-03", intakes: ["08:00"], pieces: 2 }]);
    expect(r?.remaining).toBe(17);
  });
});
