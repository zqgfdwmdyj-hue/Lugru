# Prüfstand je Reiter

Noch kein Lauf gefunden (test-results/ergebnis.json fehlt) – erst `npm run e2e` ausführen.

Erzeugt mit `npm run pruefstand` aus `e2e/pruefstand.ts` (Abläufe, Live-Prüfungen) und dem letzten Lauf. Nicht von Hand bearbeiten.

Zeichen: ✓ automatisch bestanden · ✕ automatisch fehlgeschlagen · ○ im letzten Lauf nicht gelaufen · 👁 live geprüft · – noch nicht geprüft

## Übersicht

| Bereich | Reiter | Automatisch | Live | Noch offen |
|---|---|---|---|---|
| Heute | Tagesübersicht `/` | ○ 0/3 Abläufe | – | 2 |
| Heute | Tagesplan `/kalender/tagesplan` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Termine `/kalender` | ○ 0/2 Abläufe | – | – |
| Heute | Posteingang `/posteingang` | ○ 0/4 Abläufe | – | 3 |
| Heute | Uploads (alles hochladen) `/uploads` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Schnellerfassung (Sprache) `/schnell` | ○ 0/2 Abläufe | – | 3 |
| Heute | Feierabend `/kalender/feierabend` | ○ 0/2 Abläufe | – | – |
| Heute | Fahrtenbuch `/kalender/fahrten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Heute | Rechtsfälle (Anwalt) `/rechtsfaelle` | ○ 0/1 Abläufe | – | 2 |
| Einkauf | Deal-Eingang `/deal-eingang` | ○ 0/4 Abläufe | – | 3 |
| Einkauf | Lugru Deals `/deal-eingang/lugru` | ○ 0/1 Abläufe | – | – |
| Einkauf | Bestellvorschläge `/einkauf/vorschlaege` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | EK-Import (→ sellerboard) `/einkauf/ek-import` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Scanner (Barcode mit Ampel) `/scan` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Deal-Ampel (Einkauf prüfen) `/lieferanten/deal-ampel` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Einkauf & Wareneingang `/einkauf` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Dropship-Trackings `/einkauf/beschaffungsanalyse` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Lieferanten-Feeds `/lieferanten` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Lieferanten-Abfrage `/lieferanten/abfrage` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Chancen `/lieferanten/chancen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Großhändler finden `/lieferanten/finden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einkauf | Kontakt-Board `/board` | ○ 0/1 Abläufe | – | – |
| Amazon | Fall-Zentrale `/amazon-faelle` | ○ 0/3 Abläufe | – | 2 |
| Amazon | Amazon-ToDos `/amazon-todos` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon | Repricer (BQool) `/repricer` | ○ 0/4 Abläufe | – | 1 |
| Amazon | Listungen (alle Kanäle) `/listings` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon | SAS-Programm `/sas` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon | FBA-Inbound `/inbound` | ○ 0/1 Abläufe | – | – |
| Amazon | Ansprüche `/ansprueche` | ○ 0/2 Abläufe | – | – |
| Amazon | Fälle & A-bis-Z `/faelle` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon | Bewertungen `/bewertungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Amazon | Amazon Business `/amazon-business` | ○ 0/2 Abläufe | – | 1 |
| Amazon | Echtheits-Ordner `/echtheit` | ○ 0/1 Abläufe | – | – |
| eBay & Temu | Neues eBay-Angebot `/ebay` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| eBay & Temu | eBay-Angebote prüfen `/ebay/pruefen` | ○ 0/1 Abläufe | – | – |
| eBay & Temu | eBay-Artikel & Gewinn `/ebay?ansicht=artikel` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| eBay & Temu | eBay-Verlauf `/ebay?ansicht=verlauf` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| eBay & Temu | eBay → Temu / Wawi `/listings/temu` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Gewinn `/gewinn` | ○ 0/3 Abläufe | – | 1 |
| Finanzen | Liquidität `/cashflow` | ○ 0/2 Abläufe | – | – |
| Finanzen | Buchhaltung (Abgleich, DATEV) `/buchhaltung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Importe (Daten importieren) `/import` | ○ 0/2 Abläufe | – | – |
| Finanzen | Verlust-Stopp `/verlust` | ○ 0/2 Abläufe | – | 1 |
| Finanzen | Hebel: Umsatz & Marge `/hebel` | ○ 0/1 Abläufe | – | – |
| Finanzen | Kapital-Ampel `/kapital` | ○ 0/3 Abläufe | – | – |
| Finanzen | Eingangsrechnungen `/rechnungen` | ○ 0/1 Abläufe | – | – |
| Finanzen | Belege scannen `/rechnungen/belege` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Ausgangsrechnungen `/rechnungen/ausgang` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | eBay-Rechnungen `/ebay?ansicht=rechnungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | Kunden `/rechnungen/kunden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Finanzen | COG-Export `/export` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Bestand & Inventur `/bestand` | ○ 0/3 Abläufe | – | – |
| Produkte & Lager | Paletten-Lager (Kunden) `/paletten` | ○ 0/1 Abläufe | – | – |
| Produkte & Lager | Paletten-Lager (Kunden) › Sendungen `/paletten/sendungen` | ○ 0/2 Abläufe | – | – |
| Produkte & Lager | Paletten-Lager (Kunden) › Lagerplan `/paletten/lagerplan` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager (Kunden) › Abholung `/paletten/abholung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager (Kunden) › Inventur `/paletten/inventur` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager (Kunden) › Abrechnung `/paletten/abrechnung` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager (Kunden) › Kunden & Preise `/paletten/kunden` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Paletten-Lager (Kunden) › Auswertung `/paletten/uebersicht` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Retouren-Station & Fälle `/remissionen/pruefungen` | ○ 0/3 Abläufe | – | 3 |
| Produkte & Lager | Produkte `/produkte` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Chargen `/chargen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Artikelstamm (eigene Marken) `/artikel` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Aufträge & Versand `/auftraege` | ○ 0/2 Abläufe | – | – |
| Produkte & Lager | Labels: Warensendung & DHL `/auftraege/lieferschein` | ○ 0/4 Abläufe | – | – |
| Produkte & Lager | Prep Center: Versand je Monat `/auftraege/prep-center` | ○ 0/2 Abläufe | – | – |
| Produkte & Lager | Retouren `/retouren` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Produkte & Lager | Remissionen `/remissionen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
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
| Delegation | VA & Delegation `/delegation` | ○ 0/4 Abläufe | – | 1 |
| Delegation | Alle Aufgaben `/?ansicht=liste` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Delegation | Anrufe (im Tagesplan) `/kalender/tagesplan?anrufe=1` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Wissen & Calls | Wissen `/wissen` | ○ 0/2 Abläufe | – | – |
| Wissen & Calls | Calls (Consultant & Gruppe) `/calls` | ○ 0/5 Abläufe | – | 3 |
| Privat | Übersicht `/privat` | ○ 0/5 Abläufe | – | 2 |
| Privat | Kalender `/privat/kalender` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Eintragen `/privat/eintragen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Rückblick `/privat/rueckblick` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Privat | Einstellungen `/privat/einstellungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Einstellungen `/einstellungen` | ○ 0/4 Abläufe | – | – |
| Einstellungen | Anbindungen `/anbindungen` | ○ 0/2 Abläufe | – | – |
| Einstellungen | Claude & KI-Assistent `/einstellungen/claude` | ○ 0/8 Abläufe | – | 2 |
| Einstellungen | Handy & Tesla `/einstellungen/handy` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Apple Watch `/einstellungen/watch` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | Shop-Profile & Payback `/einstellungen/shop-profile` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Einstellungen | eBay-Einstellungen `/ebay?ansicht=einstellungen` | ○ nur Oberfläche | – | Funktionen ungeprüft |
| Übergreifend | /posteingang/verbinden `/posteingang/verbinden` | ○ 0/2 Abläufe | – | 1 |
| Übergreifend | /assistent-verlauf `/assistent-verlauf` | ○ 0/2 Abläufe | – | – |
| Übergreifend | /calls/offen `/calls/offen` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /kalender/zeiten `/kalender/zeiten` | ○ 0/1 Abläufe | – | – |
| Übergreifend | /privat/familienaufgaben `/privat/familienaufgaben` | ○ 0/1 Abläufe | – | – |
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
| Gerichts-/Behörden-Mail und Anwalts-Mails (B14) | Behörde: Entwurf an den Anwalt (nicht gesendet) + Aufgabe; Anwalt mit Aktenzeichen: in den Fall statt in den Posteingang | ○ im letzten Lauf nicht gelaufen | `recht-discord.spec.ts` |

