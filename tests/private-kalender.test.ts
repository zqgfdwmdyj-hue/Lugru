import { describe, expect, it } from "vitest";
import { dateStats, defaultStatus, happened, kidsOverview, nextSleeper, sinceSummary, statusOf, statusProblem, type KidsEntry, type SleepEntry } from "@/lib/private/logic";
import {
  buildCalendarItems,
  defaultRitual,
  eventRef,
  eventRefFrom,
  filterItems,
  isoWeekday,
  itemsByDay,
  occurrenceKey,
  parseOccurrence,
  periodDays,
  periodProblem,
  ritualOccurrences,
  touchRhythm,
  weekDays,
  type TouchEntry,
} from "@/lib/private/kalender";
import { exportCalendarProblem, neutralExportItems } from "@/lib/private/export-logic";
import { isBusinessCalendar } from "@/lib/calendar/visibility";

// Nur erfundene Daten (Namen „Anna“/„Ben“, Daten im Oktober/November 2026).
const names = { a: "Anna", b: "Ben" };
const TODAY = "2026-10-27"; // Dienstag

describe("Status: geplant · stattgefunden · ausgefallen", () => {
  it("alte Einträge ohne Status gelten als stattgefunden", () => {
    expect(statusOf({})).toBe("stattgefunden");
    expect(statusOf({ status: "geplant" })).toBe("geplant");
    expect(happened({ status: "ausgefallen" })).toBe(false);
  });
  it("Zukunft kann nicht stattgefunden haben, Vorbelegung nach Datum", () => {
    expect(statusProblem("2026-10-30", "stattgefunden", TODAY)).toMatch(/geplant/);
    expect(statusProblem("2026-10-30", "geplant", TODAY)).toBeNull();
    expect(defaultStatus("2026-10-30", TODAY)).toBe("geplant");
    expect(defaultStatus(TODAY, TODAY)).toBe("stattgefunden");
  });
  it("Planung ändert die Ist-Auswertung nicht", () => {
    const kids: KidsEntry[] = [
      { day: "2026-10-20", person: "a", hours: 2 },
      { day: "2026-10-29", person: "a", hours: 5, status: "geplant" },
      { day: "2026-10-21", person: "b", hours: 3, status: "ausgefallen" },
    ];
    const ov = kidsOverview(kids, "2026-10");
    expect(ov.totals.a).toEqual({ count: 1, hours: 2 });
    expect(ov.totals.b).toEqual({ count: 0, hours: 0 });
    expect(ov.planned).toEqual({ a: 1, b: 0 });
    expect(ov.days.length).toBe(3); // Liste zeigt alles, mit Status
  });
  it("geplantes Ausschlafen macht niemanden „dran gewesen“", () => {
    const sleep: SleepEntry[] = [
      { day: "2026-10-24", person: "a", hours: 1 },
      { day: "2026-10-31", person: "b", hours: 1, status: "geplant" },
    ];
    expect(nextSleeper(sleep)).toBe("b");
  });
  it("Paarzeit und Rückblick zählen nur Stattgefundenes", () => {
    const dates = [{ day: "2026-10-10", hours: 3 }, { day: "2026-10-30", hours: 3, status: "geplant" as const }];
    expect(dateStats(dates, "2026-10", TODAY).inMonth).toBe(1);
    const s = sinceSummary({ since: "2026-10-01", today: TODAY, intim: [], kids: [{ day: "2026-10-05", person: "a", hours: 1, status: "geplant" }], tasks: [], dates });
    expect(JSON.stringify(s)).not.toContain("2026-10-30");
  });
});

