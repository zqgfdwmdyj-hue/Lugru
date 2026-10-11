import { test } from "node:test";
import assert from "node:assert/strict";
import { tagebuchInhalt, seiteRendern, besuchteOrte } from "../lib/tagebuch.mjs";

const heute = "2026-06-01";
const reise = (extra) => ({
  id: "r1", name: "Karibik", art: "kreuzfahrt", schiff: "Mein Schiff 2", oeffentlich: true,
  personen: [{ id: "p1", name: "Anna Geheim" }],
  haefen: [
    { id: "h1", datum: "2026-05-01", art: "hafen", name: "Castries", land: "St. Lucia", lat: 14, lng: -61, notiz: "PRIVATE NOTIZ" },
    { id: "h2", datum: "2026-05-02", art: "seetag", name: "Seetag" },
    { id: "h3", datum: "2026-07-01", art: "hafen", name: "Zukunftshafen", land: "X", lat: 1, lng: 1 },
  ],
  ausfluege: [
    { id: "a1", hafenId: "h1", titel: "Delfine", status: "gebucht", preisGruppe: 275, preisArt: "gruppe", notiz: "GEHEIM", kategorie: "tiere" },
    { id: "a2", hafenId: "h1", titel: "Nur eine Idee", status: "idee" },
    { id: "a3", hafenId: "h3", titel: "Später", status: "gebucht" },
  ],
  hotels: [{ id: "ho1", name: "Hotel Sonne", status: "gebucht", anreise: "2026-04-28", abreise: "2026-05-01", lat: 14.1, lng: -61.1, preis: 999 }],
  kosten: [{ titel: "Flug", betrag: 1234 }],
  ...extra,
});
const beitraege = {
  bewertungen: [
    { zielArt: "ausflug", zielId: "a1", autorId: "u1", sterne: 5, text: "Toll", fotos: ["f1"] },
    { zielArt: "ausflug", zielId: "a1", autorId: "u1", sterne: 1, text: "PRIVATER TEXT", fotos: ["f2"], privat: true },
    { zielArt: "hotel", zielId: "ho1", autorId: "u1", sterne: 4, text: "Schön", fotos: ["f3"] },
  ],
  tauchgaenge: [
    { tauchplatz: "Riff", datum: "2026-05-01", taucherId: "u1", fotos: ["f4"], maxTiefe: 18 },
    { tauchplatz: "Privatriff", datum: "2026-05-01", taucherId: "u1", fotos: ["f5"], privat: true },
  ],
  fotos: [],
};
const benutzer = [{ id: "u1", name: "Anna Geheim" }];
const einst = { titel: "Unsere Reisen", text: "", orte: [{ id: "o1", name: "Hurghada", land: "Ägypten", lat: 27, lng: 33, jahr: "2019", notiz: "" }] };

test("Öffentliches Tagebuch: nur Freigegebenes, nur Vergangenes", () => {
  const i = tagebuchInhalt([{ reise: reise(), beitraege }], benutzer, einst, heute);
  assert.equal(i.reisen.length, 1);
  const r = i.reisen[0];
  assert.deepEqual(r.ausfluege.map((a) => a.titel), ["Delfine"]);
  assert.deepEqual(r.ausfluege[0].bewertungen.map((b) => b.text), ["Toll"]);
  assert.equal(r.ausfluege[0].bewertungen[0].autor, "Anna");
  assert.deepEqual(r.hotels.map((h) => h.name), ["Hotel Sonne"]);
  assert.deepEqual(r.tauchgaenge.map((t) => t.tauchplatz), ["Riff"]);
  assert.deepEqual([...i.fotos].sort(), ["f1", "f3", "f4"]);
  assert.deepEqual(i.orte.map((o) => o.name).sort(), ["Castries", "Hurghada"]);
  const html = seiteRendern(i, "https://reise.example", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "© OSM");
  for (const verboten of ["PRIVATE NOTIZ", "GEHEIM", "PRIVATER TEXT", "Privatriff", "Zukunftshafen", "Später", "Nur eine Idee", "Geheim", "275", "999", "1234", "Flug"]) {
    assert.ok(!html.includes(verboten), `darf nicht öffentlich sein: ${verboten}`);
  }
  assert.ok(html.includes("Castries") && html.includes("Hotel Sonne") && html.includes("Hurghada"));
});

