import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ausgleich, bordkonto, kalenderDatei, erinnerungenAm, rueckweg, dokumentHinweise, countdown, fotoZuordnen, exifLesen,
  tauchImport, tauchStatistik, tauchgangDoppelt, passendeVorlagen, vorlageEintraege, inReisewaehrung, reiseZeitraum,
} from "../public/unterwegs-logik.js";
import { regionFuer, tiereFuer, tiereDerReise } from "../public/tiere.js";

const personen = [
  { id: "a", name: "Anna", typ: "erwachsen" },
  { id: "b", name: "Ben", typ: "erwachsen" },
  { id: "k", name: "Kim", typ: "kind", alter: 8 },
];
const reise = {
  name: "Karibik Test",
  waehrung: "EUR",
  personen,
  haefen: [
    { id: "h1", datum: "2027-03-20", art: "hafen", name: "Bridgetown", land: "Barbados", lat: 13.1, lng: -59.63, ankunft: "08:00", abfahrt: "18:00", allesAnBord: "17:30" },
    { id: "h2", datum: "2027-03-21", art: "seetag", name: "Seetag" },
    { id: "h3", datum: "2027-03-22", art: "hafen", name: "Roseau", land: "Dominica", lat: 15.3, lng: -61.39, ankunft: "07:00", abfahrt: "17:00", allesAnBord: "16:30" },
  ],
  ausfluege: [
    { id: "x1", hafenId: "h1", titel: "Schildkröten schnorcheln", status: "gebucht", beginn: "09:30", dauerMin: 180, ziel: { lat: 13.15, lng: -59.64 } },
    { id: "x2", hafenId: "h1", titel: "Rum-Tour", status: "favorit", beginn: "14:00", dauerMin: 120, ziel: { lat: 13.09, lng: -59.61 } },
    { id: "x3", hafenId: "h3", titel: "Wale beobachten; Boot, Familie", status: "gebucht", beginn: "10:00", dauerMin: 210 },
  ],
  hotels: [],
};

test("Ausgleich: wer schuldet wem (Kinder zahlen nicht mit, Dollar umgerechnet)", () => {
  const ausgaben = [
    { betrag: 90, waehrung: "EUR", bezahltVon: "a", fuer: [] }, // je 45 für Anna und Ben
    { betrag: 100, waehrung: "USD", bezahltVon: "b", fuer: ["a", "b"] }, // 89 € → je 44,50
    { betrag: 30, waehrung: "EUR", bezahltVon: "", ort: "bord" }, // ohne Zahler: zählt nicht
  ];
  const r = ausgleich(ausgaben, reise);
  assert.equal(r.summe, 179);
  assert.equal(r.saldo.a, 0.5); // 90 − 45 − 44,5
  assert.equal(r.saldo.b, -0.5);
  assert.equal(r.saldo.k, 0);
  assert.deepEqual(r.zahlungen, [{ von: "b", an: "a", betrag: 0.5 }]);
  assert.equal(inReisewaehrung({ betrag: 10, waehrung: "USD" }, { waehrung: "EUR", kurse: { USD: 0.9 } }), 9);
});

test("Ausgleich mit mehreren Schuldnern geht auf", () => {
  const r = ausgleich([{ betrag: 300, bezahltVon: "a", fuer: ["a", "b", "k"] }, { betrag: 60, bezahltVon: "k", fuer: ["a", "b", "k"] }], reise);
  const summe = r.zahlungen.reduce((s, z) => s + z.betrag, 0);
  assert.equal(Math.round(summe * 100) / 100, 180);
  assert.ok(r.zahlungen.every((z) => z.an === "a"));
});

test("Bordkonto mit Budget", () => {
  const k = bordkonto([
    { ort: "bord", betrag: 40, kategorie: "getraenke", datum: "2027-03-20" },
    { ort: "bord", betrag: 70, kategorie: "spa", datum: "2027-03-21" },
    { ort: "land", betrag: 500, kategorie: "ausflug" },
  ], { ...reise, bordBudget: 100 });
  assert.equal(k.summe, 110);
  assert.equal(k.rest, -10);
  assert.equal(k.jeKategorie.spa, 70);
  assert.equal(k.anzahl, 2);
});

