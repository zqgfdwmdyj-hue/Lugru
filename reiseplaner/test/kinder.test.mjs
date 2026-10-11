import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LAENDER, landFuer, SPRACHEN, WOERTER, schatzAufgaben, ABZEICHEN, packBild, mischen } from "../public/kinderdaten.js";
import { kalenderDatei } from "../public/unterwegs-logik.js";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "reiseplaner-kinder-"));
const extras = await import("../lib/extras.mjs");

test("Länder: Inseln über Koordinaten, sonst über den Ländernamen", () => {
  assert.equal(landFuer({ name: "Fort-de-France", land: "Frankreich", lat: 14.6, lng: -61.07 }).name, "Martinique");
  assert.equal(landFuer({ name: "Santa Cruz", land: "Spanien", lat: 28.46, lng: -16.25 }).name, "Kanarische Inseln");
  assert.equal(landFuer({ name: "Castries", land: "St. Lucia" }).flagge, "🇱🇨");
  assert.equal(landFuer({ name: "La Romana" }), null); // nicht „Oman“
  assert.equal(landFuer({ art: "seetag" }), null);
  for (const l of LAENDER) {
    assert.ok(SPRACHEN[l.sprache], `${l.name}: Sprache ${l.sprache}`);
    assert.ok(l.flagge && l.hauptstadt && l.essen && l.fakt, l.name);
  }
  for (const [k, w] of Object.entries(WOERTER)) {
    assert.ok(SPRACHEN[k], k);
    assert.equal(w[0][0], "Hallo");
    assert.equal(w[1][0], "Danke");
    for (const z of w) assert.equal(z.length, 3);
  }
});

test("Schatzsuche: 5 verschiedene Aufgaben, je Tag immer gleich", () => {
  const a = schatzAufgaben({ id: "h1", datum: "2027-03-21", art: "hafen" });
  assert.equal(a.length, 5);
  assert.equal(new Set(a.map((x) => x.text)).size, 5);
  assert.deepEqual(a, schatzAufgaben({ id: "h1", datum: "2027-03-21", art: "hafen" }));
  assert.notDeepEqual(a, schatzAufgaben({ id: "h2", datum: "2027-03-22", art: "hafen" }));
  assert.match(schatzAufgaben({ id: "s", datum: "2027-03-20", art: "seetag" }).map((x) => x.text).join(), /Rettungsboote|Kapitän|Deck|Delfin|Crew|Schiff|Pool|Kinderclub|Kielwasser|Eis|Bordkarte|Regenbogen/);
  assert.deepEqual(mischen([1, 2, 3, 4], "x"), mischen([1, 2, 3, 4], "x"));
  assert.equal(new Set(ABZEICHEN.map((x) => x.id)).size, ABZEICHEN.length);
  assert.equal(packBild("Kuscheltier"), "🧸");
  assert.equal(packBild("Irgendwas"), "📦");
});

test("Kinder-Zustand wird geprüft und gesäubert", async () => {
  const id = `kinder-${Date.now()}`;
  const fotos = new Set(["foto-1234"]);
  let k = await extras.kinderAendern(id, "p1", { bereich: "abzeichen", schluessel: "mutprobe", wert: true });
  assert.ok(k.abzeichen.mutprobe);
  await assert.rejects(extras.kinderAendern(id, "p1", { bereich: "abzeichen", schluessel: "<script>", wert: true }), /Ungültiges/);
  await extras.kinderAendern(id, "p1", { bereich: "quiz", schluessel: "2027-03-21", wert: 4 });
  k = await extras.kinderAendern(id, "p1", { bereich: "quiz", schluessel: "2027-03-21", wert: 2 });
  assert.equal(k.quiz["2027-03-21"], 4); // bester Versuch bleibt
  k = await extras.kinderAendern(id, "p1", { bereich: "quiz", schluessel: "2027-03-22", wert: 99 });
  assert.equal(k.quiz["2027-03-22"], 10);
  k = await extras.kinderAendern(id, "p1", { bereich: "tagebuch", schluessel: "2027-03-21", wert: { stimmung: 9, text: "x".repeat(2000), bildId: "fremd" } }, fotos);
  assert.deepEqual([k.tagebuch["2027-03-21"].stimmung, k.tagebuch["2027-03-21"].text.length, k.tagebuch["2027-03-21"].bildId], [null, 1000, ""]);
  k = await extras.kinderAendern(id, "p1", { bereich: "tagebuch", schluessel: "2027-03-21", wert: { stimmung: 0, text: "Delfine!", bildId: "foto-1234" } }, fotos);
  assert.equal(k.tagebuch["2027-03-21"].bildId, "foto-1234");
  await extras.kinderAendern(id, "p1", { bereich: "kasse", wert: { start: "30" } });
  k = await extras.kinderAendern(id, "p1", { bereich: "kasseAusgabe", wert: { titel: "Eis", betrag: "2.5", datum: "2027-03-21" } });
  assert.equal(k.kasse.start, 30);
  assert.equal(k.kasse.ausgaben[0].betrag, 2.5);
  await assert.rejects(extras.kinderAendern(id, "p1", { bereich: "kasseAusgabe", wert: { betrag: -1 } }), /Betrag/);
  k = await extras.kinderAendern(id, "p1", { bereich: "kasseAusgabe", schluessel: k.kasse.ausgaben[0].id, wert: null });
  assert.equal(k.kasse.ausgaben.length, 0);
  await assert.rejects(extras.kinderAendern(id, "p1", { bereich: "geheim" }), /Unbekannter/);
  let s = await extras.schatzSetzen(id, "h1:3", true, "foto-1234");
  assert.equal(s["h1:3"].fotoId, "foto-1234");
  s = await extras.schatzSetzen(id, "h1:3", false);
  assert.equal(s["h1:3"], undefined);
  await assert.rejects(async () => extras.schatzSetzen(id, "../x", true), /Ungültige/);
  const t = await extras.tierSetzen(id, "Delfin", true, "foto-1234");
  assert.equal(t.tierFotos.Delfin, "foto-1234");
  assert.equal((await extras.tierSetzen(id, "Delfin", false)).tierFotos.Delfin, undefined);
});

test("Kinderprogramm: Erinnerung zum Abholen im Kalender", () => {
  const { text } = kalenderDatei({ name: "T", haefen: [{ id: "s1", datum: "2027-03-20", art: "seetag" }], ausfluege: [{ id: "k1", hafenId: "s1", titel: "Kids Club", kategorie: "kinderclub", status: "gebucht", beginn: "10:00", dauerMin: 120 }] }, { erstellt: new Date("2027-01-01T00:00:00Z") });
  assert.match(text, /SUMMARY:🧒 Abholen: Kids Club/);
  assert.match(text, /DTSTART:20270320T120000/);
  assert.match(text, /TRIGGER:-PT15M/);
});
