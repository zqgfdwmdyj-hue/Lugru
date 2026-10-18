import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { flugZeitplan, verspaetungsTipps, flugFortschritt, grosskreisPunkt, uhrzeitMitTag, passendeVorlagen, automatischePackliste, kalenderDatei } from "../public/unterwegs-logik.js";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "reiseplaner-flug-"));
const extras = await import("../lib/extras.mjs");

test("Zeitplan rückwärts ab Abflug – mit Kindern mehr Reserve", () => {
  const v = { abZeit: "07:30", anfahrtMin: 90, parkenMin: 20, terminal: "Terminal 1", titel: "DE 2224" };
  const p = flugZeitplan(v, { kinder: true });
  assert.deepEqual(p.schritte.map((s) => s.zeit), ["01:55", "03:10", "05:30", "06:35", "06:50", "07:30"]);
  assert.match(p.schritte[1].text, /90 Min\. Fahrt \+ 20 Min\. Parken\/Shuttle \+ 30 Min\. Reserve/);
  const ohneKinder = flugZeitplan(v);
  assert.equal(ohneKinder.schritte[1].zeit, "03:25");
  // Ohne Anfahrt: nur ab „am Flughafen“
  assert.deepEqual(flugZeitplan({ abZeit: "06:00" }).schritte.map((s) => s.art), ["da", "gate", "boarding", "abflug"]);
  assert.equal(flugZeitplan({ abZeit: "" }), null);
  // Sehr früher Flug: Aufstehen am Vortag
  assert.equal(flugZeitplan({ abZeit: "01:00", anfahrtMin: 60 }).schritte[0].zeit, "20:45 (Vortag)");
  assert.equal(uhrzeitMitTag(1500), "01:00 (+1 Tag)");
});

test("Tipps bei Verspätung – ab 3 Std. Hinweis auf Entschädigung", () => {
  assert.deepEqual(verspaetungsTipps(0), []);
  assert.ok(verspaetungsTipps(20).some((t) => /Fluglinien/.test(t)));
  assert.ok(!verspaetungsTipps(120).some((t) => /Entschädigung/.test(t)));
  assert.ok(verspaetungsTipps(200, { kinder: true }).some((t) => /Entschädigung.*250–600 €/.test(t)));
  assert.ok(verspaetungsTipps(200, { kinder: true }).some((t) => /Spielplatz/.test(t)));
  assert.ok(verspaetungsTipps(400).some((t) => /Hotel/.test(t)));
});

test("Wo sind wir gerade? Anteil, Restzeit, Position auf dem Großkreis", () => {
  const v = { datum: "2027-03-19", abZeit: "10:00", flugdauerMin: 600, vonOrt: { lat: 50.03, lng: 8.57 }, nachOrt: { lat: 13.07, lng: -59.49 } };
  const f = flugFortschritt(v, new Date("2027-03-19T15:00:00"));
  assert.equal(f.phase, "fliegt");
  assert.equal(f.anteil, 0.5);
  assert.equal(f.restMin, 300);
  assert.ok(f.km > 7200 && f.km < 7500, String(f.km));
  assert.ok(f.position.lat < 50 && f.position.lat > 13 && f.position.lng < 8 && f.position.lng > -60);
  assert.equal(flugFortschritt(v, new Date("2027-03-19T09:00:00")).phase, "vorher");
  assert.equal(flugFortschritt(v, new Date("2027-03-19T21:00:00")).phase, "gelandet");
  // Dauer aus Ab/An über Mitternacht
  assert.equal(flugFortschritt({ datum: "2027-03-19", abZeit: "22:00", anDatum: "2027-03-20", anZeit: "06:00" }, new Date("2027-03-20T02:00:00")).anteil, 0.5);
  assert.equal(flugFortschritt({ datum: "2027-03-19", abZeit: "10:00" }), null);
  const mitte = grosskreisPunkt({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }, 0.5);
  assert.ok(Math.abs(mitte.lng - 45) < 1e-9 && Math.abs(mitte.lat) < 1e-9);
});

