import { describe, expect, it } from "vitest";
import { careOverview, dateReminder, dateStats, intakesAt, medStock, moodSeries, nextCareDate, routineState, thanksSince, type CareTask, type MedPlan } from "@/lib/private/logic";

// Privat: Einnahme/Vorrat, Routinen, Wertschätzung, Stimmung, Mental Load, Date-Erinnerung. Fiktive Daten.

describe("Vorrat", () => {
  const plan: MedPlan = { med: "Testmittel", doseMg: 10, piecesPerIntake: 1, intakesPerDay: 2, warnDays: 10, stock: { count: 30, asOf: "2026-10-27T07:00" } };
  it("zieht Einnahmen nach dem Stand ab (auch takenAt ohne Liste)", () => {
    const r = medStock(plan, [
      { day: "2026-10-27", intakes: ["06:50", "07:30", "13:00"] }, // 06:50 vor dem Stand
      { day: "2026-10-28", takenAt: "07:30" },
    ]);
    expect(r).toEqual({ remaining: 27, daysLeft: 13, low: false, taken: 3 });
  });
  it("knapp ab warnDays, halbe Tabletten", () => {
    const r = medStock({ ...plan, piecesPerIntake: 0.5, intakesPerDay: 1, stock: { count: 5, asOf: "2026-10-01T00:00" } }, [{ day: "2026-10-02", intakes: ["08:00"] }]);
    expect(r).toMatchObject({ remaining: 4.5, daysLeft: 9, low: true });
    expect(medStock({ ...plan, stock: undefined }, [])).toBeNull();
  });
  it("Einnahme in derselben Minute wie das Zählen: nur zählen, wenn sie danach kam", () => {
    const vorher = [{ day: "2026-10-27", intakes: ["07:00"] }];
    // beim Zählen war die 07:00-Einnahme schon eingetragen → nicht nochmal abziehen
    expect(medStock({ ...plan, stock: { count: 30, asOf: "2026-10-27T07:00", atAsOf: intakesAt(vorher, "2026-10-27T07:00") } }, vorher)!.remaining).toBe(30);
    // gezählt, dann in derselben Minute genommen → abziehen
    expect(medStock({ ...plan, stock: { count: 30, asOf: "2026-10-27T07:00", atAsOf: 0 } }, vorher)!.remaining).toBe(29);
  });
});

describe("Routinen", () => {
  it("komplett nur mit allen Schritten, Serie und 7 Tage", () => {
    const r = { title: "Morgen", items: ["A", "B"], checks: { "2026-10-25": ["A", "B"], "2026-10-26": ["B", "A"], "2026-10-27": ["A"] } };
    const st = routineState(r, "2026-10-27");
    expect(st).toMatchObject({ doneToday: false, streak: 2, today: ["A"] });
    expect(st.last7.filter((d) => d.done).length).toBe(2);
    expect(routineState({ ...r, checks: { ...r.checks, "2026-10-27": ["A", "B"] } }, "2026-10-27").streak).toBe(3);
  });
});

describe("Wertschätzung & Stimmung", () => {
  it("seit dem letzten Paar-Gespräch, getrennt nach Schreiber", () => {
    const t = thanksSince(
      [
        { day: "2026-10-20", from: "a", text: "alt" },
        { day: "2026-10-22", from: "a", text: "Abendessen gekocht" },
        { day: "2026-10-23", from: "b", text: "Geduld mit mir" },
      ],
      "2026-10-20",
    );
    expect(t).toEqual({ a: ["Abendessen gekocht"], b: ["Geduld mit mir"] });
    expect(thanksSince([{ day: "2026-10-20", from: "b", text: "x" }], null).b).toEqual(["x"]);
  });
  it("Stimmung je Person über die Tage", () => {
    const s = moodSeries([{ day: "2026-10-27", person: "a", value: 4 }, { day: "2026-10-27", person: "b", value: 2 }], "b", "2026-10-27", 3);
    expect(s.map((p) => p.value)).toEqual([null, null, 2]);
  });
});

describe("Wer kümmert sich", () => {
  const tasks: CareTask[] = [
    { title: "Kinderarzt", owner: "b", repeat: "jaehrlich", next: "2026-10-30", done: [{ day: "2026-10-01", by: "b" }] },
    { title: "Einkauf", owner: "a", repeat: "woechentlich", done: [{ day: "2026-10-20", by: "a" }, { day: "2026-10-27", by: "a" }, { day: "2026-09-01", by: "b" }] },
    { title: "Geschenke", owner: "offen", repeat: "laufend" },
  ];
  it("Zuständigkeiten, erledigt in 30 Tagen, demnächst fällig", () => {
    const o = careOverview(tasks, "2026-10-27");
    expect(o.owned).toEqual({ a: 1, b: 1, beide: 0, offen: 1 });
    expect(o.doneBy).toEqual({ a: 2, b: 1 });
    expect(o.shareA).toBe(67);
    expect(o.due.map((t) => t.title)).toEqual(["Kinderarzt"]);
  });
  it("nächster Termin nach Wiederholung", () => {
    expect(nextCareDate({ repeat: "woechentlich" }, "2026-10-27")).toBe("2026-11-03");
    expect(nextCareDate({ repeat: "monatlich", next: "2026-10-31" }, "2026-10-27")).toBe("2026-12-01");
    expect(nextCareDate({ repeat: "jaehrlich" }, "2026-10-27")).toBe("2027-10-27");
    expect(nextCareDate({ repeat: "laufend" }, "2026-10-27")).toBeUndefined();
  });
});

describe("Date-Erinnerung", () => {
  it("nach eingestellten Tagen, aus = 0", () => {
    expect(dateReminder("2026-10-01", "2026-10-27", 21)).toBe(26);
    expect(dateReminder("2026-10-20", "2026-10-27", 21)).toBeNull();
    expect(dateReminder("2026-10-01", "2026-10-27", 0)).toBeNull();
    expect(dateReminder(null, "2026-10-27", 21)).toBeNull();
  });
  it("Babysitter-Kosten im Jahr", () => {
    expect(dateStats([{ day: "2026-03-01", costEur: 40 }, { day: "2026-10-03", costEur: 45 }, { day: "2025-12-31", costEur: 50 }], "2026-10", "2026-10-27").costInYear).toBe(85);
  });
});
