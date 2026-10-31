import { describe, expect, it } from "vitest";
import { durationOf, kidsHours, multiDay, overnight } from "@/lib/private/logic";
import { buildCalendarItems, itemsByDay } from "@/lib/private/kalender";

// Auszeit/Paarzeit/Kinderzeit über mehrere Tage (Übernachtung): z. B. Mo 08:00 – Di 18:00. Erfundene Namen.
const names = { a: "Ina", b: "Tom" };

describe("Dauer über mehrere Tage", () => {
  it("Mo 08:00 – Di 18:00 = 34 Std., über Nacht", () => {
    expect(durationOf({ day: "2026-11-02", toDay: "2026-11-03", from: "08:00", to: "18:00" })).toEqual({ hours: 34, overnight: true, clockShift: 0 });
    expect(kidsHours({ day: "2026-11-02", toDay: "2026-11-03", from: "08:00", to: "18:00" })).toBe(34);
    expect(multiDay({ day: "2026-11-02", toDay: "2026-11-03" })).toBe(true);
    expect(overnight({ day: "2026-11-02", toDay: "2026-11-04", from: "08:00", to: "07:00" })).toBe(true);
  });

  it("auch wenn das Ende früher am Tag liegt als der Beginn (Fr 18:00 – So 10:00 = 40 Std.)", () => {
    expect(durationOf({ day: "2026-11-06", toDay: "2026-11-08", from: "18:00", to: "10:00" })).toMatchObject({ hours: 40 });
  });

  it("Zeitumstellung zählt mit (Sa 10:00 – So 10:00 am 24./25.10.2026 = 25 Std.)", () => {
    expect(durationOf({ day: "2026-10-24", toDay: "2026-10-25", from: "10:00", to: "10:00" })).toMatchObject({ hours: 25, clockShift: 1 });
  });

  it("klare Fehler: Uhrzeiten fehlen, Ende vor Beginn, mehr als 14 Tage", () => {
    expect(durationOf({ day: "2026-11-02", toDay: "2026-11-03", hours: 30 })).toEqual({ error: expect.stringContaining("„von“") });
    expect(durationOf({ day: "2026-11-03", toDay: "2026-11-02", from: "08:00", to: "18:00" })).toEqual({ error: expect.stringContaining("vor dem ersten Tag") });
    expect(durationOf({ day: "2026-11-01", toDay: "2026-11-20", from: "08:00", to: "18:00" })).toEqual({ error: expect.stringContaining("14 Tage") });
  });

  it("„bis Tag“ = derselbe Tag verhält sich wie bisher", () => {
    expect(durationOf({ day: "2026-11-02", toDay: "2026-11-02", from: "08:00", to: "18:00" })).toEqual({ hours: 10, overnight: false, clockShift: 0 });
  });
});

describe("Kalender", () => {
  it("Auszeit mit Kindern beim Partner erscheint an jedem Tag – auch wenn sie vor der Woche beginnt", () => {
    const items = buildCalendarItems(
      {
        names,
        today: "2026-11-01",
        auszeit: [{ id: "a1", data: { day: "2026-11-01", toDay: "2026-11-03", from: "08:00", to: "18:00", person: "a", linkId: "L1", status: "geplant" } }],
        kinder: [{ id: "k1", data: { day: "2026-11-01", toDay: "2026-11-03", from: "08:00", to: "18:00", person: "b", linkId: "L1", status: "geplant" } }],
      },
      "2026-11-02",
      "2026-11-08",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "auszeit", day: "2026-11-01", endDay: "2026-11-03", title: "Auszeit Ina · Kinder bei Tom" });
    const tage = itemsByDay(items, "2026-11-02", "2026-11-08");
    expect([...tage.keys()].sort()).toEqual(["2026-11-02", "2026-11-03"]);
    expect(tage.get("2026-11-03")![0].part).toBe("end");
  });
});