- – Offen: Mails abrufen (nur echte Postfächer)
- – Offen: Entwurf echt senden (nur mit echtem Postfach)
- – Offen: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test

### Heute › Schnellerfassung (Sprache) (`/schnell`)

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

### Heute › Rechtsfälle (Anwalt) (`/rechtsfaelle`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Asana-Fall (nur lesen) mit Kommentar „Bitte bis … Unterlagen senden“, privater Fall, Anwalts-Mails, Claude | Status und Frist im Fall, wir am Zug, Aufgabe 3 Tage vorher (Kalender), privater Fall nur im Privatbereich, Startseite nur mit Anzahl, Entwurf nie gesendet, Asana nie beschrieben | ○ im letzten Lauf nicht gelaufen | `recht-discord.spec.ts` |

- – Offen: Echter Asana-Zugang (Token) beim Anwalt; ob Webhooks für Gäste gehen
- – Offen: Echte Anwalts-Mails (Domain, Aktenzeichen-Format)

### Einkauf › Deal-Eingang (`/deal-eingang`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B25.3 Schwelle „Lugru Deals=60“ | als gespeicherter Wert im Feld, nicht als Platzhalter | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |
| Text, Screenshot (3 Angebote), Kurzbefehl mit Geräte-Schlüssel, Kapital-Ampel rot, Preisliste (XLSX 500 Zeilen), Mail „Deal prüfen“, ProfitPath über Discord, Knöpfe Bestellvorschlag/B2B-Deal, Claude-Werkzeuge | Ampel je Angebot mit Gründen; Push ≤ 60 s nur bei Grün/Gelb (ProfitPath); widerrufener Schlüssel abgelehnt; gleiche ASIN/EK zusammengefasst, neuer EK = Update; Einkaufsentwurf und B2B-Entwurf angelegt | ○ im letzten Lauf nicht gelaufen | `deal-eingang.spec.ts` |
| Abschnitt 10/11: Lugru-Deals-History über den Endpunkt (mit/ohne Schlüssel, erneut senden), Budget-Grenze je Deal, geteilter Deal mit Shop-Link, „Gekauft: Menge, Preis“, Amazon-Bestellbestätigung als .eml, 👎 aus der Push-Meldung mit Grund, 👍 unter der ProfitPath-Nachricht in Discord, Wareneingang + 35 Tage mit sellerboard-Monat, Monatsbericht, Claude-Werkzeuge | History neu/aktualisiert/ungültig gezählt, ohne Schlüssel 401; Deal-Wert „Passt zu dir (X/100)“ mit ähnlichen Deals (Lugru-Gruppe); über Budget höchstens Gelb mit Budget-Grund; Push mit „Zum Angebot“ (Shop-Link) und „Gekauft …“; gekauft → Bestellung „bestellt“ + Aufgabe „Wareneingang buchen“; Mail → gekauft (Menge, Preis, Bestellnummer), Mail bleibt im Posteingang; 👍/👎 mit Weg gespeichert; Ergebnis nach 30 Tagen mit realem ROI; deal_wert/deal_lernen_bericht/deal_bewerten/deal_gekauft | ○ im letzten Lauf nicht gelaufen | `deal-wert.spec.ts` |
| Lücken aus dem Bauauftrag (Abschnitte 2, 4, 5, 7): weitere Einstellungen (ungültiger/gültiger iCloud-Link), Kurzbefehl-Skizzen, offene Rechteinhaber-Beschwerde zur ASIN, Lieferant ohne Marktplatz-Freigabe + Gefahrgut, Keepa-Mini-Chart, Screenshot im Original und fremde Datei | Einstellungen gespeichert, Budget/Ziel-ROI unverändert; Link + 4 Skizzen; Rot mit Fallnummer; Rot „selektiver Vertrieb“ + Gelb Gefahrgut als 2. Grund; Chart mit Ø/Tief/Stand; Bild 200 image/png, Datei über anderen Eingang 404 | ○ im letzten Lauf nicht gelaufen | `deal-eingang-luecken.spec.ts` |

