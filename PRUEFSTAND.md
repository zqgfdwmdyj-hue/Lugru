# Prüfstand je Reiter

Noch kein Lauf gefunden (test-results/ergebnis.json fehlt) – erst `npm run e2e` ausführen.

Erzeugt mit `npm run pruefstand` aus `e2e/pruefstand.ts` (Abläufe, Live-Prüfungen) und dem letzten Lauf. Nicht von Hand bearbeiten.

Zeichen: ✓ automatisch bestanden · ✕ automatisch fehlgeschlagen · ○ im letzten Lauf nicht gelaufen · 👁 live geprüft · – noch nicht geprüft

## Übersicht

| Bereich | Reiter | Automatisch | Live | Noch offen |
|---|---|---|---|---|
| Heute | Tagesübersicht `/` | ○ 0/3 Abläufe | – | 2 |
| Heute | Tagesplan (Anrufe) `/kalender/tagesplan` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Termine `/kalender` | ○ 0/2 Abläufe | – | – |
| Heute | Posteingang `/posteingang` | ○ 0/5 Abläufe | – | 4 |
| Heute | Uploads `/uploads` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Schnellerfassung `/schnell` | ○ 0/2 Abläufe | – | 3 |
| Heute | Feierabend `/kalender/feierabend` | ○ 0/2 Abläufe | – | – |
| Heute | Fahrtenbuch `/kalender/fahrten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals | Deal-Eingang `/deal-eingang` | ○ 0/6 Abläufe | – | 4 |
| Einkauf & Deals | Lugru Deals `/deal-eingang/lugru` | ○ 0/1 Abläufe | – | – |
| Einkauf & Deals | Deal-Ampel `/lieferanten/deal-ampel` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals | Scanner `/scan` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals | Bestellvorschläge `/einkauf/vorschlaege` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals | Einkauf & Wareneingang `/einkauf` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals | EK-Import (→ sellerboard) `/einkauf/ek-import` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals | Dropship-Trackings `/einkauf/beschaffungsanalyse` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals › Lieferanten | Feeds `/lieferanten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals › Lieferanten | Abfrage `/lieferanten/abfrage` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals › Lieferanten | Chancen `/lieferanten/chancen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals › Lieferanten | Großhändler finden `/lieferanten/finden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf & Deals › Lieferanten | Kontakt-Board `/board` | ○ 0/1 Abläufe | – | – |
| Amazon › Fälle & Erstattungen | Fall-Zentrale `/amazon-faelle` | ○ 0/3 Abläufe | – | 2 |
| Amazon › Fälle & Erstattungen | Amazon-ToDos `/amazon-todos` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon › Fälle & Erstattungen | Ansprüche `/ansprueche` | ○ 0/2 Abläufe | – | – |
| Amazon › Fälle & Erstattungen | Fälle & A-bis-Z `/faelle` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon › Fälle & Erstattungen | Echtheits-Ordner `/echtheit` | ○ 0/1 Abläufe | – | – |
| Amazon › Angebote & Lager | Repricer (BQool) `/repricer` | ○ 0/4 Abläufe | – | 1 |
| Amazon › Angebote & Lager | Repricer (BQool) › Leistung `/repricer/leistung` | ○ 0/2 Abläufe | – | 2 |
| Amazon › Angebote & Lager | Repricer (BQool) › BQool-Dateien `/repricer/bqool` | ○ 0/2 Abläufe | – | 2 |
| Amazon › Angebote & Lager | Listungen (alle Kanäle) `/listings` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon › Angebote & Lager | FBA-Inbound `/inbound` | ○ 0/1 Abläufe | – | – |
| Amazon › Angebote & Lager | SAS-Programm `/sas` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon › Angebote & Lager | Bewertungen `/bewertungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon › Angebote & Lager | Amazon Business `/amazon-business` | ○ 0/2 Abläufe | – | 1 |
| eBay & Temu | eBay `/ebay` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| eBay & Temu | Angebote prüfen `/ebay/pruefen` | ○ 0/1 Abläufe | – | – |
| eBay & Temu | Temu / Wawi `/listings/temu` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Bestand & Inventur `/bestand` | ○ 0/3 Abläufe | – | – |
| Lager & Versand › Lager | Produkte `/produkte` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Artikelstamm `/artikel` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Chargen `/chargen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Paletten-Lager `/paletten` | ○ 0/1 Abläufe | – | – |
| Lager & Versand › Lager | Paletten-Lager › Sendungen `/paletten/sendungen` | ○ 0/2 Abläufe | – | – |
| Lager & Versand › Lager | Paletten-Lager › Lagerplan `/paletten/lagerplan` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Paletten-Lager › Abholung `/paletten/abholung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Paletten-Lager › Inventur `/paletten/inventur` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Paletten-Lager › Abrechnung `/paletten/abrechnung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Paletten-Lager › Kunden & Preise `/paletten/kunden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Lager | Paletten-Lager › Auswertung `/paletten/uebersicht` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Versand | Aufträge & Versand `/auftraege` | ○ 0/2 Abläufe | – | – |
| Lager & Versand › Versand | Labels: Warensendung & DHL `/auftraege/lieferschein` | ○ 0/4 Abläufe | – | – |
| Lager & Versand › Versand | Label aus Chat (DHL) `/versand/label` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Versand | Abholung DHL/UPS `/versand/abholung` | ○ 0/3 Abläufe | – | 2 |
| Lager & Versand › Versand | Prep Center: Versand je Monat `/auftraege/prep-center` | ○ 0/2 Abläufe | – | – |
| Lager & Versand › Retouren | Retouren-Station & Fälle `/remissionen/pruefungen` | ○ 0/3 Abläufe | – | 3 |
| Lager & Versand › Retouren | Retouren `/retouren` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Lager & Versand › Retouren | Remissionen `/remissionen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Gewinn `/gewinn` | ○ 0/3 Abläufe | – | 1 |
| Finanzen | Liquidität `/cashflow` | ○ 0/2 Abläufe | – | – |
| Finanzen | Kapital-Ampel `/kapital` | ○ 0/4 Abläufe | – | – |
| Finanzen | Hebel: Umsatz & Marge `/hebel` | ○ 0/1 Abläufe | – | – |
| Finanzen | Verlust-Stopp `/verlust` | ○ 0/2 Abläufe | – | 1 |
| Finanzen | Buchhaltung (Abgleich, DATEV) `/buchhaltung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Importe `/import` | ○ 0/2 Abläufe | – | – |
| Finanzen | COG-Export `/export` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen › Rechnungen | Eingangsrechnungen `/rechnungen` | ○ 0/1 Abläufe | – | – |
| Finanzen › Rechnungen | Belege scannen `/rechnungen/belege` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen › Rechnungen | Rechnungsstation (Kamera) `/rechnungsstation` | ○ 0/2 Abläufe | – | 3 |
| Finanzen › Rechnungen | Rechnungsstation: Prüfliste `/rechnungsstation/pruefen` | ○ 0/2 Abläufe | – | – |
| Finanzen › Rechnungen | Ausgangsrechnungen `/rechnungen/ausgang` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen › Rechnungen | Kunden `/rechnungen/kunden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| B2B | Deals `/b2b` | ○ 0/6 Abläufe | – | 5 |
| B2B | Preislisten je Land `/b2b/preislisten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| B2B | B2B-Kunden `/b2b/kunden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| B2B | Lieferanten-Freigaben `/b2b/lieferanten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| B2B | Bilanz `/b2b/bilanz` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Ideen & Saison `/marken` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Content-Plan `/marken/content` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Shop-Analyse `/marken/shop` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Markenprofile `/marken/profile` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Uhren: Buy & Flip `/marken/uhren` | ○ 0/2 Abläufe | – | – |
| Marken & Content | Uhren: Buy & Flip › Lernen `/marken/uhren/lernen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Uhren: Buy & Flip › Rechner `/marken/uhren/rechner` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Marken & Content | Uhren: Buy & Flip › Deals `/marken/uhren/deals` | ○ 0/2 Abläufe | 👁 behoben, behoben | – |
| Marken & Content | Uhren: Buy & Flip › Marktpreise `/marken/uhren/preise` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Team & Verwaltung | VA & Delegation `/delegation` | ○ 0/4 Abläufe | – | 1 |
| Team & Verwaltung | Wissen `/wissen` | ○ 0/2 Abläufe | – | – |
| Team & Verwaltung | Calls (Consultant & Gruppe) `/calls` | ○ 0/5 Abläufe | – | 3 |
| Team & Verwaltung | Rechtsfälle (Anwalt) `/rechtsfaelle` | ○ 0/1 Abläufe | – | 2 |
| Privat | Übersicht `/privat` | ○ 0/12 Abläufe | – | 2 |
| Privat | Kalender `/privat/kalender` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Eintragen `/privat/eintragen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Nachrichten `/privat/nachrichten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Rückblick `/privat/rueckblick` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Einstellungen `/privat/einstellungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen `/einstellungen` | ○ 0/4 Abläufe | – | – |
| Einstellungen | Einstellungen › Anbindungen `/anbindungen` | ○ 0/6 Abläufe | – | 3 |
| Einstellungen | Einstellungen › KI-Assistent `/einstellungen/claude` | ○ 0/8 Abläufe | – | 2 |
| Einstellungen | Einstellungen › Hintergrund & Importe `/einstellungen/hintergrund` | ○ 0/5 Abläufe | – | – |
| Einstellungen | Einstellungen › Geräte: Handy & Tesla `/einstellungen/handy` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen › Apple Watch `/einstellungen/watch` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen › Benachrichtigungen `/einstellungen/benachrichtigungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen › Shop-Profile `/einstellungen/shop-profile` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen › Abholung `/einstellungen/abholung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen › Testumgebung `/einstellungen/testumgebung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Übergreifend | /posteingang/verbinden `/posteingang/verbinden` | ○ 0/2 Abläufe | – | 1 |
| Übergreifend | /assistent-verlauf `/assistent-verlauf` | ○ 0/2 Abläufe | – | – |
| Übergreifend | /calls/offen `/calls/offen` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /kalender/zeiten `/kalender/zeiten` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /privat/familienaufgaben `/privat/familienaufgaben` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /deal-eingang/lernen `/deal-eingang/lernen` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /privat/therapie-bogen `/privat/therapie-bogen` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /privat/geld `/privat/geld` | ○ 0/1 Abläufe | – | – |
| Übergreifend | Fragefeld | ○ 0/2 Abläufe | 👁 behoben | – |
| Übergreifend | Server (Port, Adresse, Testumgebung) | – | 👁 befund | 2 |

## Je Reiter

Für **jede** Seite der Navigation gilt zusätzlich (Desktop und Handy): Seite öffnen (Inhaberin): Status mit Text, aktive Auswahl markiert, deaktivierte Knöpfe erkennbar, Kontrast ≥ 4,5:1, am Handy kein Querscrollen. Ergebnis: ○ im letzten Lauf nicht gelaufen.

### Heute › Tagesübersicht (`/`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B15.2 Privater Kalender auf der Startseite | nur „Privat belegt“ + Uhrzeit, nie Titel, Ort oder Betrag; Assistenz sieht nichts | ○ im letzten Lauf nicht gelaufen | `b15-sofort.spec.ts` |
| B15.1 FBM-Versandbestätigung offen | Alarm mit Frist, Datei für Seller Central, „Verkauft, jetzt liefern“ erst nach Bestätigung erledigt | ○ im letzten Lauf nicht gelaufen | `amazon-todos-versand.spec.ts` |
| B25.7 Paletten ohne Kunde unter „Jetzt dringend“ | Signal „N Paletten ohne Kunde – werden nicht abgerechnet“ mit Link auf den Filter | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

- – Offen: Aufgaben anlegen, erledigen, verschieben
- – Offen: Tageskennzahlen

### Heute › Termine (`/kalender`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Geschäftskalender als Büro-Konto und als Inhaberin | keine privaten Einträge (Testwort PRIVATGEHEIM erscheint nicht) | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
| B25.8 Tagesplan: Termin mit Ort, Anruf-Aufgabe mit Nummer | Fahrzeit-Block vor dem Termin (aus PLZ geschätzt, „Anrufe möglich“); 📞-Link mit tel: | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

