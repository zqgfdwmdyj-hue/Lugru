import { describe, expect, it } from "vitest";
import { calendarVisible } from "@/lib/calendar/visibility";

// Wer sieht eigene Kalender? Fiktive Namen.

describe("Kalender-Sichtbarkeit", () => {
  const owner = { role: "owner" as const, privateAccess: false };
  const partner = { role: "staff" as const, privateAccess: true };
  const staff = { role: "staff" as const, privateAccess: false };
  it("Inhaber und Privat-Zugang sehen alles", () => {
    expect(calendarVisible(owner, "Familie", [])).toBe(true);
    expect(calendarVisible(partner, "Familie", undefined)).toBe(true);
  });
  it("Mitarbeiter ohne Freigabe: kein eigener Kalender; mit Freigabe nur dieser (Schreibweise egal)", () => {
    expect(calendarVisible(staff, "Arbeit", undefined)).toBe(false);
    expect(calendarVisible(staff, "Arbeit", [" arbeit "])).toBe(true);
    expect(calendarVisible(staff, "Familie", ["Arbeit"])).toBe(false);
  });
});