test("Nicht freigegebene Reisen erscheinen gar nicht", () => {
  const i = tagebuchInhalt([{ reise: reise({ oeffentlich: false }), beitraege }], benutzer, einst, heute);
  assert.equal(i.reisen.length, 0);
  assert.equal(i.fotos.size, 0);
  assert.deepEqual(i.orte.map((o) => o.name), ["Hurghada"]);
});

test("Besuchte Orte für die Weltkarte: ohne Seetage und Zukunft", () => {
  const orte = besuchteOrte(reise(), heute);
  assert.deepEqual(orte.map((o) => [o.name, o.art]), [["Castries", "hafen"], ["Hotel Sonne", "hotel"]]);
});

test("Pins im Seitenquelltext können kein HTML einschleusen", () => {
  const boese = { ...einst, orte: [{ id: "x", name: "</script><script>alert(1)</script>", land: "", lat: 1, lng: 1, jahr: "", notiz: "" }] };
  const html = seiteRendern(tagebuchInhalt([], [], boese, heute), "https://x", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "");
  assert.ok(!html.includes("</script><script>alert(1)"));
});

test("Einzelne Fotos und private Notizen bleiben privat – im Tagebuch und in Freigaben", async () => {
  const { inhaltFuer, seiteRendern: freigabeSeite, erlaubteFotos } = await import("../lib/teilen.mjs");
  const b = {
    bewertungen: [{ zielArt: "ausflug", zielId: "a1", autorId: "u1", sterne: 5, text: "Öffentlich toll", textPrivat: "GEHEIME NOTIZ", fotos: ["f1", "f2"], fotosPrivat: ["f2"] }],
    tauchgaenge: [{ id: "t1", tauchplatz: "Riff", datum: "2026-05-01", taucherId: "u1", text: "Super", textPrivat: "PRIVAT TAUCHEN", fotos: ["f3", "f4"], fotosPrivat: ["f4"] }],
    fotos: [],
  };
  const i = tagebuchInhalt([{ reise: reise(), beitraege: b }], benutzer, einst, heute);
  assert.deepEqual([...i.fotos].sort(), ["f1", "f3"]);
  const html = seiteRendern(i, "https://x", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "");
  assert.ok(!html.includes("GEHEIME NOTIZ") && !html.includes("PRIVAT TAUCHEN") && !html.includes("/foto/f2") && !html.includes("/foto/f4"));
  const r = reise();
  const ausflug = inhaltFuer(r, b, benutzer, { token: "x".repeat(32), art: "ausflug", zielId: "a1" });
  assert.deepEqual([...erlaubteFotos(ausflug)], ["f1"]);
  assert.ok(!freigabeSeite(ausflug, { token: "x".repeat(32) }, "https://x").includes("GEHEIME NOTIZ"));
  const tg = inhaltFuer(r, b, benutzer, { token: "x".repeat(32), art: "tauchgang", zielId: "t1" });
  assert.deepEqual([...erlaubteFotos(tg)], ["f3"]);
  assert.ok(!JSON.stringify(tg).includes("PRIVAT TAUCHEN"));
  const bericht = inhaltFuer(r, b, benutzer, { token: "x".repeat(32), art: "bericht", zielId: "r1" });
  assert.deepEqual([...erlaubteFotos(bericht)].sort(), ["f1", "f3"]);
  assert.ok(!JSON.stringify(bericht).includes("GEHEIME NOTIZ") && !JSON.stringify(bericht).includes("PRIVAT TAUCHEN"));
});