### Heute › Posteingang (`/posteingang`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| .eml-Datei hochladen | Rückmeldung, Dateiauswahl danach leer | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Antwort-Entwurf (über Claude) prüfen und senden | Entwurf an der Mail; ohne Häkchen „Geprüft“ wird nicht gesendet; mit Häkchen landet die Mail in den Test-Mails und der Entwurf ist als gesendet markiert | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |
| Posteingang auf null: Regel an Zuständigen, Auto-Archiv, Zahlung abgelehnt (IT), Termin-Mail → Privatkalender, Vorschlag für Claude | Aufgabe für die Zuständige, Newsletter archiviert, Zahlung kritisch mit Aufgabe, Termin nur im Privatkalender (nie im Posteingang) | ○ im letzten Lauf nicht gelaufen | `posteingang-null.spec.ts` |
| B32.5 Antwort aus dem Mailprogramm (Gesendet-Ordner) auf eine Käuferfrage; neue B2B-Anfrage aus dem Mailprogramm | Mail „beantwortet (extern)“ mit Postfach/Name, Aufgabe erledigt, vorbereiteter Entwurf verworfen, Verlauf zeigt die Antwort; neue Anfrage unter „Ausgehend“ mit „Nachfassen in 3 Tagen“ → fällig = Aufgabe, Antwort des Kunden schließt sie | ○ im letzten Lauf nicht gelaufen | `persoenliche-mails.spec.ts` |
| Gerichts-/Behörden-Mail und Anwalts-Mails (B14) | Behörde: Entwurf an den Anwalt (nicht gesendet) + Aufgabe; Anwalt mit Aktenzeichen: in den Fall statt in den Posteingang | ○ im letzten Lauf nicht gelaufen | `recht-discord.spec.ts` |

- – Offen: Mails abrufen (nur echte Postfächer) – inkl. Gesendet-Ordner und Minuten-Abruf
- – Offen: Entwurf echt senden (nur mit echtem Postfach)
- – Offen: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test
- – Offen: Outlook: Zuordnung gesendeter Mails nur über Betreff + Empfänger (kein In-Reply-To aus Graph)

### Heute › Schnellerfassung (`/schnell`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Diktat per Handy-Schlüssel: Aufgabe, Eingangsliste, Privates nur mit Zugang, Widerruf | richtig eingeordnet, widerrufener Schlüssel → 401 | ○ im letzten Lauf nicht gelaufen | `schnell-familie.spec.ts` |
| Widget, Anrufe in der Fahrzeit, Briefing je Ziel, SMS-Codes, Ins Auto, Fahrtenbuch, Scan, Auto-Status/Klima | Werte mit Satz zum Vorlesen; „KAUFEN“ nur Entwurf; Navi-Ziel und Klima im (erfundenen) Auto; Fahrt als geschäftlich vorgeschlagen; Tesla-Schlüssel unter /.well-known | ○ im letzten Lauf nicht gelaufen | `handy-tesla.spec.ts` |

- – Offen: Echtes Handy (Kurzbefehle/Widget)
- – Offen: Echter Tesla (Fleet-API-App, virtueller Schlüssel, Befehls-Proxy)
- – Offen: Echte SMS über Twilio

### Heute › Feierabend (`/kalender/feierabend`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Feierabend: erledigt/offen, auf morgen schieben, morgen Top 3 | wichtige bleiben stehen | ○ im letzten Lauf nicht gelaufen | `herzstueck.spec.ts` |
| Wochenrückblick mit „Privates zeigen“ (B16) | Beobachtungen (Bogen-Format, „unvollständig“), Zuwendung je Art und Richtung, Gespräche, Danke, Stimmung, Dateideen, Aufgaben, Vorwochen-Vergleich; ohne Freigabe nichts Privates | ○ im letzten Lauf nicht gelaufen | `privat-rueckblick.spec.ts` |

### Einkauf & Deals › Deal-Eingang (`/deal-eingang`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B25.3 Schwelle „Lugru Deals=60“ | als gespeicherter Wert im Feld, nicht als Platzhalter | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |
| Text, Screenshot (3 Angebote), Kurzbefehl mit Geräte-Schlüssel, Kapital-Ampel rot, Preisliste (XLSX 500 Zeilen), Mail „Deal prüfen“, ProfitPath über Discord, Knöpfe Bestellvorschlag/B2B-Deal, Claude-Werkzeuge | Ampel je Angebot mit Gründen; Push ≤ 60 s nur bei Grün/Gelb (ProfitPath); widerrufener Schlüssel abgelehnt; gleiche ASIN/EK zusammengefasst, neuer EK = Update; Einkaufsentwurf und B2B-Entwurf angelegt | ○ im letzten Lauf nicht gelaufen | `deal-eingang.spec.ts` |
| Abschnitt 10/11: Lugru-Deals-History über den Endpunkt (mit/ohne Schlüssel, erneut senden), Budget-Grenze je Deal, geteilter Deal mit Shop-Link, „Gekauft: Menge, Preis“, Amazon-Bestellbestätigung als .eml, 👎 aus der Push-Meldung mit Grund, 👍 unter der ProfitPath-Nachricht in Discord, Wareneingang + 35 Tage mit sellerboard-Monat, Monatsbericht, Claude-Werkzeuge | History neu/aktualisiert/ungültig gezählt, ohne Schlüssel 401; Deal-Wert „Passt zu dir (X/100)“ mit ähnlichen Deals (Lugru-Gruppe); über Budget höchstens Gelb mit Budget-Grund; Push mit „Zum Angebot“ (Shop-Link) und „Gekauft …“; gekauft → Bestellung „bestellt“ + Aufgabe „Wareneingang buchen“; Mail → gekauft (Menge, Preis, Bestellnummer), Mail bleibt im Posteingang; 👍/👎 mit Weg gespeichert; Ergebnis nach 30 Tagen mit realem ROI; deal_wert/deal_lernen_bericht/deal_bewerten/deal_gekauft | ○ im letzten Lauf nicht gelaufen | `deal-wert.spec.ts` |
| Nachtrag B28: Deal-Quelle mit Lieferant anlegen, Testpfanne (Buy Box 79 €, früher 57,99 €, IT 1 Angebot), Ziel-VK DE 56 €, 👍 mit Grund „In einem Land kein Angebot“ + ähnlicher Deal neu prüfen, 👍 in Discord mit Rückfrage (Zahl-Reaktion + Text), Gekauft 84 × 25 € mit Bestellmail, Antwort mit Sendungsnummer als .eml, Claude-Werkzeuge | je Land Gewinn/Marge/ROI + max. EK Ziel-ROI/Ziel-Marge, Verk./Monat überall gefüllt (IT „geschätzt“), Seller-Central-Knopf; Szenario rechnet neu + „ca. n Verkäufe/Monat (Keepa „gekauft“)“; Deal-Wert des ähnlichen Deals steigt mit Grund-Text, Lernbericht zählt Gründe; Bot fragt im Thread, Grund + Freitext gespeichert; Entwurf an den Lieferanten, nichts gesendet vor „Senden“, danach Beleg am Deal und im Einkauf, Sendungsnummer + Rechnung zugeordnet; deal_gekauft legt nur Entwurf an | ○ im letzten Lauf nicht gelaufen | `deal-b28.spec.ts` |
| B28.6 Abnahme 6: Testpfanne ab 84 Stück, Mindest-ROI p. a. in den Einstellungen | Spalten „Umschlag“ (Spanne, geschätzt) und „ROI p. a.“ je Land, Hinweis „Umschlag … · ROI p. a. … (Ziel ≥ 100 %)“, Reichweiten-Warnung mit Menge für 45 Tage; deal_wert/deal_eingang_detail mit roi_pa_prozent und umschlag | ○ im letzten Lauf nicht gelaufen | `b28-umschlag.spec.ts` |
| Lücken aus dem Bauauftrag (Abschnitte 2, 4, 5, 7): weitere Einstellungen (ungültiger/gültiger iCloud-Link), Kurzbefehl-Skizzen, offene Rechteinhaber-Beschwerde zur ASIN, Lieferant ohne Marktplatz-Freigabe + Gefahrgut, Keepa-Mini-Chart, Screenshot im Original und fremde Datei | Einstellungen gespeichert, Budget/Ziel-ROI unverändert; Link + 4 Skizzen; Rot mit Fallnummer; Rot „selektiver Vertrieb“ + Gelb Gefahrgut als 2. Grund; Chart mit Ø/Tief/Stand; Bild 200 image/png, Datei über anderen Eingang 404 | ○ im letzten Lauf nicht gelaufen | `deal-eingang-luecken.spec.ts` |

- – Offen: B28: Bestellmail an echte Lieferanten (Zustellung, Message-ID-Erhalt je Postfach) und Discord-Rückfrage nach 👍 im echten ProfitPath-Kanal (Bot braucht dort „Nachrichten senden“, „Threads erstellen“, „Reaktionen hinzufügen“) – nur live
- – Offen: ProfitPath mit echtem Discord-Bot (Message Content Intent, Rechte „Kanal ansehen“ + „Nachrichtenverlauf lesen“) – nur live
- – Offen: Lugru Deals live: Programm auf den neuen Stand bringen, Seller-Adresse + Verbindungsschlüssel eintragen – die History kommt dann von selbst
- – Offen: Echte Bestellbestätigungen anderer Shops (Betreff/Format je Shop) – nur live

### Einkauf & Deals › Lugru Deals (`/deal-eingang/lugru`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Lugru Deals über Discord: History, Live-Post, Reaktion, doppelter Post, eigener Kauf, Statistik, deal_quellen, Deal-Wert | Live-Post im Deal-Eingang mit Ampel (Push nur Grün/Gelb), History mit Reaktionen, Statistik aktualisiert, „Lugru Deals“ in deal_quellen, keine Namen gespeichert | ○ im letzten Lauf nicht gelaufen | `lugru-deals.spec.ts` |

### Einkauf & Deals › Lieferanten › Kontakt-Board (`/board`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Aufgabe zuweisen hängt passende Anleitung an; zugewiesene Person sieht sie | 📘-Link auf der Karte, auch bei der Assistenz | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Amazon › Fälle & Erstattungen › Fall-Zentrale (`/amazon-faelle`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Amazon-Mails einordnen: Freischaltung abgelehnt, Fall „Antwort nötig“ (2 Mails, gleiche Fall-ID), Freischaltung entzogen, unsichere Mail | Paket mit Rechnung ≤ 180 Tage und ≥ 10 Stück, VA-Thread; ein Vorgang mit Antwort DE/EN inkl. Sendung, POD als „fehlt“; Entzug rot mit Meldung an Ludwig und Bestand in €; Einordnung von Hand lernt; Claude-Werkzeuge | ○ im letzten Lauf nicht gelaufen | `amazon-faelle.spec.ts` |
| 20 erfundene Amazon-Mails in 8 Sprachen einordnen (Unit-Test) | ≥ 18 richtig (Bereich und Phase), Fall-ID/ASIN/Frist erkannt | ○ im letzten Lauf nicht gelaufen |  |
| Amazon-Berichte 1–4: Konto-Berichte anfordern/abholen, Kontozustand, gestrandet/gesperrt, weitere Gebühren, USt per Schnittstelle, Datei-Import | DE „gefährdet“ (neue Markenbeschwerde), FR gut; 2 SKUs/8 Stück/10,50 € gebunden; Tasse gesperrt; Langzeitlager 3,40 €, Inbound 1,20 €; Aufgaben + Push; USt mit Quelle api; amazon_faelle/amazon_lagergebuehren | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |

- – Offen: Echte Seller-Central-Mails (nur live mit Nur-ansehen-Daten)
- – Offen: SP-API: Listings Restrictions (Freischaltungsstatus je Marktplatz) – braucht die Amazon-Anbindung

### Amazon › Fälle & Erstattungen › Ansprüche (`/ansprueche`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Als eingereicht markieren (über Claude) | nur mit Freigabe „ändern“; Status, Fallnummer, Zeitpunkt und Protokolleintrag „über Claude“; zweiter Aufruf ändert nichts Falsches | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |

### Amazon › Fälle & Erstattungen › Echtheits-Ordner (`/echtheit`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket | Beleg + SKU im Ordner, ZIP (PK…) | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Amazon › Angebote & Lager › Repricer (BQool) (`/repricer`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| BQool-Export „Manage Listings“ hochladen | Rückmeldung mit Anzahl je Marktplatz, Auffälligkeiten (ohne Min, pausiert, ohne Regel) in der Tabelle und im Werkzeug „repricer“ | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |
| B15.11 Übersicht je Regel, Filter, alle Länder | Regel mit DE/FR, aktiv/pausiert richtig (Angebotsstatus „Inactive“ ≠ pausiert); Filter Land und Status | ○ im letzten Lauf nicht gelaufen | `b15-anzeige.spec.ts` |
| B25.5 /repricer/export ohne Format | leitet auf die Vorschau „BQool-Dateien“ mit Warnungen je Land; CSV nur mit ?format | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

- – Offen: Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen

