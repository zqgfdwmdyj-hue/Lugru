# Prüfstand je Reiter

Letzter Lauf der Ablaufprüfungen: **29.10.2026, 20:34** · 67 bestanden · 0 fehlgeschlagen · 0 erst im zweiten Versuch · Dauer 207 s. Testumgebung mit erfundenen Daten, keine echten Dienste.

Erzeugt mit `npm run pruefstand` aus `e2e/pruefstand.ts` (Abläufe, Live-Prüfungen) und dem letzten Lauf. Nicht von Hand bearbeiten.

Zeichen: ✓ automatisch bestanden · ✕ automatisch fehlgeschlagen · ○ im letzten Lauf nicht gelaufen · 👁 live geprüft · – noch nicht geprüft

## Übersicht

| Bereich | Reiter | Automatisch | Live | Noch offen |
|---|---|---|---|---|
| Heute | Tagesübersicht `/` | ✓ nur Oberfläche | – | 2 |
| Heute | Alle Aufgaben `/?ansicht=liste` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Posteingang `/posteingang` | ✓ 2/2 Abläufe | – | 3 |
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
| Verkauf & Versand | Consultant-Calls `/calls` | ✓ 2/2 Abläufe | – | 2 |
| Verkauf & Versand | Echtheits-Ordner `/echtheit` | ✓ 1/1 Abläufe | – | – |
| Verkauf & Versand | Amazon Business `/amazon-business` | ✓ 2/2 Abläufe | – | 1 |
| Verkauf & Versand | Repricer (BQool) `/repricer` | ✓ 2/2 Abläufe | – | 1 |
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
| Einkauf & Lieferanten | B2B-Deals `/b2b` | ✓ 4/4 Abläufe | – | 5 |
| Einkauf & Lieferanten | Kontakt-Board `/board` | ✓ 1/1 Abläufe | – | – |
| Service & Ansprüche | Retouren `/retouren` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Ansprüche `/ansprueche` | ✓ 2/2 Abläufe | – | – |
| Service & Ansprüche | Remissionen `/remissionen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Retouren-Station & Fälle `/remissionen/pruefungen` | ✓ 3/3 Abläufe | – | 3 |
| Service & Ansprüche | Fälle & A-bis-Z `/faelle` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Service & Ansprüche | Bewertungen `/bewertungen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Gewinn `/gewinn` | ✓ 1/1 Abläufe | – | – |
| Finanzen | Liquidität `/cashflow` | ✓ 2/2 Abläufe | – | – |
| Finanzen | Hebel: Umsatz & Marge `/hebel` | ✓ 1/1 Abläufe | – | – |
| Finanzen | Kapital-Ampel `/kapital` | ✓ 2/2 Abläufe | – | – |
| Finanzen | Verlust-Stopp `/verlust` | ✓ 2/2 Abläufe | – | 1 |
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
| Hilfsfunktionen | Claude & KI-Assistent `/einstellungen/claude` | ✓ 8/8 Abläufe | – | 2 |
| Hilfsfunktionen | eBay-Einstellungen `/ebay?ansicht=einstellungen` | ✓ nur Oberfläche | – | Funktionen ungeprüft |
| Übergreifend | /kalender/zeiten `/kalender/zeiten` | ✓ 1/1 Abläufe | – | – |
| Übergreifend | /privat/familienaufgaben `/privat/familienaufgaben` | ✓ 1/1 Abläufe | – | – |
| Übergreifend | /privat/geld `/privat/geld` | ✓ 1/1 Abläufe | – | – |
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
| Antwort-Entwurf (über Claude) prüfen und senden | Entwurf an der Mail; ohne Häkchen „Geprüft“ wird nicht gesendet; mit Häkchen landet die Mail in den Test-Mails und der Entwurf ist als gesendet markiert | ✓ bestanden (desktop) | `geschaeft.spec.ts` |

- – Offen: Mails abrufen (nur echte Postfächer)
- – Offen: Entwurf echt senden (nur mit echtem Postfach)
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

