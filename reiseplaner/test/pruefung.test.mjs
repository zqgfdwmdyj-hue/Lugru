// Prüfpunkte aus der Oberflächenprüfung: Preis offen, Dubletten, Buchungskonflikte, Etappen, Puffer-Annahmen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausflugKosten, reiseKosten, hotelKosten, titelAehnlich, moeglicheDubletten, buchungsKonflikte, zeitplan, festeZeit, bewertung, punkteErklaerung } from "../public/rechnen.js";
import { etappen } from "../public/unterwegs-logik.js";
import { importAbgleich, planZusammenfuehren } from "../public/zusammenfuehren.js";

const personen = [{ id: "e1", name: "Ludwig", typ: "erwachsen" }, { id: "k1", name: "Mia", typ: "kind", alter: 7 }, { id: "k2", name: "Ben", typ: "kind", alter: 3 }];

test("Leerer Preis ist „offen“, eine eingetragene 0 ist kostenlos", () => {
  const alle = personen.map((p) => p.id);
  assert.equal(ausflugKosten({ preisArt: "person", preisErw: null, teilnehmer: alle }, personen).offen, true);
  assert.equal(ausflugKosten({ preisArt: "person", preisErw: 0, teilnehmer: alle }, personen).offen, false);
  assert.equal(ausflugKosten({ preisArt: "person", preisErw: 50, teilnehmer: alle }, personen).offen, false, "Kinder ohne Kinderpreis zahlen den Erwachsenenpreis");
  assert.equal(ausflugKosten({ preisArt: "gruppe", preisGruppe: null, teilnehmer: alle }, personen).offen, true);
  // Nur Kleinkind unter „gratis unter“ → bekannt, auch ohne Erwachsenenpreis
  assert.equal(ausflugKosten({ preisArt: "person", preisErw: null, kostenlosBis: 4, teilnehmer: ["k2"] }, personen).offen, false);
  assert.equal(hotelKosten({ preis: null, preisArt: "nacht", anreise: "2027-03-19", abreise: "2027-03-22" }).offen, true);
  assert.equal(hotelKosten({ preis: 0, preisArt: "gesamt" }).offen, false);
});

test("Reisekosten listen gezählte Posten ohne Preis", () => {
  const k = reiseKosten({
    personen,
    haefen: [{ id: "h1", datum: "2027-03-28" }],
    ausfluege: [
      { id: "a1", hafenId: "h1", titel: "Kool Dominica", status: "gebucht", preisArt: "person", preisErw: null, teilnehmer: ["e1"] },
      { id: "a2", hafenId: "h1", titel: "Idee ohne Preis", status: "idee", preisArt: "person", preisErw: null, teilnehmer: ["e1"] },
    ],
    hotels: [],
    kosten: [{ id: "x", titel: "Trinkgeld", betrag: null, status: "favorit" }],
  });
  assert.deepEqual(k.offen.map((o) => o.titel), ["Trinkgeld", "Kool Dominica"]);
  assert.equal(k.geplant, 0);
});

test("Ähnliche Titel werden erkannt, verschiedene nicht", () => {
  assert.ok(titelAehnlich("TUI Naturwunder Dominicas", "Naturwunder Dominica (TUI)"));
  assert.ok(titelAehnlich("Mero Beach", "Mero Beach – Strandtag"));
  assert.ok(titelAehnlich("Mero", "Mero"));
  assert.ok(!titelAehnlich("Inselrundfahrt mit Weinprobe", "Altstadt zu Fuß"));
  assert.ok(!titelAehnlich("Strand", "Strand und Schnorcheln am Riff"));
});

test("Mögliche Dubletten nur am selben Tag; „keine Dublette“ und Alternativen blenden aus", () => {
  const a = { id: "a", hafenId: "h1", titel: "Mero Beach", status: "idee" };
  const b = { id: "b", hafenId: "h1", titel: "Mero Beach Strandtag", status: "favorit" };
  const c = { id: "c", hafenId: "h2", titel: "Mero Beach", status: "idee" };
  assert.equal(moeglicheDubletten([a, b, c]).length, 1);
  assert.equal(moeglicheDubletten([{ ...a, keineDublette: ["b"] }, b]).length, 0);
  assert.equal(moeglicheDubletten([a, { ...b, alternativen: ["a"] }]).length, 0);
  assert.equal(moeglicheDubletten([a, { ...b, status: "verworfen" }]).length, 0);
});