describe("Periode", () => {
  it("Zeitraum über den Monatswechsel, laufend bis heute", () => {
    expect(periodDays({ start: "2026-10-29", end: "2026-11-02" }, "2026-11-10")).toBe(5);
    expect(periodDays({ start: "2026-10-25" }, TODAY)).toBe(3);
  });
  it("prüft Ende vor Beginn, Zukunft und Überschneidung derselben Person", () => {
    expect(periodProblem({ start: "2026-10-10", end: "2026-10-08", person: "b" }, [], TODAY)).toMatch(/vor dem Beginn/);
    expect(periodProblem({ start: "2026-11-01", person: "b" }, [], TODAY)).toMatch(/begonnen/);
    const others = [{ id: "x", start: "2026-10-01", end: "2026-10-05", person: "b" as const }];
    expect(periodProblem({ start: "2026-10-04", end: "2026-10-06", person: "b" }, others, TODAY)).toMatch(/Überschneidet/);
    expect(periodProblem({ start: "2026-10-04", end: "2026-10-06", person: "a" }, others, TODAY)).toBeNull();
    expect(periodProblem({ start: "2026-10-01", end: "2026-10-06", person: "b" }, others, TODAY, "x")).toBeNull();
  });
  it("erscheint im Kalender durchgehend über den Monatswechsel", () => {
    const items = buildCalendarItems({ names, today: "2026-11-05", periods: [{ id: "p1", data: { start: "2026-10-30", end: "2026-11-03", person: "b" } }] }, "2026-10-26", "2026-11-08");
    const byDay = itemsByDay(items, "2026-10-26", "2026-11-08");
    const days = [...byDay.entries()].filter(([, l]) => l.some((i) => i.kind === "periode")).map(([d]) => d);
    expect(days).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(byDay.get("2026-10-30")![0].part).toBe("start");
    expect(byDay.get("2026-11-01")![0].part).toBe("mid");
    expect(byDay.get("2026-11-03")![0].part).toBe("end");
    // Monatsansicht November (Raster ab 26.10.): beginnt sichtbar am 30.10.
    const nov = itemsByDay(items, "2026-11-01", "2026-11-30");
    expect(nov.get("2026-11-01")![0].part).toBe("mid");
  });
});