### Verkauf & Versand › Consultant-Calls (`/calls`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Google-Doc importieren → KI-Punkte → übernehmen → Aufgabe mit Link; Offene Punkte; Discord-Kanal | 4 Punkte, Aufgabe (amazon) mit Frist, Fragen/Consultant-Punkte offen, Zusammenfassung mit Teilnehmern, 1 neuer Call aus Discord | ✓ bestanden (desktop) | `teil2.spec.ts` |
| Umzug aus dem bisherigen Call-Archiv: Export (JSON) hochladen, zweimal | Call mit Zusammenfassung und Google-Doc-Link, 3 Vorschläge; zweiter Import: „1 waren schon da“ | ✓ bestanden (desktop) | `teil2.spec.ts` |

- – Offen: Echter Discord-Bot im Call-Kanal (Bot-Token, Kanal-ID) und Freigabe der Google Docs
- – Offen: Export des bisherigen Call-Archivs auf dem Server hochladen (echte Daten, nicht im Repo)

### Verkauf & Versand › Echtheits-Ordner (`/echtheit`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket | Beleg + SKU im Ordner, ZIP (PK…) | ✓ bestanden (desktop) | `teil2.spec.ts` |

### Verkauf & Versand › Amazon Business (`/amazon-business`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Geschäftsbericht (CSV) hochladen, Staffelpreis-Vorschlag übernehmen, Freigabe, Upload-Datei | B2B-Werte je ASIN, Status freigegeben, Datei mit business-price | ✓ bestanden (desktop) | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

- – Offen: Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen

### Verkauf & Versand › Repricer (BQool) (`/repricer`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |
| BQool-Export „Manage Listings“ hochladen | Rückmeldung mit Anzahl je Marktplatz, Auffälligkeiten (ohne Min, pausiert, ohne Regel) in der Tabelle und im Werkzeug „repricer“ | ✓ bestanden (desktop) | `geschaeft.spec.ts` |

- – Offen: Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen

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

### Einkauf & Lieferanten › B2B-Deals (`/b2b`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Deal anlegen, Prognose je Land, Rechenhilfe, Freischalten nur mit Vertriebsfreigabe, Discord | Prognose DE/FR/IT/ES (Keepa) und NL (Amazon live); Warnung bei negativem Verdienst; ohne Freigabe des Lieferanten kein Freischalten; Discord „neu“, „fast weg“, „geschlossen“ | ✓ bestanden (desktop) | `b2b-deals.spec.ts`, `b2b-deals.spec.ts` |
| Abnahme: 1 Deal, 3 Kunden, 1 Fehlmenge | VIES → Reverse Charge nur FR; Mengengrenzen im Portal; Vorkasse-Rechnungen (Lexoffice), Zahlungsabgleich, Bestellung Entwurf → Freigabe → Senden nur mit Haken; Wareneingang 54/60 → anteilig 18/27/9, 3 Gutschriften, Reklamation; Export CSV/XLSX/PDF; verteilt → erledigt | ✓ bestanden (desktop) | `b2b-deals.spec.ts` |
| Kundenportal getrennt | eigene Anmeldung (Einladungs-Link, einmalig); nur eigene Reservierungen und Belege; kein Zugang ins Seller-System, Mitarbeiter-Anmeldung gilt im Portal nicht | ✓ bestanden (desktop) | `b2b-deals.spec.ts`, `b2b-deals.spec.ts` |
| Preislisten je Land, Lieferanten-Mail, Claude-Werkzeuge, Erfolgskontrolle | KI ordnet unklare Spalten zu; Ampel/Filter/Export; Deal aus Zeile; Mail-Anhang wird übernommen (Aufgabe); deal_anlegen/preis/freischalten protokolliert, Kunden ohne Kontaktdaten; Kontrolle 30/60 Tage je Land | ✓ bestanden (desktop) | `b2b-preislisten.spec.ts`, `b2b-preislisten.spec.ts`, `b2b-preislisten.spec.ts`, `b2b-preislisten.spec.ts` |