- – Offen: ProfitPath mit echtem Discord-Bot (Message Content Intent, Rechte „Kanal ansehen“ + „Nachrichtenverlauf lesen“) – nur live
- – Offen: Lugru Deals live: Programm auf den neuen Stand bringen, Seller-Adresse + Verbindungsschlüssel eintragen – die History kommt dann von selbst
- – Offen: Echte Bestellbestätigungen anderer Shops (Betreff/Format je Shop) – nur live

### Einkauf › Lugru Deals (`/deal-eingang/lugru`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Lugru Deals über Discord: History, Live-Post, Reaktion, doppelter Post, eigener Kauf, Statistik, deal_quellen, Deal-Wert | Live-Post im Deal-Eingang mit Ampel (Push nur Grün/Gelb), History mit Reaktionen, Statistik aktualisiert, „Lugru Deals“ in deal_quellen, keine Namen gespeichert | ○ im letzten Lauf nicht gelaufen | `lugru-deals.spec.ts` |

### Einkauf › Kontakt-Board (`/board`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Aufgabe zuweisen hängt passende Anleitung an; zugewiesene Person sieht sie | 📘-Link auf der Karte, auch bei der Assistenz | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Amazon › Fall-Zentrale (`/amazon-faelle`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Amazon-Mails einordnen: Freischaltung abgelehnt, Fall „Antwort nötig“ (2 Mails, gleiche Fall-ID), Freischaltung entzogen, unsichere Mail | Paket mit Rechnung ≤ 180 Tage und ≥ 10 Stück, VA-Thread; ein Vorgang mit Antwort DE/EN inkl. Sendung, POD als „fehlt“; Entzug rot mit Meldung an Ludwig und Bestand in €; Einordnung von Hand lernt; Claude-Werkzeuge | ○ im letzten Lauf nicht gelaufen | `amazon-faelle.spec.ts` |
| 20 erfundene Amazon-Mails in 8 Sprachen einordnen (Unit-Test) | ≥ 18 richtig (Bereich und Phase), Fall-ID/ASIN/Frist erkannt | ○ im letzten Lauf nicht gelaufen |  |
| Amazon-Berichte 1–4: Konto-Berichte anfordern/abholen, Kontozustand, gestrandet/gesperrt, weitere Gebühren, USt per Schnittstelle, Datei-Import | DE „gefährdet“ (neue Markenbeschwerde), FR gut; 2 SKUs/8 Stück/10,50 € gebunden; Tasse gesperrt; Langzeitlager 3,40 €, Inbound 1,20 €; Aufgaben + Push; USt mit Quelle api; amazon_faelle/amazon_lagergebuehren | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |

- – Offen: Echte Seller-Central-Mails (nur live mit Nur-ansehen-Daten)
- – Offen: SP-API: Listings Restrictions (Freischaltungsstatus je Marktplatz) – braucht die Amazon-Anbindung

### Amazon › Repricer (BQool) (`/repricer`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| BQool-Export „Manage Listings“ hochladen | Rückmeldung mit Anzahl je Marktplatz, Auffälligkeiten (ohne Min, pausiert, ohne Regel) in der Tabelle und im Werkzeug „repricer“ | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |
| B15.11 Übersicht je Regel, Filter, alle Länder | Regel mit DE/FR, aktiv/pausiert richtig (Angebotsstatus „Inactive“ ≠ pausiert); Filter Land und Status | ○ im letzten Lauf nicht gelaufen | `b15-anzeige.spec.ts` |
| B25.5 /repricer/export ohne Format | leitet auf die Vorschau „BQool-Dateien“ mit Warnungen je Land; CSV nur mit ?format | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

- – Offen: Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen

### Amazon › FBA-Inbound (`/inbound`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| FBA-Sendung scannen | unbekannter Code → Fehler; gültiger Code bucht; Karton-Auswahl bleibt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |

### Amazon › Ansprüche (`/ansprueche`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Als eingereicht markieren (über Claude) | nur mit Freigabe „ändern“; Status, Fallnummer, Zeitpunkt und Protokolleintrag „über Claude“; zweiter Aufruf ändert nichts Falsches | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |

### Amazon › Amazon Business (`/amazon-business`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Geschäftsbericht (CSV) hochladen, Staffelpreis-Vorschlag übernehmen, Freigabe, Upload-Datei | B2B-Werte je ASIN, Status freigegeben, Datei mit business-price | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

- – Offen: Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen

### Amazon › Echtheits-Ordner (`/echtheit`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket | Beleg + SKU im Ordner, ZIP (PK…) | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### eBay & Temu › eBay-Angebote prüfen (`/ebay/pruefen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kleinanzeigen-Entwurf am eBay-Angebot | Titel ≤ 65, Kategorie, Zustand, Preis in ganzen Euro, Text ohne eBay-Sätze, Bilder + ZIP; nichts wird eingestellt | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |

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

### Finanzen › Importe (Daten importieren) (`/import`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Unbekannte Datei importieren | Fehler, Datei bleibt ausgewählt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| B25.2 Spalte „Ergebnis / Fehler“, Lagergebühren/USt-Bericht unter „Was erkannt wird“ | Ergebnis je Import (auch „nachgezogen“), fehlgeschlagene Uploads und abgelehnte Schnittstellen-Berichte mit Fehler | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

### Finanzen › Verlust-Stopp (`/verlust`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| 2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar | Aufgabe „verlust-<SKU>“ offen/wichtig bzw. nicht mehr offen | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

- – Offen: Echte sellerboard-Tageswerte je Produkt (kommen mit dem täglichen Komplett-Abgleich)

### Finanzen › Hebel: Umsatz & Marge (`/hebel`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | geschätzte Werte gekennzeichnet | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |

### Finanzen › Kapital-Ampel (`/kapital`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Ladenhüter (Reichweite > 120 T) wird rot mit Vorschlägen | Ampel rot, „Nicht nachbestellen“ | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Kennzahlen | Zeitraum, Quelle, Stand | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Hinweis gestrandeter Bestand + weitere Amazon-Gebühren | Stück, gebundenes Kapital, Langzeit-Lagergebühr | ○ im letzten Lauf nicht gelaufen | `amazon-berichte.spec.ts` |

### Finanzen › Eingangsrechnungen (`/rechnungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Rechnung hochladen, Sammelbearbeitung | Upload leert nach Erfolg; Auswahl bleibt bei Fehlschlag; Rückfrage abgelehnt = nichts passiert | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |

