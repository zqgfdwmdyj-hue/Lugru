import { test } from "node:test";
import assert from "node:assert/strict";
import { ausflugKosten, reiseKosten, zeitplan, bewertung, textZuAusfluegen, zahl, minZuZeit, dauerText } from "../public/rechnen.js";

const personen = [
  { id: "e1", typ: "erwachsen" }, { id: "e2", typ: "erwachsen" }, { id: "e3", typ: "erwachsen" }, { id: "e4", typ: "erwachsen" },
  { id: "k1", typ: "kind", alter: 10 }, { id: "k2", typ: "kind", alter: 3 },
];
const alle = personen.map((p) => p.id);
const hafen = { id: "h1", ankunft: "08:00", abfahrt: "18:00", allesAnBord: "17:30" };

test("Zahlen im deutschen Format", () => {
  assert.equal(zahl("59,90"), 59.9);
  assert.equal(zahl("1.234,50 €"), 1234.5);
  assert.equal(zahl("59.90"), 59.9);
  assert.equal(zahl(""), null);
  assert.equal(zahl("abc"), null);
});

test("Preis pro Person mit Kinderpreis und Gratis-Alter", () => {
  const a = { preisArt: "person", preisErw: 60, preisKind: 40, kostenlosBis: 4, teilnehmer: alle };
  const k = ausflugKosten(a, personen);
  assert.equal(k.summe, 4 * 60 + 40 + 0);
  assert.equal(k.erwachsene, 4);
  assert.equal(k.kinder, 2);
  assert.equal(k.jePerson.k2, 0);
});

test("Ohne Kinderpreis zahlen Kinder den Erwachsenenpreis", () => {
  const a = { preisArt: "person", preisErw: 25, teilnehmer: ["e1", "k1"] };
  assert.equal(ausflugKosten(a, personen).summe, 50);
});

test("Gruppenpreis wird geteilt, Zusatzkosten kommen dazu", () => {
  const a = { preisArt: "gruppe", preisGruppe: 300, zusatzkosten: 60, teilnehmer: ["e1", "e2", "k1"] };
  const k = ausflugKosten(a, personen);
  assert.equal(k.summe, 360);
  assert.equal(k.jePerson.e1, 120);
});

test("Niemand dabei = keine Kosten", () => {
  assert.equal(ausflugKosten({ preisArt: "gruppe", preisGruppe: 300, zusatzkosten: 10, teilnehmer: [] }, personen).summe, 0);
});

test("Reisekosten zählen nur Gebucht und Favorit", () => {
  const reise = {
    personen,
    ausfluege: [
      { hafenId: "h1", quelle: "schiff", status: "gebucht", preisArt: "person", preisErw: 10, teilnehmer: ["e1"] },
      { hafenId: "h1", quelle: "viator", status: "favorit", preisArt: "person", preisErw: 20, teilnehmer: ["e1", "e2"] },
      { hafenId: "h2", quelle: "schiff", status: "idee", preisArt: "person", preisErw: 999, teilnehmer: alle },
    ],
  };
  const k = reiseKosten(reise);
  assert.equal(k.gebucht, 10);
  assert.equal(k.geplant, 50);
  assert.equal(k.jeHafen.h1, 50);
  assert.equal(k.jePerson.e1, 30);
  assert.equal(k.jeHafen.h2, undefined);
});

test("Zeitplan: eigener Ausflug mit Anfahrt, knapper Puffer warnt", () => {
  const a = { quelle: "getyourguide", beginn: "09:00", dauerMin: 420, fahrzeitMin: 45 };
  const z = zeitplan(a, hafen);
  assert.equal(z.zurueck, 9 * 60 + 420 + 45); // 16:45
  assert.equal(z.puffer, 45);
  assert.equal(z.losVomSchiff, 8 * 60 + 15);
  assert.ok(z.warnungen.some((w) => w.includes("wartet das Schiff nicht")));
});

test("Zeitplan: Schiffsausflug ohne Anfahrt, keine Warnung", () => {
  const z = zeitplan({ quelle: "schiff", beginn: "09:00", dauerMin: 420, fahrzeitMin: 45 }, hafen);
  assert.equal(z.puffer, 90);
  assert.equal(z.warnungen.length, 0);
});

test("Zeitplan: zu spät zurück", () => {
  const z = zeitplan({ quelle: "eigene", beginn: "10:00", dauerMin: 480, fahrzeitMin: 30 }, hafen);
  assert.ok(z.puffer < 0);
  assert.ok(z.warnungen[0].includes("nach „Alle an Bord“"));
});

test("Ohne „Alle an Bord“ gilt Abfahrt minus 30 Minuten", () => {
  const z = zeitplan({ quelle: "schiff", beginn: "09:00", dauerMin: 60 }, { ankunft: "08:00", abfahrt: "18:00", allesAnBord: "" });
  assert.equal(z.puffer, 17 * 60 + 30 - 10 * 60);
});

test("Bewertung bestraft zu späte Rückkehr", () => {
  const gut = bewertung({ quelle: "schiff", beginn: "09:00", dauerMin: 240, preisErw: 50, teilnehmer: alle, interesse: 3 }, hafen, personen);
  const spaet = bewertung({ quelle: "eigene", beginn: "12:00", dauerMin: 360, fahrzeitMin: 30, preisErw: 50, teilnehmer: alle, interesse: 3 }, hafen, personen);
  assert.ok(gut.punkte > spaet.punkte);
});

test("Eingefügter Text wird zu Ausflügen", () => {
  const text = `Inselrundfahrt mit Weinprobe
TFS01 · ca. 4,5 Std. · ab 09:00 Uhr
Erwachsene 69 € · Kinder 49 €

Altstadt zu Fuß
ca. 2 Std.
39,00 €`;
  const [a, b] = textZuAusfluegen(text);
  assert.equal(a.titel, "Inselrundfahrt mit Weinprobe");
  assert.equal(a.preisErw, 69);
  assert.equal(a.preisKind, 49);
  assert.equal(a.dauerMin, 270);
  assert.equal(a.beginn, "09:00");
  assert.equal(a.code, "TFS01");
  assert.equal(b.preisErw, 39);
  assert.equal(b.preisKind, null);
  assert.equal(b.dauerMin, 120);
});

test("Kinderpreis in eigener Zeile", () => {
  const [a] = textZuAusfluegen("Delfine beobachten\nPreis: 55 €\nKinderpreis: 35 €\n3 Stunden");
  assert.equal(a.preisErw, 55);
  assert.equal(a.preisKind, 35);
  assert.equal(a.dauerMin, 180);
});

test("Zeit- und Dauertexte", () => {
  assert.equal(minZuZeit(510), "08:30");
  assert.equal(dauerText(135), "2 Std. 15 Min.");
  assert.equal(dauerText(45), "45 Min.");
});