describe("Abendritual: zweimal Streicheln, dann Massage", () => {
  const r = defaultRitual("2026-10-26");
  it("Vorlage Mo–Do, Di/Do zusätzlich Massage, Fr–So frei", () => {
    const occ = ritualOccurrences("s1", r, "2026-10-26", "2026-11-01", new Set());
    const plan = occ.map((o) => `${o.day.slice(8)}:${o.slot.kind}:${o.slot.giver}`);
    expect(plan).toEqual(["26:streicheln:a", "27:streicheln:a", "27:massage:b", "28:streicheln:a", "29:streicheln:a", "29:massage:b"]);
    expect(occ.some((o) => isoWeekday(o.day) >= 5)).toBe(false);
  });
  it("bestätigte, verschobene oder ausgelassene Vorkommen erscheinen nicht doppelt", () => {
    const all = ritualOccurrences("s1", r, "2026-10-26", "2026-10-27", new Set());
    const handled = new Set([all[0].key]);
    expect(ritualOccurrences("s1", r, "2026-10-26", "2026-10-27", handled).map((o) => o.key)).not.toContain(all[0].key);
    expect(parseOccurrence(all[0].key)).toEqual({ seriesId: "s1", day: "2026-10-26", slot: "1-streicheln-ab" });
    expect(parseOccurrence("kaputt")).toBeNull();
  });
  it("Rhythmus zählt nur Bestätigtes, Streicheln am selben Abend vor der Massage", () => {
    const t = (day: string, kind: TouchEntry["kind"], status: TouchEntry["status"] = "stattgefunden"): TouchEntry => ({ day, kind, giver: kind === "massage" ? "b" : "a", receiver: kind === "massage" ? "a" : "b", status });
    expect(touchRhythm([], r)).toMatchObject({ count: 0, target: 2, due: false });
    expect(touchRhythm([t("2026-10-26", "streicheln")], r).count).toBe(1);
    expect(touchRhythm([t("2026-10-26", "streicheln"), t("2026-10-27", "streicheln", "geplant")], r).count).toBe(1);
    const tue = [t("2026-10-26", "streicheln"), t("2026-10-27", "streicheln"), t("2026-10-27", "massage")];
    expect(touchRhythm(tue, r)).toMatchObject({ count: 0, lastMassage: "2026-10-27" });
    expect(touchRhythm(tue.slice(0, 2), r)).toMatchObject({ count: 2, due: true });
    // Massage nur geplant: zählt nicht – Rhythmus steht weiter auf 2/2.
    expect(touchRhythm([...tue.slice(0, 2), t("2026-10-27", "massage", "geplant")], r).count).toBe(2);
  });
  it("Streicheln und Massage am selben Abend getrennt bestätigbar (zwei Einträge)", () => {
    const k1 = occurrenceKey("s1", "2026-10-27", r.slots[1]);
    const k2 = occurrenceKey("s1", "2026-10-27", r.slots[2]);
    expect(k1).not.toBe(k2);
    const items = buildCalendarItems(
      { names, today: TODAY, rituals: [{ id: "s1", data: r }], touches: [{ id: "t1", data: { day: "2026-10-27", kind: "streicheln", giver: "a", receiver: "b", status: "stattgefunden", seriesId: "s1", occurrence: k1 } }] },
      "2026-10-27",
      "2026-10-27",
    );
    expect(items.map((i) => `${i.kind}:${i.status}:${i.virtual ? "v" : "e"}`).sort()).toEqual(["massage:geplant:v", "streicheln:stattgefunden:e"]);
    expect(items.find((i) => i.kind === "massage")!.title).toBe("Ben massiert Anna");
  });
  it("ein verschobenes Vorkommen steht am neuen Tag, nicht mehr am alten", () => {
    const k = occurrenceKey("s1", "2026-10-28", r.slots[3]);
    const items = buildCalendarItems({ names, today: TODAY, rituals: [{ id: "s1", data: r }], touches: [{ id: "t2", data: { day: "2026-10-31", kind: "streicheln", giver: "a", receiver: "b", status: "geplant", seriesId: "s1", occurrence: k } }] }, "2026-10-26", "2026-11-01");
    const byDay = itemsByDay(items, "2026-10-26", "2026-11-01");
    expect(byDay.get("2026-10-28") ?? []).toHaveLength(0);
    expect(byDay.get("2026-10-31")!.map((i) => i.id)).toEqual(["t2"]);
  });
});