test("Buchungskonflikt: zeitgleich gebucht für dieselbe Person – und gebuchte Alternativen", () => {
  const reise = {
    personen,
    haefen: [{ id: "h1", datum: "2027-03-28", art: "hafen", ankunft: "08:00", abfahrt: "18:00", allesAnBord: "17:30" }],
    ausfluege: [
      { id: "t1", hafenId: "h1", titel: "TUI Naturwunder", quelle: "schiff", status: "gebucht", beginn: "09:00", dauerMin: 240, teilnehmer: ["e1", "k1"] },
      { id: "t2", hafenId: "h1", titel: "TUI Inselrundfahrt", quelle: "schiff", status: "gebucht", beginn: "10:00", dauerMin: 180, teilnehmer: ["e1"] },
      { id: "t3", hafenId: "h1", titel: "Strand nachmittags", quelle: "eigene", status: "gebucht", beginn: "14:30", dauerMin: 60, teilnehmer: ["e1"] },
      { id: "t4", hafenId: "h1", titel: "Kinderclub", quelle: "schiff", status: "gebucht", beginn: "09:00", dauerMin: 240, teilnehmer: ["k2"] },
    ],
  };
  const k = buchungsKonflikte(reise);
  assert.equal(k.get("t1")?.[0].mit.id, "t2");
  assert.deepEqual(k.get("t1")[0].personen, ["Ludwig"]);
  assert.ok(!k.has("t3"), "nach Rückkehr keine Überschneidung");
  assert.ok(!k.has("t4"), "andere Person");
  reise.ausfluege[2].alternativen = ["t4"];
  assert.equal(buchungsKonflikte(reise).get("t3")?.[0].grund, "Beide Alternativen sind gebucht");
});

test("Kreuzfahrt: keine Autoetappen zwischen Häfen; Flugtage werden nicht gefahren", () => {
  const haefen = [
    { id: "h1", datum: "2027-03-27", art: "hafen", name: "Pointe-à-Pitre", lat: 16.24, lng: -61.53 },
    { id: "h2", datum: "2027-03-28", art: "hafen", name: "Roseau", lat: 15.3, lng: -61.39 },
  ];
  assert.deepEqual(etappen({ art: "kreuzfahrt", haefen }), []);
  assert.deepEqual(etappen({ haefen }), [], "ohne Art gilt Kreuzfahrt");
  const rund = etappen({
    art: "rundreise",
    haefen: [{ id: "o1", datum: "2027-05-01", art: "ort", name: "Athen", lat: 37.98, lng: 23.73 }, { id: "o2", datum: "2027-05-03", art: "ort", name: "Heraklion", lat: 35.34, lng: 25.13 }, { id: "o3", datum: "2027-05-06", art: "ort", name: "Chania", lat: 35.51, lng: 24.02 }],
    verbindungen: [{ art: "flug", datum: "2027-05-03", status: "gebucht" }],
  });
  assert.equal(rund[0].mittel, "flug");
  assert.equal(rund[1].mittel, "auto");
});

test("Puffer: fehlendes „Alle an Bord“ und fehlender Beginn werden als Annahme gekennzeichnet", () => {
  const tag = { id: "h1", datum: "2027-03-28", art: "hafen", ankunft: "08:00", abfahrt: "18:00", allesAnBord: "" };
  const f = festeZeit(tag);
  assert.equal(f.angenommen, true);
  assert.match(f.grundlage, /Abfahrt 18:00 − 30 Min/);
  const z = zeitplan({ quelle: "schiff", dauerMin: 240 }, tag);
  assert.equal(z.startAngenommen, true);
  assert.equal(z.annahmen.length, 2);
  assert.match(z.rechenweg, /Zurück ca\. 12:30/);
  const fest = zeitplan({ quelle: "schiff", beginn: "09:00", dauerMin: 240 }, { ...tag, allesAnBord: "17:30" });
  assert.equal(fest.annahmen.length, 0);
  assert.equal(fest.puffer, 270);
});

test("Punktwert wird erklärt; offener Preis zählt nicht als günstig", () => {
  const tag = { id: "h1", art: "hafen", ankunft: "08:00", allesAnBord: "17:30" };
  const b = bewertung({ quelle: "schiff", beginn: "09:00", dauerMin: 240, interesse: 4, preisArt: "person", preisErw: null, teilnehmer: ["e1"] }, tag, personen);
  assert.equal(b.proPersonStunde, null);
  assert.match(punkteErklaerung({ interesse: 4 }, b), /Interesse 4\/5 = 80.*Preis offen/);
});