- – Offen: Echte Lexoffice-Anbindung mit dem Schlüssel der Deal-Firma (Rechnungsnummern, Reverse-Charge-Text, PDF)
- – Offen: Echter VIES-Abruf mit eigener USt-IdNr. (Kennung der qualifizierten Abfrage)
- – Offen: Discord-Webhook im echten B2B-Kanal
- – Offen: PrepTool (preptool.de): API-Anbindung folgt, sobald Instanz-Adresse und OpenAPI-Datei vorliegen – bis dahin Export neutral (CSV/XLSX/PDF)
- – Offen: Steuer: Reverse Charge nur, wenn die Ware Deutschland verlässt – bei FBA-Versand in DE mit dem Steuerberater klären

### Einkauf & Lieferanten › Kontakt-Board (`/board`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Aufgabe zuweisen hängt passende Anleitung an; zugewiesene Person sieht sie | 📘-Link auf der Karte, auch bei der Assistenz | ✓ bestanden (desktop) | `teil2.spec.ts` |

### Service & Ansprüche › Ansprüche (`/ansprueche`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |
| Als eingereicht markieren (über Claude) | nur mit Freigabe „ändern“; Status, Fallnummer, Zeitpunkt und Protokolleintrag „über Claude“; zweiter Aufruf ändert nichts Falsches | ✓ bestanden (desktop) | `geschaeft.spec.ts` |

### Service & Ansprüche › Retouren-Station & Fälle (`/remissionen/pruefungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Retouren-Station: Paket mit 4 Artikeln ohne Tastatur/Maus (Sprache + Handscanner) | Remission über Etikett, Lieferschein-Abgleich, LPN → Kundenretoure; Fall nur ab Schwelle und wenn Amazon nicht gezahlt hat; KI-Warnung bei Abweichung; Netz weg → Warteschlange; Video je Paket | ✓ bestanden (desktop) | `retouren-station.spec.ts` |
| Fall-Paket und Eingereicht | Text DE/EN, Fotos 1_Versandetikett … 4_Inhalt in fester Reihenfolge, ZIP, Anspruch mit Betrag/Frist, Fallnummer + Eingereicht im Verlauf; RET-SKU mit EK der Charge | ✓ bestanden (desktop) | `retouren-station.spec.ts` |
| Rechte der Station | ohne Bereich Amazon kein Zugriff auf Station, Schnittstelle und Fotos | ✓ bestanden (desktop) | `retouren-station.spec.ts` |

- – Offen: Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell
- – Offen: Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen
- – Offen: Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen

### Finanzen › Gewinn (`/gewinn`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Zeitraum, Quelle, Stand; keine kaputten Werte | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Liquidität (`/cashflow`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Schätzungen mit „≈“, „keine Daten“ statt 0 | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |
| Kontoauszug einlesen, Amex erkannt, großer Einkauf in der Amex-Woche | Woche „unter Reserve“, Was-wäre-wenn meldet Unterschreitung | ✓ bestanden (desktop) | `teil2.spec.ts` |

### Finanzen › Hebel: Umsatz & Marge (`/hebel`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | geschätzte Werte gekennzeichnet | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Kapital-Ampel (`/kapital`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Ladenhüter (Reichweite > 120 T) wird rot mit Vorschlägen | Ampel rot, „Nicht nachbestellen“ | ✓ bestanden (desktop) | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

### Finanzen › Verlust-Stopp (`/verlust`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| 2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar | Aufgabe „verlust-<SKU>“ offen/wichtig bzw. nicht mehr offen | ✓ bestanden (desktop) | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ✓ bestanden (desktop) | `kennzahlen.spec.ts` |