test("Kalenderdatei: Alle an Bord mit Vorwarnung, gebuchte Ausflüge, Fristen, Sonderzeichen", () => {
  const { text, anzahl } = kalenderDatei(reise, { anBord: [90, 30], ausfluege: 45, dokumente: [{ id: "d1", titel: "Online-Check-in", frist: "2027-03-10", fristZeit: "12:00" }], erstellt: new Date("2027-01-01T00:00:00Z") });
  assert.equal(anzahl, 5); // 2 × an Bord, 2 gebuchte Ausflüge, 1 Frist (Favorit zählt nicht)
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /DTSTART:20270320T173000\r\n/);
  assert.match(text, /TRIGGER:-PT90M/);
  assert.match(text, /TRIGGER:-PT30M/);
  assert.match(text, /DTSTART:20270320T093000/);
  assert.ok(!text.includes("Rum-Tour"));
  assert.match(text, /Wale beobachten\\; Boot\\, Familie/);
  assert.match(text, /DTSTART:20270310T120000/);
  for (const z of text.split("\r\n")) assert.ok(new TextEncoder().encode(z).length <= 75, `Zeile zu lang: ${z}`);
  assert.equal(erinnerungenAm(reise, "2027-03-20").map((e) => e.zeit).join(","), `${9 * 60 + 30 - 45},${17 * 60 + 30 - 90},${17 * 60}`);
});

test("Rückweg: wann müssen wir los?", () => {
  const h = reise.haefen[0]; // Alle an Bord 17:30
  assert.deepEqual(rueckweg(h, 14 * 60, 40), { losUm: "16:30", restMin: 150, status: "ok", zielZeit: "17:30" });
  assert.equal(rueckweg(h, 16 * 60 + 10, 40).status, "knapp");
  assert.equal(rueckweg(h, 16 * 60 + 40, 40).status, "los");
  assert.equal(rueckweg(h, 17 * 60, 40).status, "zuSpaet");
  assert.equal(rueckweg(reise.haefen[1], 600, 10), null);
});

test("Dokumente: Fristen und Ausweise (6 Monate nach Reiseende)", () => {
  const h = dokumentHinweise([
    { id: "1", titel: "Check-in", frist: "2027-03-02" },
    { id: "2", titel: "Reisepass", art: "ausweis", personId: "a", gueltigBis: "2027-07-01" },
    { id: "3", titel: "Reisepass", art: "ausweis", personId: "b", gueltigBis: "2027-03-21" },
    { id: "4", titel: "Erledigt", frist: "2027-03-02", erledigt: true },
    { id: "5", titel: "ESTA", frist: "2027-03-25" },
  ], reise, "2027-03-01");
  assert.equal(h[0].stufe, "rot");
  assert.ok(h.some((x) => x.id === "3" && x.stufe === "rot" && /vor Reiseende/.test(x.text)));
  assert.ok(h.some((x) => x.id === "2" && x.stufe === "gelb" && /6 Monate/.test(x.text) && /Anna/.test(x.text)));
  assert.ok(h.some((x) => x.id === "1" && /morgen/.test(x.text)));
  assert.ok(h.some((x) => x.id === "5" && x.stufe === "info"));
  assert.ok(!h.some((x) => x.id === "4"));
});

test("Countdown für Kinder", () => {
  assert.deepEqual(countdown(reise, "2027-03-10"), { phase: "vorher", tage: 10, tageGesamt: 3 });
  assert.deepEqual(countdown(reise, "2027-03-21"), { phase: "unterwegs", tagNr: 2, tageGesamt: 3, tage: 1 });
  assert.equal(countdown(reise, "2027-04-01").phase, "vorbei");
  assert.equal(countdown({ haefen: [] }, "2027-01-01").phase, "leer");
  assert.deepEqual(reiseZeitraum(reise), { von: "2027-03-20", bis: "2027-03-22" });
});

test("Foto-Zuordnung über Zeit und Ort", () => {
  assert.deepEqual(fotoZuordnen({ datum: "2027-03-20", zeit: "10:15" }, reise), { hafenId: "h1", ausflugId: "x1", grund: "zeit" });
  assert.deepEqual(fotoZuordnen({ datum: "2027-03-20", zeit: "14:30" }, reise), { hafenId: "h1", ausflugId: "x2", grund: "zeit" });
  // Abends, aber nahe am Rum-Tour-Ziel
  assert.deepEqual(fotoZuordnen({ datum: "2027-03-20", zeit: "19:00", lat: 13.091, lng: -59.611 }, reise), { hafenId: "h1", ausflugId: "x2", grund: "ort" });
  assert.deepEqual(fotoZuordnen({ datum: "2027-03-21", zeit: "12:00" }, reise), { hafenId: "h2", ausflugId: "", grund: "tag" });
  assert.equal(fotoZuordnen({ datum: "2026-01-01" }, reise).hafenId, "");
  assert.equal(fotoZuordnen({}, reise).hafenId, "");
});