### Amazon › Angebote & Lager › Repricer (BQool) › Leistung (`/repricer/leistung`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B31.5 Abnahme 5: vier „Listing Performance“ (je Land) + „Daily Sales“ per Upload; Land offen → Rückfrage | Typ und Land erkannt (DE über Regelname, FR/IT/ES über SKU-Abgleich, Daily Sales DE über Umsatzsumme), Buy Box je Land wie in den Dateien, Listen „unter Min ohne Buy Box“ (Min senken), „Verlust“ (Liquidation), „Preisbewegung“ (Aufgabe „BQool-Regel prüfen“), Gewinn-Seite Spalte BQool je Tag, Verlust-Stopp zweite Quelle, Claude repricer/umsatz/verlust_stopp; unbekannte SKUs → „Welches Land?“ | ○ im letzten Lauf nicht gelaufen | `b31-5-bqool-berichte.spec.ts` |
| B31.5 täglicher Lauf holt die Berichte selbst | „Listing Performance“ mit „Last 7 days“ und „Daily Sales“ je Land heruntergeladen und ohne Rückfrage eingelesen, Abruf „BQool: Berichte“ | ○ im letzten Lauf nicht gelaufen | `b31-5-bqool-berichte.spec.ts` |

- – Offen: Echte BQool-Berichtsseiten „Listing Performance“/„Daily Sales“ unter Anbindungen eintragen und einmal „Jetzt starten“ (nur live)
- – Offen: Spalte „Products“ der echten Datei: SKU-Erkennung beim ersten Upload prüfen (Ergebnis nennt Zeilen ohne SKU)

### Amazon › Angebote & Lager › Repricer (BQool) › BQool-Dateien (`/repricer/bqool`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B31 täglicher BQool-Kreislauf: Ist DE/FR/IT/ES holen, Soll erzeugen, Push „BQool-Upload freigeben“, ohne Freigabe nichts, Freigeben → Upload je Land (Dateityp Repricing Central) mit Rückmeldung und Fehlerzeilen-Aufgabe, Nachkontrolle, Verfall, automatisch nur nach Min-Prüfung | Ist aller 4 Länder mit Stand heute (repricer „bqool_stand: heute …“), Push „DE 2 / FR 1 / IT 1 / ES 1 Änderungen, 0 Regelwechsel …“ mit Freigeben/Ansehen, nichts hochgeladen bis zur Freigabe, danach 4 Dateien mit Typ „repricing“, „1 Fehlerzeile“ als Aufgabe, Nachkontrolle „Min und Regel stimmen bei allen 4 SKUs“, Min DE = effektiver Min unter der Buy Box; verfallener Lauf lädt nichts hoch; „automatisch“ erst mit bestätigtem Min-Verhalten | ○ im letzten Lauf nicht gelaufen | `b31-bqool-kreislauf.spec.ts` |
| Ist hochladen → Abgleich → Liquidation → Export DE/FR → Übertragen mit Bestätigung | Dateien im BQool-Format, je Land eigene Upload-Seite, ein Land fehlgeschlagen → Aufgabe | ○ im letzten Lauf nicht gelaufen | `bqool-dateien.spec.ts` |

- – Offen: Echte BQool-Seiten: Export-Seite DE (Download „Full Template“) und Upload-Dateityp „Repricing Central File“ – einmal mit „Verbindung testen“ und „Jetzt starten“ prüfen (nur live)
- – Offen: Min-Verhalten in BQool an einer SKU nachsehen, dann Häkchen „Min-Verhalten geprüft“ (B31.3)

### Amazon › Angebote & Lager › FBA-Inbound (`/inbound`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| FBA-Sendung scannen | unbekannter Code → Fehler; gültiger Code bucht; Karton-Auswahl bleibt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |

### Amazon › Angebote & Lager › Amazon Business (`/amazon-business`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Geschäftsbericht (CSV) hochladen, Staffelpreis-Vorschlag übernehmen, Freigabe, Upload-Datei | B2B-Werte je ASIN, Status freigegeben, Datei mit business-price | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

- – Offen: Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen

### eBay & Temu › Angebote prüfen (`/ebay/pruefen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kleinanzeigen-Entwurf am eBay-Angebot | Titel ≤ 65, Kategorie, Zustand, Preis in ganzen Euro, Text ohne eBay-Sätze, Bilder + ZIP; nichts wird eingestellt | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |

### Lager & Versand › Lager › Bestand & Inventur (`/bestand`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl, keine kaputten Werte | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Inventur scannen | bucht +1, Feld leert sich für den nächsten Scan | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| B15.3 Prep Center verschickt | eigenes Lager unverändert; alte Fehlbuchung als Vorschlag, Zurückbuchen nur auf Klick | ○ im letzten Lauf nicht gelaufen | `b15-sofort.spec.ts` |

### Lager & Versand › Lager › Paletten-Lager (`/paletten`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B15.13 Palette ohne Kunde | Warnung mit Palettennummer, Filter „ohne Kunde“ | ○ im letzten Lauf nicht gelaufen | `b15-anzeige.spec.ts` |

### Lager & Versand › Lager › Paletten-Lager › Sendungen (`/paletten/sendungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen | Meldung im System + Mail (abgefangen), Kunden sieht nur Freigegebenes, Links verfallen | ○ im letzten Lauf nicht gelaufen | `sendungen.spec.ts` |
| Notiz über Claude bzw. Fragefeld | nur mit Recht; Mitarbeiter als Vorschlag mit Ausführen/Ablehnen | ○ im letzten Lauf nicht gelaufen | `rechte.spec.ts` |

### Lager & Versand › Versand › Aufträge & Versand (`/auftraege`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Labels kaufen und alle als versendet melden (Amazon, simuliert) | Versandbestätigung je Amazon-Auftrag an den Testdienst; eBay ohne Verbindung als Meldung | ○ im letzten Lauf nicht gelaufen | `labels.spec.ts` |
| Ansicht „Meldung offen“ | fehlgeschlagene Meldungen sichtbar | ○ im letzten Lauf nicht gelaufen | `labels.spec.ts` |

### Lager & Versand › Versand › Labels: Warensendung & DHL (`/auftraege/lieferschein`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Falsche Datei hochladen | Fehler; Datei und Haken bleiben; Kanal bei „Offene Aufträge“ bleibt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Vorschau mit lauter „bitte prüfen“ | Fehler; Auswahl je Bestellung bleibt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Gewichte pflegen | unklare Eingabe bleibt stehen, gültige Zeile zeigt gespeicherte Werte, neue Zeile leert sich | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert) | 5 Labels, Kabel als DHL-Paket, keine echten Käufe | ○ im letzten Lauf nicht gelaufen | `labels.spec.ts` |

### Lager & Versand › Versand › Abholung DHL/UPS (`/versand/abholung`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Abholung per Claude: „DHL-Abholung morgen 10–12 Uhr, 12 Pakete, <Abholort>“ (Abholort vorher unter Einstellungen → Abholung angelegt) | erst Rückfrage mit Zusammenfassung und Hinweisen (keine feste Uhrzeit, > 10 Pakete = Anfrage), nichts gebucht; nach „Ja“ (bestaetigt) Buchung mit Auftragsnummer, Protokoll „über Claude“; doppelt und Sonntag abgelehnt; Storno über abholung_stornieren | ○ im letzten Lauf nicht gelaufen | `abholung.spec.ts` |
| UPS-Abholung von der Seite: UPS → Abholung buchen; Storno; VA (Service) bucht DHL | Paketzahl/Datum/Fenster vorbelegt, PRN 2929TEST… im Protokoll, Storno an UPS; VA bucht, Einstellungen → Abholung gesperrt | ○ im letzten Lauf nicht gelaufen | `abholung.spec.ts` |
| Vorschlag am Abend: 5 bzw. 6 fertige DHL-Labels über der Schwelle, „Vorschlag jetzt prüfen“ | bei 5 kein Vorschlag; bei 6 Aufgabe „Abholung buchen? … DHL-Labels fertig“ mit Push, nichts gebucht; Ein-Klick „Jetzt buchen“ bucht genau das, Aufgabe erledigt | ○ im letzten Lauf nicht gelaufen | `abholung.spec.ts` |

- – Offen: Echte DHL-Abholung: API „Parcel DE Pickup“ in der DHL-App freischalten, GKP-Benutzer mit Abholrecht, Abholorte eintragen – erste Buchung (Sandbox aus) nur live (To-do)
- – Offen: Echte UPS-Abholung: App im UPS Developer Portal (OAuth + Pickup), Zugang unter Anbindungen → UPS – erste Buchung nur live (To-do)

### Lager & Versand › Versand › Prep Center: Versand je Monat (`/auftraege/prep-center`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Zeitraum = Monat, Stand = letzter Bestellabruf, fehlende Gebühren als Text statt 0 | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Frage im Fragefeld „Was kostet uns das Prep Center?“ | exakte Zahlen je Monat aus den Testdaten + Erklärung | ○ im letzten Lauf nicht gelaufen | `fragefeld.spec.ts` |

### Lager & Versand › Retouren › Retouren-Station & Fälle (`/remissionen/pruefungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Retouren-Station: Paket mit 4 Artikeln ohne Tastatur/Maus (Sprache + Handscanner) | Remission über Etikett, Lieferschein-Abgleich, LPN → Kundenretoure; Fall nur ab Schwelle und wenn Amazon nicht gezahlt hat; KI-Warnung bei Abweichung; Netz weg → Warteschlange; Video je Paket | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |
| Fall-Paket und Eingereicht | Text DE/EN, Fotos 1_Versandetikett … 4_Inhalt in fester Reihenfolge, ZIP, Anspruch mit Betrag/Frist, Fallnummer + Eingereicht im Verlauf; RET-SKU mit EK der Charge | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |
| Rechte der Station | ohne Bereich Amazon kein Zugriff auf Station, Schnittstelle und Fotos | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |

- – Offen: Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell
- – Offen: Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen
- – Offen: Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen

### Finanzen › Gewinn (`/gewinn`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Zeitraum, Quelle, Stand; keine kaputten Werte | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| B15.4 Quelle je Zeile, sellerboard als Ersatz, Amazon-Zeile | Abrechnung nur bis Monatsmitte → Amazon aus sellerboard; ohne sellerboard Hinweis „Zeitraum danach fehlt“; USt.-Zeilen und Rücklagen nicht im Ergebnis | ○ im letzten Lauf nicht gelaufen | `b15-zahlen.spec.ts` |
| B25.1 Abrechnung aus dem Transaktionsbericht (auch ältere Importe) | fehlende Abrechnungszeilen aus gespeicherten Transaktionen nachgezogen; genauere Datei ersetzt sie; Übertrag = Auszahlung, nie Umsatz; keine Doppelzählung | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

- – Offen: Amazon-Zeile mit echten Abrechnungen gegen sellerboard vergleichen (−525 € laut Testbericht)

### Finanzen › Liquidität (`/cashflow`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Schätzungen mit „≈“, „keine Daten“ statt 0 | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Kontoauszug einlesen, Amex erkannt, großer Einkauf in der Amex-Woche | Woche „unter Reserve“, Was-wäre-wenn meldet Unterschreitung | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Finanzen › Kapital-Ampel (`/kapital`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Ladenhüter (Reichweite > 120 T) wird rot mit Vorschlägen | Ampel rot, „Nicht nachbestellen“ | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| B28.7 Abnahme 7: drei erhaltene Einkäufe eines Testlieferanten mit FBA-Sendungen und Monatswerten, ein Einkauf > 45 Tage offen, Umsatz 30 Tage | Cash-to-Cash-Zyklus mit Medianen (4/3/8 T + 14 T Auszahlung), je Lieferant, Kapital ÷ Monatsumsatz, Hinweis „Einkäufe bereinigen“; kapital_ampel.cash_to_cash; Deal-Eingang nimmt den eigenen Vorlauf | ○ im letzten Lauf nicht gelaufen | `b28-umschlag.spec.ts` |
| Hinweis gestrandeter Bestand + weitere Amazon-Gebühren | Stück, gebundenes Kapital, Langzeit-Lagergebühr | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |

### Finanzen › Hebel: Umsatz & Marge (`/hebel`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | geschätzte Werte gekennzeichnet | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

### Finanzen › Verlust-Stopp (`/verlust`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| 2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar | Aufgabe „verlust-<SKU>“ offen/wichtig bzw. nicht mehr offen | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

- – Offen: Echte sellerboard-Tageswerte je Produkt (kommen mit „Gewinn je Produkt und Tag“ um 04:00 und 13:00)

### Finanzen › Importe (`/import`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Unbekannte Datei importieren | Fehler, Datei bleibt ausgewählt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| B25.2 Spalte „Ergebnis / Fehler“, Lagergebühren/USt-Bericht unter „Was erkannt wird“ | Ergebnis je Import (auch „nachgezogen“), fehlgeschlagene Uploads und abgelehnte Schnittstellen-Berichte mit Fehler | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

### Finanzen › Rechnungen › Eingangsrechnungen (`/rechnungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Rechnung hochladen, Sammelbearbeitung | Upload leert nach Erfolg; Auswahl bleibt bei Fehlschlag; Rückfrage abgelehnt = nichts passiert | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |

