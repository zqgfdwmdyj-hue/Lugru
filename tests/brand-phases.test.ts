import { describe, expect, it } from "vitest";
import { contentPhase, ideaUnaccepted, postUnaccepted, ideaPhase, isOverdue, phaseOrder } from "@/lib/brands/phases";

// Marken & Content: Phasen, Überfälliges, eigene vor KI.

describe("Phasen", () => {
  it("Ideen und Content", () => {
    expect(["idea", "review", "planned", "in_progress", "live"].map(ideaPhase)).toEqual(["ideen", "ideen", "planung", "umsetzung", "veroeffentlichung"]);
    expect(contentPhase("idea", null)).toBe("ideen");
    expect(contentPhase("idea", "2026-11-01")).toBe("planung");
    expect(contentPhase("edited", null)).toBe("umsetzung");
    expect(contentPhase("scheduled", "2026-11-01")).toBe("veroeffentlichung");
  });
  it("überfällig nur, wenn noch nicht fertig", () => {
    expect(isOverdue("2026-10-01", false, "2026-10-24")).toBe(true);
    expect(isOverdue("2026-10-01", true, "2026-10-24")).toBe(false);
    expect(isOverdue(null, false, "2026-10-24")).toBe(false);
  });
  it("Reihenfolge: überfällig, eigene vor KI, Termin", () => {
    const l = phaseOrder(
      [
        { id: "ki", source: "ai", date: "2026-10-30", done: false },
        { id: "eigen", source: "manual", date: "2026-11-30", done: false },
        { id: "alt", source: "ai", date: "2026-10-01", done: false },
      ],
      "2026-10-24",
    );
    expect(l.map((x) => x.id)).toEqual(["alt", "eigen", "ki"]);
  });
});

describe("Nicht angenommene Ideen", () => {
  it("KI-Beitrag mit vorgeschlagenem Datum bleibt Idee und ist nie überfällig", () => {
    expect(contentPhase("idea", "2026-10-01", "ai")).toBe("ideen");
    expect(contentPhase("idea", "2026-10-01", "manual")).toBe("planung");
    expect(postUnaccepted("idea", "ai")).toBe(true);
    expect(postUnaccepted("filmed", "ai")).toBe(false);
    expect(ideaUnaccepted("review")).toBe(true);
    expect(ideaUnaccepted("planned")).toBe(false);
  });
});
