import { describe, expect, it } from "vitest";
import { berlinInstant, clockChangeOn, clockShiftHours, durationOf, kidsHours, kidsOverview, upcomingClockChange } from "@/lib/private/logic";

describe("Zeitumstellung (Europe/Berlin)", () => {
  it("erkennt die Umstellungsnächte", () => {
    expect(clockChangeOn("2026-10-25")).toBe(60); // zurückgestellt: Nacht länger
    expect(clockChangeOn("2026-03-29")).toBe(-60); // vorgestellt: Nacht kürzer
    expect(clockChangeOn("2027-03-28")).toBe(-60);
    expect(clockChangeOn("2026-10-24")).toBe(0);
    expect(clockChangeOn("2026-10-26")).toBe(0);
    expect(upcomingClockChange("2026-10-24")).toEqual({ day: "2026-10-25", change: 60 });
    expect(upcomingClockChange("2026-11-01")).toBeNull();
  });

  it("Uhrzeit → Zeitpunkt wie eine echte Uhr", () => {
    expect(new Date(berlinInstant("2026-10-24", "06:30")).toISOString()).toBe("2026-10-24T04:30:00.000Z"); // Sommerzeit
    expect(new Date(berlinInstant("2026-10-25", "06:30")).toISOString()).toBe("2026-10-25T05:30:00.000Z"); // Winterzeit
    expect(new Date(berlinInstant("2026-10-25", "02:30")).toISOString()).toBe("2026-10-25T00:30:00.000Z"); // doppelte Stunde: die erste
    expect(new Date(berlinInstant("2026-03-29", "02:30")).toISOString()).toBe("2026-03-29T01:30:00.000Z"); // fehlende Stunde: = 03:30
  });

  it("Ausschlafen am Morgen nach der Umstellung: zählt nach der Uhr, die Nachtstunde nicht", () => {
    expect(kidsHours({ day: "2026-10-25", from: "06:30", to: "08:30" })).toBe(2);
    expect(clockShiftHours({ day: "2026-10-25", from: "06:30", to: "08:30" })).toBe(0);
    expect(kidsHours({ day: "2026-03-29", from: "06:30", to: "08:30" })).toBe(2);
  });

  it("Zeitspannen über die Umstellung zählen die tatsächlich vergangene Zeit", () => {
    // Herbst: 23–7 Uhr über die Umstellung = 9 Std. (Uhr zeigt 8)
    expect(kidsHours({ day: "2026-10-24", from: "23:00", to: "07:00" })).toBe(9);
    expect(clockShiftHours({ day: "2026-10-24", from: "23:00", to: "07:00" })).toBe(1);
    expect(kidsHours({ day: "2026-10-25", from: "01:00", to: "04:00" })).toBe(4);
    // Frühjahr: eine Stunde weniger
    expect(kidsHours({ day: "2026-03-28", from: "23:00", to: "07:00" })).toBe(7);
    expect(clockShiftHours({ day: "2026-03-28", from: "23:00", to: "07:00" })).toBe(-1);
    // normale Nacht und ohne Tag: wie bisher nach der Uhr
    expect(kidsHours({ day: "2026-10-17", from: "23:00", to: "07:00" })).toBe(8);
    expect(kidsHours({ from: "23:00", to: "07:00" })).toBe(8);
  });

  it("Speichern meldet die Umstellung und prüft Grenzen mit der echten Dauer", () => {
    expect(durationOf({ day: "2026-10-24", from: "23:00", to: "07:00" })).toEqual({ hours: 9, overnight: true, clockShift: 1 });
    expect(durationOf({ day: "2026-10-25", from: "06:30", to: "08:00" })).toEqual({ hours: 1.5, overnight: false, clockShift: 0 });
    // angegebene Stunden passend zur echten Dauer sind kein Widerspruch
    expect(durationOf({ day: "2026-10-24", from: "23:00", to: "07:00", hours: 9 })).toMatchObject({ hours: 9 });
  });

  it("Monatssummen rechnen die echte Dauer", () => {
    const ov = kidsOverview(
      [
        { day: "2026-10-24", person: "a", from: "23:00", to: "07:00" },
        { day: "2026-10-25", person: "b", from: "06:30", to: "08:30" },
      ],
      "2026-10",
    );
    expect([ov.totals.a.hours, ov.totals.b.hours]).toEqual([9, 2]);
  });
});
