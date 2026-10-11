import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "reiseplaner-extras-"));
const extras = await import("../lib/extras.mjs");

const kontext = { personen: ["p1", "p2"], dateien: [{ id: "datei-1" }] };

test("Einträge werden geprüft und gesäubert", () => {
  assert.deepEqual(extras.eintragAus("packliste", { text: "  Maske ", gruppe: "Tauchen", fuer: "fremd", erledigt: "ja", boese: 1 }, kontext), { text: "Maske", gruppe: "Tauchen", fuer: "", erledigt: false });
  assert.throws(() => extras.eintragAus("packliste", { text: " " }, kontext), /eingepackt/);
  const d = extras.eintragAus("dokumente", { titel: "Pass", art: "hack", personId: "p1", frist: "2027-13-99x", gueltigBis: "2030-01-01", link: "javascript:alert(1)", dateiId: "gibtsnicht" }, kontext);
  assert.deepEqual([d.art, d.personId, d.frist, d.gueltigBis, d.link, d.dateiId], ["sonstiges", "p1", "", "2030-01-01", "", ""]);
  assert.equal(extras.eintragAus("dokumente", { titel: "x", dateiId: "datei-1" }, kontext).dateiId, "datei-1");
  const a = extras.eintragAus("ausgaben", { betrag: "12,50", waehrung: "usd", kategorie: "spa", ort: "bord", bezahltVon: "p2", fuer: ["p1", "p1", "x"] }, kontext);
  assert.deepEqual([a.betrag, a.waehrung, a.kategorie, a.ort, a.bezahltVon, a.fuer], [12.5, "EUR", "spa", "bord", "p2", ["p1"]]);
  assert.throws(() => extras.eintragAus("ausgaben", { betrag: -5 }, kontext), /Betrag/);
  assert.throws(() => extras.eintragAus("geheim", {}, kontext), /Liste/);
});

test("Gleichzeitige Änderungen gehen nicht verloren", async () => {
  const id = `reise-${Date.now()}-${process.pid}`;
  await Promise.all(Array.from({ length: 20 }, (_, i) => extras.eintragHinzufuegen(id, "packliste", { text: `Teil ${i}` }, "u1")));
  const e = await extras.extrasLesen(id);
  assert.equal(e.packliste.length, 20);
  await Promise.all([extras.stimmeSetzen(id, "a1", "p1", 1), extras.stimmeSetzen(id, "a1", "p2", -1), extras.tierSetzen(id, "Delfin", true)]);
  let s = await extras.extrasLesen(id);
  assert.deepEqual(s.stimmen.a1, { p1: 1, p2: -1 });
  assert.ok(s.tiere.Delfin);
  await extras.stimmeSetzen(id, "a1", "p1", 0);
  await extras.stimmeSetzen(id, "a1", "p2", 7);
  s = await extras.extrasLesen(id);
  assert.equal(s.stimmen.a1, undefined);
});