- – Offen: Echte sellerboard-Tageswerte je Produkt (kommen mit dem täglichen Komplett-Abgleich)

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
| Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag) | Zahlen aus dem Keepa-Nachbau, zweiter Aufruf aus dem Zwischenspeicher (keine neue Keepa-Abfrage), unbekannte ASIN klar benannt | ✓ bestanden (desktop) | `keepa.spec.ts` |
| Keepa: Länder vergleichen | DE/FR/IT/ES/UK nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als „nicht bei Keepa“ | ✓ bestanden (desktop) | `keepa.spec.ts` |
| Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon) | Lager-Konto bekommt sie nicht, direkter Aufruf abgewiesen | ✓ bestanden (desktop) | `keepa.spec.ts` |
| Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live | Berichte unter Anbindungen anfordern/abholen; Werte aus dem Amazon-Nachbau je Land; Angebote live mit 10-Min.-Zwischenspeicher; unbekannte ASIN als Fehler je Land | ✓ bestanden (desktop) | `geschaeft.spec.ts` |
| Neue Werkzeuge ohne Neustart (notifications/tools/list_changed) | Ereignis-Kanal meldet beim Verbinden „tools/list_changed“ | ✓ bestanden (desktop) | `retouren-station.spec.ts` |
| Rechte der neuen Werkzeuge im Fragefeld | Büro: Posteingang, Repricer, Angebote live (über Wawi → Lieferanten); keine Buy Box, Listung, Lageralter, Ansprüche, Anbindungen | ✓ bestanden (desktop) | `geschaeft.spec.ts` |

- – Offen: Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)
- – Offen: getItemOffers-Ratenlimit im Betrieb beobachten

### Übergreifend › /kalender/zeiten (`/kalender/zeiten`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Freier Tag → Aufgabe wandert auf den nächsten Arbeitstag; Wochenrückblick | Fälligkeit verschoben, Rückblick sichtbar | ✓ bestanden (desktop) | `teil2.spec.ts` |

### Übergreifend › /privat/familienaufgaben (`/privat/familienaufgaben`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Familien-Zugang: Aufgabe anlegen, Fairness aus; kein Geld/Tagebuch/Geschäft | nur Familienliste + Familienkalender | ✓ bestanden (desktop) | `teil2.spec.ts` |

### Übergreifend › /privat/geld (`/privat/geld`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Frage für den Steuerberater, nur für die eigene Person | Hinweis „keine Steuerberatung“, Familien-Zugang gesperrt | ✓ bestanden (desktop) | `teil2.spec.ts` |

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

**Automatisch** (64 Abläufe + Oberfläche auf 76 Seiten): 64 bestanden, 0 fehlgeschlagen, 0 nicht gelaufen.

**Live geprüft:**

- Uhren: Buy & Flip › Deals: Uhren-Deal bearbeiten (vor dem 28.10.2026, Prüfung mit ChatGPT) – Eingaben/Status gingen verloren – behoben, seither automatisch geprüft
- Uhren: Buy & Flip › Deals: Übungs-Deal (vor dem 28.10.2026, Prüfung mit ChatGPT) – zählte unter „Verworfen“ – behoben, seither automatisch geprüft
- Fragefeld: Altes Gespräch fortsetzen (vor dem 28.10.2026, Nutzung im Betrieb) – 400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft
- Server (Port, Adresse, Testumgebung): Erreichbarkeit (vor dem 28.10.2026, Prüfung mit ChatGPT) – Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen

**Noch nicht geprüft** (Funktionen ohne Ablaufprüfung, 45 Reiter – die Seiten selbst laufen in der Oberflächen-Prüfung mit):