### Produkte & Lager › Bestand & Inventur (`/bestand`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Herkunft je Kennzahl, keine kaputten Werte | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Inventur scannen | bucht +1, Feld leert sich für den nächsten Scan | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| B15.3 Prep Center verschickt | eigenes Lager unverändert; alte Fehlbuchung als Vorschlag, Zurückbuchen nur auf Klick | ○ im letzten Lauf nicht gelaufen | `b15-sofort.spec.ts` |

### Produkte & Lager › Paletten-Lager (Kunden) (`/paletten`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| B15.13 Palette ohne Kunde | Warnung mit Palettennummer, Filter „ohne Kunde“ | ○ im letzten Lauf nicht gelaufen | `b15-anzeige.spec.ts` |

### Produkte & Lager › Paletten-Lager (Kunden) › Sendungen (`/paletten/sendungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen | Meldung im System + Mail (abgefangen), Kunden sieht nur Freigegebenes, Links verfallen | ○ im letzten Lauf nicht gelaufen | `sendungen.spec.ts` |
| Notiz über Claude bzw. Fragefeld | nur mit Recht; Mitarbeiter als Vorschlag mit Ausführen/Ablehnen | ○ im letzten Lauf nicht gelaufen | `rechte.spec.ts` |

### Produkte & Lager › Retouren-Station & Fälle (`/remissionen/pruefungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Retouren-Station: Paket mit 4 Artikeln ohne Tastatur/Maus (Sprache + Handscanner) | Remission über Etikett, Lieferschein-Abgleich, LPN → Kundenretoure; Fall nur ab Schwelle und wenn Amazon nicht gezahlt hat; KI-Warnung bei Abweichung; Netz weg → Warteschlange; Video je Paket | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |
| Fall-Paket und Eingereicht | Text DE/EN, Fotos 1_Versandetikett … 4_Inhalt in fester Reihenfolge, ZIP, Anspruch mit Betrag/Frist, Fallnummer + Eingereicht im Verlauf; RET-SKU mit EK der Charge | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |
| Rechte der Station | ohne Bereich Amazon kein Zugriff auf Station, Schnittstelle und Fotos | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |

- – Offen: Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell
- – Offen: Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen
- – Offen: Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen

### Produkte & Lager › Aufträge & Versand (`/auftraege`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Labels kaufen und alle als versendet melden (Amazon, simuliert) | Versandbestätigung je Amazon-Auftrag an den Testdienst; eBay ohne Verbindung als Meldung | ○ im letzten Lauf nicht gelaufen | `labels.spec.ts` |
| Ansicht „Meldung offen“ | fehlgeschlagene Meldungen sichtbar | ○ im letzten Lauf nicht gelaufen | `labels.spec.ts` |

### Produkte & Lager › Labels: Warensendung & DHL (`/auftraege/lieferschein`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Falsche Datei hochladen | Fehler; Datei und Haken bleiben; Kanal bei „Offene Aufträge“ bleibt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Vorschau mit lauter „bitte prüfen“ | Fehler; Auswahl je Bestellung bleibt | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Gewichte pflegen | unklare Eingabe bleibt stehen, gültige Zeile zeigt gespeicherte Werte, neue Zeile leert sich | ○ im letzten Lauf nicht gelaufen | `formulare.spec.ts` |
| Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert) | 5 Labels, Kabel als DHL-Paket, keine echten Käufe | ○ im letzten Lauf nicht gelaufen | `labels.spec.ts` |

### Produkte & Lager › Prep Center: Versand je Monat (`/auftraege/prep-center`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Kennzahlen | Zeitraum = Monat, Stand = letzter Bestellabruf, fehlende Gebühren als Text statt 0 | ○ im letzten Lauf nicht gelaufen | `kennzahlen.spec.ts` |
| Frage im Fragefeld „Was kostet uns das Prep Center?“ | exakte Zahlen je Monat aus den Testdaten + Erklärung | ○ im letzten Lauf nicht gelaufen | `fragefeld.spec.ts` |

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

### Delegation › VA & Delegation (`/delegation`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Aufgabe an die VA über Discord: Thread mit Anleitung und Datei, ✅ erledigt, Rechnungsfrage automatisch beantwortet, Rückfrage → Antwort im Thread | Thread je Aufgabe, Status übernommen, keine Privat-/Finanzdaten an die VA | ○ im letzten Lauf nicht gelaufen | `va-discord.spec.ts` |
| B18: Anspruch mit Frist in 8 Tagen, Frist rückt auf 7/5/3/1 Tage, VA antwortet „case 12345678901“, Anspruch mit Frist heute, dann abgelaufen; Claude va_aufgaben/ueberblick | Thread sofort (Englisch, Art, SKU, Sendung, Menge, Betrag, Frist, Anleitung); Erinnerung nur an −7/−3/−1; eingereicht mit Fallnummer; Fristtag → Meldung an Ludwig; verpasst → Liste „Premium-Support/PSTAM“, Zeile „N Fristen verpasst“ rot (VA-Seite, Feierabend, ueberblick); „Daily overview“ einmal am Tag mit Thread-Links | ○ im letzten Lauf nicht gelaufen | `va-automatik.spec.ts` |
| B18: Amazon-Mails Markenbeschwerde, Fall „Antwort nötig“ 120 €, Fall 800 €, Fallnummer im Fall-Thread, „An die VA“ von Hand, Modus „Vorschlag“, Regel je Kategorie ändern | Marke nur Ludwig; 120 € automatisch Thread; 800 € erst Ludwig (Meldung, Knopf); Vorgang „eingereicht“; im Vorschlag kein Thread, tägliche Aufgabe; Regel gespeichert | ○ im letzten Lauf nicht gelaufen | `va-automatik.spec.ts` |
| B18: Tagesgrenze erreicht, zwei neue Ansprüche, VA antwortet „#n case …“ im Sammel-Thread | beide im Sammel-Thread (#1, #2), nur der genannte eingereicht | ○ im letzten Lauf nicht gelaufen | `va-automatik.spec.ts` |

- – Offen: VA-Automatik live: Zeitzone „Asia/Manila“ prüfen, einige Tage im Modus „Vorschlag“ beobachten, dann auf „automatisch“ umstellen

