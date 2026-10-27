import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES, calendarAbbreviations, colorDistance, distinctCalendarColors } from "@/lib/calendar/colors";
import { KIND_STYLE } from "@/lib/private/kind-style";

// Erfundene Kalendernamen; Farben wie Apple sie liefert.
describe("Kalenderfarben unterscheidbar", () => {
  it("ähnliche Farben (Familie/Privat beide gelb-orange) werden getrennt", () => {
    const m = distinctCalendarColors([{ name: "Familie", color: "#F7B500" }, { name: "Privat", color: "#FF9F0A" }], Object.values(SYSTEM_CATEGORIES).map((c) => c.color));
    expect(m.get("Familie")).toBe("#F7B500");
    expect(m.get("Privat")).not.toBe("#FF9F0A");
    expect(colorDistance(m.get("Familie")!, m.get("Privat")!)).toBeGreaterThanOrEqual(18);
  });
  it("eigene Farbe bleibt, wenn sie sich klar unterscheidet; ohne Farbe gibt es eine Ersatzfarbe", () => {
    const m = distinctCalendarColors([{ name: "Arbeit", color: "#34C759" }, { name: "Sport", color: null }]);
    expect(m.get("Arbeit")).toBe("#34C759");
    expect(m.get("Sport")).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it("Kürzel eindeutig und kurz", () => {
    const a = calendarAbbreviations(["Familie", "Feiertage", "Lugru Arbeit", "Privat"]);
    expect(a.get("Familie")).toBe("Fa");
    expect(a.get("Feiertage")).toBe("Fe");
    expect(a.get("Lugru Arbeit")).toBe("LA");
    expect(new Set(a.values()).size).toBe(4);
    const b = calendarAbbreviations(["Familie", "Familienfeste"]);
    expect(b.get("Familie")).not.toBe(b.get("Familienfeste"));
  });
  it("Systemkategorien haben Symbol und klar verschiedene Farben", () => {
    const cats = Object.values(SYSTEM_CATEGORIES);
    for (const c of cats) expect(c.icon.length).toBeGreaterThan(0);
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) expect(colorDistance(cats[i].color, cats[j].color)).toBeGreaterThan(15);
  });
  it("Privat-Arten: Streicheln und Massage deutlich verschieden, alle Paare ≥ 20", () => {
    const k = Object.entries(KIND_STYLE).filter(([key]) => key !== "extern");
    expect(colorDistance(KIND_STYLE.streicheln.color, KIND_STYLE.massage.color)).toBeGreaterThan(30);
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) expect(colorDistance(k[i][1].color, k[j][1].color), `${k[i][0]}/${k[j][0]}`).toBeGreaterThanOrEqual(20);
  });
});