test("Import: Dubletten werden gegenübergestellt und nie still zusammengeführt", () => {
  const reise = {
    personen,
    haefen: [{ id: "h1", datum: "2027-03-28", art: "hafen", name: "Roseau" }],
    ausfluege: [{ id: "a1", hafenId: "h1", titel: "Mero Beach", status: "idee", preisErw: null, notiz: "" }],
    hotels: [], kosten: [], verbindungen: [],
  };
  const plan = { personen: [], stationen: [], hotels: [], kosten: [], verbindungen: [], ausfluege: [
    { datum: "2027-03-28", titel: "Mero Beach", status: "idee", preisErw: 25, notiz: "Liegen inklusive" },
    { datum: "2027-03-28", titel: "Mero Beach Strandtag", status: "idee", preisErw: 30 },
  ] };
  const abgleich = importAbgleich(reise, plan);
  assert.deepEqual(abgleich.map((x) => x.art), ["gleich", "aehnlich"]);

  const kopie = structuredClone(reise);
  const z = planZusammenfuehren(kopie, plan, { entscheidungen: { "ausfluege:1": "ueberspringen" } });
  assert.equal(kopie.ausfluege.length, 1);
  assert.equal(kopie.ausfluege[0].preisErw, 25, "leere Felder ergänzt");
  assert.equal(z.uebersprungen, 1);
  assert.deepEqual(z.aenderungen[0].felder.sort(), ["notiz", "preisErw"]);

  const kopie2 = structuredClone(reise);
  planZusammenfuehren(kopie2, plan, { entscheidungen: { "ausfluege:0": "zusaetzlich", "ausfluege:1": "zusaetzlich" } });
  assert.equal(kopie2.ausfluege.length, 3);
  assert.equal(kopie2.ausfluege[0].preisErw, null, "vorhandener Eintrag unverändert");

  // Vorhandene Werte werden nie überschrieben
  const kopie3 = structuredClone(reise);
  kopie3.ausfluege[0].preisErw = 20;
  planZusammenfuehren(kopie3, plan, { entscheidungen: { "ausfluege:1": "aktualisieren" } });
  assert.equal(kopie3.ausfluege[0].preisErw, 20);
});

test("Kostenposten: bezahlt aus Eingabe oder verknüpften Ausgaben – nie doppelt", async () => {
  const { kostenPosten } = await import("../public/unterwegs-logik.js");
  const reise = {
    personen: [{ id: "a", typ: "erwachsen" }, { id: "b", typ: "erwachsen" }],
    ausfluege: [
      { id: "x", titel: "Bootstour", status: "gebucht", preisArt: "person", preisErw: 100, teilnehmer: ["a", "b"], bezahltBetrag: 50 },
      { id: "y", titel: "Idee", status: "favorit", preisArt: "person", preisErw: 30, teilnehmer: ["a"] },
      { id: "z", titel: "Ohne Preis", status: "gebucht", preisArt: "person", preisErw: null, teilnehmer: ["a"] },
    ],
    kosten: [{ id: "k", titel: "Flug", betrag: 800, status: "gebucht" }],
    hotels: [],
  };
  const ausgaben = [{ betrag: 800, buchung: "kosten:k" }, { betrag: 60 }];
  const p = kostenPosten(reise, ausgaben);
  assert.equal(p.gebucht, 1000);
  assert.equal(p.bezahlt, 850);
  assert.equal(p.nochOffen, 150);
  assert.equal(p.unterwegs, 60, "nur nicht verknüpfte Ausgaben zählen zusätzlich");
  assert.equal(p.gesamt, 1060);
  assert.equal(p.preisOffen, 1);
  assert.equal(p.posten.find((x) => x.id === "z").rest, null);
  assert.ok(!p.posten.some((x) => x.id === "y"), "Favoriten nur auf Wunsch");
  assert.equal(kostenPosten(reise, ausgaben, { mitFavoriten: true }).geplant, 1030);
});

