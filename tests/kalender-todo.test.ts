import { describe, expect, it } from "vitest";
import { kalenderTodo, vornamen } from "@/lib/calendar/kalender-todo";

// Familienkalender → To-do-Liste. Erfundene Namen.
const P = [
  { userId: "u-ludwig", namen: vornamen("Ludwig Muster") },
  { userId: "u-tom", namen: vornamen("Tom", "Thomas") },
];

describe("To do <Name> im Kalendertitel", () => {
  it("Schreibweisen wie im Familienkalender", () => {
    expect(kalenderTodo("To do Ludwig : Sachen Tafel herrichten", P)).toEqual({ userId: "u-ludwig", text: "Sachen Tafel herrichten" });
    expect(kalenderTodo("ToDo für Ludwig – Reifen wechseln", P)).toEqual({ userId: "u-ludwig", text: "Reifen wechseln" });
    expect(kalenderTodo("To-Do Ludwig: Müll rausbringen", P)?.text).toBe("Müll rausbringen");
    expect(kalenderTodo("todo ludwig Paket abholen", P)?.text).toBe("Paket abholen");
    expect(kalenderTodo("Aufgabe Tom: Kinder abholen", P)).toEqual({ userId: "u-tom", text: "Kinder abholen" });
    expect(kalenderTodo("Ludwig: To do Garage aufräumen", P)?.text).toBe("Garage aufräumen");
    expect(kalenderTodo("To do Thomas: Rasen", P)?.userId).toBe("u-tom");
  });
  it("ohne Text danach der ganze Titel; keine Fehltreffer", () => {
    expect(kalenderTodo("To do Ludwig", P)).toEqual({ userId: "u-ludwig", text: "To do Ludwig" });
    expect(kalenderTodo("Ludwig Zahnarzt", P)).toBeNull();
    expect(kalenderTodo("To do Ludwiga: etwas", P)).toBeNull();
    expect(kalenderTodo("Fortbildung Arbeit", P)).toBeNull();
    expect(kalenderTodo("Jourfix", P)).toBeNull();
    expect(kalenderTodo("To do: Einkaufen", P)).toBeNull(); // ohne Namen: niemandem zuordnen
  });
  it("Vornamen: erstes Wort, mindestens 2 Zeichen, ohne Dubletten", () => {
    expect(vornamen("Ludwig Muster", "Ludwig", null, "A")).toEqual(["Ludwig"]);
  });
});
