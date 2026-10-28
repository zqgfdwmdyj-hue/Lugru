import { describe, expect, it } from "vitest";
import { buildCalendarItems, ritualOccurrences, type RitualEntry, type RitualSlot } from "@/lib/private/kalender";
import { changesTiming, repeatDays, seriesDeleteIds, seriesInfo, seriesScope, seriesTargets } from "@/lib/private/serie";

// Nur erfundene Daten (Namen „Anna“/„Ben“, Daten im Herbst 2026).

describe("Wiederholungen anlegen", () => {
  it("ohne Wiederholung nur der erste Tag", () => {
    expect(repeatDays("2026-11-02", "", "")).toEqual({ days: ["2026-11-02"] });
  });
  it("wöchentlich und alle 2 Wochen bis einschließlich „bis“", () => {
    expect(repeatDays("2026-11-02", "woche", "2026-11-23")).toEqual({ days: ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"], every: 7 });
    expect(repeatDays("2026-11-02", "2wochen", "2026-11-29")).toEqual({ days: ["2026-11-02", "2026-11-16"], every: 14 });
  });
  it("Fehler statt stiller Annahme: kein „bis“, „bis“ vor Beginn, länger als ein Jahr", () => {
    expect(repeatDays("2026-11-02", "woche", "")).toHaveProperty("error");
    expect(repeatDays("2026-11-02", "woche", "2026-11-01")).toHaveProperty("error");
    expect(repeatDays("2026-11-02", "woche", "2027-12-01")).toHaveProperty("error");
    const year = repeatDays("2026-11-02", "woche", "2027-11-02");
    expect("days" in year && year.days.length).toBe(53);
  });
});

describe("Serie ändern: nur dieser · dieser und alle folgenden · alle", () => {
  const row = (id: string, day: string, status = "geplant", exception?: boolean) => ({ id, data: { day, status, repeatId: "r1", repeatEvery: 7, ...(exception ? { exception } : {}) } });
  const rows = [row("1", "2026-10-19", "stattgefunden"), row("2", "2026-10-26", "ausgefallen"), row("3", "2026-11-02"), row("4", "2026-11-09", "geplant", true), row("5", "2026-11-16"), { id: "x", data: { day: "2026-11-02", status: "geplant" } }];
  it("Umfang aus dem Formular, unbekannt = nur dieser", () => {
    expect(seriesScope("folgende")).toBe("folgende");
    expect(seriesScope("alle")).toBe("alle");
    expect(seriesScope("irgendwas")).toBe("dieser");
  });
  it("nur dieser: genau der geöffnete Eintrag", () => {
    expect(seriesTargets(rows, rows[2], "dieser").targets.map((r) => r.id)).toEqual(["3"]);
  });
  it("folgende: ab diesem Tag, nur Geplantes ohne Ausnahme; Ausnahme bleibt", () => {
    expect(seriesTargets(rows, rows[2], "folgende")).toEqual({ targets: [rows[2], rows[4]], kept: 1 });
  });
  it("alle: Erledigtes (stattgefunden/ausgefallen) und Ausnahmen bleiben unverändert", () => {
    const r = seriesTargets(rows, rows[2], "alle");
    expect(r.targets.map((x) => x.id)).toEqual(["3", "5"]);
    expect(r.kept).toBe(3);
  });
  it("Einträge ohne Serie: immer nur dieser", () => {
    expect(seriesTargets(rows, rows[5], "alle").targets.map((r) => r.id)).toEqual(["x"]);
  });
  it("Löschen nach Wahl: dieser / folgende / alle – fremde Einträge nie", () => {
    expect(seriesDeleteIds(rows, rows[2], "dieser")).toEqual(["3"]);
    expect(seriesDeleteIds(rows, rows[2], "folgende")).toEqual(["3", "4", "5"]);
    expect(seriesDeleteIds(rows, rows[2], "alle")).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("Überblick: Anzahl, Position, Ausnahmen, folgende", () => {
    expect(seriesInfo(rows, rows[2])).toEqual({ count: 5, every: 7, first: "2026-10-19", last: "2026-11-16", position: 3, exceptions: 1, following: 3 });
    expect(seriesInfo(rows, rows[5])).toBeNull();
  });
  it("Ausnahme nur bei anderem Tag oder anderer Uhrzeit", () => {
    expect(changesTiming({ day: "2026-11-02", from: "15:00" }, { day: "2026-11-02", from: "15:00", what: "Zoo" })).toBe(false);
    expect(changesTiming({ day: "2026-11-02", from: "15:00" }, { day: "2026-11-03", from: "15:00" })).toBe(true);
    expect(changesTiming({ day: "2026-11-02" }, { day: "2026-11-02", from: "16:00" })).toBe(true);
  });
  it("Kalender kennzeichnet Serie und Ausnahme (nicht nur über Farbe)", () => {
    const items = buildCalendarItems(
      {
        names: { a: "Anna", b: "Ben" },
        today: "2026-10-28",
        kinder: [
          { id: "k1", data: { day: "2026-11-02", person: "a", status: "geplant", repeatId: "r1", repeatEvery: 7 } },
          { id: "k2", data: { day: "2026-11-10", person: "a", status: "geplant", repeatId: "r1", repeatEvery: 7, exception: true } },
          { id: "k3", data: { day: "2026-11-03", person: "b", status: "geplant" } },
        ],
      },
      "2026-11-01",
      "2026-11-30",
    );
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.k1).toMatchObject({ repeat: true });
    expect(by.k1.exception).toBeUndefined();
    expect(by.k2).toMatchObject({ repeat: true, exception: true });
    expect(by.k3.repeat).toBeUndefined();
  });
});

describe("Abendritual als Abfolge: zweimal Streicheln, danach Massage", () => {
  const slot = (weekday: number, kind: RitualSlot["kind"]): RitualSlot => ({ weekday, kind, giver: kind === "massage" ? "b" : "a", receiver: kind === "massage" ? "a" : "b" });
  // Abende Mo, Mi, Fr, So – je Abend beide Plätze, die Reihenfolge entscheidet.
  const evenings = [1, 3, 5, 7];
  const r: RitualEntry = { title: "Test", from: "2026-11-02", strokesPerMassage: 2, active: true, mode: "abfolge", slots: evenings.flatMap((d) => [slot(d, "streicheln"), slot(d, "massage")]) };
  const plan = (x: RitualEntry, from: string, to: string) => ritualOccurrences("s1", x, from, to, new Set()).map((o) => `${o.day.slice(8)}:${o.slot.kind[0]}`);
  it("S, S, M, S, S, M … über die Wochengrenze hinweg, nur an den gewählten Abenden", () => {
    expect(plan(r, "2026-11-02", "2026-11-15")).toEqual(["02:s", "04:s", "06:m", "08:s", "09:s", "11:m", "13:s", "15:s"]);
  });
  it("gleiches Ergebnis für jeden Ausschnitt (Bestätigen eines einzelnen Abends findet ihn wieder)", () => {
    expect(plan(r, "2026-11-11", "2026-11-11")).toEqual(["11:m"]);
    expect(plan(r, "2026-11-09", "2026-11-13")).toEqual(["09:s", "11:m", "13:s"]);
    // weit in der Zukunft (Zählung ohne alle Tage einzeln durchzugehen)
    const far = ritualOccurrences("s1", r, "2027-05-03", "2027-05-09", new Set()).map((o) => o.slot.kind);
    expect(far).toHaveLength(4);
    expect(far.filter((k) => k === "massage").length).toBeGreaterThanOrEqual(1);
  });
  it("neue Fassung setzt beim Stand an: schon 1 Streicheln erledigt → S, M, S, S, M", () => {
    expect(plan({ ...r, offset: 1 }, "2026-11-02", "2026-11-09")).toEqual(["02:s", "04:m", "06:s", "08:s", "09:m"]);
  });
  it("dreimal Streicheln, dann Massage", () => {
    expect(plan({ ...r, strokesPerMassage: 3 }, "2026-11-02", "2026-11-13").map((x) => x.slice(3))).toEqual(["s", "s", "s", "m", "s", "s", "s"]);
  });
  it("bestätigte oder verschobene Abende verschieben die Reihenfolge nicht", () => {
    const all = ritualOccurrences("s1", r, "2026-11-02", "2026-11-08", new Set());
    const rest = ritualOccurrences("s1", r, "2026-11-02", "2026-11-08", new Set([all[0].key]));
    expect(rest.map((o) => o.key)).toEqual(all.slice(1).map((o) => o.key));
  });
});