describe("Gemeinsamer Kalender", () => {
  it("verknüpfte Auszeit + Kinderzeit = ein Eintrag für beide Personen", () => {
    const items = buildCalendarItems(
      {
        names,
        today: TODAY,
        auszeit: [{ id: "z1", data: { day: TODAY, person: "a", from: "18:00", to: "21:00", linkId: "L", status: "geplant" } }],
        kinder: [{ id: "k1", data: { day: TODAY, person: "b", from: "18:00", to: "21:00", linkId: "L", status: "geplant" } }, { id: "k2", data: { day: TODAY, person: "a", hours: 1 } }],
      },
      TODAY,
      TODAY,
    );
    expect(items).toHaveLength(2);
    const linked = items.find((i) => i.kind === "auszeit")!;
    expect(linked.title).toBe("Auszeit Anna · Kinder bei Ben");
    expect(linked.people.sort()).toEqual(["a", "b"]);
    expect(linked.href).toBe("/privat/eintrag/z1");
  });
  it("Filter nach Person und Art", () => {
    const items = buildCalendarItems(
      {
        names,
        today: TODAY,
        termine: [{ id: "t", data: { day: TODAY, with: "privat", title: "Elternabend", person: "b" } }],
        ausschlafen: [{ id: "s", data: { day: TODAY, person: "a", hours: 1 } }],
        extern: [{ id: "e", title: "Geburtstag", day: TODAY, calendar: "Familie" }],
      },
      TODAY,
      TODAY,
    );
    expect(filterItems(items, { person: "a" }).map((i) => i.kind).sort()).toEqual(["ausschlafen", "extern"]);
    expect(filterItems(items, { kinds: new Set(["termin"]) }).map((i) => i.title)).toEqual(["Elternabend"]);
  });
  it("Woche Mo–So", () => {
    expect(weekDays("2026-11-01")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});

describe("Externer Kalender: nur ausdrücklich, nur neutral", () => {
  const rows = [
    { id: "1", kind: "termin", data: { day: "2026-10-28", extern: true } },
    { id: "2", kind: "termin", data: { day: "2026-10-29" } },
    { id: "3", kind: "periode", data: { day: "2026-10-28", extern: true } },
    { id: "4", kind: "intim", data: { day: "2026-10-28", extern: true } },
    { id: "5", kind: "zuwendung", data: { day: "2026-10-28", extern: true } },
    { id: "6", kind: "auszeit", data: { day: "2026-10-30", extern: true, linkId: "L" } },
    { id: "7", kind: "kinder", data: { day: "2026-10-30", extern: true, linkId: "L" } },
    { id: "8", kind: "paarzeit", data: { day: "2026-10-31", extern: true, status: "ausgefallen" } },
  ];
  it("nur angehakt, nie Periode/Nähe/Zuwendung, verknüpft einmal, Ausgefallenes nicht", () => {
    const out = neutralExportItems(rows, "2026-10-01", "2026-12-31");
    expect(out.map((o) => o.key)).toEqual(["priv:1", "priv:L"]);
    expect(out.every((o) => o.title === "Privater Termin" && o.description === "")).toBe(true);
  });
  it("Export-Kalender nie der System- oder ein Mitarbeiter-Kalender", () => {
    expect(exportCalendarProblem("Seller-System", "Seller-System", [])).toMatch(/geschäftliche/);
    expect(exportCalendarProblem("Team", "Seller-System", ["team"])).toMatch(/Mitarbeiter/);
    expect(exportCalendarProblem("Privat", "Seller-System", ["Team"])).toBeNull();
  });
  it("Geschäft/Privat-Filter im Hauptkalender", () => {
    expect(isBusinessCalendar("Seller-System", [], "Seller-System")).toBe(true);
    expect(isBusinessCalendar("Team", ["team"], "Seller-System")).toBe(true);
    expect(isBusinessCalendar("Familie", ["team"], "Seller-System")).toBe(false);
  });
});

describe("Familienkalender-Termin übernehmen (z. B. Eishockey als Paarzeit)", () => {
  const start = new Date("2026-11-01T14:00:00Z");
  const ref = eventRef("test-uid-eishockey@example", start);
  const extern = [
    { id: "ev-1", ref, title: "Eishockeyspiel", day: "2026-11-01", time: "15:00", calendar: "Familie", abbr: "Fa" },
    { id: "ev-2", ref: eventRef("test-uid-halloween@example", new Date("2026-10-31T15:00:00Z")), title: "Halloween", day: "2026-10-31", time: "16:00", calendar: "Familie" },
  ];

  it("Kennung aus UID und Beginn, nur gültige werden übernommen", () => {
    expect(ref).toBe("test-uid-eishockey@example|2026-11-01T14:00:00.000Z");
    expect(eventRefFrom(ref)).toBe(ref);
    expect(eventRefFrom("a|b|2026-11-01T14:00:00.000Z")).toBe("a|b|2026-11-01T14:00:00.000Z");
    expect(eventRefFrom("kein-termin")).toBeUndefined();
    expect(eventRefFrom("x|2026-11-01")).toBeUndefined();
    expect(eventRefFrom("x\n|2026-11-01T14:00:00.000Z")).toBeUndefined();
    expect(eventRefFrom(42)).toBeUndefined();
  });

  it("noch nicht übernommen: Termin antippbar (öffnet Eintragen)", () => {
    const items = buildCalendarItems({ names, today: TODAY, extern }, "2026-10-26", "2026-11-01");
    const e = items.find((i) => i.key === "extern:ev-1")!;
    expect(e.href).toBe("/privat/eintragen?vom=ev-1");
  });

  it("übernommen: Privat-Eintrag ersetzt den Termin, mit Herkunft – kein Doppel", () => {
    const items = buildCalendarItems(
      {
        names,
        today: TODAY,
        extern,
        paarzeit: [{ id: "p1", data: { day: "2026-11-01", from: "15:00", to: "18:00", what: "Eishockeyspiel", status: "geplant", fromEvent: ref } }],
        kinder: [{ id: "k1", data: { day: "2026-10-31", person: "beide", from: "16:00", to: "19:00", what: "Halloween", status: "geplant", fromEvent: extern[1].ref } }],
      },
      "2026-10-26",
      "2026-11-01",
    );
    expect(items.filter((i) => i.kind === "extern")).toEqual([]);
    const p = items.find((i) => i.kind === "paarzeit")!;
    expect(p).toMatchObject({ title: "Paarzeit · Eishockeyspiel", fromCalendar: "Familie", status: "geplant" });
    const k = items.find((i) => i.kind === "kinder")!;
    expect(k).toMatchObject({ title: "Kinderzeit zusammen · Halloween", people: ["a", "b"], fromCalendar: "Familie" });
    // Für jede Person sichtbar.
    expect(filterItems(items, { person: "b" }).map((i) => i.kind).sort()).toEqual(["kinder", "paarzeit"]);
  });

  it("Termin verschoben (anderer Beginn) → erscheint wieder, der Privat-Eintrag bleibt", () => {
    const moved = [{ ...extern[0], ref: eventRef("test-uid-eishockey@example", new Date("2026-11-01T15:00:00Z")), time: "16:00" }];
    const items = buildCalendarItems({ names, today: TODAY, extern: moved, paarzeit: [{ id: "p1", data: { day: "2026-11-01", status: "geplant", hours: 3, fromEvent: ref } }] }, "2026-10-26", "2026-11-01");
    expect(items.map((i) => i.kind).sort()).toEqual(["extern", "paarzeit"]);
    expect(items.find((i) => i.kind === "paarzeit")?.fromCalendar).toBe("Familienkalender");
  });
});

describe("Kinderzeit „beide zusammen“", () => {
  const e = (person: KidsEntry["person"], day: string, from: string, to: string, status?: KidsEntry["status"]): KidsEntry => ({ day, person, from, to, ...(status ? { status } : {}) });
  it("eigene Summe, nicht im Anteil „allein mit den Kindern“", () => {
    const ov = kidsOverview([e("a", "2026-10-03", "10:00", "14:00"), e("b", "2026-10-04", "10:00", "12:00"), e("beide", "2026-10-31", "16:00", "19:00"), e("beide", "2026-10-30", "10:00", "12:00", "geplant")], "2026-10");
    expect(ov.totals).toEqual({ a: { count: 1, hours: 4 }, b: { count: 1, hours: 2 } });
    expect(ov.together).toEqual({ count: 1, hours: 3 });
    expect(ov.shareA).toBe(67);
    expect(ov.planned).toEqual({ a: 0, b: 0 });
    expect(ov.days.find((d) => d.day === "2026-10-31")).toMatchObject({ a: [], b: [], both: [expect.objectContaining({ person: "beide" })] });
  });
  it("Sitzungs-Rückblick zählt nur allein verbrachte Zeit", () => {
    const s = sinceSummary({ since: "2026-10-01", today: TODAY, intim: [], tasks: [], kids: [e("a", "2026-10-03", "10:00", "14:00"), e("beide", "2026-10-05", "10:00", "14:00")] });
    expect(s.kidsHours).toEqual({ a: 4, b: 0 });
    expect(s.kidsCount).toEqual({ a: 1, b: 0 });
  });
});
