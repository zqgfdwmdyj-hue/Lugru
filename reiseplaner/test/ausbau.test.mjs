import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { hotelKosten, naechte, reiseKosten, startpunkt, sichereUrl } from "../public/rechnen.js";
import { planZusammenfuehren } from "../public/zusammenfuehren.js";
import { docxText } from "../lib/docx.mjs";
import { inhaltFuer, seiteRendern, erlaubteFotos } from "../lib/teilen.mjs";

const personen = [{ id: "e1", typ: "erwachsen" }, { id: "e2", typ: "erwachsen" }, { id: "k1", typ: "kind", alter: 9 }];

test("Hotelkosten: pro Nacht und Zimmer bzw. gesamt", () => {
  assert.equal(naechte("2026-10-23", "2026-10-26"), 3);
  const k = hotelKosten({ preis: 120, preisArt: "nacht", zimmer: 2, anreise: "2026-10-23", abreise: "2026-10-26" }, personen);
  assert.equal(k.summe, 720);
  assert.equal(k.proNacht, 240);
  assert.equal(k.proPersonNacht, 80);
  assert.equal(hotelKosten({ preis: 999, preisArt: "gesamt", anreise: "2026-10-23", abreise: "2026-10-26" }).summe, 999);
});

test("Reisekosten mit Hotel und weiteren Posten", () => {
  const k = reiseKosten({
    personen,
    ausfluege: [{ hafenId: "h", status: "gebucht", preisArt: "person", preisErw: 10, teilnehmer: ["e1"] }],
    hotels: [{ status: "gebucht", preis: 300, preisArt: "gesamt" }, { status: "idee", preis: 5000, preisArt: "gesamt" }],
    kosten: [{ titel: "Flug", betrag: 600, status: "favorit" }],
  });
  assert.equal(k.gebucht, 310);
  assert.equal(k.geplant, 910);
  assert.equal(k.hotels.geplant, 300);
  assert.equal(Math.round(k.jePerson.e1), 10 + 100 + 200);
});

test("Startpunkt an Land-Tagen ist das gebuchte Hotel", () => {
  const hotels = [
    { name: "Idee-Hotel", status: "idee", lat: 1, lng: 1, anreise: "2026-01-01", abreise: "2026-01-05" },
    { name: "Gebucht", status: "gebucht", lat: 2, lng: 2, anreise: "2026-01-01", abreise: "2026-01-05" },
  ];
  assert.equal(startpunkt({ art: "ort", datum: "2026-01-03", lat: 9, lng: 9 }, hotels).name, "Gebucht");
  assert.equal(startpunkt({ art: "ort", datum: "2026-01-05", lat: 9, lng: 9, name: "Ort" }, hotels).name, "Ort"); // Abreisetag
  assert.equal(startpunkt({ art: "hafen", datum: "2026-01-03", lat: 9, lng: 9, name: "Hafen" }, hotels).name, "Hafen");
});

test("Nur http(s)-Links", () => {
  assert.equal(sichereUrl("javascript:alert(1)"), "");
  assert.equal(sichereUrl(" https://x.de/a "), "https://x.de/a");
});

test("KI-Plan wird ergänzt statt doppelt angelegt", () => {
  const reise = { personen, haefen: [{ id: "h1", datum: "2026-10-20", name: "Teneriffa", ankunft: "" }], ausfluege: [{ id: "a1", hafenId: "h1", titel: "Teide", preisErw: null }], hotels: [], kosten: [] };
  const plan = {
    personen: [],
    stationen: [{ datum: "2026-10-20", art: "hafen", name: "Teneriffa", land: "", ankunft: "08:00", abfahrt: "18:00", allesAnBord: "", notiz: "" }, { datum: "2026-10-21", art: "seetag", name: "", land: "", ankunft: "", abfahrt: "", allesAnBord: "", notiz: "" }],
    hotels: [{ name: "Botánico", ort: "Puerto", anreise: "", abreise: "", preis: 100, preisArt: "nacht", verpflegung: "", status: "idee", link: "javascript:x", notiz: "" }],
    ausfluege: [{ datum: "2026-10-20", ort: "Teneriffa", titel: "teide", kategorie: "natur", quelle: "schiff", status: "idee", beginn: "", dauerMin: 300, preisErw: 79, preisKind: null, link: "", notiz: "" }, { datum: "2026-10-25", ort: "Lissabon", titel: "Tram 28", kategorie: "stadt", quelle: "eigene", status: "idee", beginn: "", dauerMin: null, preisErw: null, preisKind: null, link: "", notiz: "" }],
    kosten: [{ titel: "Flug", betrag: 900, status: "gebucht" }],
  };
  const z = planZusammenfuehren(reise, plan);
  assert.equal(reise.haefen.length, 3); // Seetag + neuer Tag für Lissabon
  assert.equal(reise.haefen[0].ankunft, "08:00");
  assert.equal(reise.ausfluege.length, 2);
  assert.equal(reise.ausfluege[0].preisErw, 79);
  assert.equal(reise.hotels[0].link, "");
  assert.equal(reise.ausfluege[1].teilnehmer.length, 3);
  assert.deepEqual([z.tage, z.ausfluege, z.hotels, z.kosten], [2, 1, 1, 1]);
  planZusammenfuehren(reise, plan);
  assert.equal(reise.ausfluege.length, 2);
  assert.equal(reise.kosten.length, 1);
});