/** Baut ein kleines JPEG mit EXIF (Aufnahmezeit + GPS), little oder big endian. */
function jpegMitExif({ zeit, lat, lng, latRef, lngRef, le = true }) {
  const b = [];
  const u16 = (n) => (le ? b.push(n & 255, n >> 8) : b.push(n >> 8, n & 255));
  const u32 = (n) => (le ? b.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24) : b.push(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255));
  // TIFF: Kopf (8) | IFD0 2 Einträge (2+24+4=30) → 38 | Exif-IFD 1 Eintrag (18) → 56 | GPS-IFD 4 Einträge (54) → 110 | Text (20) → 130 | Rationale
  const zeitOff = 110, latOff = 130, lngOff = 154;
  b.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d])); u16(42); u32(8);
  u16(2); u16(0x8769); u16(4); u32(1); u32(38); u16(0x8825); u16(4); u32(1); u32(56); u32(0);
  u16(1); u16(0x9003); u16(2); u32(20); u32(zeitOff); u32(0);
  u16(4);
  const ref = (tag, c) => { u16(tag); u16(2); u32(2); le ? b.push(c.charCodeAt(0), 0, 0, 0) : b.push(c.charCodeAt(0), 0, 0, 0); };
  ref(1, latRef); u16(2); u16(5); u32(3); u32(latOff); ref(3, lngRef); u16(4); u16(5); u32(3); u32(lngOff); u32(0);
  for (const c of `${zeit}\0`) b.push(c.charCodeAt(0));
  for (const [g, m, s] of [lat, lng]) { u32(g); u32(1); u32(m); u32(1); u32(s * 100); u32(100); }
  const tiff = Uint8Array.from(b);
  const app1 = [0xff, 0xe1, ((tiff.length + 8) >> 8) & 255, (tiff.length + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0];
  return Uint8Array.from([0xff, 0xd8, ...app1, ...tiff, 0xff, 0xd9]);
}

test("EXIF: Aufnahmezeit und GPS (beide Byte-Reihenfolgen), Unsinn ergibt {}", () => {
  for (const le of [true, false]) {
    const e = exifLesen(jpegMitExif({ zeit: "2027:03:20 10:15:42", lat: [13, 6, 0], lng: [59, 37, 48], latRef: "N", lngRef: "W", le }));
    assert.deepEqual(e, { datum: "2027-03-20", zeit: "10:15", lat: 13.1, lng: -59.63 });
  }
  assert.deepEqual(exifLesen(new Uint8Array([1, 2, 3, 4])), {});
  assert.deepEqual(exifLesen(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4])), {});
});

test("Tauchcomputer-Import: UDDF (Kelvin, Pascal, Tauchplatz)", () => {
  const uddf = `<?xml version="1.0"?><uddf version="3.2.0">
    <divesite><site id="s1"><name>Champagne Reef</name><geography><location>Dominica</location><latitude>15.25</latitude><longitude>-61.37</longitude></geography></site></divesite>
    <profiledata><repetitiongroup id="r1"><dive id="d1">
      <informationbeforedive><link ref="s1"/><datetime>2027-03-22T10:42:00</datetime></informationbeforedive>
      <tankdata><tankpressurebegin>20000000</tankpressurebegin><tankpressureend>6000000</tankpressureend></tankdata>
      <informationafterdive><greatestdepth>18.4</greatestdepth><averagedepth>9.1</averagedepth><diveduration>3060</diveduration><lowesttemperature>300.15</lowesttemperature></informationafterdive>
    </dive></repetitiongroup></profiledata></uddf>`;
  const [t] = tauchImport(uddf, "log.uddf");
  assert.equal(t.datum, "2027-03-22");
  assert.equal(t.beginn, "10:42");
  assert.equal(t.tauchplatz, "Champagne Reef");
  assert.equal(t.ort, "Dominica");
  assert.equal(t.maxTiefe, 18.4);
  assert.equal(t.tauchzeitMin, 51);
  assert.equal(t.wasserTemp, 27);
  assert.equal(t.druckStart, 200);
  assert.equal(t.druckEnde, 60);
  assert.equal(t.lat, 15.25);
});

