import { describe, expect, it } from "vitest";
import { placeAll } from "@/lib/pallets/placement";

// Mehrfach-Einlagerung: Platzierung vorher entschieden. Fiktive Plätze.

const plan = ["A-01", "A-02", "A-03", "A-04"];
describe("placeAll", () => {
  it("alle auf einen Platz, ohne Platz, eine Palette", () => {
    expect(placeAll(3, "A-01", "alle", plan, [])).toEqual({ locations: ["A-01", "A-01", "A-01"], short: 0 });
    expect(placeAll(2, "A-01", "ohne", plan, [])).toEqual({ locations: [null, null], short: 0 });
    expect(placeAll(1, "A-02", null, plan, [])).toEqual({ locations: ["A-02"], short: 0 });
  });
  it("verteilen ab dem Platz über freie Plätze, belegte überspringen, Rest ohne Platz", () => {
    expect(placeAll(3, "A-02", "verteilen", plan, ["A-03"])).toEqual({ locations: ["A-02", "A-04", "A-01"], short: 0 });
    expect(placeAll(4, "A-01", "verteilen", plan, ["A-02", "A-03"])).toEqual({ locations: ["A-01", "A-04", null, null], short: 2 });
  });
});
