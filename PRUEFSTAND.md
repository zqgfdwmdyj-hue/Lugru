# Prüfstand je Reiter

Letzter Lauf der Ablaufprüfungen: **28.10.2026, 20:54** · 35 bestanden · 0 fehlgeschlagen · 0 erst im zweiten Versuch · Dauer 120 s. Testumgebung mit erfundenen Daten, keine echten Dienste.

Erzeugt mit `npm run pruefstand` aus `e2e/pruefstand.ts` (Abläufe, Live-Prüfungen) und dem letzten Lauf. Nicht von Hand bearbeiten.

Zeichen: ✓ automatisch bestanden · ✕ automatisch fehlgeschlagen · ○ im letzten Lauf nicht gelaufen · 👁 live geprüft · – noch nicht geprüft

## Übersicht

| Bereich | Reiter | Automatisch | Live | Noch offen |
|---|---|---|---|---|
| Heute | Tagesübersicht `/` | ✓ nur Oberfläche | – | 2 |
| Heute | Alle Aufgaben `/?ansicht=liste` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Posteingang `/posteingang` | ✓ 1/1 Abläufe | – | 2 |
| Heute | Termine `/kalender` | ✓ 1/1 Abläufe | – | – |
| Verkauf & Versand | Aufträge & Versand `/auftraege` | ✓ 2/2 Abläufe | – | – |
| Verkauf & Versand | Labels: Warensendung & DHL `/auftraege/lieferschein` | ✓ 4/4 Abläufe | – | – |
| Verkauf & Versand | Prep Center: Versand je Monat `/auftraege/prep-center` | ✓ 2/2 Abläufe | – | – |
| Verkauf & Versand | Angebote (alle Kanäle) `/listings` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | Neues eBay-Angebot `/ebay` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | eBay-Angebote prüfen `/ebay/pruefen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | eBay-Artikel & Gewinn `/ebay?ansicht=artikel` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | eBay-Verlauf `/ebay?ansicht=verlauf` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | eBay → Temu / Wawi `/listings/temu` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | Amazon-ToDos `/amazon-todos` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | Amazon SAS-Programm `/sas` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Verkauf & Versand | Repricer (BQool) `/repricer` | ✓ 1/1 Abläufe | – | – |
| Produkte & Lager | Produkte `/produkte` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Chargen `/chargen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Bestand & Inventur `/bestand` | ✓ 2/2 Abläufe | – | – |
| Produkte & Lager | Artikelstamm (eigene Marken) `/artikel` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | FBA-Inbound `/inbound` | ✓ 1/1 Abläufe | – | – |
| Produkte & Lager | Paletten-Lager `/paletten` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager › Sendungen `/paletten/sendungen` | ✓ 2/2 Abläufe | – | – |
| Produkte & Lager | Paletten-Lager › Lagerplan `/paletten/lagerplan` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager › Abholung `/paletten/abholung` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager › Inventur `/paletten/inventur` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager › Abrechnung `/paletten/abrechnung` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager › Kunden & Preise `/paletten/kunden` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager › Auswertung `/paletten/uebersicht` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Einkauf & Wareneingang `/einkauf` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Dropship-Trackings `/einkauf/beschaffungsanalyse` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Lieferanten-Feeds `/lieferanten` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Lieferanten-Abfrage `/lieferanten/abfrage` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Chancen `/lieferanten/chancen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Großhändler finden `/lieferanten/finden` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Lieferanten | Kontakt-Board `/board` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Retouren `/retouren` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Ansprüche `/ansprueche` | ✓ 1/1 Abläufe | – | – |
| Service & Ansprüche | Remissionen `/remissionen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Fälle & A-bis-Z `/faelle` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Bewertungen `/bewertungen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Gewinn `/gewinn` | ✓ 1/1 Abläufe | – | – |
| Finanzen | Cash Flow `/cashflow` | ✓ 1/1 Abläufe | – | – |
| Finanzen | Hebel: Umsatz & Marge `/hebel` | ✓ 1/1 Abläufe | – | – |
| Finanzen | Eingangsrechnungen `/rechnungen` | ✓ 1/1 Abläufe | – | – |
| Finanzen | Belege scannen `/rechnungen/belege` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Ausgangsrechnungen `/rechnungen/ausgang` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | eBay-Rechnungen `/ebay?ansicht=rechnungen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Kunden `/rechnungen/kunden` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | COG-Export `/export` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Ideen & Saison `/marken` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Content-Plan `/marken/content` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Shop-Analyse `/marken/shop` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Uhren: Buy & Flip `/marken/uhren` | ✓ 2/2 Abläufe | – | – |
| Marken & Content | Uhren: Buy & Flip › Lernen `/marken/uhren/lernen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Uhren: Buy & Flip › Rechner `/marken/uhren/rechner` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Uhren: Buy & Flip › Deals `/marken/uhren/deals` | ✓ 2/2 Abläufe | 👁 behoben, behoben | – |
| Marken & Content | Uhren: Buy & Flip › Marktpreise `/marken/uhren/preise` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Markenprofile `/marken/profile` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Privat `/privat` | ✓ 3/3 Abläufe | – | 2 |
| Hilfsfunktionen | Wissen `/wissen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Hilfsfunktionen | Daten importieren `/import` | ✓ 1/1 Abläufe | – | – |
| Hilfsfunktionen | Einstellungen `/einstellungen` | ✓ 1/1 Abläufe | – | – |
| Hilfsfunktionen | Anbindungen `/anbindungen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Hilfsfunktionen | Claude & KI-Assistent `/einstellungen/claude` | ✓ 2/2 Abläufe | – | – |
| Hilfsfunktionen | eBay-Einstellungen `/ebay?ansicht=einstellungen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Übergreifend | Fragefeld | ✓ 2/2 Abläufe | 👁 behoben | – |
| Übergreifend | Server (Port, Adresse, Testumgebung) | – | 👁 befund | 2 |