test("Handgepäck-Vorlage bei Flügen, Wecker im Kalender", () => {
  const reise = { art: "kreuzfahrt", personen: [{ id: "k1", typ: "kind" }], haefen: [], verbindungen: [{ id: "v1", art: "flug", status: "gebucht", datum: "2027-03-19", abZeit: "07:30", anfahrtMin: 90, titel: "DE 2224" }] };
  assert.ok(passendeVorlagen(reise).includes("handgepaeck"));
  assert.ok(!passendeVorlagen({ ...reise, verbindungen: [{ ...reise.verbindungen[0], status: "verworfen" }] }).includes("handgepaeck"));
  assert.ok(automatischePackliste(reise).some((x) => x.gruppe === "Handgepäck" && /100 ml/.test(x.text)));
  const { text: ics } = kalenderDatei(reise, { dokumente: [] });
  assert.match(ics, /Aufstehen \(Losfahren um 03:30\)/);
  assert.match(ics, /TRIGGER:-PT315M/);
  assert.match(ics, /Jetzt losfahren!/);
  assert.match(ics, /TRIGGER:-PT240M/);
});

test("Flughafen-Bingo und Fluglinien je Kind", async () => {
  const id = `flugspiel-${Date.now()}`;
  let k = await extras.kinderAendern(id, "k1", { bereich: "flugspiel", schluessel: "bingo:Pilot/in", wert: true });
  k = await extras.kinderAendern(id, "k1", { bereich: "flugspiel", schluessel: "linie:Turkish Airlines", wert: true });
  assert.deepEqual(Object.keys(k.flugspiel).sort(), ["bingo:Pilot/in", "linie:Turkish Airlines"]);
  k = await extras.kinderAendern(id, "k1", { bereich: "flugspiel", schluessel: "bingo:Pilot/in", wert: false });
  assert.deepEqual(Object.keys(k.flugspiel), ["linie:Turkish Airlines"]);
  await assert.rejects(extras.kinderAendern(id, "k1", { bereich: "flugspiel", schluessel: "__proto__", wert: true }), /Ungültiges/);
  await assert.rejects(extras.kinderAendern(id, "k1", { bereich: "flugspiel", schluessel: "bingo:<script>", wert: true }), /Ungültiges/);
});

test("Lounge-Bewertungen: Freigabe-Seite und öffentliches Tagebuch", async () => {
  const teilen = await import("../lib/teilen.mjs");
  const tagebuch = await import("../lib/tagebuch.mjs");
  const reise = { id: "r1", name: "Karibik", oeffentlich: true, haefen: [{ id: "h1", datum: "2026-03-20", name: "Roseau", lat: 15.3, lng: -61.4 }], verbindungen: [{ id: "v1", art: "flug", status: "gebucht", datum: "2026-03-19", von: "Frankfurt (FRA)" }], flughafenOrte: [{ id: "o1", verbindungId: "v1", art: "lounge", name: "Sky Lounge", flughafen: "Frankfurt (FRA)", terminal: "T1" }] };
  const beitraege = { bewertungen: [{ id: "b1", autorId: "u1", zielArt: "flughafen", zielId: "o1", sterne: 4, text: "Tolle Kinderecke", fotos: [] }, { id: "b2", autorId: "u1", zielArt: "flughafen", zielId: "o1", sterne: 1, text: "geheim", privat: true, fotos: [] }], tauchgaenge: [], fotos: [] };
  const inhalt = teilen.inhaltFuer(reise, beitraege, [{ id: "u1", name: "Anna Muster" }], { art: "flughafen", zielId: "o1" });
  assert.equal(inhalt.titel, "Sky Lounge");
  assert.equal(inhalt.bewertungen.length, 1, "private Bewertung bleibt draußen");
  assert.match(teilen.seiteRendern(inhalt, { token: "t", art: "flughafen" }, "https://x.example"), /Tolle Kinderecke/);
  const tb = tagebuch.tagebuchInhalt([{ reise, beitraege }], [{ id: "u1", name: "Anna Muster" }], { titel: "T", text: "", orte: [] }, "2026-06-01");
  assert.equal(tb.reisen[0].flughafen[0].name, "Sky Lounge");
  const html = tagebuch.seiteRendern(tb, "https://x.example", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "OSM");
  assert.match(html, /✈️ Flughafen/);
  assert.doesNotMatch(html, /geheim/);
});