### Wissen & Calls › Wissen (`/wissen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Wissen aus Calls: KI-Auszug je Call, Bereich „Aus Calls“, Eintrag mit Quelle, Suche | Einträge mit Einschätzung und Link zum Call, im Bereich „Aus Calls“ und in der Suche | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |
| Anleitung anlegen und beim Zuweisen anhängen | Anleitung im Wissen, 📘 an der Aufgabe | ○ im letzten Lauf nicht gelaufen | `teil2.spec.ts` |

### Wissen & Calls › Calls (Consultant & Gruppe) (`/calls`)

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

### Privat › Übersicht (`/privat`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen | Ausnahme bleibt bei Serienänderung erhalten; nur die gewählten Termine ändern/verschwinden | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
| Abendritual als Abfolge „zweimal Streicheln, danach Massage“ | die nächsten Abende im Voraus: S, S, M, S, S, M | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
| Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe | nichts Privates sichtbar; nur mit Privat-Freigabe der Inhaberin im Konnektor | ○ im letzten Lauf nicht gelaufen | `privat.spec.ts` |
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

### Einstellungen › Anbindungen (`/anbindungen`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Karte „Postfächer“ und Warnung ohne Amazon-Mail; Google/Microsoft nur optional unter „Erweitert“ | Warnung „Kein Postfach verbunden“; Google-Karte zeigt OPTIONAL; anbindungen_status (nur Probleme) listet Google nicht, liefert Postfächer und Warnung | ○ im letzten Lauf nicht gelaufen | `postfach.spec.ts` |
| B25.12 Intervall je Abruf auf der Karte, echter Zeitplan statt „laut Plan“ | z. B. „Amazon-Bestellungen: alle 15 Min.“; Zeitplan aus dem letzten Lauf | ○ im letzten Lauf nicht gelaufen | `b25.spec.ts` |

### Einstellungen › Claude & KI-Assistent (`/einstellungen/claude`)

| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |
|---|---|---|---|
| Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten | nicht angebotene Werkzeuge abgewiesen und protokolliert; Änderungen nur als Vorschlag | ○ im letzten Lauf nicht gelaufen | `rechte.spec.ts` |
| Jedes lesende Werkzeug einzeln | Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten | ○ im letzten Lauf nicht gelaufen | `werkzeuge.spec.ts` |
| Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag) | Zahlen aus dem Keepa-Nachbau, zweiter Aufruf aus dem Zwischenspeicher (keine neue Keepa-Abfrage), unbekannte ASIN klar benannt | ○ im letzten Lauf nicht gelaufen | `keepa.spec.ts` |
| Keepa: Länder vergleichen | DE/FR/IT/ES/UK nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als „nicht bei Keepa“ | ○ im letzten Lauf nicht gelaufen | `keepa.spec.ts` |
| Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon) | Lager-Konto bekommt sie nicht, direkter Aufruf abgewiesen | ○ im letzten Lauf nicht gelaufen | `keepa.spec.ts` |
| Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live | Berichte unter Anbindungen anfordern/abholen; Werte aus dem Amazon-Nachbau je Land; Angebote live mit 10-Min.-Zwischenspeicher; unbekannte ASIN als Fehler je Land | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |
| Neue Werkzeuge ohne Neustart (notifications/tools/list_changed) | Ereignis-Kanal meldet beim Verbinden „tools/list_changed“ | ○ im letzten Lauf nicht gelaufen | `retouren-station.spec.ts` |
| Rechte der neuen Werkzeuge im Fragefeld | Büro: Posteingang, Repricer, Angebote live (über Wawi → Lieferanten); keine Buy Box, Listung, Lageralter, Ansprüche, Anbindungen | ○ im letzten Lauf nicht gelaufen | `geschaeft.spec.ts` |

- – Offen: Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)
- – Offen: getItemOffers-Ratenlimit im Betrieb beobachten

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

**Automatisch** (116 Abläufe + Oberfläche auf 107 Seiten): 0 bestanden, 0 fehlgeschlagen, 116 nicht gelaufen.