test("Tauchcomputer-Import: Subsurface und CSV", () => {
  const ssrf = `<divelog program='subsurface' version='3'><divesites><site uuid='ab12' name='Bianca C' gps='12.03 -61.78'/></divesites>
    <dives><trip><dive number='7' date='2027-03-24' time='09:05:00' duration='38:30 min' divesiteid='ab12'><buddy>Ben</buddy><notes>Wrack &amp; Adlerrochen</notes>
      <divecomputer model='Shearwater Peregrine'><depth max='31.2 m' mean='19.0 m' /><temperature water='27.5 C' /></divecomputer></dive></trip></dives></divelog>`;
  const [s] = tauchImport(ssrf, "log.ssrf");
  assert.deepEqual([s.datum, s.beginn, s.tauchplatz, s.maxTiefe, s.tauchzeitMin, s.wasserTemp, s.buddy, s.text], ["2027-03-24", "09:05", "Bianca C", 31.2, 39, 27.5, "Ben", "Wrack & Adlerrochen"]);
  const csv = "Datum;Zeit;Tauchplatz;Max. Tiefe;Dauer;Wassertemperatur\n22.03.2027;14:10;Scotts Head;12,5 m;45:00;28\n\n23.03.2027;08:00;Nachttauchgang;9;2700 s;27";
  const liste = tauchImport(csv, "export.csv");
  assert.equal(liste.length, 2);
  assert.deepEqual([liste[0].datum, liste[0].beginn, liste[0].tauchplatz, liste[0].maxTiefe, liste[0].tauchzeitMin, liste[0].wasserTemp], ["2027-03-22", "14:10", "Scotts Head", 12.5, 45, 28]);
  assert.equal(liste[1].tauchzeitMin, 45);
  assert.deepEqual(tauchImport("kein Logbuch", "x.pdf"), []);
  assert.ok(tauchgangDoppelt({ datum: "2027-03-22", beginn: "14:15" }, [{ datum: "2027-03-22", beginn: "14:10" }]));
  assert.ok(!tauchgangDoppelt({ datum: "2027-03-22", beginn: "16:15" }, [{ datum: "2027-03-22", beginn: "14:10" }]));
});

test("Tauchstatistik mit Artenliste", () => {
  const s = tauchStatistik([
    { tauchplatz: "A", maxTiefe: 18, tauchzeitMin: 50, wasserTemp: 27, sichtungen: "Schildkröte, 2 Adlerrochen" },
    { tauchplatz: "B", maxTiefe: 31.2, tauchzeitMin: 40, wasserTemp: 28.5, sichtungen: "Schildkröte; Muräne" },
    { tauchplatz: "A", maxTiefe: null, tauchzeitMin: 30 },
  ]);
  assert.equal(s.anzahl, 3);
  assert.equal(s.summeMin, 120);
  assert.equal(s.tiefste, 31.2);
  assert.equal(s.tiefsterPlatz, "B");
  assert.equal(s.laengste, 50);
  assert.equal(s.kaelteste, 27);
  assert.equal(s.plaetze, 2);
  assert.deepEqual(s.arten[0], ["Schildkröte", 2]);
  assert.ok(s.arten.some(([a]) => a === "Adlerrochen"));
});

test("Tiere je Region und Packlisten-Vorschläge", () => {
  assert.equal(regionFuer({ lat: 15.3, lng: -61.39 }).id, "karibik");
  assert.equal(regionFuer({ lat: 27.25, lng: 33.8 }).id, "rotesmeer"); // Hurghada
  assert.equal(regionFuer({ lat: 28.47, lng: -16.25 }).id, "atlantik"); // Teneriffa
  assert.equal(regionFuer({ lat: 59.9, lng: 10.7 }).id, "norden"); // Oslo
  assert.equal(regionFuer({ lat: 41.38, lng: 2.17 }).id, "mittelmeer"); // Barcelona
  assert.equal(regionFuer({ lat: null }), null);
  assert.ok(tiereFuer(reise.haefen[1]).some((t) => t.name === "Fliegender Fisch"));
  const alle = tiereDerReise(reise);
  assert.equal(new Set(alle.map((t) => t.name)).size, alle.length);
  const v = passendeVorlagen({ ...reise, ausfluege: [...reise.ausfluege, { kategorie: "tauchen" }] });
  assert.deepEqual(v, ["basis", "kreuzfahrt", "warm", "tauchen", "kinder"]);
  const rest = vorlageEintraege("tauchen", [{ text: "logbuch" }]);
  assert.ok(!rest.some((e) => e.text === "Logbuch"));
});
