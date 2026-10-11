import { test } from "node:test";
import assert from "node:assert/strict";
import { reiseplanAusText } from "../public/reiseplan-text.js";
import { planZusammenfuehren } from "../public/zusammenfuehren.js";
import { reiseKosten, ausflugKosten, textZuAusfluegen } from "../public/rechnen.js";

// Erfundener Plan im Format, wie ChatGPT-Pläne oft aussehen
const PLAN = `REISE
7 Nächte Mittelmeer mit Mein Schiff 9
01.05.2027–08.05.2027
Reisegruppe: 5 Personen
3 Erwachsene + 2 Kinder (4 und 9 Jahre)

01.05.2027 – Palma, Mallorca
Liegezeit: 08:00–20:00
Einschiffung.

02.05.2027 – Seetag

03.05.2027 – Valletta, Malta
Ankunft: 07:00
Schiff bleibt über Nacht.

AUSFLUG GEBUCHT:
TUI Cruises – Hafenrundfahrt mit Delfinen
Zeit: 09:00–12:30
Preis gesamt für 5 Personen: 240 €

TUI BACKUP GEBUCHT:
Blaue Grotte
Zeit: 13:00–16:00
Preis gesamt etwa 180 €.

BEVORZUGTE LOKALE ALTERNATIVE:
Gozo Sea Tours & Services
Comino, Blue Lagoon, Schnorcheln
Start empfohlen: 09:30
Dauer der Tour: ca. 5 Stunden
Preis: 60 USD pro Person ab 5 Jahren
4-jähriges Kind kostenlos.
Gesamtpreis:
240 USD, ca. 215 € für alle 5.

04.05.2027 – Valletta, Malta
Abfahrt Schiff: 18:00

AUSFLUG FEST:
Malta Divers
2 zertifizierte Taucher
Zeit: 08:30–ca. 12:00
Preis für 2 Taucher: ca. 260 € + Taxi zur Tauchbasis.

ANSCHLIESSEND GEPLANT:
Strand Golden Bay
Jetski-Angebot:
ca. 30 USD / 15 Minuten

05.05.2027 – Neapel, Italien
Liegezeit: 07:00–19:00

PRIVATE ALTERNATIVE – AMALFI DRIVERS:
Privattour für 5 Personen
Start: 08:30 am Cruise Terminal
Preis Tour:
Erwachsene: 70 USD pro Person
Kinder: 30 USD pro Person
`;

test("Ganzer Reiseplan: Kopf, Personen, Tage", () => {
  const p = reiseplanAusText(PLAN);
  assert.equal(p.name, "7 Nächte Mittelmeer mit Mein Schiff 9");
  assert.equal(p.schiff, "Mein Schiff 9");
  assert.deepEqual(p.personen.map((x) => [x.typ, x.alter]), [["erwachsen", null], ["erwachsen", null], ["erwachsen", null], ["kind", 4], ["kind", 9]]);
  assert.deepEqual(p.stationen.map((s) => [s.datum, s.art, s.name, s.ankunft, s.abfahrt]), [
    ["2027-05-01", "hafen", "Palma", "08:00", "20:00"],
    ["2027-05-02", "seetag", "Seetag", "", ""],
    ["2027-05-03", "hafen", "Valletta", "07:00", ""],
    ["2027-05-04", "hafen", "Valletta", "", "18:00"],
    ["2027-05-05", "hafen", "Neapel", "07:00", "19:00"],
  ]);
  assert.equal(p.stationen[0].notiz, "Einschiffung.");
});

test("Ganzer Reiseplan: Ausflüge mit Status, Zeiten und Preisen", () => {
  const p = reiseplanAusText(PLAN);
  const [hafen, backup, alternative, tauchen, strand, privat] = p.ausfluege;
  assert.equal(p.ausfluege.length, 6);
  assert.deepEqual([hafen.titel, hafen.quelle, hafen.status, hafen.beginn, hafen.dauerMin, hafen.preisArt, hafen.preisGruppe], ["Hafenrundfahrt mit Delfinen", "schiff", "gebucht", "09:00", 210, "gruppe", 240]);
  assert.equal(backup.status, "gebucht");
  assert.equal(backup.preisGruppe, 180);
  assert.match(backup.notiz, /Backup/);
  assert.equal(alternative.status, "idee");
  assert.equal(alternative.titel, "Gozo Sea Tours & Services: Comino, Blue Lagoon, Schnorcheln");
  assert.equal(alternative.preisGruppe, 215); // Euro-Angabe hat Vorrang vor Dollar
  assert.equal(alternative.beginn, "09:30");
  assert.equal(alternative.dauerMin, 300);
  assert.equal(alternative.interesse, 5);
  assert.equal(tauchen.kategorie, "tauchen");
  assert.equal(tauchen.status, "favorit");
  assert.equal(tauchen.preisGruppe, 260);
  assert.equal(tauchen.anzahl, 2);
  assert.equal(strand.preisGruppe, null); // Preistabelle „30 USD / 15 Minuten“ ist kein Ausflugspreis
  assert.equal(strand.preisErw, null);
  assert.equal(privat.titel, "Amalfi Drivers: Privattour für 5 Personen");
  assert.equal(privat.preisArt, "person");
  assert.equal(privat.preisErw, 62.3); // 70 USD umgerechnet
  assert.equal(privat.preisKind, 26.7);
  assert.match(privat.notiz, /US-Dollar umgerechnet/);
});

test("Ganzer Reiseplan: Übernahme rechnet Gesamtpreise nicht pro Person hoch", () => {
  const p = reiseplanAusText(PLAN);
  const reise = { personen: p.personen.map((x, i) => ({ id: `p${i}`, ...x })), haefen: [], ausfluege: [], hotels: [], kosten: [] };
  planZusammenfuehren(reise, { ...p, personen: [] });
  const tauchen = reise.ausfluege.find((a) => a.kategorie === "tauchen");
  assert.equal(tauchen.teilnehmer.length, 2); // nur die ersten zwei Erwachsenen
  assert.equal(ausflugKosten(tauchen, reise.personen).summe, 260);
  const k = reiseKosten(reise);
  assert.equal(k.gebucht, 240 + 180);
  assert.equal(k.geplant, 240 + 180 + 260);
  // Erneut einlesen verdoppelt nichts
  planZusammenfuehren(reise, { ...p, personen: [] });
  assert.equal(reise.ausfluege.length, 6);
  assert.equal(reise.haefen.length, 5);
});

test("Einfacher Ausflugs-Import erkennt Gesamtpreise", () => {
  const [a] = textZuAusfluegen("Delfintour\nPreis gesamt für 6 Personen: 275 €");
  assert.equal(a.preisArt, "gruppe");
  assert.equal(a.preisGruppe, 275);
  assert.equal(a.preisErw, null);
});