### Finanzen › Rechnungen › Rechnungsstation (Kamera) (`/rechnungsstation`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| 50 Blätter nacheinander an der Station (VA mit Bereich Service), Stapel fertig, Prüfliste, Weitergabe | 49 Belege (1 Zweiseiter angehängt), alle mit Lieferant/Datum, 42 automatisch zugeordnet (Bestellungen, ASIN an Charge), Kassenzettel als Ausgabe, Duplikat und fehlender Betrag rot, unsicheres Datum gelb; Aufgabe „Rechnungsstapel prüfen: 49 Belege, …, 2 unklar“; 47 an Stotax (gelb mit Vermerk), rot erst nach Prüfung; nach der Prüfung Aufgabe erledigt; unter 10 Minuten | ○ im letzten Lauf nicht gelaufen | `rechnungsstation.spec.ts` |
| PDF-Stapel (22 Seiten, 20 Rechnungen) im Scanner-Ordner, „Scanner-Ordner jetzt prüfen“; Lager ohne Zugriff | 20 Belege (2 Zweiseiter), alle grün, Original nach verarbeitet/; Lager wird umgeleitet, Upload 403 | ○ im letzten Lauf nicht gelaufen | `rechnungsstation.spec.ts` |

- – Offen: Kamera an der Werkbank: Auslöser (Blatt still, Ränder erkannt) und Entzerren mit echtem Papier – Logik im Unit-Test, Gerät nur live
- – Offen: Einzugsscanner: Netzwerkfreigabe auf ./scan-eingang einrichten, echte PDF mit Kassenzetteln/Rechnungen – nur live
- – Offen: Drive-Belegordner: Dienstkonto mit Schreibrecht, Ordner-ID in der Prüfliste (Inhaber) – nur live

### Finanzen › Rechnungen › Rechnungsstation: Prüfliste (`/rechnungsstation/pruefen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Prüfliste nach dem Stapel: Bild je Beleg, Duplikat-Hinweis, „Ausstehende jetzt an Stotax“, fehlenden Betrag nachtragen, Duplikat verwerfen | nur rote/gelbe Belege mit Bild; Weitergabe meldet „An Stotax übertragen: 47“ und bleibt im Stapel; nach Speichern geprüft und weitergegeben, verworfenes Duplikat „kein Beleg“; Liste danach leer | ○ im letzten Lauf nicht gelaufen | `rechnungsstation.spec.ts` |
| „Scanner-Ordner jetzt prüfen“ mit PDF-Stapel | Meldung „1 PDF aus dem Scanner-Ordner: 20 Belege“, Stapel mit 20 Belegen | ○ im letzten Lauf nicht gelaufen | `rechnungsstation.spec.ts` |

### B2B › Deals (`/b2b`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B25.10 Wo Deal-Blatt, Sammelbestellung und Prep-Export erscheinen | Hilfe-Kasten auf der B2B-Seite (offen, solange kein Deal da ist) | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |
| B15.12 SKU-Kürzel in der Lieferantenliste | Kürzel in eigener Liste, nicht bei den Freigaben; „Ist ein Lieferant“ nur auf Klick | ○ im letzten Lauf nicht gelaufen | `b15-anzeige.spec.ts` |
| Deal anlegen, Prognose je Land, Rechenhilfe, Freischalten nur mit Vertriebsfreigabe, Discord | Prognose DE/FR/IT/ES (Keepa) und NL (Amazon live); Warnung bei negativem Verdienst; ohne Freigabe des Lieferanten kein Freischalten; Discord „neu“, „fast weg“, „geschlossen“ | ○ im letzten Lauf nicht gelaufen | `b2b-deals.spec.ts`, `b2b-deals.spec.ts` |
| Abnahme: 1 Deal, 3 Kunden, 1 Fehlmenge | VIES → Reverse Charge nur FR; Mengengrenzen im Portal; Vorkasse-Rechnungen (Lexoffice), Zahlungsabgleich, Bestellung Entwurf → Freigabe → Senden nur mit Haken; Wareneingang 54/60 → anteilig 18/27/9, 3 Gutschriften, Reklamation; Export CSV/XLSX/PDF; verteilt → erledigt | ○ im letzten Lauf nicht gelaufen | `b2b-deals.spec.ts` |
| Kundenportal getrennt | eigene Anmeldung (Einladungs-Link, einmalig); nur eigene Reservierungen und Belege; kein Zugang ins Seller-System, Mitarbeiter-Anmeldung gilt im Portal nicht | ○ im letzten Lauf nicht gelaufen | `b2b-deals.spec.ts`, `b2b-deals.spec.ts` |
| Preislisten je Land, Lieferanten-Mail, Claude-Werkzeuge, Erfolgskontrolle | KI ordnet unklare Spalten zu; Ampel/Filter/Export; Deal aus Zeile; Mail-Anhang wird übernommen (Aufgabe); deal_anlegen/preis/freischalten protokolliert, Kunden ohne Kontaktdaten; Kontrolle 30/60 Tage je Land | ○ im letzten Lauf nicht gelaufen | `b2b-preislisten.spec.ts`, `b2b-preislisten.spec.ts`, `b2b-preislisten.spec.ts`, `b2b-preislisten.spec.ts` |

- – Offen: Echte Lexoffice-Anbindung mit dem Schlüssel der Deal-Firma (Rechnungsnummern, Reverse-Charge-Text, PDF)
- – Offen: Echter VIES-Abruf mit eigener USt-IdNr. (Kennung der qualifizierten Abfrage)
- – Offen: Discord-Webhook im echten B2B-Kanal
- – Offen: PrepTool (preptool.de): API-Anbindung folgt, sobald Instanz-Adresse und OpenAPI-Datei vorliegen – bis dahin Export neutral (CSV/XLSX/PDF)
- – Offen: Steuer: Reverse Charge nur, wenn die Ware Deutschland verlässt – bei FBA-Versand in DE mit dem Steuerberater klären

### Marken & Content › Uhren: Buy & Flip (`/marken/uhren`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | nur echte Deals, Herkunft angegeben | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Übungs-Deal | zählt nicht unter „Verworfen“ und nicht in den Kennzahlen | ○ im letzten Lauf nicht gelaufen | `uebungsdaten.spec.ts` |

### Marken & Content › Uhren: Buy & Flip › Deals (`/marken/uhren/deals`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Pflichtfeld-Fehler → Eingaben bleiben → speichern → neu laden → Status ändern → nochmals speichern | Status bleibt (Handy und Desktop) | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Filter und Schalter „Übungs-Deals zeigen“ | Übung standardmäßig ausgeblendet, Schalter blendet ein | ○ im letzten Lauf nicht gelaufen | `uebungsdaten.spec.ts` |

- 👁 Live (vor dem 28.10.2026, Prüfung mit ChatGPT): Uhren-Deal bearbeiten – Eingaben/Status gingen verloren – behoben, seither automatisch geprüft
- 👁 Live (vor dem 28.10.2026, Prüfung mit ChatGPT): Übungs-Deal – zählte unter „Verworfen“ – behoben, seither automatisch geprüft

### Team & Verwaltung › VA & Delegation (`/delegation`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Aufgabe an die VA über Discord: Thread mit Anleitung und Datei, ✅ erledigt, Rechnungsfrage automatisch beantwortet, Rückfrage → Antwort im Thread | Thread je Aufgabe, Status übernommen, keine Privat-/Finanzdaten an die VA | ○ im letzten Lauf nicht gelaufen | `va-discord.spec.ts` |
| B18: Anspruch mit Frist in 8 Tagen, Frist rückt auf 7/5/3/1 Tage, VA antwortet „case 12345678901“, Anspruch mit Frist heute, dann abgelaufen; Claude va_aufgaben/ueberblick | Thread sofort (Englisch, Art, SKU, Sendung, Menge, Betrag, Frist, Anleitung); Erinnerung nur an −7/−3/−1; eingereicht mit Fallnummer; Fristtag → Meldung an Ludwig; verpasst → Liste „Premium-Support/PSTAM“, Zeile „N Fristen verpasst“ rot (VA-Seite, Feierabend, ueberblick); „Daily overview“ einmal am Tag mit Thread-Links | ○ im letzten Lauf nicht gelaufen | `va-automatik.spec.ts` |
| B18: Amazon-Mails Markenbeschwerde, Fall „Antwort nötig“ 120 €, Fall 800 €, Fallnummer im Fall-Thread, „An die VA“ von Hand, Modus „Vorschlag“, Regel je Kategorie ändern | Marke nur Ludwig; 120 € automatisch Thread; 800 € erst Ludwig (Meldung, Knopf); Vorgang „eingereicht“; im Vorschlag kein Thread, tägliche Aufgabe; Regel gespeichert | ○ im letzten Lauf nicht gelaufen | `va-automatik.spec.ts` |
| B18: Tagesgrenze erreicht, zwei neue Ansprüche, VA antwortet „#n case …“ im Sammel-Thread | beide im Sammel-Thread (#1, #2), nur der genannte eingereicht | ○ im letzten Lauf nicht gelaufen | `va-automatik.spec.ts` |

- – Offen: VA-Automatik live: Zeitzone „Asia/Manila“ prüfen, einige Tage im Modus „Vorschlag“ beobachten, dann auf „automatisch“ umstellen

### Team & Verwaltung › Wissen (`/wissen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Wissen aus Calls: KI-Auszug je Call, Bereich „Aus Calls“, Eintrag mit Quelle, Suche | Einträge mit Einschätzung und Link zum Call, im Bereich „Aus Calls“ und in der Suche | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Anleitung anlegen und beim Zuweisen anhängen | Anleitung im Wissen, 📘 an der Aufgabe | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Team & Verwaltung › Calls (Consultant & Gruppe) (`/calls`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Google-Doc importieren → KI-Punkte → übernehmen → Aufgabe mit Link; Offene Punkte; Discord-Kanal | 4 Punkte, Aufgabe (amazon) mit Frist, Fragen/Consultant-Punkte offen, Zusammenfassung mit Teilnehmern, 1 neuer Call aus Discord | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Umzug aus dem bisherigen Call-Archiv: Export (JSON) hochladen, zweimal | Call mit Zusammenfassung und Google-Doc-Link, 3 Vorschläge; zweiter Import: „1 waren schon da“ | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Wochen-Calls der Deal-Gruppe auf einmal: Word + ZIP (Text, Untertitel) + Link aus Discord-Kopie; Titel/Datum ändern; nochmal hochladen | 4 Calls mit Datum aus Dateiname/Kopfzeile, KI im Hintergrund fertig, Wissen aus dem Call im Wissen (Quelle, Einschätzung, Suche), Datum geändert; zweites Hochladen: Kopie (gleicher Inhalt) und Link übersprungen | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| B25.12 Suchfeld über alle Transkripte | eingefügter Call wird über ein Wort aus dem Transkript gefunden; ohne Treffer „Kein Call enthält …“ | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |
| Gruppen-Kanäle (Discord, nur lesen): Nachrichten mehrerer Nutzer, Deal, Kanal „aus“, alter Rohtext | Tageszusammenfassung (Quelle Chat), Insider-Wissen mit Link, Frühwarnung mit eigenem Abgleich, Deal im Deal-Eingang, Kanal „aus“ nicht gelesen, Bot schreibt nie, keine Namen an die KI, Rohtext > 30 Tage gelöscht | ○ im letzten Lauf nicht gelaufen | `recht-discord.spec.ts` |

- – Offen: Echter Discord-Bot im Call-Kanal (Bot-Token, Kanal-ID) und Freigabe der Google Docs
- – Offen: Export des bisherigen Call-Archivs auf dem Server hochladen (echte Daten, nicht im Repo)
- – Offen: Gruppen-Kanäle: Bot vom Server-Admin der Deal-Gruppe eingeladen (nur Leserechte)

### Team & Verwaltung › Rechtsfälle (Anwalt) (`/rechtsfaelle`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Asana-Fall (nur lesen) mit Kommentar „Bitte bis … Unterlagen senden“, privater Fall, Anwalts-Mails, Claude | Status und Frist im Fall, wir am Zug, Aufgabe 3 Tage vorher (Kalender), privater Fall nur im Privatbereich, Startseite nur mit Anzahl, Entwurf nie gesendet, Asana nie beschrieben | ○ im letzten Lauf nicht gelaufen | `recht-discord.spec.ts` |

- – Offen: Echter Asana-Zugang (Token) beim Anwalt; ob Webhooks für Gäste gehen
- – Offen: Echte Anwalts-Mails (Domain, Aktenzeichen-Format)

