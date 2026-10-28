// Prüfstand je Reiter: welcher Ablauf geprüft wird, was erwartet ist, welche automatische Prüfung ihn abdeckt
// (Datei › Titelanfang) und was live geprüft wurde. Daraus erzeugt `npm run pruefstand` die Datei PRUEFSTAND.md –
// zusammen mit den Ergebnissen des letzten Laufs (test-results/ergebnis.json).
//
// Live-Prüfung nachtragen: beim Reiter unter `live` eine Zeile ergänzen (Datum, wer, Ablauf, Ergebnis) und
// `npm run pruefstand` erneut ausführen. Nur erfundene Daten oder das Nur-ansehen-Konto verwenden.

export type Ablauf = { ablauf: string; erwartet: string; tests: string[] };
export type Live = { datum: string; wer: string; ablauf: string; ergebnis: string; status: "ok" | "befund" | "behoben" };
export type Reiter = { abläufe?: Ablauf[]; live?: Live[]; offen?: string[] };

const FRUEHER = "vor dem 28.10.2026";

/** Schlüssel = Pfad aus der Navigation (src/lib/nav.ts) bzw. ein Name für Bereiche ohne eigenen Menüpunkt. */
export const PRUEFSTAND: Record<string, Reiter> = {
  "/": { offen: ["Aufgaben anlegen, erledigen, verschieben", "Tageskennzahlen"] },
  "/posteingang": {
    abläufe: [{ ablauf: ".eml-Datei hochladen", erwartet: "Rückmeldung, Dateiauswahl danach leer", tests: ["formulare.spec.ts › Posteingang: .eml hochladen"] }],
    offen: ["Mails abrufen (nur echte Postfächer)", "Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test"],
  },
  "/kalender": {
    abläufe: [{ ablauf: "Geschäftskalender als Büro-Konto und als Inhaberin", erwartet: "keine privaten Einträge (Testwort PRIVATGEHEIM erscheint nicht)", tests: ["privat.spec.ts › Privates bleibt privat"] }],
  },
  "/auftraege": {
    abläufe: [
      { ablauf: "Labels kaufen und alle als versendet melden (Amazon, simuliert)", erwartet: "Versandbestätigung je Amazon-Auftrag an den Testdienst; eBay ohne Verbindung als Meldung", tests: ["labels.spec.ts › Offene Aufträge"] },
      { ablauf: "Ansicht „Meldung offen“", erwartet: "fehlgeschlagene Meldungen sichtbar", tests: ["labels.spec.ts › Offene Aufträge"] },
    ],
  },
  "/auftraege/lieferschein": {
    abläufe: [
      { ablauf: "Falsche Datei hochladen", erwartet: "Fehler; Datei und Haken bleiben; Kanal bei „Offene Aufträge“ bleibt", tests: ["formulare.spec.ts › Falsche Datei"] },
      { ablauf: "Vorschau mit lauter „bitte prüfen“", erwartet: "Fehler; Auswahl je Bestellung bleibt", tests: ["formulare.spec.ts › Vorschau: alle"] },
      { ablauf: "Gewichte pflegen", erwartet: "unklare Eingabe bleibt stehen, gültige Zeile zeigt gespeicherte Werte, neue Zeile leert sich", tests: ["formulare.spec.ts › Gewichte"] },
      { ablauf: "Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert)", erwartet: "5 Labels, Kabel als DHL-Paket, keine echten Käufe", tests: ["labels.spec.ts › Offene Aufträge"] },
    ],
  },
  "/auftraege/prep-center": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Zeitraum = Monat, Stand = letzter Bestellabruf, fehlende Gebühren als Text statt 0", tests: ["kennzahlen.spec.ts › Prep Center"] },
      { ablauf: "Frage im Fragefeld „Was kostet uns das Prep Center?“", erwartet: "exakte Zahlen je Monat aus den Testdaten + Erklärung", tests: ["fragefeld.spec.ts › Prep Center"] },
    ],
  },
  "/repricer": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln", tests: ["kennzahlen.spec.ts › Repricer"] }] },
  "/bestand": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl, keine kaputten Werte", tests: ["kennzahlen.spec.ts › Bestand"] },
      { ablauf: "Inventur scannen", erwartet: "bucht +1, Feld leert sich für den nächsten Scan", tests: ["formulare.spec.ts › Inventur-Scanner"] },
    ],
  },
  "/inbound": { abläufe: [{ ablauf: "FBA-Sendung scannen", erwartet: "unbekannter Code → Fehler; gültiger Code bucht; Karton-Auswahl bleibt", tests: ["formulare.spec.ts › Scanner: unbekannter Code"] }] },
  "/paletten/sendungen": {
    abläufe: [
      { ablauf: "Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen", erwartet: "Meldung im System + Mail (abgefangen), Kunden sieht nur Freigegebenes, Links verfallen", tests: ["sendungen.spec.ts › Anlegen"] },
      { ablauf: "Notiz über Claude bzw. Fragefeld", erwartet: "nur mit Recht; Mitarbeiter als Vorschlag mit Ausführen/Ablehnen", tests: ["rechte.spec.ts › Claude-Konnektor"] },
    ],
  },
  "/ansprueche": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl", tests: ["kennzahlen.spec.ts › Ansprüche"] }] },
  "/gewinn": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "Zeitraum, Quelle, Stand; keine kaputten Werte", tests: ["kennzahlen.spec.ts › Gewinn"] }] },
  "/cashflow": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "Schätzungen mit „≈“, „keine Daten“ statt 0", tests: ["kennzahlen.spec.ts › Cash Flow"] }] },
  "/hebel": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "geschätzte Werte gekennzeichnet", tests: ["kennzahlen.spec.ts › Hebel"] }] },
  "/rechnungen": { abläufe: [{ ablauf: "Rechnung hochladen, Sammelbearbeitung", erwartet: "Upload leert nach Erfolg; Auswahl bleibt bei Fehlschlag; Rückfrage abgelehnt = nichts passiert", tests: ["formulare.spec.ts › Rechnungen"] }] },
  "/import": { abläufe: [{ ablauf: "Unbekannte Datei importieren", erwartet: "Fehler, Datei bleibt ausgewählt", tests: ["formulare.spec.ts › Import"] }] },
  "/marken/uhren": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "nur echte Deals, Herkunft angegeben", tests: ["kennzahlen.spec.ts › Uhren"] },
      { ablauf: "Übungs-Deal", erwartet: "zählt nicht unter „Verworfen“ und nicht in den Kennzahlen", tests: ["uebungsdaten.spec.ts › Übungs-Deal"] },
    ],
  },
  "/marken/uhren/deals": {
    abläufe: [
      { ablauf: "Pflichtfeld-Fehler → Eingaben bleiben → speichern → neu laden → Status ändern → nochmals speichern", erwartet: "Status bleibt (Handy und Desktop)", tests: ["formulare.spec.ts › Pflichtfeld-Fehler"] },
      { ablauf: "Filter und Schalter „Übungs-Deals zeigen“", erwartet: "Übung standardmäßig ausgeblendet, Schalter blendet ein", tests: ["uebungsdaten.spec.ts › Übungs-Deal"] },
    ],
    live: [
      { datum: FRUEHER, wer: "Prüfung mit ChatGPT", ablauf: "Uhren-Deal bearbeiten", ergebnis: "Eingaben/Status gingen verloren – behoben, seither automatisch geprüft", status: "behoben" },
      { datum: FRUEHER, wer: "Prüfung mit ChatGPT", ablauf: "Übungs-Deal", ergebnis: "zählte unter „Verworfen“ – behoben, seither automatisch geprüft", status: "behoben" },
    ],
  },
  "/privat": {
    abläufe: [
      { ablauf: "Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen", erwartet: "Ausnahme bleibt bei Serienänderung erhalten; nur die gewählten Termine ändern/verschwinden", tests: ["privat.spec.ts › Serie anlegen"] },
      { ablauf: "Abendritual als Abfolge „zweimal Streicheln, danach Massage“", erwartet: "die nächsten Abende im Voraus: S, S, M, S, S, M", tests: ["privat.spec.ts › Abendritual als Abfolge"] },
      { ablauf: "Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe", erwartet: "nichts Privates sichtbar; nur mit Privat-Freigabe der Inhaberin im Konnektor", tests: ["privat.spec.ts › Privates bleibt privat"] },
    ],
    offen: ["Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests", "Live nie prüfen (echte private Daten)"],
  },
  "/einstellungen": {
    abläufe: [{ ablauf: "Testumgebung: Banner, Sperre nach außen, Übersicht", erwartet: "Banner auf jeder Seite, Verbindungen nach außen gesperrt, Mails abgefangen", tests: ["testumgebung.spec.ts › Banner"] }],
  },
  "/einstellungen/claude": {
    abläufe: [
      { ablauf: "Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten", erwartet: "nicht angebotene Werkzeuge abgewiesen und protokolliert; Änderungen nur als Vorschlag", tests: ["rechte.spec.ts › Claude-Konnektor"] },
      { ablauf: "Jedes lesende Werkzeug einzeln", erwartet: "Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten", tests: ["werkzeuge.spec.ts › Jedes lesende Werkzeug"] },
      { ablauf: "Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag)", erwartet: "Zahlen aus dem Keepa-Nachbau, zweiter Aufruf aus dem Zwischenspeicher (keine neue Keepa-Abfrage), unbekannte ASIN klar benannt", tests: ["keepa.spec.ts › keepa_produkt"] },
      { ablauf: "Keepa: Länder vergleichen", erwartet: "DE/FR/IT/ES/UK nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als „nicht bei Keepa“", tests: ["keepa.spec.ts › keepa_vergleich"] },
      { ablauf: "Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon)", erwartet: "Lager-Konto bekommt sie nicht, direkter Aufruf abgewiesen", tests: ["keepa.spec.ts › Rechte"] },
    ],
  },
  Fragefeld: {
    abläufe: [
      { ablauf: "Altes Gespräch nach Update fortsetzen", erwartet: "kein 400, alter Denk-Schritt verworfen", tests: ["fragefeld.spec.ts › Altes Gespräch"] },
      { ablauf: "Privates im Kalender-Werkzeug", erwartet: "nie (auch nicht für die Inhaberin)", tests: ["privat.spec.ts › Privates bleibt privat"] },
    ],
    live: [{ datum: FRUEHER, wer: "Nutzung im Betrieb", ablauf: "Altes Gespräch fortsetzen", ergebnis: "400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft", status: "behoben" }],
  },
  "Server (Port, Adresse, Testumgebung)": {
    offen: ["`deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)", "`deploy/testumgebung.sh an` + `pruefen` auf dem Server"],
    live: [{ datum: FRUEHER, wer: "Prüfung mit ChatGPT", ablauf: "Erreichbarkeit", ergebnis: "Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen", status: "befund" }],
  },
};

/** Jede Seite der Navigation wird zusätzlich von dieser Prüfung abgedeckt (Desktop und Handy). */
export const ALLE_SEITEN: Ablauf = {
  ablauf: "Seite öffnen (Inhaberin): Status mit Text, aktive Auswahl markiert, deaktivierte Knöpfe erkennbar, Kontrast ≥ 4,5:1, am Handy kein Querscrollen",
  erwartet: "keine Befunde",
  tests: ["oberflaeche.spec.ts › Alle Seiten"],
};
