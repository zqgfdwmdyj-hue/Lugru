import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { geschichteOhneKi, zahlenSpass } from "../public/kinderdaten.js";
import { planB, kachelnFuer } from "../public/unterwegs-logik.js";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "reiseplaner-ideen-"));
const extras = await import("../lib/extras.mjs");

test("Familien-Challenge: nur bekannte Kategorien, ±1, nie negativ", async () => {
  const id = `challenge-${Date.now()}`;
  await extras.challengeSetzen(id, "essen", "p1", 1);
  let c = await extras.challengeSetzen(id, "essen", "p1", 5);
  assert.equal(c.essen.p1, 2, "delta wird auf ±1 begrenzt");
  c = await extras.challengeSetzen(id, "tiere", "p2", -1);
  assert.equal(c.tiere.p2, 0);
  await assert.rejects(extras.challengeSetzen(id, "__proto__", "p1", 1), /Unbekannte/);
});

test("Sammelalbum, Ranking und Stimmen-Tagebuch werden geprüft", async () => {
  const id = `funde-${Date.now()}`;
  const fotos = new Set(["foto-1"]);
  const audio = new Set(["audio-1"]);
  await assert.rejects(extras.kinderAendern(id, "k1", { bereich: "fund", wert: { titel: "Muschel", fotoId: "fremd" } }, fotos), /Foto/);
  let k = await extras.kinderAendern(id, "k1", { bereich: "fund", wert: { titel: " ", fotoId: "foto-1", ort: "Strand", datum: "2027-03-21x" } }, fotos);
  assert.equal(k.funde.length, 1);
  assert.deepEqual([k.funde[0].titel, k.funde[0].ort, k.funde[0].datum], ["Fundstück", "Strand", ""]);
  k = await extras.kinderAendern(id, "k1", { bereich: "fund", schluessel: k.funde[0].id, wert: null }, fotos);
  assert.equal(k.funde.length, 0);
  k = await extras.kinderAendern(id, "k1", { bereich: "ranking", wert: { ort: "Roseau", essen: "Mango-Eis", boese: "x", tier: "x".repeat(500) } });
  assert.deepEqual(Object.keys(k.ranking).sort(), ["erlebnis", "essen", "ort", "tier"]);
  assert.equal(k.ranking.tier.length, 60);
  k = await extras.kinderAendern(id, "k1", { bereich: "tagebuch", schluessel: "2027-03-21", wert: { text: "Toll", audioId: "audio-1", bildId: "fremd" } }, fotos, audio);
  assert.deepEqual([k.tagebuch["2027-03-21"].audioId, k.tagebuch["2027-03-21"].bildId], ["audio-1", ""]);
  k = await extras.kinderAendern(id, "k1", { bereich: "tagebuch", schluessel: "2027-03-22", wert: { text: "x", audioId: "../../etc/passwd" } }, fotos, audio);
  assert.equal(k.tagebuch["2027-03-22"].audioId, "");
});

test("Audio-Dateien bekommen eine passende Endung", () => {
  assert.match(extras.dateiPfad("abc", "audio/webm"), /abc\.webm$/);
  assert.match(extras.dateiPfad("abc", "audio/mp4"), /abc\.m4a$/);
  assert.match(extras.dateiPfad("abc", "application/pdf"), /abc\.pdf$/);
  assert.match(extras.dateiPfad("abc", "text/html"), /abc\.bin$/);
});