- ○ Tagesübersicht: B15.2 Privater Kalender auf der Startseite – im letzten Lauf nicht gelaufen
- ○ Tagesübersicht: B15.1 FBM-Versandbestätigung offen – im letzten Lauf nicht gelaufen
- ○ Tagesübersicht: B25.7 Paletten ohne Kunde unter „Jetzt dringend“ – im letzten Lauf nicht gelaufen
- ○ Termine: Geschäftskalender als Büro-Konto und als Inhaberin – im letzten Lauf nicht gelaufen
- ○ Termine: B25.8 Tagesplan: Termin mit Ort, Anruf-Aufgabe mit Nummer – im letzten Lauf nicht gelaufen
- ○ Posteingang: .eml-Datei hochladen – im letzten Lauf nicht gelaufen
- ○ Posteingang: Antwort-Entwurf (über Claude) prüfen und senden – im letzten Lauf nicht gelaufen
- ○ Posteingang: Posteingang auf null: Regel an Zuständigen, Auto-Archiv, Zahlung abgelehnt (IT), Termin-Mail → Privatkalender, Vorschlag für Claude – im letzten Lauf nicht gelaufen
- ○ Posteingang: Gerichts-/Behörden-Mail und Anwalts-Mails (B14) – im letzten Lauf nicht gelaufen
- ○ Schnellerfassung (Sprache): Diktat per Handy-Schlüssel: Aufgabe, Eingangsliste, Privates nur mit Zugang, Widerruf – im letzten Lauf nicht gelaufen
- ○ Schnellerfassung (Sprache): Widget, Anrufe in der Fahrzeit, Briefing je Ziel, SMS-Codes, Ins Auto, Fahrtenbuch, Scan, Auto-Status/Klima – im letzten Lauf nicht gelaufen
- ○ Feierabend: Feierabend: erledigt/offen, auf morgen schieben, morgen Top 3 – im letzten Lauf nicht gelaufen
- ○ Feierabend: Wochenrückblick mit „Privates zeigen“ (B16) – im letzten Lauf nicht gelaufen
- ○ Rechtsfälle (Anwalt): Asana-Fall (nur lesen) mit Kommentar „Bitte bis … Unterlagen senden“, privater Fall, Anwalts-Mails, Claude – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: B25.3 Schwelle „Lugru Deals=60“ – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Text, Screenshot (3 Angebote), Kurzbefehl mit Geräte-Schlüssel, Kapital-Ampel rot, Preisliste (XLSX 500 Zeilen), Mail „Deal prüfen“, ProfitPath über Discord, Knöpfe Bestellvorschlag/B2B-Deal, Claude-Werkzeuge – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Abschnitt 10/11: Lugru-Deals-History über den Endpunkt (mit/ohne Schlüssel, erneut senden), Budget-Grenze je Deal, geteilter Deal mit Shop-Link, „Gekauft: Menge, Preis“, Amazon-Bestellbestätigung als .eml, 👎 aus der Push-Meldung mit Grund, 👍 unter der ProfitPath-Nachricht in Discord, Wareneingang + 35 Tage mit sellerboard-Monat, Monatsbericht, Claude-Werkzeuge – im letzten Lauf nicht gelaufen
- ○ Deal-Eingang: Lücken aus dem Bauauftrag (Abschnitte 2, 4, 5, 7): weitere Einstellungen (ungültiger/gültiger iCloud-Link), Kurzbefehl-Skizzen, offene Rechteinhaber-Beschwerde zur ASIN, Lieferant ohne Marktplatz-Freigabe + Gefahrgut, Keepa-Mini-Chart, Screenshot im Original und fremde Datei – im letzten Lauf nicht gelaufen
- ○ Lugru Deals: Lugru Deals über Discord: History, Live-Post, Reaktion, doppelter Post, eigener Kauf, Statistik, deal_quellen, Deal-Wert – im letzten Lauf nicht gelaufen
- ○ Kontakt-Board: Aufgabe zuweisen hängt passende Anleitung an; zugewiesene Person sieht sie – im letzten Lauf nicht gelaufen
- ○ Fall-Zentrale: Amazon-Mails einordnen: Freischaltung abgelehnt, Fall „Antwort nötig“ (2 Mails, gleiche Fall-ID), Freischaltung entzogen, unsichere Mail – im letzten Lauf nicht gelaufen
- ○ Fall-Zentrale: 20 erfundene Amazon-Mails in 8 Sprachen einordnen (Unit-Test) – im letzten Lauf nicht gelaufen
- ○ Fall-Zentrale: Amazon-Berichte 1–4: Konto-Berichte anfordern/abholen, Kontozustand, gestrandet/gesperrt, weitere Gebühren, USt per Schnittstelle, Datei-Import – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): BQool-Export „Manage Listings“ hochladen – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): B15.11 Übersicht je Regel, Filter, alle Länder – im letzten Lauf nicht gelaufen
- ○ Repricer (BQool): B25.5 /repricer/export ohne Format – im letzten Lauf nicht gelaufen
- ○ FBA-Inbound: FBA-Sendung scannen – im letzten Lauf nicht gelaufen
- ○ Ansprüche: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Ansprüche: Als eingereicht markieren (über Claude) – im letzten Lauf nicht gelaufen
- ○ Amazon Business: Geschäftsbericht (CSV) hochladen, Staffelpreis-Vorschlag übernehmen, Freigabe, Upload-Datei – im letzten Lauf nicht gelaufen
- ○ Amazon Business: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Echtheits-Ordner: Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket – im letzten Lauf nicht gelaufen
- ○ eBay-Angebote prüfen: Kleinanzeigen-Entwurf am eBay-Angebot – im letzten Lauf nicht gelaufen
- ○ Gewinn: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Gewinn: B15.4 Quelle je Zeile, sellerboard als Ersatz, Amazon-Zeile – im letzten Lauf nicht gelaufen
- ○ Gewinn: B25.1 Abrechnung aus dem Transaktionsbericht (auch ältere Importe) – im letzten Lauf nicht gelaufen
- ○ Liquidität: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Liquidität: Kontoauszug einlesen, Amex erkannt, großer Einkauf in der Amex-Woche – im letzten Lauf nicht gelaufen
- ○ Importe (Daten importieren): Unbekannte Datei importieren – im letzten Lauf nicht gelaufen
- ○ Importe (Daten importieren): B25.2 Spalte „Ergebnis / Fehler“, Lagergebühren/USt-Bericht unter „Was erkannt wird“ – im letzten Lauf nicht gelaufen
- ○ Verlust-Stopp: 2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar – im letzten Lauf nicht gelaufen
- ○ Verlust-Stopp: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Hebel: Umsatz & Marge: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: Ladenhüter (Reichweite > 120 T) wird rot mit Vorschlägen – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Kapital-Ampel: Hinweis gestrandeter Bestand + weitere Amazon-Gebühren – im letzten Lauf nicht gelaufen
- ○ Eingangsrechnungen: Rechnung hochladen, Sammelbearbeitung – im letzten Lauf nicht gelaufen
- ○ Bestand & Inventur: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Bestand & Inventur: Inventur scannen – im letzten Lauf nicht gelaufen
- ○ Bestand & Inventur: B15.3 Prep Center verschickt – im letzten Lauf nicht gelaufen
- ○ Paletten-Lager (Kunden): B15.13 Palette ohne Kunde – im letzten Lauf nicht gelaufen
- ○ Paletten-Lager (Kunden) › Sendungen: Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen – im letzten Lauf nicht gelaufen
- ○ Paletten-Lager (Kunden) › Sendungen: Notiz über Claude bzw. Fragefeld – im letzten Lauf nicht gelaufen
- ○ Retouren-Station & Fälle: Retouren-Station: Paket mit 4 Artikeln ohne Tastatur/Maus (Sprache + Handscanner) – im letzten Lauf nicht gelaufen
- ○ Retouren-Station & Fälle: Fall-Paket und Eingereicht – im letzten Lauf nicht gelaufen
- ○ Retouren-Station & Fälle: Rechte der Station – im letzten Lauf nicht gelaufen
- ○ Aufträge & Versand: Labels kaufen und alle als versendet melden (Amazon, simuliert) – im letzten Lauf nicht gelaufen
- ○ Aufträge & Versand: Ansicht „Meldung offen“ – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Falsche Datei hochladen – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Vorschau mit lauter „bitte prüfen“ – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Gewichte pflegen – im letzten Lauf nicht gelaufen
- ○ Labels: Warensendung & DHL: Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert) – im letzten Lauf nicht gelaufen
- ○ Prep Center: Versand je Monat: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ Prep Center: Versand je Monat: Frage im Fragefeld „Was kostet uns das Prep Center?“ – im letzten Lauf nicht gelaufen
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
- ○ Übersicht: Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen – im letzten Lauf nicht gelaufen
- ○ Übersicht: Abendritual als Abfolge „zweimal Streicheln, danach Massage“ – im letzten Lauf nicht gelaufen
- ○ Übersicht: Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe – im letzten Lauf nicht gelaufen
- ○ Übersicht: Familienkalender: Wen betrifft der Termin (ich / Familie / Partnerin), Name im Titel – im letzten Lauf nicht gelaufen
- ○ Übersicht: Rückblick mit frei gewähltem Zeitraum (von–bis, Schnellauswahl) und Wochenrückblick „7 Tage bis“ beliebigem Tag – im letzten Lauf nicht gelaufen
- ○ Einstellungen: Testumgebung: Banner, Sperre nach außen, Übersicht – im letzten Lauf nicht gelaufen
- ○ Einstellungen: Apple Watch: Seite mit Anleitung, ein Kurzbefehl für alles (watch/frage), Ausprobieren – im letzten Lauf nicht gelaufen
- ○ Einstellungen: Zugang Assistenz (Büro): Finanz- und Privatseiten aufrufen – im letzten Lauf nicht gelaufen
- ○ Einstellungen: B25.9 Privat „voll“ bei Nicht-Inhaber, va@…-Konto ohne VA-Rolle – im letzten Lauf nicht gelaufen
- ○ Anbindungen: Karte „Postfächer“ und Warnung ohne Amazon-Mail; Google/Microsoft nur optional unter „Erweitert“ – im letzten Lauf nicht gelaufen
- ○ Anbindungen: B25.12 Intervall je Abruf auf der Karte, echter Zeitplan statt „laut Plan“ – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Jedes lesende Werkzeug einzeln – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag) – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Keepa: Länder vergleichen – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon) – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Neue Werkzeuge ohne Neustart (notifications/tools/list_changed) – im letzten Lauf nicht gelaufen
- ○ Claude & KI-Assistent: Rechte der neuen Werkzeuge im Fragefeld – im letzten Lauf nicht gelaufen
- ○ /posteingang/verbinden: Postfach verbinden: App-Passwort zuerst, Anleitung (Google, Microsoft 365, GMX/WEB.DE, IONOS/STRATO), „Nur abrufen“, OAuth nur unter „Erweitert“ – im letzten Lauf nicht gelaufen
- ○ /posteingang/verbinden: Mails hochladen: niederländische Compliance-Mail und Routinemail „Verkauft, jetzt liefern“ – im letzten Lauf nicht gelaufen
- ○ /assistent-verlauf: B25.6 Rückgängig für aufgabe_verschieben (auch aufgabe_zuweisen, auftrag_status, privat_eintrag_anlegen) – im letzten Lauf nicht gelaufen
- ○ /assistent-verlauf: Auftrag an Claude aus den Amazon-ToDos: „ToDos mit versendetem Auftrag erledigen“ → Vorschau → Ausführen → Verlauf → Rückgängig; gelber Auftragsstatus; Preis ändern; Mail mit „ignore previous instructions“; VA-Konto; gleiche Aktion über den Konnektor – im letzten Lauf nicht gelaufen
- ○ /calls/offen: Kennzahlen – im letzten Lauf nicht gelaufen
- ○ /kalender/zeiten: Freier Tag → Aufgabe wandert auf den nächsten Arbeitstag; Wochenrückblick – im letzten Lauf nicht gelaufen
- ○ /privat/familienaufgaben: Familien-Zugang: Aufgabe anlegen, Fairness aus; kein Geld/Tagebuch/Geschäft – im letzten Lauf nicht gelaufen
- ○ /privat/therapie-bogen: Therapie-Bogen seit letzter Sitzung (B16): Beobachtung mit 3 Feldern und „[?]“, Zeitraum wählen, Beobachtung ändern/löschen per Formular und Claude, rückgängig – im letzten Lauf nicht gelaufen
- ○ /privat/geld: Frage für den Steuerberater, nur für die eigene Person – im letzten Lauf nicht gelaufen
- ○ Fragefeld: Altes Gespräch nach Update fortsetzen – im letzten Lauf nicht gelaufen
- ○ Fragefeld: Privates im Kalender-Werkzeug – im letzten Lauf nicht gelaufen

