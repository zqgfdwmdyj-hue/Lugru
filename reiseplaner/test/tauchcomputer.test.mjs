import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { tauchImport, profilAus } from "../public/unterwegs-logik.js";
import { tauchProfilSvg } from "../public/rechnen.js";
import { zipTexte } from "../public/zip.js";

// Aufbau wie ein Oceanic+-Export (Apple Watch): Platzname = interne ID, Ø-Tiefe nur über Messpunkte
const punkte = (liste) => liste.map(([s, m]) => `<waypoint><depth>${m}</depth><divetime>${s}</divetime><temperature>296.15</temperature></waypoint>`).join("");
const oceanic = `<?xml version="1.0"?><uddf version="3.2.1"><divesite>
  <site id="site_aaaaaaaaaaaa"><name>site_aaaaaaaaaaaa</name><geography><location>site_aaaaaaaaaaaa</location><latitude>10.5</latitude><longitude>-61.25</longitude></geography></site>
  <site id="site_bbbbbbbbbbbb"><name>Hausriff</name><geography><location>Testbucht</location><latitude>1</latitude><longitude>2</longitude></geography></site>
</divesite><profiledata>
  <repetitiongroup><dive id="d1"><informationbeforedive><link ref="site_aaaaaaaaaaaa"/><datetime>2030-05-02T09:05:00.000+00:02</datetime></informationbeforedive>
    <samples>${punkte([[0, 0], [60, 10], [1140, 10], [1200, 0]])}</samples>
    <informationafterdive><lowesttemperature>295.15</lowesttemperature><greatestdepth>10.04</greatestdepth><diveduration>1200.0</diveduration></informationafterdive></dive></repetitiongroup>
  <repetitiongroup><dive id="d2"><informationbeforedive><link ref="site_bbbbbbbbbbbb"/><datetime>2030-05-01T15:00:00</datetime></informationbeforedive>
    <samples>${punkte([[0, 0], [30, 1], [60, 0]])}</samples></dive></repetitiongroup>
</profiledata></uddf>`;

test("Oceanic+/Apple-Watch-UDDF: IDs statt Namen, Ø-Tiefe und Profil aus Messpunkten", () => {
  const [kurz, t] = tauchImport(oceanic, "export.uddf");
  assert.equal(t.datum, "2030-05-02");
  assert.equal(t.beginn, "09:05");
  assert.equal(t.tauchplatz, "", "interne ID ist kein Tauchplatzname");
  assert.equal(t.ort, "");
  assert.deepEqual([t.lat, t.lng], [10.5, -61.25]);
  assert.equal(t.maxTiefe, 10);
  assert.equal(t.mittelTiefe, 9.5);
  assert.equal(t.tauchzeitMin, 20);
  assert.equal(t.wasserTemp, 22);
  assert.deepEqual(t.profil, [[0, 0], [1, 10], [19, 10], [20, 0]]);
  // Ohne Nachher-Block: Werte aus den Messpunkten, echter Name bleibt
  assert.equal(kurz.tauchplatz, "Hausriff");
  assert.equal(kurz.ort, "Testbucht");
  assert.equal(kurz.maxTiefe, 1);
  assert.equal(kurz.tauchzeitMin, 1);
  assert.equal(kurz.wasserTemp, 23);
});

test("Profil wird auf höchstens 120 Punkte verdichtet, tiefster Punkt bleibt", () => {
  const viele = Array.from({ length: 1000 }, (_, i) => ({ s: i * 4, m: i === 333 ? 42 : 10 }));
  const p = profilAus(viele);
  assert.ok(p.length <= 122, String(p.length));
  assert.ok(p.some(([, m]) => m === 42));
  assert.deepEqual(p.at(-1), [66.6, 10]);
  assert.deepEqual(profilAus([{ s: 0, m: 0 }]), []);
});

test("Tiefenprofil als SVG ohne Skript, leer bei zu wenig Daten", () => {
  const svg = tauchProfilSvg([[0, 0], [5, 18.2], [40, 5], [45, 0]]);
  assert.match(svg, /^<svg class="tauchprofil"/);
  assert.match(svg, /maximal 18,2 m nach 5 Minuten/);
  assert.match(svg, />20 m</);
  assert.doesNotMatch(svg, /<script|on\w+=/i);
  assert.equal(tauchProfilSvg([]), "");
  assert.equal(tauchProfilSvg([[0, "<b>"], [1, 2]]), "");
});

function zipBauen(eintraege) {
  const lokal = [], zentral = [];
  let pos = 0;
  for (const { name, text, packen } of eintraege) {
    const daten = Buffer.from(text), n = Buffer.from(name);
    const gepackt = packen ? deflateRawSync(daten) : daten;
    const k = Buffer.alloc(30);
    k.writeUInt32LE(0x04034b50, 0); k.writeUInt16LE(packen ? 8 : 0, 8); k.writeUInt32LE(crc32(daten), 14);
    k.writeUInt32LE(gepackt.length, 18); k.writeUInt32LE(daten.length, 22); k.writeUInt16LE(n.length, 26);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(packen ? 8 : 0, 10); z.writeUInt32LE(crc32(daten), 16);
    z.writeUInt32LE(gepackt.length, 20); z.writeUInt32LE(daten.length, 24); z.writeUInt16LE(n.length, 28); z.writeUInt32LE(pos, 42);
    lokal.push(k, n, gepackt); zentral.push(z, n);
    pos += 30 + n.length + gepackt.length;
  }
  const zb = Buffer.concat(zentral), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(eintraege.length, 8); e.writeUInt16LE(eintraege.length, 10);
  e.writeUInt32LE(zb.length, 12); e.writeUInt32LE(pos, 16);
  const b = Buffer.concat([...lokal, zb, e]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

test("ZIP vom Tauchcomputer: UDDF wird entpackt, Fremdes ignoriert", async () => {
  const zip = zipBauen([
    { name: "exports/log.uddf", text: oceanic, packen: true },
    { name: "__MACOSX/exports/._log.uddf", text: "x", packen: false },
    { name: "bild.jpg", text: "kein text", packen: false },
    { name: "notiz.csv", text: "Datum;Max. Tiefe\n2030-05-03;12", packen: false },
  ]);
  const texte = await zipTexte(zip);
  assert.deepEqual(texte.map((x) => x.name), ["exports/log.uddf", "notiz.csv"]);
  assert.equal(tauchImport(texte[0].text, texte[0].name).length, 2);
  await assert.rejects(zipTexte(new ArrayBuffer(10)), /beschädigt/);
});