test("Gute-Nacht-Geschichte ohne KI nutzt Kinder, Ort, Tier und Erlebnis", () => {
  const g = geschichteOhneKi({ kinder: ["Mia", "Ben"], ort: "Roseau", seetag: false, tier: "Pottwal", erlebnis: "Champagne Reef" }, "h1");
  assert.match(g, /^## Ein Abenteuer in Roseau/);
  assert.match(g, /Mia und Ben/);
  assert.match(g, /Pottwal/);
  assert.match(g, /Champagne Reef/);
  assert.match(geschichteOhneKi({ kinder: ["Mia"], seetag: true, schiff: "Mein Schiff 4" }), /Die Mein Schiff 4 schaukelte/);
});

test("Zahlen-Spaß rechnet Strecke, Schiff und Tage um", () => {
  const f = zahlenSpass({ km: 1224, tage: 14, orte: 8, laender: 6, schiff: "Mein Schiff 4" }).join("\n");
  assert.match(f, /1\.224 km/);
  assert.match(f, /2,0-mal von Hamburg nach München/);
  assert.match(f, /295 m/);
  assert.match(f, /336 Stunden/);
  assert.deepEqual(zahlenSpass({ km: 0 }), []);
});

test("Wetter-Plan B: nur bei schlechtem Wetter und für Ausflüge im Freien", () => {
  const w = (regen, code, wind) => ({ time: ["2027-03-21"], precipitation_probability_max: [regen], weather_code: [code], wind_speed_10m_max: [wind] });
  const ausfluege = [{ titel: "Strand", kategorie: "strand", status: "gebucht" }, { titel: "Museum", kategorie: "kultur", status: "gebucht" }, { titel: "Boot", kategorie: "boot", status: "verworfen" }, { titel: "Tauchen", kategorie: "tauchen", status: "favorit" }];
  assert.equal(planB(w(20, 1, 20), ausfluege), null);
  const regen = planB(w(80, 63, 20), ausfluege);
  assert.equal(regen.grund, "Regen (80 %)");
  assert.deepEqual(regen.betroffen.map((a) => a.titel), ["Strand", "Tauchen"]);
  const sturm = planB(w(10, 2, 55), ausfluege);
  assert.equal(sturm.grund, "Wind bis 55 km/h");
  assert.deepEqual(sturm.betroffen.map((a) => a.titel), ["Tauchen"]);
  assert.equal(planB(w(30, 95, 10), ausfluege).grund, "Gewitter");
  assert.equal(planB(null, ausfluege), null);
});

test("Offline-Karten: Kacheln rund um die Orte, ohne Doppelte, mit Obergrenze", () => {
  const k = kachelnFuer([{ lat: 15.3, lng: -61.39 }, { lat: 15.3, lng: -61.39 }, { lat: null, lng: 1 }], { zoomVon: 14, zoomBis: 14, radiusKm: 1 });
  assert.ok(k.length >= 4 && k.length <= 16, String(k.length));
  assert.ok(k.every((t) => t.z === 14 && t.x >= 0 && t.y >= 0 && t.x < 2 ** 14));
  assert.equal(new Set(k.map((t) => `${t.x}/${t.y}`)).size, k.length);
  // Zoom 0: genau eine Kachel für die ganze Welt
  assert.deepEqual(kachelnFuer([{ lat: 50, lng: 8 }], { zoomVon: 0, zoomBis: 0 }), [{ z: 0, x: 0, y: 0 }]);
  assert.equal(kachelnFuer([{ lat: 50, lng: 8 }], { zoomVon: 10, zoomBis: 18, max: 50 }).length, 50);
});

test("Automatische Packliste: passende Vorlagen, Persönliches je Person, keine Doppelten", async () => {
  const { automatischePackliste } = await import("../public/unterwegs-logik.js");
  const reise = {
    art: "kreuzfahrt",
    personen: [{ id: "e1", name: "Papa", typ: "erwachsen" }, { id: "e2", name: "Mama", typ: "erwachsen" }, { id: "k1", name: "Mia", typ: "kind" }],
    haefen: [{ lat: 15.3, lng: -61.4 }],
    ausfluege: [{ kategorie: "tauchen" }],
  };
  const liste = automatischePackliste(reise);
  const texte = liste.map((x) => x.text);
  for (const t of ["Handy + Ladekabel", "Kofferbanderolen am Koffer", "Riffschonende Sonnencreme (LSF 50)", "Brevet / Tauchschein", "Spiele & Bücher für unterwegs"]) assert.ok(texte.includes(t), t);
  assert.ok(!texte.includes("Skipass"));
  assert.deepEqual(liste.filter((x) => x.text === "Reisepass / Personalausweis").map((x) => x.fuer), ["e1", "e2"]);
  assert.deepEqual(liste.filter((x) => x.text === "Kinderreisepass").map((x) => x.fuer), ["k1"]);
  assert.equal(new Set(liste.map((x) => `${x.text}|${x.fuer}`)).size, liste.length);
  // Vorhandenes kommt nicht noch einmal
  const zweite = automatischePackliste(reise, [...liste.slice(0, 5), { text: "  handy + LADEKABEL ", fuer: "" }]);
  assert.equal(zweite.length, liste.length - 6);
  assert.equal(automatischePackliste(reise, liste).length, 0);
});

test("Packliste ergänzen: Server verhindert Doppelte und merkt sich die Automatik", async () => {
  const id = `pack-${Date.now()}`;
  const a = await extras.packlisteErgaenzen(id, [{ text: "Maske", gruppe: "Tauchen", fuer: "", erledigt: false }, { text: "maske", gruppe: "", fuer: "", erledigt: false }], "u1");
  assert.equal(a.neu.length, 1);
  const b = await extras.packlisteErgaenzen(id, [{ text: "Maske", gruppe: "", fuer: "", erledigt: false }, { text: "Maske", gruppe: "", fuer: "p1", erledigt: false }], "u1");
  assert.equal(b.neu.length, 1);
  const e = await extras.extrasLesen(id);
  assert.equal(e.packliste.length, 2);
  assert.equal(e.packAuto, true);
});

test("Packliste je Familie: „für alle“ hakt jede Familie getrennt ab", async () => {
  const { packFamilie, packErledigt } = await import("../public/unterwegs-logik.js");
  const reise = { familien: [{ id: "f1", name: "Wir" }, { id: "f2", name: "Eltern" }], personen: [{ id: "p1", familie: "f1" }, { id: "p2", familie: "f2" }, { id: "p3" }] };
  assert.equal(packFamilie({ fuer: "" }, reise), "");
  assert.equal(packFamilie({ fuer: "familie:f2" }, reise), "f2");
  assert.equal(packFamilie({ fuer: "p1" }, reise), "f1");
  assert.equal(packFamilie({ fuer: "p3" }, reise), "");
  const gemeinsam = { fuer: "", erledigt: false, erledigtVon: { f1: true } };
  assert.equal(packErledigt(gemeinsam, "f1", reise), true);
  assert.equal(packErledigt(gemeinsam, "f2", reise), false, "Haken der einen Familie gilt nicht für die andere");
  assert.equal(packErledigt({ fuer: "p2", erledigt: true }, "f1", reise), true, "eigene Einträge: ein Haken");
  assert.equal(packErledigt({ fuer: "", erledigt: true }, "", { familien: [] }), true, "ohne Familien wie bisher");

  const id = `famhaken-${Date.now()}`;
  const [x] = (await extras.packlisteErgaenzen(id, [{ text: "Reiseapotheke", gruppe: "", fuer: "", erledigt: false }], "u1")).neu;
  let y = await extras.packHaken(id, x.id, { haushalt: "f1", erledigt: true, familien: ["f1", "f2"] });
  assert.deepEqual([y.erledigt, y.erledigtVon], [false, { f1: true }]);
  y = await extras.packHaken(id, x.id, { haushalt: "f2", erledigt: true, familien: ["f1", "f2"] });
  assert.deepEqual(y.erledigtVon, { f1: true, f2: true });
  y = await extras.packHaken(id, x.id, { haushalt: "f1", erledigt: false, familien: ["f1", "f2"] });
  assert.deepEqual(y.erledigtVon, { f2: true });
  y = await extras.packHaken(id, x.id, { haushalt: "fremd", erledigt: true, familien: ["f1", "f2"] });
  assert.equal(y.erledigt, true, "unbekannte Familie → normaler Haken");
  await assert.rejects(extras.packHaken(id, "gibts-nicht", { erledigt: true }), /nicht gefunden/);
});
