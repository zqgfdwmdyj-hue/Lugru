import { describe, expect, it } from "vitest";
import { ARBEITSZEIT_STANDARD, freieFenster, planeTag, planeTage, schaetzeAufwand, type PlanAufgabe, type Sperre } from "@/lib/tagesplan/logic";

// Tagesplan – erfundene Aufgaben. 2026-11-02 ist ein Montag.

const a = (id: string, o: Partial<PlanAufgabe> = {}): PlanAufgabe => ({ id, titel: `Aufgabe ${id}`, faellig: "2026-11-02", prioritaet: "normal", aufwand: "M", geschaetzt: false, link: null, ...o });
const kinder: Sperre = { von: "13:00", bis: "16:00", titel: "Kinderzeit", art: "privat" };

describe("Kapazität", () => {
  it("Arbeitszeit minus Sperrzeiten", () => {
    expect(freieFenster({ von: "09:00", bis: "17:00" }, [kinder])).toEqual([{ von: 540, bis: 780 }, { von: 960, bis: 1020 }]);
    expect(freieFenster({ von: "09:00", bis: "17:00" }, [{ von: "00:00", bis: "23:59", titel: "Auszeit", art: "privat", ganztags: true }])).toEqual([]);
    expect(freieFenster(null, [])).toEqual([]);
  });
});

describe("Abnahme Modul 1", () => {
  it("Tag mit 3 Std. Kinderzeit: nicht mehr Aufwand als die restliche Kapazität (5 Std.)", () => {
    const aufgaben = [a("1", { aufwand: "L" }), a("2", { aufwand: "M" }), a("3", { aufwand: "M" }), a("4", { aufwand: "S" })];
    const { plan, rest } = planeTag("2026-11-02", aufgaben, { von: "09:00", bis: "17:00" }, [kinder]);
    expect(plan.kapazitaet).toBe(300);
    expect(plan.belegt).toBeLessThanOrEqual(300);
    expect(plan.geplant.map((g) => g.id)).toEqual(["1", "2"]);
    expect(rest.map((r) => r.id).sort()).toEqual(["3", "4"].filter((x) => !plan.geplant.some((g) => g.id === x)));
    // L (4 Std.) ab 09:00 läuft über die Kinderzeit hinweg weiter: 09:00–13:00 = 4 Std.
    expect(plan.geplant[0]).toMatchObject({ von: "09:00", bis: "13:00" });
    expect(plan.geplant[1]).toMatchObject({ von: "16:00", bis: "17:00" });
  });
  it("Konflikt „Frist in Auszeit“ wird angezeigt; nicht Passendes wird mit neuem Datum verschoben", () => {
    const auszeit: Sperre = { von: "00:00", bis: "23:59", titel: "Auszeit", art: "privat", ganztags: true };
    const r = planeTage({
      start: "2026-11-02",
      tage: 5,
      arbeitszeit: ARBEITSZEIT_STANDARD,
      sperrenAm: (t) => (t === "2026-11-03" ? [auszeit] : t === "2026-11-02" ? [kinder] : []),
      aufgaben: [a("x", { faellig: "2026-11-03", titel: "Steuerunterlagen schicken" }), a("l1", { aufwand: "L" }), a("l2", { aufwand: "L" })],
    });
    const di = r.tage.find((t) => t.tag === "2026-11-03")!;
    expect(di.ampel).toBe("frei");
    expect(di.konflikte).toEqual([{ aufgabeId: "x", titel: "Steuerunterlagen schicken", text: "Frist fällt in „Auszeit“" }]);
    // Mo: nur eine L-Aufgabe passt (5 Std.), die zweite wandert auf Mi (Di ist Auszeit)
    expect(r.tage[0].geplant.some((g) => g.id === "l1")).toBe(true);
    expect(r.verschoben.find((v) => v.id === "l2")?.neu).toBe("2026-11-04");
  });
  it("Auszeit mit Uhrzeit über die ganze Arbeitszeit → Konflikt nennt die Auszeit", () => {
    const r = planeTage({ start: "2026-11-03", tage: 1, arbeitszeit: ARBEITSZEIT_STANDARD, sperrenAm: () => [{ von: "08:00", bis: "18:00", titel: "Auszeit", art: "privat" }], aufgaben: [a("x", { faellig: "2026-11-03", titel: "Frist" })] });
    expect(r.tage[0].konflikte[0].text).toBe("Frist fällt in „Auszeit“");
  });
  it("wichtige Aufgabe heute fällig, passt nicht mehr → Konflikt, Tag rot", () => {
    const r = planeTage({ start: "2026-11-02", tage: 1, arbeitszeit: { ...ARBEITSZEIT_STANDARD, "1": { von: "09:00", bis: "10:00" } }, sperrenAm: () => [], aufgaben: [a("1", { prioritaet: "critical", aufwand: "M" }), a("2", { prioritaet: "critical", aufwand: "S" })] });
    expect(r.tage[0].ampel).toBe("rot");
    expect(r.tage[0].konflikte[0].text).toMatch(/Wichtig und heute fällig/);
  });
});

describe("Aufwand vorschätzen", () => {
  it("Stichworte", () => {
    expect(schaetzeAufwand("Lieferant XY zurückrufen")).toBe("S");
    expect(schaetzeAufwand("Inventur Lager")).toBe("L");
    expect(schaetzeAufwand("Listing überarbeiten")).toBe("M");
  });
});
