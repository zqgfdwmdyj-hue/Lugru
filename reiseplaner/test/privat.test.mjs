import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "reiseplaner-privat-"));
const teilen = await import("../lib/teilen.mjs");
const tagebuch = await import("../lib/tagebuch.mjs");
const ki = await import("../lib/ki.mjs");

const GEHEIM = ["GEHEIM-WLAN", "Code 4711", "0171-999", "Dünenweg 7", "BUCHUNG-XYZ"];
const reise = {
  id: "r1", name: "Ostsee", art: "ferienwohnung", oeffentlich: true,
  personen: [{ id: "p1", name: "Anna Lugru", familie: "f1" }],
  familien: [{ id: "f1", name: "Familie Lugru" }],
  haefen: [{ id: "t1", datum: "2026-05-01", art: "ort", name: "Zingst", lat: 54.4, lng: 12.7 }],
  hotels: [{ id: "h1", name: "FeWo Düne", status: "gebucht", anreise: "2026-05-01", abreise: "2026-05-05", lat: 54.4, lng: 12.7, wlan: "Duene", wlanPasswort: "GEHEIM-WLAN", zugang: "Code 4711", telefon: "0171-999", adresse: "Dünenweg 7", checkout: "10:00" }],
  verbindungen: [{ id: "v1", art: "zug", titel: "ICE 1", status: "gebucht", datum: "2026-05-05", abZeit: "12:00", buchungsnr: "BUCHUNG-XYZ" }],
  zimmer: [{ id: "z1", unterkunft: "h1", nummer: "2", personen: ["p1"] }],
  ausfluege: [],
};
const beitraege = { bewertungen: [{ id: "b1", zielArt: "hotel", zielId: "h1", autorId: "u1", sterne: 5, text: "Schön", fotos: [] }], tauchgaenge: [], fotos: [] };

test("Infos vor Ort und Buchungsnummern bleiben privat", () => {
  const inhalt = teilen.inhaltFuer(reise, beitraege, [{ id: "u1", name: "Anna Lugru" }], { art: "hotel", zielId: "h1", mitPreis: true });
  const seite = teilen.seiteRendern(inhalt, { token: "t", art: "hotel" }, "https://x.example");
  const bericht = teilen.seiteRendern(teilen.inhaltFuer(reise, beitraege, [{ id: "u1", name: "Anna Lugru" }], { art: "bericht", zielId: "r1" }), { token: "t", art: "bericht" }, "https://x.example");
  const tb = tagebuch.seiteRendern(tagebuch.tagebuchInhalt([{ reise, beitraege }], [{ id: "u1", name: "Anna Lugru" }], { titel: "T", text: "", orte: [] }, "2026-06-01"), "https://x.example", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "OSM");
  const stand = JSON.stringify(ki.reiseStand(reise, beitraege, [{ id: "u1", name: "Anna Lugru" }]));
  for (const g of GEHEIM) {
    assert.ok(!seite.includes(g), `Freigabe enthält ${g}`);
    assert.ok(!bericht.includes(g), `Bericht enthält ${g}`);
    assert.ok(!tb.includes(g), `Tagebuch enthält ${g}`);
    assert.ok(!stand.includes(g), `KI-Daten enthalten ${g}`);
  }
  assert.ok(!tb.includes("Lugru") && !seite.includes("Lugru"), "keine Nachnamen/Familiennamen öffentlich");
  assert.match(stand, /"checkout":"10:00"/);
});