**Live geprüft:**

- Uhren: Buy & Flip › Deals: Uhren-Deal bearbeiten (vor dem 28.10.2026, Prüfung mit ChatGPT) – Eingaben/Status gingen verloren – behoben, seither automatisch geprüft
- Uhren: Buy & Flip › Deals: Übungs-Deal (vor dem 28.10.2026, Prüfung mit ChatGPT) – zählte unter „Verworfen“ – behoben, seither automatisch geprüft
- Fragefeld: Altes Gespräch fortsetzen (vor dem 28.10.2026, Nutzung im Betrieb) – 400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft
- Server (Port, Adresse, Testumgebung): Erreichbarkeit (vor dem 28.10.2026, Prüfung mit ChatGPT) – Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen

**Noch nicht geprüft** (Funktionen ohne Ablaufprüfung, 60 Reiter – die Seiten selbst laufen in der Oberflächen-Prüfung mit):

Tagesplan (`/kalender/tagesplan`) · Uploads (alles hochladen) (`/uploads`) · Fahrtenbuch (`/kalender/fahrten`) · Bestellvorschläge (`/einkauf/vorschlaege`) · EK-Import (→ sellerboard) (`/einkauf/ek-import`) · Scanner (Barcode mit Ampel) (`/scan`) · Deal-Ampel (Einkauf prüfen) (`/lieferanten/deal-ampel`) · Einkauf & Wareneingang (`/einkauf`) · Dropship-Trackings (`/einkauf/beschaffungsanalyse`) · Lieferanten-Feeds (`/lieferanten`) · Lieferanten-Abfrage (`/lieferanten/abfrage`) · Chancen (`/lieferanten/chancen`) · Großhändler finden (`/lieferanten/finden`) · Amazon-ToDos (`/amazon-todos`) · Listungen (alle Kanäle) (`/listings`) · SAS-Programm (`/sas`) · Fälle & A-bis-Z (`/faelle`) · Bewertungen (`/bewertungen`) · Neues eBay-Angebot (`/ebay`) · eBay-Artikel & Gewinn (`/ebay?ansicht=artikel`) · eBay-Verlauf (`/ebay?ansicht=verlauf`) · eBay → Temu / Wawi (`/listings/temu`) · Buchhaltung (Abgleich, DATEV) (`/buchhaltung`) · Belege scannen (`/rechnungen/belege`) · Ausgangsrechnungen (`/rechnungen/ausgang`) · eBay-Rechnungen (`/ebay?ansicht=rechnungen`) · Kunden (`/rechnungen/kunden`) · COG-Export (`/export`) · Paletten-Lager (Kunden) › Lagerplan (`/paletten/lagerplan`) · Paletten-Lager (Kunden) › Abholung (`/paletten/abholung`) · Paletten-Lager (Kunden) › Inventur (`/paletten/inventur`) · Paletten-Lager (Kunden) › Abrechnung (`/paletten/abrechnung`) · Paletten-Lager (Kunden) › Kunden & Preise (`/paletten/kunden`) · Paletten-Lager (Kunden) › Auswertung (`/paletten/uebersicht`) · Produkte (`/produkte`) · Chargen (`/chargen`) · Artikelstamm (eigene Marken) (`/artikel`) · Retouren (`/retouren`) · Remissionen (`/remissionen`) · Preislisten je Land (`/b2b/preislisten`) · B2B-Kunden (`/b2b/kunden`) · Lieferanten-Freigaben (`/b2b/lieferanten`) · Bilanz (`/b2b/bilanz`) · Ideen & Saison (`/marken`) · Content-Plan (`/marken/content`) · Shop-Analyse (`/marken/shop`) · Markenprofile (`/marken/profile`) · Uhren: Buy & Flip › Lernen (`/marken/uhren/lernen`) · Uhren: Buy & Flip › Rechner (`/marken/uhren/rechner`) · Uhren: Buy & Flip › Marktpreise (`/marken/uhren/preise`) · Alle Aufgaben (`/?ansicht=liste`) · Anrufe (im Tagesplan) (`/kalender/tagesplan?anrufe=1`) · Kalender (`/privat/kalender`) · Eintragen (`/privat/eintragen`) · Rückblick (`/privat/rueckblick`) · Einstellungen (`/privat/einstellungen`) · Handy & Tesla (`/einstellungen/handy`) · Apple Watch (`/einstellungen/watch`) · Shop-Profile & Payback (`/einstellungen/shop-profile`) · eBay-Einstellungen (`/ebay?ansicht=einstellungen`)