### Privat › Übersicht (`/privat`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B32 Persönliche Mail „muss den Termin morgen absagen, bin krank“ (Abnahme 1–4) | nur im Privatbereich (Privat › Nachrichten), Push „Antwort prüfen“ ohne Discord-Kanal (DM nur, wenn eingestellt), Termin als abgesagt markiert (Rückgängig), KI-Entwurf mit gute Besserung und Unterschrift; „Senden“ = Antwort im selben Verlauf, Karte weg; Newsletter/Amazon unverändert; Büro/Familie sehen nichts; Morgenbericht/Überblick nur Anzahl | ○ im letzten Lauf nicht gelaufen | `persoenliche-mails.spec.ts` |
| B32 Handy: persönliche Mail im Vollbild | Senden · Bearbeiten · Später fest unten, kein Querscrollen; Später speichert den Text und lässt die Nachricht offen | ○ im letzten Lauf nicht gelaufen | `persoenliche-mails.spec.ts` |
| Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen | Ausnahme bleibt bei Serienänderung erhalten; nur die gewählten Termine ändern/verschwinden | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
| Abendritual als Abfolge „zweimal Streicheln, danach Massage“ | die nächsten Abende im Voraus: S, S, M, S, S, M | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
| Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe | nichts Privates sichtbar; nur mit Privat-Freigabe der Inhaberin im Konnektor | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
| Familienkalender: „To do Ina: …“ → wichtige Aufgabe | genau eine Aufgabe (wichtig, Ina, Frist = Termintag); erledigt bleibt erledigt | ○ im letzten Lauf nicht gelaufen | `familie-watch.spec.ts` |
| B27 ArbitrageOne-Nachtlauf: PurchaseOrders .xls/Lagerbestand .xlsx, „wird erstellt“, Dialog, Fehler mit Bildschirmfoto, Erneut verarbeiten | Einkäufe/Lagerbestand verarbeitet; BQool aus der Export-Liste, Reimbursement über den Dialog; Fehler je Export mit Bild + Seite; sellerboard „übersprungen“; alter Fehlimport → fertig | ○ im letzten Lauf nicht gelaufen | `b27-automatik.spec.ts` |
| B27 anbindungen_status: sellerboard-Zeitplan fest, altes Call-Archiv abgelöst | feste Uhrzeiten („04:00 und 13:00“, B29) statt „wird beim nächsten Lauf erfasst“; Call-Archiv nicht unter nur_probleme | ○ im letzten Lauf nicht gelaufen | `b27-automatik.spec.ts` |
| BQool-Upload: Erfolg erkennen (kurzer Hinweis, stille Annahme, Ablehnung), sonst „bitte prüfen“ + „hat geklappt“ | Hinweis/Server-Annahme = hochgeladen, JSON-Ablehnung = Fehler; nichts erkannt = gelb + normale Aufgabe; „hat geklappt“ → von Hand bestätigt, Status fertig, Aufgabe erledigt | ○ im letzten Lauf nicht gelaufen | `bqool-upload-erkennung.spec.ts` |
| Familientermine direkt im Tagesplan/Kalender zuordnen (ich / beide / nur Partnerin) | „nur Tom“ → blockt nicht, steht unter „Blockt nicht“, Kapazität steigt; zurückholen und ↺ gehen; Kalender-Tagesliste gleich; To-do-Termine blocken nicht | ○ im letzten Lauf nicht gelaufen | `familie-watch.spec.ts` |
| Familienkalender: Wen betrifft der Termin (ich / Familie / Partnerin), Name im Titel | Termin nur der Partnerin blockt den eigenen Tagesplan nicht (keine Fahrzeit), „nur Tom“ im Kalender; Familie blockt wieder | ○ im letzten Lauf nicht gelaufen | `familie-watch.spec.ts` |
| Rückblick mit frei gewähltem Zeitraum (von–bis, Schnellauswahl) und Wochenrückblick „7 Tage bis“ beliebigem Tag | Zählungen nur im Zeitraum; vertauschte Daten getauscht, Zukunft auf heute gekürzt; „Zurück zum Monat“ | ○ im letzten Lauf nicht gelaufen | `privat-rueckblick.spec.ts` |

- – Offen: Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests
- – Offen: Live nie prüfen (echte private Daten)

### Einstellungen › Einstellungen (`/einstellungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Testumgebung: Banner, Sperre nach außen, Übersicht | Banner auf jeder Seite, Verbindungen nach außen gesperrt, Mails abgefangen | ○ im letzten Lauf nicht gelaufen | `testumgebung.spec.ts` |
| Apple Watch: Seite mit Anleitung, ein Kurzbefehl für alles (watch/frage), Ausprobieren | über Handy & Tesla erreichbar; Adresse + Schlüssel; Ausprobieren zeigt die Uhr-Antwort; freie Sätze → richtiger Befehl, ändernde nur per POST | ○ im letzten Lauf nicht gelaufen | `familie-watch.spec.ts` |
| Zugang Assistenz (Büro): Finanz- und Privatseiten aufrufen | gesperrt, keine Finanz- oder Privatdaten | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| B25.9 Privat „voll“ bei Nicht-Inhaber, va@…-Konto ohne VA-Rolle | Privatbereich gesperrt; beim Inhaber-Login auf „kein Zugang“ bereinigt + Dialog + Aufgabe; Knopf „Als VA-Rolle übernehmen“ | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

### Einstellungen › Einstellungen › Anbindungen (`/anbindungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Karte „Postfächer“ und Warnung ohne Amazon-Mail; Google/Microsoft nur optional unter „Erweitert“ | Warnung „Kein Postfach verbunden“; Google-Karte zeigt OPTIONAL; anbindungen_status (nur Probleme) listet Google nicht, liefert Postfächer und Warnung | ○ im letzten Lauf nicht gelaufen | `postfach.spec.ts` |
| B25.12 Intervall je Abruf auf der Karte, echter Zeitplan statt „laut Plan“ | z. B. „Amazon-Bestellungen: alle 15 Min.“; Zeitplan aus dem letzten Lauf | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |
| B29 sellerboard-Aufrufbudget: künstliches Budget 5, „Fällige Abrufe nachholen“ gegen den sellerboard-Nachbau | Zähler „sellerboard-Aufrufe heute: n/125 (Automatik n, Reserve n)“ = Aufrufe beim Nachbau, höchstens 5; Verkauf lief (Vorrang), übrige Abrufe „übersprungen (Tagesbudget)“, kein Fehler | ○ im letzten Lauf nicht gelaufen | `b29-sellerboard-budget.spec.ts` |
| B30 ArbitrageOne-Einkäufe (PurchaseOrders): Fehlimport mit Art ek_liste → „Erneut verarbeiten“; Einkauf → Bestellungen; Upload unter Uploads; EK-Vorschlag | „fertig“ mit „2 Bestellungen, 3 Positionen, 2 ohne Zuordnung“, Art ao_einkaeufe; Bestellungen mit Lieferant, Datum, Menge, EK, Status, „1 ohne Zuordnung“; Upload erkannt als „ArbitrageOne – Bestellungen“, „schon bekannt: 3 Positionen“; EK-Vorschlag mit Warnung gegen sellerboard-COG, keine Charge; Liquidität ohne die Bestellung | ○ im letzten Lauf nicht gelaufen | `b30-ao-bestellungen.spec.ts` |
| B30.3 Fehlimporte beim nächsten Abruf nachverarbeitet; fehlende Spalten | Fehlimport von vor 4 Tagen „fertig“ als ao_einkaeufe; Einkäufe · ok · 1 Bestellung, 1 Position; Fehler nennt „gefunden: …; fehlt: …“ | ○ im letzten Lauf nicht gelaufen | `b30-ao-bestellungen.spec.ts` |
| B29 Limit-Fehler „used up today's MCP call limit“, danach Rücksetzung | genau ein Eintrag „pausiert bis 01:00 Uhr“ (auch unter nur_probleme), keine Fehlerzeilen, während der Pause kein Aufruf; danach nachgeholt Verkauf → Gewinn je Produkt → Bestand → Tagesabrufe, Eintrag weg | ○ im letzten Lauf nicht gelaufen | `b29-sellerboard-budget.spec.ts` |

- – Offen: B30 mit der echten PurchaseOrders-Datei: Import vom 06.11. nach dem Update „fertig“, Spaltenzuordnung (EK netto/brutto, Menge, Status) prüfen; Lauf am 07.11. 05:30 Einkäufe · ok – nur live (To-dos 90/91)
- – Offen: B29 Abnahme 1 und 4 mit echtem sellerboard: am 06.11. nach 01:00 laufen alle Abrufe wieder, um 12:00 höchstens 45 Aufrufe laut Zähler; ein ganzer Tag mit Morgenbericht und drei Nachfragen endet unter 125 – nur live (Rechnung nach Plan im Unit-Test: 45 bis 12:00, 72 am Tag)
- – Offen: B29 schlanke Feldauswahl (bis 200 Zeilen je Seite) gegen echtes sellerboard – lehnt sellerboard sie ab, fällt der Abruf von selbst auf volle Zeilen zurück

### Einstellungen › Einstellungen › KI-Assistent (`/einstellungen/claude`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten | nicht angebotene Werkzeuge abgewiesen und protokolliert; Änderungen nur als Vorschlag | ○ im letzten Lauf nicht gelaufen | `rechte.spec.ts` |
| Jedes lesende Werkzeug einzeln | Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten | ○ im letzten Lauf nicht gelaufen | `werkzeuge.spec.ts` |
| Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag) | Zahlen aus dem Keepa-Nachbau, zweiter Aufruf aus dem Zwischenspeicher (keine neue Keepa-Abfrage), unbekannte ASIN klar benannt | ○ im letzten Lauf nicht gelaufen | `keepa.spec.ts` |
| Keepa: Länder vergleichen | DE/FR/IT/ES/UK nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als „nicht bei Keepa“ | ○ im letzten Lauf nicht gelaufen | `keepa.spec.ts` |
| Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon) | Lager-Konto bekommt sie nicht, direkter Aufruf abgewiesen | ○ im letzten Lauf nicht gelaufen | `keepa.spec.ts` |
| Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live | Berichte unter Einstellungen → Hintergrund & Importe anfordern/abholen; Werte aus dem Amazon-Nachbau je Land; Angebote live mit 10-Min.-Zwischenspeicher; unbekannte ASIN als Fehler je Land | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |
| Neue Werkzeuge ohne Neustart (notifications/tools/list_changed) | Ereignis-Kanal meldet beim Verbinden „tools/list_changed“ | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |
| Rechte der neuen Werkzeuge im Fragefeld | Büro: Posteingang, Repricer, Angebote live (über Wawi → Lieferanten); keine Buy Box, Listung, Lageralter, Ansprüche, Anbindungen | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |

- – Offen: Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)
- – Offen: getItemOffers-Ratenlimit im Betrieb beobachten

### Einstellungen › Einstellungen › Hintergrund & Importe (`/einstellungen/hintergrund`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Eigener Reiter „Hintergrund & Importe“ neben Anbindungen und KI-Assistent; Anbindungen nur noch mit Hinweis | Reiter aktiv, Abschnitt Hintergrund-Abrufe mit Tabelle; unter Anbindungen keine Abruf-Tabelle mehr, Link auf den neuen Reiter | ○ im letzten Lauf nicht gelaufen | `navigation.spec.ts` |
| ArbitrageOne „Jetzt abholen“, zweiter Abruf, fehlender Export, Zwei-Faktor (Importe – ArbitrageOne) | Meldung und Lauf-Zeilen im neuen Reiter; Rücksprung nach dem Knopf auf /einstellungen/hintergrund | ○ im letzten Lauf nicht gelaufen | `arbitrageone.spec.ts` |
| Amazon-Berichte sofort anfordern / Konto-Berichte / fertige abholen | Meldung „6 Berichte angefordert …“ im neuen Reiter, Berichte in der Tabelle | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |
| Discord live und Abrufzeile „Call-Archiv (Discord live)“ | Auslöser live, zuletzt empfangen, sofort bei Eingang | ○ im letzten Lauf nicht gelaufen | `b21-calls-live.spec.ts` |
| BQool-Upload „hat geklappt“ | Zeile „hochgeladen (von Hand bestätigt)“, Rücksprung in den Reiter | ○ im letzten Lauf nicht gelaufen | `bqool-upload-erkennung.spec.ts` |

### Übergreifend › /posteingang/verbinden (`/posteingang/verbinden`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Postfach verbinden: App-Passwort zuerst, Anleitung (Google, Microsoft 365, GMX/WEB.DE, IONOS/STRATO), „Nur abrufen“, OAuth nur unter „Erweitert“ | IMAP-Formular sichtbar, Erweitert zugeklappt | ○ im letzten Lauf nicht gelaufen | `postfach.spec.ts` |
| Mails hochladen: niederländische Compliance-Mail und Routinemail „Verkauft, jetzt liefern“ | Compliance kritisch, Routine unwichtig; Empfänger (Delivered-To) und Ordner „Upload“ an der Mail; Amazon-ToDo mit Marktplatz NL, SKU, ASIN und Link „Kontozustand“; Claude: posteingang/mail mit an + ordner | ○ im letzten Lauf nicht gelaufen | `postfach.spec.ts` |