function miniDocx(xml) {
  const name = Buffer.from("word/document.xml");
  const daten = deflateRawSync(Buffer.from(xml));
  const lokal = Buffer.alloc(30);
  lokal.writeUInt32LE(0x04034b50, 0);
  lokal.writeUInt16LE(8, 8);
  lokal.writeUInt32LE(daten.length, 18);
  lokal.writeUInt16LE(name.length, 26);
  const zentral = Buffer.alloc(46);
  zentral.writeUInt32LE(0x02014b50, 0);
  zentral.writeUInt16LE(8, 10);
  zentral.writeUInt32LE(daten.length, 20);
  zentral.writeUInt16LE(name.length, 28);
  zentral.writeUInt32LE(0, 42);
  const start = 30 + name.length + daten.length;
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(1, 10);
  ende.writeUInt32LE(46 + name.length, 12);
  ende.writeUInt32LE(start, 16);
  return Buffer.concat([lokal, name, daten, zentral, name, ende]);
}

test("Word-Datei wird als Text gelesen", () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>Tag 1: Teneriffa</w:t></w:r></w:p><w:p><w:r><w:t>Preis 59 &amp; mehr</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(docxText(miniDocx(xml)), "Tag 1: Teneriffa\nPreis 59 & mehr");
});

test("Freigabe zeigt nur den Beitrag – ohne Kosten, ohne fremde Fotos", () => {
  const reise = {
    name: "Geheim-Reise", personen,
    haefen: [{ id: "h1", datum: "2026-10-20", name: "Funchal" }],
    ausfluege: [{ id: "a1", hafenId: "h1", titel: "Levada", quelle: "schiff", preisArt: "person", preisErw: 59, link: "https://x.de", teilnehmer: ["e1"] }, { id: "a2", hafenId: "h1", titel: "Andere Tour", preisErw: 10 }],
  };
  const beitraege = { bewertungen: [{ id: "b1", zielArt: "ausflug", zielId: "a1", autorId: "u1", sterne: 4, text: "<b>Super</b>", fotos: ["f1"] }, { id: "b2", zielArt: "ausflug", zielId: "a2", autorId: "u1", sterne: 1, text: "nein", fotos: ["f2"] }], tauchgaenge: [], fotos: [] };
  const benutzer = [{ id: "u1", name: "Anna Muster" }];
  const f = { token: "t".repeat(32), art: "ausflug", zielId: "a1", mitPreis: false };
  const inhalt = inhaltFuer(reise, beitraege, benutzer, f);
  assert.deepEqual([...erlaubteFotos(inhalt)], ["f1"]);
  assert.equal(inhalt.preis, null);
  assert.equal(inhalt.bewertungen[0].autor, "Anna"); // nur Vorname
  const html = seiteRendern(inhalt, f, "https://reise.example");
  assert.ok(html.includes("&lt;b&gt;Super&lt;/b&gt;"));
  assert.ok(!html.includes("Andere Tour"));
  assert.ok(!html.includes("Geheim-Reise"));
  assert.ok(!html.includes("59"));
  assert.ok(html.includes('og:image" content="https://reise.example/teilen/'));
  assert.equal(inhaltFuer(reise, beitraege, benutzer, { ...f, zielId: "weg" }), null);
});