## Je Reiter

Für **jede** Seite der Navigation gilt zusätzlich (Desktop und Handy): Seite öffnen (Inhaberin): Status mit Text, aktive Auswahl markiert, deaktivierte Knöpfe erkennbar, Kontrast ≥ 4,5:1, am Handy kein Querscrollen. Ergebnis: ✓ bestanden (desktop + handy).

### Heute › Tagesübersicht (`/`)

Funktionen noch nicht automatisch geprüft – nur Seite + Oberfläche.

- – Offen: Aufgaben anlegen, erledigen, verschieben
- – Offen: Tageskennzahlen

### Heute › Posteingang (`/posteingang`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| .eml-Datei hochladen | Rückmeldung, Dateiauswahl danach leer | ✓ bestanden (desktop) | `formulare.spec.ts` |

- – Offen: Mails abrufen (nur echte Postfächer)
- – Offen: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test

### Heute › Termine (`/kalender`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Geschäftskalender als Büro-Konto und als Inhaberin | keine privaten Einträge (Testwort PRIVATGEHEIM erscheint nicht) | ✓ bestanden (desktop) | `privat.spec.ts` |

### Verkauf & Versand › Aufträge & Versand (`/auftraege`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Labels kaufen und alle als versendet melden (Amazon, simuliert) | Versandbestätigung je Amazon-Auftrag an den Testdienst; eBay ohne Verbindung als Meldung | ✓ bestanden (desktop) | `labels.spec.ts` |
| Ansicht „Meldung offen“ | fehlgeschlagene Meldungen sichtbar | ✓ bestanden (desktop) | `labels.spec.ts` |

### Verkauf & Versand › Labels: Warensendung & DHL (`/auftraege/lieferschein`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Falsche Datei hochladen | Fehler; Datei und Haken bleiben; Kanal bei „Offene Aufträge“ bleibt | ✓ bestanden (desktop) | `formulare.spec.ts` |
| Vorschau mit lauter „bitte prüfen“ | Fehler; Auswahl je Bestellung bleibt | ✓ bestanden (desktop) | `formulare.spec.ts` |
| Gewichte pflegen | unklare Eingabe bleibt stehen, gültige Zeile zeigt gespeicherte Werte, neue Zeile leert sich | ✓ bestanden (desktop) | `formulare.spec.ts` |
| Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert) | 5 Labels, Kabel als DHL-Paket, keine echten Käufe | ✓ bestanden (desktop) | `labels.spec.ts` |

### Verkauf & Versand › Prep Center: Versand je Monat (`/auftraege/prep-center`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Zeitraum = Monat, Stand = letzter Bestellabruf, fehlende Gebühren als Text statt 0 | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |
| Frage im Fragefeld „Was kostet uns das Prep Center?“ | exakte Zahlen je Monat aus den Testdaten + Erklärung | ✓ bestanden (desktop) | `fragefeld.spec.ts` |

### Verkauf & Versand › Repricer (BQool) (`/repricer`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Produkte & Lager › Bestand & Inventur (`/bestand`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl, keine kaputten Werte | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |
| Inventur scannen | bucht +1, Feld leert sich für den nächsten Scan | ✓ bestanden (desktop) | `formulare.spec.ts` |