- – Offen: IMAP mit echtem Postfach: Ordnerauswahl (Gmail „Alle Nachrichten“), Test-Knopf, SMTP 465 → 587, Fehlerarten (Anmeldung, IMAP aus, Port) – nur live mit Nur-ansehen-Daten

### Übergreifend › /assistent-verlauf (`/assistent-verlauf`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B25.6 Rückgängig für aufgabe_verschieben (auch aufgabe_zuweisen, auftrag_status, privat_eintrag_anlegen) | neuer Aufruf zeigt „↩ Rückgängig“, Klick stellt die alte Frist her | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |
| Auftrag an Claude aus den Amazon-ToDos: „ToDos mit versendetem Auftrag erledigen“ → Vorschau → Ausführen → Verlauf → Rückgängig; gelber Auftragsstatus; Preis ändern; Mail mit „ignore previous instructions“; VA-Konto; gleiche Aktion über den Konnektor | Vorschau nennt 2 passende und 1 getrennt (nicht versendet), ohne Klick keine Änderung; Verlauf mit Auftragstext und Datensätzen, Rückgängig öffnet wieder; gelb nur mit Einzelbestätigung; Preis: Hinweis + Link, keine Ausführung; Mail-Text löst nichts aus; VA ohne Finanzen; Konnektor gleiches Ergebnis | ○ im letzten Lauf nicht gelaufen | `assistent-aktionen.spec.ts` |

### Übergreifend › /calls/offen (`/calls/offen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl, keine kaputten Werte | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

### Übergreifend › /kalender/zeiten (`/kalender/zeiten`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Freier Tag → Aufgabe wandert auf den nächsten Arbeitstag; Wochenrückblick | Fälligkeit verschoben, Rückblick sichtbar | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Übergreifend › /privat/familienaufgaben (`/privat/familienaufgaben`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Familien-Zugang: Aufgabe anlegen, Fairness aus; kein Geld/Tagebuch/Geschäft | nur Familienliste + Familienkalender | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Übergreifend › /deal-eingang/lernen (`/deal-eingang/lernen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B28.8 Abnahme 8: zwei Verlustprodukte + ein Gewinner im Vormonat, „Liste jetzt erstellen“, „Nie wieder“ mit Grund und Freitext, Büro-Kraft mit Deal-Eingang-Zugriff | Liste des Vormonats (größter Verlust zuerst, Gewinner fehlt), Antwort gespeichert und im Lernbericht + deal_lernen_bericht.lernschleife, Büro-Kraft sieht keine Knöpfe | ○ im letzten Lauf nicht gelaufen | `b28-umschlag.spec.ts` |

### Übergreifend › /privat/therapie-bogen (`/privat/therapie-bogen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Therapie-Bogen seit letzter Sitzung (B16): Beobachtung mit 3 Feldern und „[?]“, Zeitraum wählen, Beobachtung ändern/löschen per Formular und Claude, rückgängig | Beginn = letzter Paartherapie-Termin; Tabelle Datum \| Situation \| Problematik \| gewünschte Veränderung; „unvollständig“ markiert; Protokoll ohne Inhalte | ○ im letzten Lauf nicht gelaufen | `privat-rueckblick.spec.ts` |

### Übergreifend › /privat/geld (`/privat/geld`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Frage für den Steuerberater, nur für die eigene Person | Hinweis „keine Steuerberatung“, Familien-Zugang gesperrt | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Übergreifend › Fragefeld

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Altes Gespräch nach Update fortsetzen | kein 400, alter Denk-Schritt verworfen | ○ im letzten Lauf nicht gelaufen | `fragefeld.spec.ts` |
| Privates im Kalender-Werkzeug | nie (auch nicht für die Inhaberin) | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |

- 👁 Live (vor dem 28.10.2026, Nutzung im Betrieb): Altes Gespräch fortsetzen – 400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft

### Übergreifend › Server (Port, Adresse, Testumgebung)

