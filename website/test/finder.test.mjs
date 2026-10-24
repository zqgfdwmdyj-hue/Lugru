// Prüft jede Antwortkombination des Box-Finders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
// produkte.js ist ein Browser-Skript: hier in einem leeren „window“ ausführen.
const fenster = {};
vm.runInNewContext(readFileSync(new URL("../public/js/produkte.js", import.meta.url), "utf8"), { window: fenster });
const { PRODUKTE, empfehlung } = fenster.GRULU_PRODUKTE;

const WER = ["klein", "gross", "familie"], ANLASS = ["schule", "geschenk", "reise", "snack"], TYP = ["pop", "nerds", "buch"];

test("jede Kombination hat eine Empfehlung mit Begründung", () => {
  for (const w of WER) for (const a of ANLASS) for (const t of TYP) {
    const e = empfehlung(w, a, t);
    assert.ok(PRODUKTE[e.tipp], `${w}/${a}/${t}`);
    assert.ok(e.warum.length > 0, `${w}/${a}/${t}: ohne Begründung`);
    if (e.auch) assert.ok(PRODUKTE[e.auch] && e.auch !== e.tipp, `${w}/${a}/${t}: Alternative`);
    // Nicht verfügbare Boxen immer mit verfügbarer Alternative.
    if (!PRODUKTE[e.tipp].verfuegbar) assert.ok(e.auch && PRODUKTE[e.auch].verfuegbar, `${w}/${a}/${t}: keine verfügbare Alternative`);
  }
});

test("die gewählte Geschmacksrichtung passt", () => {
  for (const w of WER) for (const a of ["geschenk", "snack"]) {
    assert.equal(empfehlung(w, a, "pop").tipp, "pop", `${w}/${a}: Knistern → Pop Rocks`);
    assert.equal(empfehlung(w, a, "nerds").tipp, "nerds", `${w}/${a}: bunt → Nerds`);
    assert.equal(empfehlung(w, a, "buch").tipp, "reise", `${w}/${a}: Buch → Reisebox`);
  }
  // Der Fall aus dem Test: Kind 4–7, Geschenk, Knistern → Pop Rocks.
  assert.equal(empfehlung("klein", "geschenk", "pop").tipp, "pop");
});

test("Schulstart führt zur Schultüte oder Füllung", () => {
  for (const w of WER) for (const t of TYP) assert.ok(["schultuete", "fuellung"].includes(empfehlung(w, "schule", t).tipp));
});