### Produkte & Lager › FBA-Inbound (`/inbound`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| FBA-Sendung scannen | unbekannter Code → Fehler; gültiger Code bucht; Karton-Auswahl bleibt | ✓ bestanden (desktop) | `formulare.spec.ts` |

### Produkte & Lager › Paletten-Lager › Sendungen (`/paletten/sendungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen | Meldung im System + Mail (abgefangen), Kunden sieht nur Freigegebenes, Links verfallen | ✓ bestanden (desktop) | `sendungen.spec.ts` |
| Notiz über Claude bzw. Fragefeld | nur mit Recht; Mitarbeiter als Vorschlag mit Ausführen/Ablehnen | ✓ bestanden (desktop) | `rechte.spec.ts` |

### Service & Ansprüche › Ansprüche (`/ansprueche`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Gewinn (`/gewinn`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Zeitraum, Quelle, Stand; keine kaputten Werte | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Cash Flow (`/cashflow`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Schätzungen mit „≈“, „keine Daten“ statt 0 | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Hebel: Umsatz & Marge (`/hebel`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | geschätzte Werte gekennzeichnet | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Eingangsrechnungen (`/rechnungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Rechnung hochladen, Sammelbearbeitung | Upload leert nach Erfolg; Auswahl bleibt bei Fehlschlag; Rückfrage abgelehnt = nichts passiert | ✓ bestanden (desktop) | `formulare.spec.ts` |

### Marken & Content › Uhren: Buy & Flip (`/marken/uhren`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | nur echte Deals, Herkunft angegeben | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |
| Übungs-Deal | zählt nicht unter „Verworfen“ und nicht in den Kennzahlen | ✓ bestanden (desktop + handy) | `uebungsdaten.spec.ts` |

### Marken & Content › Uhren: Buy & Flip › Deals (`/marken/uhren/deals`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Pflichtfeld-Fehler → Eingaben bleiben → speichern → neu laden → Status ändern → nochmals speichern | Status bleibt (Handy und Desktop) | ✓ bestanden (desktop + handy) | `formulare.spec.ts` |
| Filter und Schalter „Übungs-Deals zeigen“ | Übung standardmäßig ausgeblendet, Schalter blendet ein | ✓ bestanden (desktop + handy) | `uebungsdaten.spec.ts` |

- 👁 Live (vor dem 28.10.2026, Prüfung mit ChatGPT): Uhren-Deal bearbeiten – Eingaben/Status gingen verloren – behoben, seither automatisch geprüft
- 👁 Live (vor dem 28.10.2026, Prüfung mit ChatGPT): Übungs-Deal – zählte unter „Verworfen“ – behoben, seither automatisch geprüft

### Privat › Privat (`/privat`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen | Ausnahme bleibt bei Serienänderung erhalten; nur die gewählten Termine ändern/verschwinden | ✓ bestanden (desktop + handy) | `privat.spec.ts` |
| Abendritual als Abfolge „zweimal Streicheln, danach Massage“ | die nächsten Abende im Voraus: S, S, M, S, S, M | ✓ bestanden (desktop) | `privat.spec.ts` |
| Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe | nichts Privates sichtbar; nur mit Privat-Freigabe der Inhaberin im Konnektor | ✓ bestanden (desktop) | `privat.spec.ts` |

- – Offen: Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests
- – Offen: Live nie prüfen (echte private Daten)

### Hilfsfunktionen › Daten importieren (`/import`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Unbekannte Datei importieren | Fehler, Datei bleibt ausgewählt | ✓ bestanden (desktop) | `formulare.spec.ts` |

### Hilfsfunktionen › Einstellungen (`/einstellungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Testumgebung: Banner, Sperre nach außen, Übersicht | Banner auf jeder Seite, Verbindungen nach außen gesperrt, Mails abgefangen | ✓ bestanden (desktop + handy) | `testumgebung.spec.ts` |

### Hilfsfunktionen › Claude & KI-Assistent (`/einstellungen/claude`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten | nicht angebotene Werkzeuge abgewiesen und protokolliert; Änderungen nur als Vorschlag | ✓ bestanden (desktop) | `rechte.spec.ts` |
| Jedes lesende Werkzeug einzeln | Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten | ✓ bestanden (desktop) | `werkzeuge.spec.ts` |

### Übergreifend › Fragefeld

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Altes Gespräch nach Update fortsetzen | kein 400, alter Denk-Schritt verworfen | ✓ bestanden (desktop) | `fragefeld.spec.ts` |
| Privates im Kalender-Werkzeug | nie (auch nicht für die Inhaberin) | ✓ bestanden (desktop) | `privat.spec.ts` |