**Bekannte offene Punkte:**

- Tagesübersicht: Aufgaben anlegen, erledigen, verschieben
- Tagesübersicht: Tageskennzahlen
- Posteingang: Mails abrufen (nur echte Postfächer)
- Posteingang: Entwurf echt senden (nur mit echtem Postfach)
- Posteingang: Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test
- Schnellerfassung (Sprache): Echtes Handy (Kurzbefehle/Widget)
- Schnellerfassung (Sprache): Echter Tesla (Fleet-API-App, virtueller Schlüssel, Befehls-Proxy)
- Schnellerfassung (Sprache): Echte SMS über Twilio
- Rechtsfälle (Anwalt): Echter Asana-Zugang (Token) beim Anwalt; ob Webhooks für Gäste gehen
- Rechtsfälle (Anwalt): Echte Anwalts-Mails (Domain, Aktenzeichen-Format)
- Deal-Eingang: ProfitPath mit echtem Discord-Bot (Message Content Intent, Rechte „Kanal ansehen“ + „Nachrichtenverlauf lesen“) – nur live
- Deal-Eingang: Lugru Deals live: Programm auf den neuen Stand bringen, Seller-Adresse + Verbindungsschlüssel eintragen – die History kommt dann von selbst
- Deal-Eingang: Echte Bestellbestätigungen anderer Shops (Betreff/Format je Shop) – nur live
- Fall-Zentrale: Echte Seller-Central-Mails (nur live mit Nur-ansehen-Daten)
- Fall-Zentrale: SP-API: Listings Restrictions (Freischaltungsstatus je Marktplatz) – braucht die Amazon-Anbindung
- Repricer (BQool): Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen
- Amazon Business: Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen
- Gewinn: Amazon-Zeile mit echten Abrechnungen gegen sellerboard vergleichen (−525 € laut Testbericht)
- Verlust-Stopp: Echte sellerboard-Tageswerte je Produkt (kommen mit dem täglichen Komplett-Abgleich)
- Retouren-Station & Fälle: Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell
- Retouren-Station & Fälle: Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen
- Retouren-Station & Fälle: Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen
- Deals: Echte Lexoffice-Anbindung mit dem Schlüssel der Deal-Firma (Rechnungsnummern, Reverse-Charge-Text, PDF)
- Deals: Echter VIES-Abruf mit eigener USt-IdNr. (Kennung der qualifizierten Abfrage)
- Deals: Discord-Webhook im echten B2B-Kanal
- Deals: PrepTool (preptool.de): API-Anbindung folgt, sobald Instanz-Adresse und OpenAPI-Datei vorliegen – bis dahin Export neutral (CSV/XLSX/PDF)
- Deals: Steuer: Reverse Charge nur, wenn die Ware Deutschland verlässt – bei FBA-Versand in DE mit dem Steuerberater klären
- VA & Delegation: VA-Automatik live: Zeitzone „Asia/Manila“ prüfen, einige Tage im Modus „Vorschlag“ beobachten, dann auf „automatisch“ umstellen
- Calls (Consultant & Gruppe): Echter Discord-Bot im Call-Kanal (Bot-Token, Kanal-ID) und Freigabe der Google Docs
- Calls (Consultant & Gruppe): Export des bisherigen Call-Archivs auf dem Server hochladen (echte Daten, nicht im Repo)
- Calls (Consultant & Gruppe): Gruppen-Kanäle: Bot vom Server-Admin der Deal-Gruppe eingeladen (nur Leserechte)
- Übersicht: Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests
- Übersicht: Live nie prüfen (echte private Daten)
- Claude & KI-Assistent: Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)
- Claude & KI-Assistent: getItemOffers-Ratenlimit im Betrieb beobachten
- /posteingang/verbinden: IMAP mit echtem Postfach: Ordnerauswahl (Gmail „Alle Nachrichten“), Test-Knopf, SMTP 465 → 587, Fehlerarten (Anmeldung, IMAP aus, Port) – nur live mit Nur-ansehen-Daten
- Server (Port, Adresse, Testumgebung): `deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)
- Server (Port, Adresse, Testumgebung): `deploy/testumgebung.sh an` + `pruefen` auf dem Server