Tagesübersicht (`/`) · Alle Aufgaben (`/?ansicht=liste`) · Angebote (alle Kanäle) (`/listings`) · Neues eBay-Angebot (`/ebay`) · eBay-Angebote prüfen (`/ebay/pruefen`) · eBay-Artikel & Gewinn (`/ebay?ansicht=artikel`) · eBay-Verlauf (`/ebay?ansicht=verlauf`) · eBay → Temu / Wawi (`/listings/temu`) · Amazon-ToDos (`/amazon-todos`) · Amazon SAS-Programm (`/sas`) · Produkte (`/produkte`) · Chargen (`/chargen`) · Artikelstamm (eigene Marken) (`/artikel`) · Paletten-Lager (`/paletten`) · Paletten-Lager › Lagerplan (`/paletten/lagerplan`) · Paletten-Lager › Abholung (`/paletten/abholung`) · Paletten-Lager › Inventur (`/paletten/inventur`) · Paletten-Lager › Abrechnung (`/paletten/abrechnung`) · Paletten-Lager › Kunden & Preise (`/paletten/kunden`) · Paletten-Lager › Auswertung (`/paletten/uebersicht`) · Einkauf & Wareneingang (`/einkauf`) · Dropship-Trackings (`/einkauf/beschaffungsanalyse`) · Lieferanten-Feeds (`/lieferanten`) · Lieferanten-Abfrage (`/lieferanten/abfrage`) · Chancen (`/lieferanten/chancen`) · Großhändler finden (`/lieferanten/finden`) · Retouren (`/retouren`) · Remissionen (`/remissionen`) · Fälle & A-bis-Z (`/faelle`) · Bewertungen (`/bewertungen`) · Belege scannen (`/rechnungen/belege`) · Ausgangsrechnungen (`/rechnungen/ausgang`) · eBay-Rechnungen (`/ebay?ansicht=rechnungen`) · Kunden (`/rechnungen/kunden`) · COG-Export (`/export`) · Ideen & Saison (`/marken`) · Content-Plan (`/marken/content`) · Shop-Analyse (`/marken/shop`) · Uhren: Buy & Flip › Lernen (`/marken/uhren/lernen`) · Uhren: Buy & Flip › Rechner (`/marken/uhren/rechner`) · Uhren: Buy & Flip › Marktpreise (`/marken/uhren/preise`) · Markenprofile (`/marken/profile`) · Wissen (`/wissen`) · Anbindungen (`/anbindungen`) · eBay-Einstellungen (`/ebay?ansicht=einstellungen`)

**Bekannte offene Punkte:**

- Tagesübersicht: Aufgaben anlegen, erledigen, verschieben
- Tagesübersicht: Tageskennzahlen
- Posteingang: Mails abrufen (nur echte Postfächer)
- Posteingang: Entwurf echt senden (nur mit echtem Postfach)
- Posteingang: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test
- Consultant-Calls: Echter Discord-Bot im Call-Kanal (Bot-Token, Kanal-ID) und Freigabe der Google Docs
- Consultant-Calls: Export des bisherigen Call-Archivs auf dem Server hochladen (echte Daten, nicht im Repo)
- Amazon Business: Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen
- Repricer (BQool): Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen
- B2B-Deals: Echte Lexoffice-Anbindung mit dem Schlüssel der Deal-Firma (Rechnungsnummern, Reverse-Charge-Text, PDF)
- B2B-Deals: Echter VIES-Abruf mit eigener USt-IdNr. (Kennung der qualifizierten Abfrage)
- B2B-Deals: Discord-Webhook im echten B2B-Kanal
- B2B-Deals: PrepTool (preptool.de): API-Anbindung folgt, sobald Instanz-Adresse und OpenAPI-Datei vorliegen – bis dahin Export neutral (CSV/XLSX/PDF)
- B2B-Deals: Steuer: Reverse Charge nur, wenn die Ware Deutschland verlässt – bei FBA-Versand in DE mit dem Steuerberater klären
- Retouren-Station & Fälle: Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell
- Retouren-Station & Fälle: Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen
- Retouren-Station & Fälle: Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen
- Verlust-Stopp: Echte sellerboard-Tageswerte je Produkt (kommen mit dem täglichen Komplett-Abgleich)
- Privat: Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests
- Privat: Live nie prüfen (echte private Daten)
- Claude & KI-Assistent: Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)
- Claude & KI-Assistent: getItemOffers-Ratenlimit im Betrieb beobachten
- Server (Port, Adresse, Testumgebung): `deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)
- Server (Port, Adresse, Testumgebung): `deploy/testumgebung.sh an` + `pruefen` auf dem Server

## Prüfungen ohne Zuordnung zu einem Reiter

- kennzahlen.spec.ts › Finanzen, WaWi, Amazon – Kennzahlen › Offene Punkte Consultant: jede Kennzahl mit Herkunft, keine kaputten Werte – bitte in e2e/pruefstand.ts eintragen
- teil2.spec.ts › Teil 2 – Familie & Zugänge › Assistenz (Büro) sieht keine Finanz- oder Privatdaten – bitte in e2e/pruefstand.ts eintragen