- 👁 Live (vor dem 28.10.2026, Nutzung im Betrieb): Altes Gespräch fortsetzen – 400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft

### Übergreifend › Server (Port, Adresse, Testumgebung)

- 👁 Live (vor dem 28.10.2026, Prüfung mit ChatGPT): Erreichbarkeit – Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen
- – Offen: `deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)
- – Offen: `deploy/testumgebung.sh an` + `pruefen` auf dem Server

## Getrennt: automatisch · live · noch nicht geprüft

**Automatisch** (34 Abläufe + Oberfläche auf 66 Seiten): 34 bestanden, 0 fehlgeschlagen, 0 nicht gelaufen.

**Live geprüft:**

- Uhren: Buy & Flip › Deals: Uhren-Deal bearbeiten (vor dem 28.10.2026, Prüfung mit ChatGPT) – Eingaben/Status gingen verloren – behoben, seither automatisch geprüft
- Uhren: Buy & Flip › Deals: Übungs-Deal (vor dem 28.10.2026, Prüfung mit ChatGPT) – zählte unter „Verworfen“ – behoben, seither automatisch geprüft
- Fragefeld: Altes Gespräch fortsetzen (vor dem 28.10.2026, Nutzung im Betrieb) – 400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft
- Server (Port, Adresse, Testumgebung): Erreichbarkeit (vor dem 28.10.2026, Prüfung mit ChatGPT) – Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen

**Noch nicht geprüft** (Funktionen ohne Ablaufprüfung, 46 Reiter – die Seiten selbst laufen in der Oberflächen-Prüfung mit):

Tagesübersicht (`/`) · Alle Aufgaben (`/?ansicht=liste`) · Angebote (alle Kanäle) (`/listings`) · Neues eBay-Angebot (`/ebay`) · eBay-Angebote prüfen (`/ebay/pruefen`) · eBay-Artikel & Gewinn (`/ebay?ansicht=artikel`) · eBay-Verlauf (`/ebay?ansicht=verlauf`) · eBay → Temu / Wawi (`/listings/temu`) · Amazon-ToDos (`/amazon-todos`) · Amazon SAS-Programm (`/sas`) · Produkte (`/produkte`) · Chargen (`/chargen`) · Artikelstamm (eigene Marken) (`/artikel`) · Paletten-Lager (`/paletten`) · Paletten-Lager › Lagerplan (`/paletten/lagerplan`) · Paletten-Lager › Abholung (`/paletten/abholung`) · Paletten-Lager › Inventur (`/paletten/inventur`) · Paletten-Lager › Abrechnung (`/paletten/abrechnung`) · Paletten-Lager › Kunden & Preise (`/paletten/kunden`) · Paletten-Lager › Auswertung (`/paletten/uebersicht`) · Einkauf & Wareneingang (`/einkauf`) · Dropship-Trackings (`/einkauf/beschaffungsanalyse`) · Lieferanten-Feeds (`/lieferanten`) · Lieferanten-Abfrage (`/lieferanten/abfrage`) · Chancen (`/lieferanten/chancen`) · Großhändler finden (`/lieferanten/finden`) · Kontakt-Board (`/board`) · Retouren (`/retouren`) · Remissionen (`/remissionen`) · Fälle & A-bis-Z (`/faelle`) · Bewertungen (`/bewertungen`) · Belege scannen (`/rechnungen/belege`) · Ausgangsrechnungen (`/rechnungen/ausgang`) · eBay-Rechnungen (`/ebay?ansicht=rechnungen`) · Kunden (`/rechnungen/kunden`) · COG-Export (`/export`) · Ideen & Saison (`/marken`) · Content-Plan (`/marken/content`) · Shop-Analyse (`/marken/shop`) · Uhren: Buy & Flip › Lernen (`/marken/uhren/lernen`) · Uhren: Buy & Flip › Rechner (`/marken/uhren/rechner`) · Uhren: Buy & Flip › Marktpreise (`/marken/uhren/preise`) · Markenprofile (`/marken/profile`) · Wissen (`/wissen`) · Anbindungen (`/anbindungen`) · eBay-Einstellungen (`/ebay?ansicht=einstellungen`)

**Bekannte offene Punkte:**

- Tagesübersicht: Aufgaben anlegen, erledigen, verschieben
- Tagesübersicht: Tageskennzahlen
- Posteingang: Mails abrufen (nur echte Postfächer)
- Posteingang: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test
- Privat: Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests
- Privat: Live nie prüfen (echte private Daten)
- Server (Port, Adresse, Testumgebung): `deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)
- Server (Port, Adresse, Testumgebung): `deploy/testumgebung.sh an` + `pruefen` auf dem Server