test("KI-Import: Flüge werden zu Verbindungen – je Teilstrecke, ohne Doppelte", async () => {
  const { planZusammenfuehren } = await import("../public/zusammenfuehren.js");
  const reise = { personen: [{ id: "p1", name: "Ludwig" }, { id: "p2", name: "Mia" }], haefen: [], hotels: [], ausfluege: [], kosten: [] };
  const fl = (titel, von, nach, datum, abZeit, anZeit, anDatum = "", klasse = "Economy", gepaeck = "") => ({ art: "flug", titel, von, nach, datum, abZeit, anDatum, anZeit, details: [klasse, gepaeck, "Buchung ABC123"].filter(Boolean).join(", ") });
  const plan = { personen: [], stationen: [], hotels: [], ausfluege: [], kosten: [{ titel: "Bahnticket", betrag: null, status: "gebucht" }], verbindungen: [
    fl("Condor DE 4063", "München (MUC)", "Frankfurt (FRA)", "2027-03-19", "08:45", "09:40"),
    fl("Condor DE 3910", "Frankfurt (FRA)", "La Romana (LRM)", "2027-03-19", "12:00", "17:25", "", "Business", "30 kg"),
    fl("Condor DE 3867", "La Romana (LRM)", "Frankfurt (FRA)", "2027-04-02", "14:40", "05:45", "2027-04-03", "Business", "30 kg"),
    fl("Condor DE 4062", "Frankfurt (FRA)", "München (MUC)", "2027-04-03", "07:15", "08:15"),
  ] };
  const z = planZusammenfuehren(reise, plan);
  assert.equal(z.verbindungen, 4);
  assert.equal(reise.verbindungen.length, 4);
  const rueck = reise.verbindungen.find((v) => v.titel === "Condor DE 3867");
  assert.deepEqual([rueck.art, rueck.anDatum, rueck.anZeit, rueck.gepaeck, rueck.status, rueck.buchungsnr], ["flug", "2027-04-03", "05:45", "Business, 30 kg", "gebucht", "ABC123"]);
  assert.deepEqual(rueck.personen, ["p1", "p2"]);
  assert.equal(reise.kosten.length, 1, "Bahnticket ohne Zeiten bleibt bei den Kosten");
  // Zweiter Import (z. B. weiterer Screenshot) ergänzt nur
  const z2 = planZusammenfuehren(reise, { ...plan, verbindungen: [{ ...plan.verbindungen[1], titel: "Condor  DE 3910", details: "Business, Terminal 1, Sitz 3A" }] });
  assert.equal(z2.verbindungen, 0);
  assert.equal(reise.verbindungen.find((v) => v.titel === "Condor DE 3910").terminal, "Terminal 1");
  assert.equal(reise.verbindungen.find((v) => v.titel === "Condor DE 3910").sitz, "3A");
  const { detailsAufteilen } = await import("../public/zusammenfuehren.js");
  assert.deepEqual(detailsAufteilen("Business, 30 kg Gepäck, Sitz: 12A, Terminal 2, Buchungsnummer: XY7Z9"), { buchungsnr: "XY7Z9", terminal: "Terminal 2", sitz: "12A", rest: "Business, 30 kg Gepäck" });
  // Zeitplan funktioniert direkt mit dem importierten Flug
  assert.equal(flugZeitplan(reise.verbindungen[1]).schritte.at(-1).zeit, "12:00");
});