- 👁 Live (vor dem 28.10.2026, Prüfung mit ChatGPT): Erreichbarkeit – Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen
- – Offen: `deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)
- – Offen: `deploy/testumgebung.sh an` + `pruefen` auf dem Server

## Getrennt: automatisch · live · noch nicht geprüft

**Automatisch** (148 Abläufe + Oberfläche auf 113 Seiten): 0 bestanden, 0 fehlgeschlagen, 148 nicht gelaufen.

- ○ Tagesübersicht: B15.2 Privater Kalender auf der Startseite – im letzten Lauf nicht gelaufen
- ○ Tagesübersicht: B15.1 FBM-Versandbestätigung offen – im letzten Lauf nicht gelaufen
- ○ Tagesübersicht: B25.7 Paletten ohne Kunde unter „Jetzt dringend“ – im letzten Lauf nicht gelaufen
- ○ Termine: Geschäftskalender als Büro-Konto und als Inhaberin – im letzten Lauf nicht gelaufen
- ○ Termine: B25.8 Tagesplan: Termin mit Ort, Anruf-Aufgabe mit Nummer – im letzten Lauf nicht gelaufen
- ○ Posteingang: .eml-Datei hochladen – im letzten Lauf nicht gelaufen
- ○ Posteingang: Antwort-Entwurf (über Claude) prüfen und senden – im letzten Lauf nicht gelaufen
- ○ Posteingang: Posteingang auf null: Regel an Zuständigen, Auto-Archiv, Zahlung abgelehnt (IT), Termin-Mail → Privatkalender, Vorschlag für Claude – im letzten Lauf nicht gelaufen
- ○ Posteingang: B32.5 Antwort aus dem Mailprogramm (Gesendet-Ordner) auf eine Käuferfrage; neue B2B-Anfrage aus dem Mailprogramm – im letzten Lauf nicht gelaufen
- ○ Posteingang: Gerichts-/Behörden-Mail und Anwalts-Mails (B14) – im letzten Lauf nicht gelaufen
- ○ Schnellerfassung: Diktat per Handy-Schlüssel: Aufgabe, Eingangsliste, Privates nur mit Zugang, Widerruf – im letzten Lauf nicht gelaufen
- ○ Schnellerfassung: Widget, Anrufe in der Fahrzeit, Briefing je Ziel, SMS-Codes, Ins Auto, Fahrtenbuch, Scan, Auto-Status/Klima – im letzten Lauf nicht gelaufen
- ○ Feierabend: Feierabend: erledigt/offen, auf morgen schieben, morgen Top 3 – im letzten Lauf nicht gelaufen
- ○ Feierabend: Wochenrückblick mit „Privates zeigen“ (B16) – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: B25.3 Schwelle „Lugru Deals=60“ – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Text, Screenshot (3 Angebote), Kurzbefehl mit Geräte-Schlüssel, Kapital-Ampel rot, Preisliste (XLSX 500 Zeilen), Mail „Deal prüfen“, ProfitPath über Discord, Knöpfe Bestellvorschlag/B2B-Deal, Claude-Werkzeuge – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Abschnitt 10/11: Lugru-Deals-History über den Endpunkt (mit/ohne Schlüssel, erneut senden), Budget-Grenze je Deal, geteilter Deal mit Shop-Link, „Gekauft: Menge, Preis“, Amazon-Bestellbestätigung als .eml, 👎 aus der Push-Meldung mit Grund, 👍 unter der ProfitPath-Nachricht in Discord, Wareneingang + 35 Tage mit sellerboard-Monat, Monatsbericht, Claude-Werkzeuge – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Nachtrag B28: Deal-Quelle mit Lieferant anlegen, Testpfanne (Buy Box 79 €, früher 57,99 €, IT 1 Angebot), Ziel-VK DE 56 €, 👍 mit Grund „In einem Land kein Angebot“ + ähnlicher Deal neu prüfen, 👍 in Discord mit Rückfrage (Zahl-Reaktion + Text), Gekauft 84 × 25 € mit Bestellmail, Antwort mit Sendungsnummer als .eml, Claude-Werkzeuge – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: B28.6 Abnahme 6: Testpfanne ab 84 Stück, Mindest-ROI p. a. in den Einstellungen – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Lücken aus dem Bauauftrag (Abschnitte 2, 4, 5, 7): weitere Einstellungen (ungültiger/gültiger iCloud-Link), Kurzbefehl-Skizzen, offene Rechteinhaber-Beschwerde zur ASIN, Lieferant ohne Marktplatz-Freigabe + Gefahrgut, Keepa-Mini-Chart, Screenshot im Original und fremde Datei – im letzten Lauf nicht gelaufen
- ○ Lugru Deals: Lugru Deals über Discord: History, Live-Post, Reaktion, doppelter Post, eigener Kauf, Statistik, deal_quellen, Deal-Wert – im letzten Lauf nicht gelaufen
- ○ Kontakt-Board: Aufgabe zuweisen hängt passende Anleitung an; zugewiesene Person sieht sie – im letzten Lauf nicht gelaufen
- ○ Fall-Zentrale: Amazon-Mails einordnen: Freischaltung abgelehnt, Fall „Antwort nötig“ (2 Mails, gleiche Fall-ID), Freischaltung entzogen, unsichere Mail – im letzten Lauf nicht gelaufen
- ○ Fall-Zentrale: 20 erfundene Amazon-Mails in 8 Sprachen einordnen (Unit-Test) – im letzten Lauf nicht gelaufen
- ○ Fall-Zentrale: Amazon-Berichte 1–4: Konto-Berichte anfordern/abholen, Kontozustand, gestrandet/gesperrt, weitere Gebühren, USt per Schnittstelle, Datei-Import – im letzten Lauf nicht gelaufen
- ○ Ansprüche: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Ansprüche: Als eingereicht markieren (über Claude) – im letzten Lauf nicht gelaufen
- ○ Echtheits-Ordner: Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): BQool-Export „Manage Listings“ hochladen – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): B15.11 Übersicht je Regel, Filter, alle Länder – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): B25.5 /repricer/export ohne Format – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool) › Leistung: B31.5 Abnahme 5: vier „Listing Performance“ (je Land) + „Daily Sales“ per Upload; Land offen → Rückfrage – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool) › Leistung: B31.5 täglicher Lauf holt die Berichte selbst – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool) › BQool-Dateien: B31 täglicher BQool-Kreislauf: Ist DE/FR/IT/ES holen, Soll erzeugen, Push „BQool-Upload freigeben“, ohne Freigabe nichts, Freigeben → Upload je Land (Dateityp Repricing Central) mit Rückmeldung und Fehlerzeilen-Aufgabe, Nachkontrolle, Verfall, automatisch nur nach Min-Prüfung – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool) › BQool-Dateien: Ist hochladen → Abgleich → Liquidation → Export DE/FR → Übertragen mit Bestätigung – im letzten Lauf nicht gelaufen
- ○ FBA-Inbound: FBA-Sendung scannen – im letzten Lauf nicht gelaufen
- ○ Amazon Business: Geschäftsbericht (CSV) hochladen, Staffelpreis-Vorschlag übernehmen, Freigabe, Upload-Datei – im letzten Lauf nicht gelaufen
- ○ Amazon Business: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Angebote prüfen: Kleinanzeigen-Entwurf am eBay-Angebot – im letzten Lauf nicht gelaufen
- ○ Bestand & Inventur: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Bestand & Inventur: Inventur scannen – im letzten Lauf nicht gelaufen
- ○ Bestand & Inventur: B15.3 Prep Center verschickt – im letzten Lauf nicht gelaufen
- ○ Paletten-Lager: B15.13 Palette ohne Kunde – im letzten Lauf nicht gelaufen
- ○ Paletten-Lager › Sendungen: Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen – im letzten Lauf nicht gelaufen
- ○ Paletten-Lager › Sendungen: Notiz über Claude bzw. Fragefeld – im letzten Lauf nicht gelaufen
- ○ Aufträge & Versand: Labels kaufen und alle als versendet melden (Amazon, simuliert) – im letzten Lauf nicht gelaufen
- ○ Aufträge & Versand: Ansicht „Meldung offen“ – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Falsche Datei hochladen – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Vorschau mit lauter „bitte prüfen“ – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Gewichte pflegen – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert) – im letzten Lauf nicht gelaufen
- ○ Abholung DHL/UPS: Abholung per Claude: „DHL-Abholung morgen 10–12 Uhr, 12 Pakete, <Abholort>“ (Abholort vorher unter Einstellungen → Abholung angelegt) – im letzten Lauf nicht gelaufen
- ○ Abholung DHL/UPS: UPS-Abholung von der Seite: UPS → Abholung buchen; Storno; VA (Service) bucht DHL – im letzten Lauf nicht gelaufen
- ○ Abholung DHL/UPS: Vorschlag am Abend: 5 bzw. 6 fertige DHL-Labels über der Schwelle, „Vorschlag jetzt prüfen“ – im letzten Lauf nicht gelaufen
- ○ Prep Center: Versand je Monat: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Prep Center: Versand je Monat: Frage im Fragefeld „Was kostet uns das Prep Center?“ – im letzten Lauf nicht gelaufen
- ○ Retouren-Station & Fälle: Retouren-Station: Paket mit 4 Artikeln ohne Tastatur/Maus (Sprache + Handscanner) – im letzten Lauf nicht gelaufen
- ○ Retouren-Station & Fälle: Fall-Paket und Eingereicht – im letzten Lauf nicht gelaufen
- ○ Retouren-Station & Fälle: Rechte der Station – im letzten Lauf nicht gelaufen
- ○ Gewinn: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Gewinn: B15.4 Quelle je Zeile, sellerboard als Ersatz, Amazon-Zeile – im letzten Lauf nicht gelaufen
- ○ Gewinn: B25.1 Abrechnung aus dem Transaktionsbericht (auch ältere Importe) – im letzten Lauf nicht gelaufen
- ○ Liquidität: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Liquidität: Kontoauszug einlesen, Amex erkannt, großer Einkauf in der Amex-Woche – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: Ladenhüter (Reichweite > 120 T) wird rot mit Vorschlägen – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: B28.7 Abnahme 7: drei erhaltene Einkäufe eines Testlieferanten mit FBA-Sendungen und Monatswerten, ein Einkauf > 45 Tage offen, Umsatz 30 Tage – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: Hinweis gestrandeter Bestand + weitere Amazon-Gebühren – im letzten Lauf nicht gelaufen
- ○ Hebel: Umsatz & Marge: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Verlust-Stopp: 2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar – im letzten Lauf nicht gelaufen
- ○ Verlust-Stopp: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Importe: Unbekannte Datei importieren – im letzten Lauf nicht gelaufen
- ○ Importe: B25.2 Spalte „Ergebnis / Fehler“, Lagergebühren/USt-Bericht unter „Was erkannt wird“ – im letzten Lauf nicht gelaufen
- ○ Eingangsrechnungen: Rechnung hochladen, Sammelbearbeitung – im letzten Lauf nicht gelaufen
- ○ Rechnungsstation (Kamera): 50 Blätter nacheinander an der Station (VA mit Bereich Service), Stapel fertig, Prüfliste, Weitergabe – im letzten Lauf nicht gelaufen
- ○ Rechnungsstation (Kamera): PDF-Stapel (22 Seiten, 20 Rechnungen) im Scanner-Ordner, „Scanner-Ordner jetzt prüfen“; Lager ohne Zugriff – im letzten Lauf nicht gelaufen
- ○ Rechnungsstation: Prüfliste: Prüfliste nach dem Stapel: Bild je Beleg, Duplikat-Hinweis, „Ausstehende jetzt an Stotax“, fehlenden Betrag nachtragen, Duplikat verwerfen – im letzten Lauf nicht gelaufen
- ○ Rechnungsstation: Prüfliste: „Scanner-Ordner jetzt prüfen“ mit PDF-Stapel – im letzten Lauf nicht gelaufen
- ○ Deals: B25.10 Wo Deal-Blatt, Sammelbestellung und Prep-Export erscheinen – im letzten Lauf nicht gelaufen
- ○ Deals: B15.12 SKU-Kürzel in der Lieferantenliste – im letzten Lauf nicht gelaufen
- ○ Deals: Deal anlegen, Prognose je Land, Rechenhilfe, Freischalten nur mit Vertriebsfreigabe, Discord – im letzten Lauf nicht gelaufen
- ○ Deals: Abnahme: 1 Deal, 3 Kunden, 1 Fehlmenge – im letzten Lauf nicht gelaufen
- ○ Deals: Kundenportal getrennt – im letzten Lauf nicht gelaufen
- ○ Deals: Preislisten je Land, Lieferanten-Mail, Claude-Werkzeuge, Erfolgskontrolle – im letzten Lauf nicht gelaufen
- ○ Uhren: Buy & Flip: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Uhren: Buy & Flip: Übungs-Deal – im letzten Lauf nicht gelaufen
- ○ Uhren: Buy & Flip › Deals: Pflichtfeld-Fehler → Eingaben bleiben → speichern → neu laden → Status ändern → nochmals speichern – im letzten Lauf nicht gelaufen
- ○ Uhren: Buy & Flip › Deals: Filter und Schalter „Übungs-Deals zeigen“ – im letzten Lauf nicht gelaufen
- ○ VA & Delegation: Aufgabe an die VA über Discord: Thread mit Anleitung und Datei, ✅ erledigt, Rechnungsfrage automatisch beantwortet, Rückfrage → Antwort im Thread – im letzten Lauf nicht gelaufen
- ○ VA & Delegation: B18: Anspruch mit Frist in 8 Tagen, Frist rückt auf 7/5/3/1 Tage, VA antwortet „case 12345678901“, Anspruch mit Frist heute, dann abgelaufen; Claude va_aufgaben/ueberblick – im letzten Lauf nicht gelaufen
- ○ VA & Delegation: B18: Amazon-Mails Markenbeschwerde, Fall „Antwort nötig“ 120 €, Fall 800 €, Fallnummer im Fall-Thread, „An die VA“ von Hand, Modus „Vorschlag“, Regel je Kategorie ändern – im letzten Lauf nicht gelaufen
- ○ VA & Delegation: B18: Tagesgrenze erreicht, zwei neue Ansprüche, VA antwortet „#n case …“ im Sammel-Thread – im letzten Lauf nicht gelaufen
- ○ Wissen: Wissen aus Calls: KI-Auszug je Call, Bereich „Aus Calls“, Eintrag mit Quelle, Suche – im letzten Lauf nicht gelaufen
- ○ Wissen: Anleitung anlegen und beim Zuweisen anhängen – im letzten Lauf nicht gelaufen
- ○ Calls (Consultant & Gruppe): Google-Doc importieren → KI-Punkte → übernehmen → Aufgabe mit Link; Offene Punkte; Discord-Kanal – im letzten Lauf nicht gelaufen
- ○ Calls (Consultant & Gruppe): Umzug aus dem bisherigen Call-Archiv: Export (JSON) hochladen, zweimal – im letzten Lauf nicht gelaufen
- ○ Calls (Consultant & Gruppe): Wochen-Calls der Deal-Gruppe auf einmal: Word + ZIP (Text, Untertitel) + Link aus Discord-Kopie; Titel/Datum ändern; nochmal hochladen – im letzten Lauf nicht gelaufen
- ○ Calls (Consultant & Gruppe): B25.12 Suchfeld über alle Transkripte – im letzten Lauf nicht gelaufen
- ○ Calls (Consultant & Gruppe): Gruppen-Kanäle (Discord, nur lesen): Nachrichten mehrerer Nutzer, Deal, Kanal „aus“, alter Rohtext – im letzten Lauf nicht gelaufen
- ○ Rechtsfälle (Anwalt): Asana-Fall (nur lesen) mit Kommentar „Bitte bis … Unterlagen senden“, privater Fall, Anwalts-Mails, Claude – im letzten Lauf nicht gelaufen
- ○ Übersicht: B32 Persönliche Mail „muss den Termin morgen absagen, bin krank“ (Abnahme 1–4) – im letzten Lauf nicht gelaufen
- ○ Übersicht: B32 Handy: persönliche Mail im Vollbild – im letzten Lauf nicht gelaufen
- ○ Übersicht: Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen – im letzten Lauf nicht gelaufen
- ○ Übersicht: Abendritual als Abfolge „zweimal Streicheln, danach Massage“ – im letzten Lauf nicht gelaufen
- ○ Übersicht: Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe – im letzten Lauf nicht gelaufen
- ○ Übersicht: Familienkalender: „To do Ina: …“ → wichtige Aufgabe – im letzten Lauf nicht gelaufen
- ○ Übersicht: B27 ArbitrageOne-Nachtlauf: PurchaseOrders .xls/Lagerbestand .xlsx, „wird erstellt“, Dialog, Fehler mit Bildschirmfoto, Erneut verarbeiten – im letzten Lauf nicht gelaufen
- ○ Übersicht: B27 anbindungen_status: sellerboard-Zeitplan fest, altes Call-Archiv abgelöst – im letzten Lauf nicht gelaufen
- ○ Übersicht: BQool-Upload: Erfolg erkennen (kurzer Hinweis, stille Annahme, Ablehnung), sonst „bitte prüfen“ + „hat geklappt“ – im letzten Lauf nicht gelaufen
- ○ Übersicht: Familientermine direkt im Tagesplan/Kalender zuordnen (ich / beide / nur Partnerin) – im letzten Lauf nicht gelaufen
- ○ Übersicht: Familienkalender: Wen betrifft der Termin (ich / Familie / Partnerin), Name im Titel – im letzten Lauf nicht gelaufen
- ○ Übersicht: Rückblick mit frei gewähltem Zeitraum (von–bis, Schnellauswahl) und Wochenrückblick „7 Tage bis“ beliebigem Tag – im letzten Lauf nicht gelaufen
- ○ Einstellungen: Testumgebung: Banner, Sperre nach außen, Übersicht – im letzten Lauf nicht gelaufen
- ○ Einstellungen: Apple Watch: Seite mit Anleitung, ein Kurzbefehl für alles (watch/frage), Ausprobieren – im letzten Lauf nicht gelaufen
- ○ Einstellungen: Zugang Assistenz (Büro): Finanz- und Privatseiten aufrufen – im letzten Lauf nicht gelaufen
- ○ Einstellungen: B25.9 Privat „voll“ bei Nicht-Inhaber, va@…-Konto ohne VA-Rolle – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Anbindungen: Karte „Postfächer“ und Warnung ohne Amazon-Mail; Google/Microsoft nur optional unter „Erweitert“ – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Anbindungen: B25.12 Intervall je Abruf auf der Karte, echter Zeitplan statt „laut Plan“ – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Anbindungen: B29 sellerboard-Aufrufbudget: künstliches Budget 5, „Fällige Abrufe nachholen“ gegen den sellerboard-Nachbau – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Anbindungen: B30 ArbitrageOne-Einkäufe (PurchaseOrders): Fehlimport mit Art ek_liste → „Erneut verarbeiten“; Einkauf → Bestellungen; Upload unter Uploads; EK-Vorschlag – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Anbindungen: B30.3 Fehlimporte beim nächsten Abruf nachverarbeitet; fehlende Spalten – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Anbindungen: B29 Limit-Fehler „used up today's MCP call limit“, danach Rücksetzung – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Jedes lesende Werkzeug einzeln – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag) – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Keepa: Länder vergleichen – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon) – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Neue Werkzeuge ohne Neustart (notifications/tools/list_changed) – im letzten Lauf nicht gelaufen
- ○ Einstellungen › KI-Assistent: Rechte der neuen Werkzeuge im Fragefeld – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Hintergrund & Importe: Eigener Reiter „Hintergrund & Importe“ neben Anbindungen und KI-Assistent; Anbindungen nur noch mit Hinweis – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Hintergrund & Importe: ArbitrageOne „Jetzt abholen“, zweiter Abruf, fehlender Export, Zwei-Faktor (Importe – ArbitrageOne) – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Hintergrund & Importe: Amazon-Berichte sofort anfordern / Konto-Berichte / fertige abholen – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Hintergrund & Importe: Discord live und Abrufzeile „Call-Archiv (Discord live)“ – im letzten Lauf nicht gelaufen
- ○ Einstellungen › Hintergrund & Importe: BQool-Upload „hat geklappt“ – im letzten Lauf nicht gelaufen
- ○ /posteingang/verbinden: Postfach verbinden: App-Passwort zuerst, Anleitung (Google, Microsoft 365, GMX/WEB.DE, IONOS/STRATO), „Nur abrufen“, OAuth nur unter „Erweitert“ – im letzten Lauf nicht gelaufen
- ○ /posteingang/verbinden: Mails hochladen: niederländische Compliance-Mail und Routinemail „Verkauft, jetzt liefern“ – im letzten Lauf nicht gelaufen
- ○ /assistent-verlauf: B25.6 Rückgängig für aufgabe_verschieben (auch aufgabe_zuweisen, auftrag_status, privat_eintrag_anlegen) – im letzten Lauf nicht gelaufen
- ○ /assistent-verlauf: Auftrag an Claude aus den Amazon-ToDos: „ToDos mit versendetem Auftrag erledigen“ → Vorschau → Ausführen → Verlauf → Rückgängig; gelber Auftragsstatus; Preis ändern; Mail mit „ignore previous instructions“; VA-Konto; gleiche Aktion über den Konnektor – im letzten Lauf nicht gelaufen
- ○ /calls/offen: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ /kalender/zeiten: Freier Tag → Aufgabe wandert auf den nächsten Arbeitstag; Wochenrückblick – im letzten Lauf nicht gelaufen
- ○ /privat/familienaufgaben: Familien-Zugang: Aufgabe anlegen, Fairness aus; kein Geld/Tagebuch/Geschäft – im letzten Lauf nicht gelaufen
- ○ /deal-eingang/lernen: B28.8 Abnahme 8: zwei Verlustprodukte + ein Gewinner im Vormonat, „Liste jetzt erstellen“, „Nie wieder“ mit Grund und Freitext, Büro-Kraft mit Deal-Eingang-Zugriff – im letzten Lauf nicht gelaufen
- ○ /privat/therapie-bogen: Therapie-Bogen seit letzter Sitzung (B16): Beobachtung mit 3 Feldern und „[?]“, Zeitraum wählen, Beobachtung ändern/löschen per Formular und Claude, rückgängig – im letzten Lauf nicht gelaufen
- ○ /privat/geld: Frage für den Steuerberater, nur für die eigene Person – im letzten Lauf nicht gelaufen
- ○ Fragefeld: Altes Gespräch nach Update fortsetzen – im letzten Lauf nicht gelaufen
- ○ Fragefeld: Privates im Kalender-Werkzeug – im letzten Lauf nicht gelaufen

**Live geprüft:**

- Uhren: Buy & Flip › Deals: Uhren-Deal bearbeiten (vor dem 28.10.2026, Prüfung mit ChatGPT) – Eingaben/Status gingen verloren – behoben, seither automatisch geprüft
- Uhren: Buy & Flip › Deals: Übungs-Deal (vor dem 28.10.2026, Prüfung mit ChatGPT) – zählte unter „Verworfen“ – behoben, seither automatisch geprüft
- Fragefeld: Altes Gespräch fortsetzen (vor dem 28.10.2026, Nutzung im Betrieb) – 400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft
- Server (Port, Adresse, Testumgebung): Erreichbarkeit (vor dem 28.10.2026, Prüfung mit ChatGPT) – Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen

**Noch nicht geprüft** (Funktionen ohne Ablaufprüfung, 59 Reiter – die Seiten selbst laufen in der Oberflächen-Prüfung mit):

Tagesplan (Anrufe) (`/kalender/tagesplan`) · Uploads (`/uploads`) · Fahrtenbuch (`/kalender/fahrten`) · Deal-Ampel (`/lieferanten/deal-ampel`) · Scanner (`/scan`) · Bestellvorschläge (`/einkauf/vorschlaege`) · Einkauf & Wareneingang (`/einkauf`) · EK-Import (→ sellerboard) (`/einkauf/ek-import`) · Dropship-Trackings (`/einkauf/beschaffungsanalyse`) · Feeds (`/lieferanten`) · Abfrage (`/lieferanten/abfrage`) · Chancen (`/lieferanten/chancen`) · Großhändler finden (`/lieferanten/finden`) · Amazon-ToDos (`/amazon-todos`) · Fälle & A-bis-Z (`/faelle`) · Listungen (alle Kanäle) (`/listings`) · SAS-Programm (`/sas`) · Bewertungen (`/bewertungen`) · eBay (`/ebay`) · Temu / Wawi (`/listings/temu`) · Produkte (`/produkte`) · Artikelstamm (`/artikel`) · Chargen (`/chargen`) · Paletten-Lager › Lagerplan (`/paletten/lagerplan`) · Paletten-Lager › Abholung (`/paletten/abholung`) · Paletten-Lager › Inventur (`/paletten/inventur`) · Paletten-Lager › Abrechnung (`/paletten/abrechnung`) · Paletten-Lager › Kunden & Preise (`/paletten/kunden`) · Paletten-Lager › Auswertung (`/paletten/uebersicht`) · Label aus Chat (DHL) (`/versand/label`) · Retouren (`/retouren`) · Remissionen (`/remissionen`) · Buchhaltung (Abgleich, DATEV) (`/buchhaltung`) · COG-Export (`/export`) · Belege scannen (`/rechnungen/belege`) · Ausgangsrechnungen (`/rechnungen/ausgang`) · Kunden (`/rechnungen/kunden`) · Preislisten je Land (`/b2b/preislisten`) · B2B-Kunden (`/b2b/kunden`) · Lieferanten-Freigaben (`/b2b/lieferanten`) · Bilanz (`/b2b/bilanz`) · Ideen & Saison (`/marken`) · Content-Plan (`/marken/content`) · Shop-Analyse (`/marken/shop`) · Markenprofile (`/marken/profile`) · Uhren: Buy & Flip › Lernen (`/marken/uhren/lernen`) · Uhren: Buy & Flip › Rechner (`/marken/uhren/rechner`) · Uhren: Buy & Flip › Marktpreise (`/marken/uhren/preise`) · Kalender (`/privat/kalender`) · Eintragen (`/privat/eintragen`) · Nachrichten (`/privat/nachrichten`) · Rückblick (`/privat/rueckblick`) · Einstellungen (`/privat/einstellungen`) · Einstellungen › Geräte: Handy & Tesla (`/einstellungen/handy`) · Einstellungen › Apple Watch (`/einstellungen/watch`) · Einstellungen › Benachrichtigungen (`/einstellungen/benachrichtigungen`) · Einstellungen › Shop-Profile (`/einstellungen/shop-profile`) · Einstellungen › Abholung (`/einstellungen/abholung`) · Einstellungen › Testumgebung (`/einstellungen/testumgebung`)

**Bekannte offene Punkte:**

- Tagesübersicht: Aufgaben anlegen, erledigen, verschieben
- Tagesübersicht: Tageskennzahlen
- Posteingang: Mails abrufen (nur echte Postfächer) – inkl. Gesendet-Ordner und Minuten-Abruf
- Posteingang: Entwurf echt senden (nur mit echtem Postfach)
- Posteingang: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test
- Posteingang: Outlook: Zuordnung gesendeter Mails nur über Betreff + Empfänger (kein In-Reply-To aus Graph)
- Schnellerfassung: Echtes Handy (Kurzbefehle/Widget)
- Schnellerfassung: Echter Tesla (Fleet-API-App, virtueller Schlüssel, Befehls-Proxy)
- Schnellerfassung: Echte SMS über Twilio
- Deal-Eingang: B28: Bestellmail an echte Lieferanten (Zustellung, Message-ID-Erhalt je Postfach) und Discord-Rückfrage nach 👍 im echten ProfitPath-Kanal (Bot braucht dort „Nachrichten senden“, „Threads erstellen“, „Reaktionen hinzufügen“) – nur live
- Deal-Eingang: ProfitPath mit echtem Discord-Bot (Message Content Intent, Rechte „Kanal ansehen“ + „Nachrichtenverlauf lesen“) – nur live
- Deal-Eingang: Lugru Deals live: Programm auf den neuen Stand bringen, Seller-Adresse + Verbindungsschlüssel eintragen – die History kommt dann von selbst
- Deal-Eingang: Echte Bestellbestätigungen anderer Shops (Betreff/Format je Shop) – nur live
- Fall-Zentrale: Echte Seller-Central-Mails (nur live mit Nur-ansehen-Daten)
- Fall-Zentrale: SP-API: Listings Restrictions (Freischaltungsstatus je Marktplatz) – braucht die Amazon-Anbindung
- Repricer (BQool): Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen
- Repricer (BQool) › Leistung: Echte BQool-Berichtsseiten „Listing Performance“/„Daily Sales“ unter Anbindungen eintragen und einmal „Jetzt starten“ (nur live)
- Repricer (BQool) › Leistung: Spalte „Products“ der echten Datei: SKU-Erkennung beim ersten Upload prüfen (Ergebnis nennt Zeilen ohne SKU)
- Repricer (BQool) › BQool-Dateien: Echte BQool-Seiten: Export-Seite DE (Download „Full Template“) und Upload-Dateityp „Repricing Central File“ – einmal mit „Verbindung testen“ und „Jetzt starten“ prüfen (nur live)
- Repricer (BQool) › BQool-Dateien: Min-Verhalten in BQool an einer SKU nachsehen, dann Häkchen „Min-Verhalten geprüft“ (B31.3)
- Amazon Business: Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen
- Abholung DHL/UPS: Echte DHL-Abholung: API „Parcel DE Pickup“ in der DHL-App freischalten, GKP-Benutzer mit Abholrecht, Abholorte eintragen – erste Buchung (Sandbox aus) nur live (To-do)
- Abholung DHL/UPS: Echte UPS-Abholung: App im UPS Developer Portal (OAuth + Pickup), Zugang unter Anbindungen → UPS – erste Buchung nur live (To-do)
- Retouren-Station & Fälle: Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell
- Retouren-Station & Fälle: Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen
- Retouren-Station & Fälle: Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen
- Gewinn: Amazon-Zeile mit echten Abrechnungen gegen sellerboard vergleichen (−525 € laut Testbericht)
- Verlust-Stopp: Echte sellerboard-Tageswerte je Produkt (kommen mit „Gewinn je Produkt und Tag“ um 04:00 und 13:00)
- Rechnungsstation (Kamera): Kamera an der Werkbank: Auslöser (Blatt still, Ränder erkannt) und Entzerren mit echtem Papier – Logik im Unit-Test, Gerät nur live
- Rechnungsstation (Kamera): Einzugsscanner: Netzwerkfreigabe auf ./scan-eingang einrichten, echte PDF mit Kassenzetteln/Rechnungen – nur live
- Rechnungsstation (Kamera): Drive-Belegordner: Dienstkonto mit Schreibrecht, Ordner-ID in der Prüfliste (Inhaber) – nur live
- Deals: Echte Lexoffice-Anbindung mit dem Schlüssel der Deal-Firma (Rechnungsnummern, Reverse-Charge-Text, PDF)
- Deals: Echter VIES-Abruf mit eigener USt-IdNr. (Kennung der qualifizierten Abfrage)
- Deals: Discord-Webhook im echten B2B-Kanal
- Deals: PrepTool (preptool.de): API-Anbindung folgt, sobald Instanz-Adresse und OpenAPI-Datei vorliegen – bis dahin Export neutral (CSV/XLSX/PDF)
- Deals: Steuer: Reverse Charge nur, wenn die Ware Deutschland verlässt – bei FBA-Versand in DE mit dem Steuerberater klären
- VA & Delegation: VA-Automatik live: Zeitzone „Asia/Manila“ prüfen, einige Tage im Modus „Vorschlag“ beobachten, dann auf „automatisch“ umstellen
- Calls (Consultant & Gruppe): Echter Discord-Bot im Call-Kanal (Bot-Token, Kanal-ID) und Freigabe der Google Docs
- Calls (Consultant & Gruppe): Export des bisherigen Call-Archivs auf dem Server hochladen (echte Daten, nicht im Repo)
- Calls (Consultant & Gruppe): Gruppen-Kanäle: Bot vom Server-Admin der Deal-Gruppe eingeladen (nur Leserechte)
- Rechtsfälle (Anwalt): Echter Asana-Zugang (Token) beim Anwalt; ob Webhooks für Gäste gehen
- Rechtsfälle (Anwalt): Echte Anwalts-Mails (Domain, Aktenzeichen-Format)
- Übersicht: Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests
- Übersicht: Live nie prüfen (echte private Daten)
- Einstellungen › Anbindungen: B30 mit der echten PurchaseOrders-Datei: Import vom 06.11. nach dem Update „fertig“, Spaltenzuordnung (EK netto/brutto, Menge, Status) prüfen; Lauf am 07.11. 05:30 Einkäufe · ok – nur live (To-dos 90/91)
- Einstellungen › Anbindungen: B29 Abnahme 1 und 4 mit echtem sellerboard: am 06.11. nach 01:00 laufen alle Abrufe wieder, um 12:00 höchstens 45 Aufrufe laut Zähler; ein ganzer Tag mit Morgenbericht und drei Nachfragen endet unter 125 – nur live (Rechnung nach Plan im Unit-Test: 45 bis 12:00, 72 am Tag)
- Einstellungen › Anbindungen: B29 schlanke Feldauswahl (bis 200 Zeilen je Seite) gegen echtes sellerboard – lehnt sellerboard sie ab, fällt der Abruf von selbst auf volle Zeilen zurück
- Einstellungen › KI-Assistent: Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)
- Einstellungen › KI-Assistent: getItemOffers-Ratenlimit im Betrieb beobachten
- /posteingang/verbinden: IMAP mit echtem Postfach: Ordnerauswahl (Gmail „Alle Nachrichten“), Test-Knopf, SMTP 465 → 587, Fehlerarten (Anmeldung, IMAP aus, Port) – nur live mit Nur-ansehen-Daten
- Server (Port, Adresse, Testumgebung): `deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)
- Server (Port, Adresse, Testumgebung): `deploy/testumgebung.sh an` + `pruefen` auf dem Server