test("Weitere Kosten nur für ausgewählte Personen; Favoriten abschaltbar", () => {
  const reise = { personen: [{ id: "a", typ: "erwachsen" }, { id: "b", typ: "erwachsen" }], ausfluege: [{ id: "f", status: "favorit", preisArt: "person", preisErw: 40, teilnehmer: ["a"] }], hotels: [], kosten: [{ id: "k", titel: "Tauchkurs", betrag: 300, status: "gebucht", personen: ["b"] }] };
  const k = reiseKosten(reise);
  assert.equal(k.jePerson.b, 300);
  assert.equal(k.jePerson.a, 40);
  assert.equal(reiseKosten(reise, { mitFavoriten: false }).jePerson.a, 0);
});

test("Fehlende Übernachtungen als Lücken", async () => {
  const { fehlendeNaechte } = await import("../public/rechnen.js");
  const l = fehlendeNaechte({ art: "hotel", haefen: [{ datum: "2027-03-19" }, { datum: "2027-03-25" }], hotels: [{ status: "gebucht", anreise: "2027-03-19", abreise: "2027-03-21" }, { status: "idee", anreise: "2027-03-22", abreise: "2027-03-24" }] });
  assert.deepEqual(l.map((x) => [x.von, x.bis, x.naechte, x.nurGeplant]), [["2027-03-21", "2027-03-22", 1, false], ["2027-03-22", "2027-03-24", 2, true], ["2027-03-24", "2027-03-25", 1, false]]);
  assert.deepEqual(fehlendeNaechte({ art: "kreuzfahrt", haefen: [{ datum: "2027-03-19" }, { datum: "2027-03-25" }] }), []);
});

test("Mindestalter getrennt von „Kinder gratis unter“", async () => {
  const { zuJung, ausflugKosten } = await import("../public/rechnen.js");
  const ps = [{ id: "e", typ: "erwachsen" }, { id: "k", name: "Mia", typ: "kind", alter: 7 }];
  const a = { preisArt: "person", preisErw: 50, kostenlosBis: 6, mindestalter: 8, teilnehmer: ["e", "k"] };
  assert.deepEqual(zuJung(a, ps).map((p) => p.name), ["Mia"]);
  assert.equal(ausflugKosten(a, ps).summe, 100, "Mia (7) zahlt – gratis nur unter 6");
});

test("Zubringerflug ab Deutschland erzeugt keine Bordzeit in der Karibik", async () => {
  const { festeZeit, anBordZeit, abfahrtAmOrt } = await import("../public/rechnen.js");
  const tag = { id: "h1", datum: "2027-03-19", art: "hafen", name: "La Romana", land: "Dominikanische Republik", lat: 18.42, lng: -68.95, ankunft: "", abfahrt: "23:00", allesAnBord: "" };
  const zubringer = { id: "v1", art: "flug", status: "gebucht", titel: "Condor DE 4063", von: "München (MUC)", nach: "Frankfurt (FRA)", datum: "2027-03-19", abZeit: "08:45", vonOrt: { lat: 48.35, lng: 11.79 } };
  const ohneKoord = { ...zubringer, id: "v2", vonOrt: null };
  for (const v of [zubringer, ohneKoord]) {
    assert.equal(abfahrtAmOrt(v, tag), false);
    const f = festeZeit(tag, { verbindungen: [v] });
    assert.equal(f.kurz, "Alle an Bord");
    assert.equal(f.zeit, "22:30");
  }
  assert.equal(anBordZeit(tag).angenommen, true);
  // Rückflug ab La Romana zählt am Abreisetag
  const rueck = { id: "v3", art: "flug", status: "gebucht", titel: "Condor DE 3867", von: "La Romana (LRM)", nach: "Frankfurt (FRA)", datum: "2027-04-02", abZeit: "14:40" };
  const ende = { id: "h9", datum: "2027-04-02", art: "ort", name: "La Romana", lat: 18.42, lng: -68.95 };
  assert.equal(abfahrtAmOrt(rueck, ende), true);
  assert.equal(festeZeit(ende, { verbindungen: [rueck] }).zeit, "12:40");
  assert.equal(festeZeit(ende, { verbindungen: [{ ...rueck, vonOrt: { lat: 18.45, lng: -68.91 } }] }).zeit, "12:40");
  // Land-Tag ohne Kartenpunkt und ohne Abfahrtsort: weiterhin feste Zeit (wie bisher)
  assert.equal(festeZeit({ datum: "2027-04-02", art: "ort", name: "Ort" }, { verbindungen: [{ ...rueck, von: "" }] }).zeit, "12:40");
});
