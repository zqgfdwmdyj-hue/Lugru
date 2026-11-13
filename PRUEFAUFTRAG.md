# Prüfauftrag 28.–30.10.2026: Bauaufträge gegen den Code

Stand der Prüfung: **vor dem Nachbau** (30.10.2026). Zeichen: ✅ gebaut · 🟡 teilweise · ❌ fehlt · 🐞 gebaut, aber fehlerhaft.
Fundstellen relativ zum Repository. Echte Geschäftsdaten stehen hier bewusst nicht.

## A. MCP-Werkzeuge, die in Claude fehlen

| Werkzeug | Modul | Status | Fundstelle / Bausteine |
|---|---|---|---|
| `tagesplan(datum)` | 1 Tagesplan | ❌ | nur feste freie Zeiten: `src/lib/zeit/*` |
| `aufgabe_verschieben(id, datum)` | 1/22 | ❌ | automatisches Ausweichen an freien Tagen: `src/lib/zeit/ausweich.ts` |
| `aufgabe_zuweisen(id, person)`, Filter `zustaendig` | 2 Delegieren | ❌ | Zuweisen nur im Board (`src/app/(app)/board/actions.ts`), Feld `tasks.assigneeId` (nur Benutzer) |
| `deal_pruefen(...)` | 4 Deal-Ampel | ❌ | Bausteine im B2B-Scanner: `src/lib/b2b/scanner.ts`, `src/lib/b2b/prognose.ts` |
| `buchhaltung_status(monat)` | 5 Buchhaltung | ❌ | – |
| `fristen(bis, bereich)` | 7 Fristen/Verträge | ❌ | – |
| `feierabend()` | 10 Feierabend | ❌ | Hinweis „danach Feierabend“ auf der Startseite (`src/app/(app)/page.tsx`) |
| `auto_status()`, `auto_klima(...)` | 12 Tesla | ❌ | – |

## A. Fehler aus dem Test

| Nr. | Punkt | Status | Ursache / Fundstelle |
|---|---|---|---|
| A1 | Liquidität: alle Bestellvorschläge auf heute | 🐞 | `src/lib/money/liquiditaet-service.ts` – überfälliges „bestellen bis“ wird auf heute gelegt und voll eingerechnet |
| A2 | Verlust-Stopp: Werkzeug ohne Tageswerte, Aufgaben mit Tageswerten | 🐞 | `src/lib/sellerboard/sync.ts` (`syncSkuDays`) löscht vorhandene Tageswerte auch bei leerer Antwort; `src/lib/money/verlust-service.ts` lässt Aufgaben ohne Tagesdaten unverändert offen; Fenster = 3 Kalendertage statt 3 Tage mit Daten |
| A3 | BQool-Export | 🟡 | Upload gibt es (`src/app/(app)/repricer/bqool-upload.tsx`, `src/lib/bqool/*`, je Marktplatz); kaum sichtbar; Verlust-Stopp unterscheidet „kein Export“ nicht von „SKU fehlt“ (`src/lib/money/verlust.ts`) |
| A4 | SP-API „eingerichtet = false“ | 🟡 | Status stimmt (Anbindung nicht eingetragen); Amazon-Live-Daten brauchen sie. sellerboard „Konto“ ist ein einmaliger Schritt (`src/lib/sellerboard/sync.ts`) und wird in `anbindungen_status` fälschlich als alt gemeldet 🐞 (`src/lib/assistant/tools/geschaeft.ts`) |
| A5 | `amazon_listungen` „noch nicht abgerufen“ | 🟡 | hängt an A4 (SP-API) |
| A6 | Kapital-Ampel: Preis 0 €; Break-even nur DE | 🐞 | `src/lib/money/kapital.ts` – Preis 0 zählt als „unter Break-even“, USt nur DE |
| A7 | Keepa-Werte älter als 48 h | 🟡 | Stand wird ausgegeben (`src/lib/assistant/tools/keepa.ts`), aber kein Hinweis, kein Nachladen |
| A8 | eBay „Listing API: keine Berechtigung“ | 🟡 | Meldung vorhanden (`src/lib/ebay/listing-api.ts`), nur im Hintergrund pausiert (`src/lib/ebay/modern.ts`); Scope wird beim Verbinden nicht angefordert (`src/lib/ebay/ebay/config.ts`), Hinweis in der Oberfläche fehlt |

## B. Beschlüsse nach den Bauaufträgen

| Nr. | Punkt | Status | Fundstelle / Lücke |
|---|---|---|---|
| B1 | Call-Archiv im Seller-System, Altdaten-Import, Discord-Import, Doppel überspringen | ✅ | `src/lib/calls/*`, `/calls`; Lücken 🟡: Export-Datei mit einem Call ohne Transkript (wie die gelieferte) → Wissen kann nur aus der Zusammenfassung gezogen werden; späterer Discord-Import überspringt den Call, statt das Transkript nachzuladen; Gruppen-Call wird als Consultant-Call eingetragen |
| B2 | Wissen aus Calls (Erkenntnisse, Stelle, Datum, Sprecher, Insider, 6 Monate) | ✅ | `src/lib/calls/logic.ts`, `src/lib/calls/service.ts`, Werkzeuge `wissen`, `suche`, `calls_durchsuchen` |
| B3 | Tesla (Fleet API, Vorheizen nach Kalender, Fahrtenbuch, MCP) | ❌ | – |
| B4 | Morgenbericht: `umsatz` mit Nettogewinn | ✅ | `src/lib/assistant/tools/geschaeft.ts` |
| B4 | `amazon_listungen` fehlende Länder | 🟡 | gebaut, braucht SP-API (A4) |
| B4 | `repricer` je ASIN | ✅ | braucht hochgeladenen BQool-Export (A3) |
| B4 | verkaufte Stück je ASIN gestern | ❌ | Daten liegen vor (`sellerboard_sku_tage`), kein Werkzeug |
| B4 | `kalender`: private Termine nur „Termin außer Haus“ + Uhrzeit | 🐞 | `src/lib/assistant/tools/allgemein.ts` – liefert mit Privat-Freigabe Titel, Personen, Notiz |
| B5 | Palettenlager nicht erweitern | ✅ | nichts erweitert |
| B5 | AdelPrep: nur Export, keine festen Aufschläge | ✅ | `src/lib/b2b/*` (Preis je Deal), Export `src/lib/b2b/export.ts` |
| B5 | Buchhaltung nur LuGru/WiGru (Feld Firma) | ❌ | Teil von Modul 5 |
| B5 | Kein Kaufland/MCF, kein KPI-Dashboard | ✅ | nicht gebaut |
| B5 | Retouren-Station nur Remissionen/Kundenretouren | ✅ | `src/lib/retouren-station/*` |
| B5 | Prep-Center-Gebühren einpflegbar (B2B-Rechner, `prep_center`) | 🟡 | B2B: eine Gebühr je Stück (`src/lib/settings.ts` `b2b.prepGebuehr`); keine Preisliste, `prep_center` ohne Kosten aus Gebühren |
| B5 | ProfitGo-Schnelllink (optional) | ❌ | – |

## Herzstück (Modul 1–12)

| Modul | Punkt | Status | Fundstelle / Lücke |
|---|---|---|---|
| 1 Tagesplan | Sperrzeiten (Privat, Kalender) | 🟡 | nur feste freie Zeiten (`src/lib/zeit/*`); Kinder-/Paar-/Auszeit, Kalendertermine fließen nicht in eine Planung |
| 1 | Kapazität je Wochentag, Aufwand S/M/L, Tagesplan, Wochenansicht, Konflikte | ❌ | – |
| 2 Delegieren | Feld Zuständig mit Personen (VA, Prep Center, Steuerberater, extern) | 🟡 | nur Benutzer (`tasks.assigneeId`) |
| 2 | Regeln je Aufgabentyp, Wochenübersicht je Person | ❌ | – |
| 2 | Eigener VA-Zugang (Bereiche, kein Privat/Geld) | ✅ | Benutzer mit Bereichen (`src/lib/auth/areas.ts`), Anleitung hängt an (`src/lib/zeit/service.ts`) |
| 3 Posteingang | Archivieren/Entwurf | ✅ | Werkzeuge `posteingang_archivieren`, `posteingang_entwurf` |
| 3 | Regeln je Absender/Thema, „vorschlag“ je Mail, Termin-Mails | ❌ | Einstufung vorhanden (`src/lib/inbox/classify.ts`), ohne Regeln |
| 3 | „wichtig“ bei Zahlung abgelehnt (DE/IT/FR), Mahnung, Frist … | 🟡 | teils (Auszahlungen), fremdsprachige Ablehnungen fehlen |
| 4 Deal-Ampel | Formular, Berechnung je Land, empfohlene Menge, Ampel, MCP | ❌ | Bausteine im B2B-Scanner |
| 5 Buchhaltung | 5.1 Belegeingang (Drive, Postfächer, Upload, KI-Auslesen) | ✅ | `src/lib/invoices/*` |
| 5 | 5.1 Dubletten (Nummer+Lieferant+Betrag, Datei-Hash) | 🟡 | teils (`src/lib/invoices/*`) |
| 5 | 5.2 Sparkasse-CSV | ✅ | `src/lib/bank/*` |
| 5 | 5.2 Amex-CSV, Saldo-Kontrolle je Upload | ❌ | Amex nur als Abbuchung im Sparkassen-Auszug erkannt |
| 5 | 5.3 Abgleich Zahlung ↔ Beleg, Sammelposten, Listen | ❌ | – |
| 5 | 5.4 Vorkontierung SKR, DATEV-Export, GoBD, VAT-Bericht | ❌ | – |
| 6 Termin-Mails | Doctolib & Co. → Privatkalender | ❌ | – |
| 7 Fristen | Vorsorge, Dokumente, Fahrzeug, Verträge & Abos | ❌ | Privat → Geld hat Fixkosten/Erinnerungen (`src/lib/private/geld.ts`) |
| 8 Schulbriefe | Foto → Termine/Aufgaben | ❌ | – |
| 9 Familie | Paarzeit-Rhythmus | 🟡 | Hinweis auf Paarzeit vorhanden (`src/app/(privat)/privat/hint.tsx`); Ideen/Vorschlag fehlt |
| 9 | Geburtstage & Jahrestage mit Erinnerungen | ❌ | – |
| 10 Feierabend | Abendansicht, Wochenrückblick | 🟡 | Wochenrückblick freie Zeiten + Privat-Rückblick; Abend-Check und MCP fehlen |
| 11 Schnellerfassung | Diktat-Endpunkt mit Token, KI-Einordnung | ❌ | – |
| 12 Tesla | alles | ❌ | – |

## Retouren-Station

| Punkt | Status | Fundstelle |
|---|---|---|
| Station-Seite, Sprachbefehle mit Synonymen, Ansagen, Fotos, Video, Offline-Warteschlange | ✅ | `src/app/(app)/remissionen/station`, `src/lib/retouren-station/logic.ts` |
| LPN/FNSKU/EAN, BarcodeDetector + Handscanner | ✅ | `src/lib/retouren-station/logic.ts` |
| KI: Etikett, Lieferschein, Produktabgleich, Falltext | ✅ | `src/lib/retouren-station/ki.ts` |
| Entscheidung (Schwelle, schon erstattet), Fall-Paket ZIP, Eingereicht, RET-SKU mit EK, Aufbewahrung | ✅ | `src/lib/retouren-station/fall.ts`, `service.ts` |
| SP-API-Berichte täglich (Kundenretouren, Remissionen, Erstattungen) | 🟡 | gebaut (`src/lib/integrations/clients/amazon.ts`), läuft erst mit SP-API (A4) |
| Aktivierungswort, Server-Transkription, Etikettendruck (Phase 4, optional) | 🟡 | Aktivierungswort ja; Server-Transkription und Druck offen |
| LPN-Erkennung ≥ 95 % | – | nur live am Arbeitsplatz prüfbar |

## B2B-Deals

| Punkt | Status | Fundstelle |
|---|---|---|
| 1 Antworten erkennen, Preislisten per KI-Spalten, Lieferanten-Profil mit Vertriebsfreigaben | ✅ | `src/lib/b2b/preislisten-*.ts`, `/b2b/lieferanten` |
| 2 Scanner je Land, Packungsgröße, Aktionsmuster, Filter, Hintergrund, 24-h-Keepa | ✅ | `src/lib/b2b/scanner.ts` (Gebühren je Land über SP-API, sonst Schätzung) |
| 3 Deal anlegen, Preis je Deal/Kunde, Mengengrenzen, Freischalten nur mit Freigabe | ✅ | `src/lib/b2b/logic.ts`, `service.ts` |
| 4 Deal-Blatt, Kundenportal, B2B-Kanal, VIES | ✅ | `src/lib/b2b/blatt-pdf.ts`, `portal-auth.ts`, `vies.ts` |
| 5–7 Reservieren, Sammelbestellung, Lexoffice, Wareneingang, Fehlmenge | ✅ | `src/lib/b2b/reservierung.ts`, `ablauf.ts` |
| 8 Export fürs Prep-Tool | ✅ | `src/lib/b2b/export.ts`; Schnittstelle offen (wartet auf Adresse + API-Beschreibung) |
| 9 Erfolgskontrolle, Bilanz | ✅ | `src/lib/b2b/kontrolle.ts` |
| 10 MCP-Werkzeuge | ✅ | `src/lib/assistant/tools/b2b.ts` |

## Teil 2 (Modul 13–23)

| Modul | Status | Fundstelle / Lücke |
|---|---|---|
| 13 Liquidität | 🐞 | gebaut (`src/lib/money/liquiditaet*.ts`), Fehler A1 |
| 14 Kapital-Ampel | 🐞 | gebaut (`src/lib/money/kapital*.ts`), Fehler A6 |
| 15 Verlust-Stopp | 🐞 | gebaut (`src/lib/money/verlust*.ts`), Fehler A2/A3 |
| 16 Echtheits-Ordner | ✅ | `src/lib/echtheit/*` |
| 17 Amazon Business | ✅ | `src/lib/amazon-business/*` (Übertragung live nur mit SP-API) |
| 18 Retourenwelle | ✅ | Meilenstein + Reservierung (`src/lib/zeit/service.ts`) |
| 19 Anleitungen | ✅ | `src/lib/knowledge/anleitung.ts` |
| 20 Calls | ✅ | siehe B1 |
| 21 Familien-Aufgaben + Zugang Alexandra | ✅ | `src/lib/private/familie-aufgaben.ts` |
| 22 Feste freie Zeiten | ✅ | `src/lib/zeit/*` |
| 23 Privates Geld | ✅ | `src/lib/private/geld*.ts` |

---

# Stand nach dem Nachbau (30.10.2026)

Zeichen wie oben. 🟡 heißt hier fast immer: im Code fertig und mit Testdiensten geprüft, live fehlt nur eine
Anbindung oder Angabe von Ludwig (siehe „To-dos für Ludwig“). Ablaufprüfungen: `e2e/*.spec.ts`, Ergebnis unten.

## Vorher → nachher

| Punkt | vorher | nachher | Wo / Prüfung |
|---|---|---|---|
| `tagesplan`, `aufgabe_verschieben` (Modul 1) | ❌ | ✅ | `src/lib/tagesplan/*`, `/kalender/tagesplan`; e2e `herzstueck` |
| `aufgabe_zuweisen`, Zuständig extern, Regeln, Wochenübersicht (Modul 2) | ❌/🟡 | ✅ | `src/lib/delegieren/*`, `/delegation`; e2e `herzstueck` |
| `deal_pruefen` + Formular (Modul 4) | ❌ | ✅ | `src/lib/deal-ampel/*`; Gebühren je Land live über SP-API, sonst Schätzung (gekennzeichnet) |
| `buchhaltung_status`, Amex, Abgleich, SKR04, DATEV, USt-Bericht, je Firma (Modul 5) | ❌ | ✅ | `src/lib/buchhaltung/*`; keine Steuerberatung, Rhythmus aus den Einstellungen |
| `fristen` (Modul 7) inkl. Rechtsfristen | ❌ | ✅ | `src/lib/fristen-geschaeft.ts`, `src/lib/private/fristen*.ts` |
| `feierabend` (Modul 10) | ❌ | ✅ | `src/lib/feierabend/*` |
| `auto_status`, `auto_klima`, Vorheizen nach Kalender (Modul 12) | ❌ | ✅ | `src/lib/mobil/auto.ts`, `vorheizen.ts`; Schlüssel unter `/.well-known/appspecific/com.tesla.3p.public-key.pem`; e2e `handy-tesla` |
| A1 Liquidität: Bestellvorschläge | 🐞 | ✅ | eigene Zeile, erst nach Freigabe eingerechnet |
| A2 Verlust-Stopp: Tageswerte | 🐞 | ✅ | leere Antwort löscht nichts; Fenster = Tage mit Daten; Verkauf getrennt von Erstattung/Abschreibung/Lager (B9.6) |
| A3 BQool-Export | 🟡 | ✅ | Hinweise in Verlust-Stopp/Repricer/Start; Dateien je Land aus dem System (`bqool_export_*`) |
| A4 SP-API-Status, sellerboard „Konto“ | 🟡 | ✅ | richtiger Status je Funktion; Live-Daten brauchen die SP-API-Anbindung |
| A5 `amazon_listungen` | 🟡 | 🟡 | gebaut; wartet auf SP-API |
| A6 Kapital-Ampel Preis 0 / USt je Land | 🐞 | ✅ | `src/lib/money/kapital.ts` |
| A7 Keepa älter als 48 h | 🟡 | ✅ | Hinweis + Nachladen |
| A8 eBay Listing-API-Berechtigung | 🟡 | ✅ | Scope beim Verbinden + Hinweis; einmal neu verbinden |
| B1 Calls: Export ohne Transkript, Nachladen, Gruppen-Call | 🟡 | ✅ | `src/lib/calls/*` |
| B3 Tesla | ❌ | ✅ | siehe Modul 12 und B13 |
| B4 Stück je ASIN gestern | ❌ | ✅ | `verkaeufe_je_asin` |
| B4 `kalender` privat nur „Termin außer Haus“ | 🐞 | ✅ | `src/lib/assistant/tools/allgemein.ts` |
| B5 Buchhaltung nur LuGru/WiGru | ❌ | ✅ | Feld Firma (`src/lib/buchhaltung/service.ts`) |
| B5 Prep-Center-Gebühren, ProfitGo-Link | 🟡/❌ | ✅ | Preisliste je Leistung; ProfitGo-Adresse trägt Ludwig ein |
| Modul 3 Posteingang auf null (Regeln, Vorschlag, Zahlungen DE/IT/FR) | ❌/🟡 | ✅ | e2e `posteingang-null` |
| Modul 6 Termin-Mails → Privatkalender, Vorabend | ❌ | ✅ | e2e `posteingang-null` |
| Modul 8 Schulbriefe, Modul 9 Geburtstage/Paarzeit, Modul 11 Schnellerfassung | ❌/🟡 | ✅ | e2e `schnell-familie` |
| B8 Amazon-Fall-Zentrale | – | ✅ | `src/lib/amazon-faelle/*`; einreichen nur in Seller Central; e2e `amazon-faelle` |
| B9 Befunde Herzstück, Postfach IMAP | – | ✅ | e2e `herzstueck`, `postfach` |
| B10 Amazon-ToDos mit Versand abgleichen | – | ✅ | e2e `amazon-todos-versand` |
| B11 Assistent-Aktionen (Vorschau, Stufen, Rückgängig) | – | ✅ | e2e `assistent-aktionen` |
| B12 `privat_eintrag_anlegen` | – | ✅ | e2e `privat-anlegen` |
| B13 Handy & Tesla | – | ✅ | e2e `handy-tesla` |
| B14 Rechtsfälle (Asana nur lesen) + Discord-Wissen | – | ✅ | e2e `recht-discord` |
| Deal-Eingang 10 „Kaufen mit einem Tap“ + 11 „Lernender Deal-Wert“ (inkl. Lugru-History) | ❌ | ✅ | e2e `deal-wert`; Einzelheiten im Abschnitt „Deal-Eingang“ unten |
| VA nur Englisch, Rückmeldungen deutsch mit Original | – | ✅ | e2e `va-discord` |
| Retouren-Station SP-API-Berichte, LPN ≥ 95 % | 🟡 | 🟡 | wartet auf SP-API bzw. nur live am Arbeitsplatz prüfbar |
| B2B: Schnittstelle zum Prep-Tool | 🟡 | 🟡 | Export fertig; API wartet auf Adresse + Beschreibung |

## B15 – Befunde aus dem Browser-Test vom 30.10.

Grundlage ist der Text unter B15 im Prüfauftrag; die Datei `Seller-System_Testbericht_2026-10-30.md` lag nicht vor.
Prüfung je Punkt mit erfundenen Daten (e2e `b15-sofort`, `b15-zahlen`, `b15-anzeige` und Unit-Tests).

| Nr. | Punkt | vorher | nachher | Wo / Prüfung |
|---|---|---|---|---|
| 1 | FBM-Versandbestätigung an Amazon: Alarm mit Frist auf der Startseite, Datei (Amazon-Vorlage, Carrier + Sendungsnummer), Erinnerung; „Verkauft, jetzt liefern“ erst nach Bestätigung erledigt | ❌ | ✅ | `src/lib/orders/bestaetigung*.ts`, Aufträge → „Meldung offen“; e2e `amazon-todos-versand`, `assistent-aktionen` |
| 2 | Startseite: private Termine nur „Privat belegt“, nie Beträge/Ort; Assistenz sieht nichts | 🐞 | ✅ | `src/app/(app)/page.tsx`; e2e `b15-sofort` |
| 3 | Lagerbestand −144: Prep-Center-Aufträge buchen nicht vom eigenen Lager; alte Fehlbuchungen als Vorschlag „Zurückbuchen“ (nur auf Klick) | 🐞 | ✅ | `src/lib/orders/service.ts`, Bestand; e2e `b15-sofort` |
| 4 | Gewinn: Quelle je Zeile, sellerboard als Ersatz solange die Abrechnung fehlt; Amazon-Zeile zählte USt.-Zeilen und Rücklagen als Ergebnis | 🐞 | ✅ | `src/lib/money/profit*.ts`, `/gewinn`; e2e `b15-zahlen` |
| 5 | Bestellvorschläge: eine Rechnung und Definition (netto, ohne rote Ampel, ohne angelegte Einkäufe, unterwegs schon abgezogen) überall, mit Tooltip | 🐞 | ✅ | `kapitalbedarf()` in `src/lib/purchasing/reorder-logic.ts`; Startseite, Bestellvorschläge, Liquidität, Claude |
| 6a | Liquidität: Vorschläge erst nach Freigabe bzw. am „bestellen bis“ | 🟡 | ✅ | seit PA-2; jetzt mit derselben Rechnung wie Punkt 5 |
| 6b | Ø Wareneinkauf je Woche aus Warenrechnungen (8 Wochen) als Plan-Posten, abzüglich angelegter Einkäufe | ❌ | ✅ | `wareneinkaufPlan()`; abschaltbar in den Einstellungen |
| 6c | Warnung, wenn der Kontostand älter als 7 Tage ist | ❌ | ✅ | `/cashflow`, Quelle „veraltet“ |
| 7 | Kapital-Ampel bei Preis 0 | 🐞 | ✅ | seit PA-7 (`src/lib/money/kapital.ts`); live nach dem Server-Update |
| 8 | Deal-Ampel: deutsches Prozentformat, eine Zahl für Verkäufe (geschätzt, mit Erklärung) | 🐞 | ✅ | `src/lib/deal-ampel/logic.ts`, Seite Deal-Ampel |
| 9 | Verlust-Stopp: Liquidation laut BQool nicht „kritisch“, sondern Rückfrage „gewollt?“ | 🐞 | ✅ | `src/lib/money/verlust-service.ts` |
| 10 | Tagesplan: Kapazität 0 nie „überbucht“; nicht Passendes = „voll“ (verschoben), rot nur bei Wichtigem | 🐞 | ✅ | `src/lib/tagesplan/logic.ts`; Unit-Test |
| 11 | Repricer: alle Länder, Übersicht je Regel, Filter (Land, Regel, Status, Auffälligkeit, Suche), Seiten; „ia pausiert“ kam vom Amazon-Angebotsstatus „Inactive“ statt der Repricing-Spalte | 🐞 | ✅ | `src/lib/bqool/logic.ts`, `/repricer`; e2e `b15-anzeige`. Nach dem Update den BQool-Export einmal neu hochladen |
| 12 | Lieferantenliste: SKU-Kürzel sind keine Lieferanten | 🐞 | ✅ | eigene Liste „SKU-Kürzel“ mit Zuordnung (B2B → Lieferanten-Freigaben); bestehende Einträge nur markiert, nichts gelöscht; e2e `b15-anzeige` |
| 13 | Palettenlager: Warnung für Paletten ohne Kunde + Filter | ❌ | ✅ | `/paletten`; e2e `b15-anzeige` |
| 14 | Anbindungen offen | – | To-do | siehe To-dos 2–8 |
| 15 | Shop-Analyse langsam (4,6 s) | 🐞 | ✅ | Verlauf in einer Abfrage, TikTok-Import einmal aufbereitet und zwischengespeichert (`src/lib/brands/shop-service.ts`) |
| 16 | Handy-Ansicht mit echtem Gerät | – | To-do | nur am Gerät prüfbar (To-do 18) |

## Deal-Eingang (Bauauftrag „WhatsApp → Deal-Ampel“) – Abschnitte 1–11

Jeder Punkt einzeln gegen den Code geprüft (31.10.). Abschnitte 10 und 11 fehlten ganz; in 2–7 fehlten Gefahrgut,
IP-Beschwerden und selektiver Vertrieb, das Keepa-Mini-Chart, die Screenshot-Ansicht und mehrere Einstellungen, die der
Code zwar las, die aber nirgends einstellbar waren. Geprüft mit erfundenen Daten: e2e `deal-eingang` (1–9),
`deal-eingang-luecken` (die neuen Punkte aus 2–7), `deal-wert` (10/11), Unit-Tests `deal-wert`, `deal-risiko`,
`deal-chart`, Go-Test `sellerdeals_test.go` in Lugru Deals.

| Nr. | Punkt | vorher | nachher | Wo / Prüfung |
|---|---|---|---|---|
| 2.1 | PWA-Teilen-Ziel (Text, URL, Bilder, PDF/XLSX/CSV) | ✅ | ✅ | `src/app/manifest.ts` (`share_target` → `/api/deal-eingang`); statt eigener Seite `/deal-eingang/teilen` springt es direkt auf die Detailseite („Wird geprüft …“, lädt selbst nach) |
| 2.2 | iPhone-Kurzbefehl mit Geräte-Schlüssel (widerrufbar), Anleitung, iCloud-Link-Platzhalter | 🟡 | ✅ | `src/app/(app)/deal-eingang/kurzbefehl/page.tsx`: Schritte jetzt mit Skizzen der Kurzbefehle-App (echte Bildschirmfotos gehen nur am Gerät); iCloud-Link einstellbar |
| 2.3 | Mail-Weiterleitung (eigene Adresse bzw. Betreff „Deal prüfen“/„#deal“) | 🟡 | ✅ | `src/lib/deal-eingang/mail.ts`, `src/lib/inbox/service.ts`; Adresse war nur im Code lesbar, jetzt unter „Weitere Einstellungen“ |
| 2.4 | ProfitPath über Discord: nur Bot-ID, Embeds, 24 h nachladen, Test-Knopf, Push nur Grün/Gelb, 24 h zusammenfassen, EK-Update, Trefferquote je Modul, Hinweis Alert-Einstellungen | ✅ | ✅ | `src/lib/deal-eingang/profitpath*.ts`, Test in `src/lib/integrations/clients/discord.ts`, Hinweis auf `/deal-eingang` |
| 2.5 | Manuell einfügen / Datei ablegen | ✅ | ✅ | `/deal-eingang` (Formular `de-form`) |
| 2.x | Je Eingang Zeit, Weg, Rohtext, Dateien, Quelle (aus Text erraten), Status | ✅ | ✅ | `src/db/tables/deal-eingang.ts`, `quelleAusText` in `logic.ts` |
| 3 | KI-Erkennung (Bild/Text/PDF) mit allen Feldern, mehrere Angebote, Preislisten-Weiche ab 15 Zeilen bzw. XLSX/CSV, EAN→ASIN, Titelsuche mit Vorschlägen, Packungsgröße, max. EK ohne EK | ✅ | ✅ | `erkennen`/`asinFinden`/`zeilePruefen` in `service.ts`, `logic.ts`, `preisliste.ts`; Weiche jetzt einstellbar |
| 4a | Markt je Land DE/FR/IT/ES (Buy Box, Ø 90, Tief 12 M, Verkäufe, Angebote, Amazon-Anteil, Aktionsmuster) | ✅ | ✅ | Deal-Ampel `src/lib/deal-ampel/*` (Länder unter Deal-Ampel einstellbar) |
| 4b | NL/BE/PL/SE „soweit Daten da“ | 🟡 | 🟡 | Keepa liefert für diese Marktplätze keine Daten; mit SP-API möglich, bis dahin nicht gerechnet |
| 4c | Rechnung (SP-API-Gebühren, USt je Land, Prep), Gewinn/Marge/ROI, empfohlene Menge | ✅ | ✅ | `dealPruefen`, `empfohleneMenge` |
| 4d | Eigene Lage (Bestand, Reichweite, Kapital-Ampel, Bestellvorschlag, letzter EK, Verlust-Stopp) | ✅ | ✅ | `eigeneLage` in `service.ts` |
| 4e | Risiken: Marke gesperrt (SP-API), „Rechnung als Echtheitsnachweis?“ | ✅ | ✅ | `zeilePruefen` |
| 4f | Risiken: Gefahrgut, Marke mit IP-Beschwerden (Fall-Zentrale, Echtheits-Ordner), selektiver Vertrieb | ❌ | ✅ | neu `src/lib/deal-eingang/risiko-logic.ts`: offene Rechteinhaber-Beschwerde zur ASIN = Rot, zur Marke = Gelb; Lieferant ohne Marktplatz-Freigabe = Rot, Marke selektiv = Gelb; Gefahrgut laut Produktstamm = Gelb, laut Titel nur Hinweis; Echtheits-Ordner ohne Rechnung = Hinweis |
| 4g | Liquidität (Kapitalbedarf, Was-wäre-wenn), Ampel mit höchstens 3 Gründen, Schwellen einstellbar, Keepa > 48 h neu | ✅ | ✅ | `liquiditaetPruefen`, `dreiGruende`, Deal-Ampel-Einstellungen |
| 5a | Push (Einzelangebot wie im Beispiel, mehrere „5 geprüft: 2 🟢 …“) | ✅ | ✅ | `pushText`/`eingangAmpel` in `logic.ts`, `ablauf.ts` |
| 5b | Detailseite: Original + Screenshot, Zeilen bearbeitbar → neu rechnen, Tabelle je Land, Gründe | 🟡 | ✅ | Screenshot war nur als Dateiname sichtbar – jetzt als Bild (eigene, geschützte Route `…/datei/[fileId]`) |
| 5c | Keepa-Mini-Chart 90 Tage | ❌ | ✅ | `chart-logic.ts` + Detailseite; nur aus dem Zwischenspeicher, keine Tokens |
| 5d | Knöpfe Antwort-Entwurf, Bestellvorschläge, B2B-Deal, Verworfen mit Grund | ✅ | ✅ | Detailseite, `ablauf.ts` |
| 5e | Lernen: Trefferquote je Quelle mit realem ROI | ✅ | ✅ | `quellen`/`realerRoi`, Claude `deal_quellen` |
| 6 | MCP `deal_eingang`, `deal_eingang_detail`, `deal_quellen`, `deal_eingang_pruefen`, `deal_eingang_status`; Morgenbericht (`seit`) | ✅ | ✅ | `src/lib/assistant/tools/deal-eingang.ts` |
| 7a | Nur im Deal-Eingang, nicht im Wissen; Löschen nach 12 Monaten (Einstellung) | 🟡 | ✅ | `aufraeumen` lief schon täglich; die Frist ist jetzt einstellbar |
| 7b | Schlüssel je Gerät, widerrufbar, Rate-Limit; nur Inhaber + ausdrücklich Freigegebene, kein VA/B2B-Kunde; Insider nie in den B2B-Kanal | ✅ | ✅ | `canAccess` (`src/lib/auth/areas.ts`), `tokenPruefen`, B2B-Deal nur als Entwurf |
| 9 | Abnahme 1–9 (Screenshot mit 3 Angeboten, Text, XLSX 500, Kapital rot, Kurzbefehl/Android, widerrufener Schlüssel, list_changed) | ✅ | ✅ | e2e `deal-eingang` |
| 10a | Keine automatischen Käufe | ✅ | ✅ | es gibt keinen Kauf-Weg im Code; nur „gekauft“ erfassen |
| 10b | Amazon-Business-Bestellschnittstelle: erst prüfen, nicht bauen | ❌ | geprüft | offizielle Ordering API mit Rolle „Order Placement“; braucht Amazon-Business-Konto, Entwicklerprofil im Solution Provider Portal und Freigabe durch Amazon (1–5 Wochen). Nicht gebaut |
| 10c | Push bei Grün bzw. Deal-Wert über Schwelle: Direktlink (Shop, sonst Amazon-Seite), empfohlene Menge, max. EK, Restbudget der Woche, Ablauf | ❌ | ✅ | `src/lib/deal-eingang/kauf*.ts`; Knöpfe „Zum Angebot“ / „Gekauft …“ in der Meldung |
| 10d | Budget-Grenzen je Deal/Tag/Woche (Einstellung), darüber höchstens Gelb mit Hinweis | ❌ | ✅ | Deal-Eingang → „Kaufen mit einem Tap“ (nur Inhaber) |
| 10e | Bestellbestätigung per Mail → „gekauft“ (Menge, Preis) → Wareneingang + Rechnung erwartet | ❌ | ✅ | Postfach/.eml → Bestellung „bestellt“ mit Shop-Bestellnummer (Rechnung wird darüber zugeordnet), Aufgabe „Wareneingang buchen“ |
| 10f | „gekauft: Menge, Preis“ per Knopf bzw. Sprache | ❌ | ✅ | Knopf auf der Seite (aus der Meldung), SMS/Sprache „gekauft 60 zu 19,50“, Claude `deal_gekauft` |
| 11.1 | 👍/👎 mit Kurzgrund (feste Liste) über Push, Seite, Discord, Claude | ❌ | ✅ | Push öffnet die Seite mit Vorauswahl; Discord-Reaktion unter der ProfitPath-Nachricht (alle 15 Min. bzw. „ProfitPath abrufen“) |
| 11.2 | Eigene Ergebnisse je Charge 30/60/90 Tage nach Wareneingang (Ø VK, Gewinn/ROI, Tage bis Abverkauf, Erstattungen) | ❌ | ✅ | sellerboard je Monat (anteilig auf die gekaufte Menge) + Amazon-Rücksendungen; täglich bzw. Knopf auf `/deal-eingang/lernen` |
| 11.3 | Lugru-Deals-History rückwirkend inkl. Reaktionen, nur anonym/aggregiert, schwaches Signal, „bewährt“ stärkt | ❌ | 🟡 | Go: Lugru Deals sendet stündlich (erstes Mal alles); Seller: `POST /api/public/lugru-deals/deals`. Nur Anzahlen ✅/❌, keine Namen. „Zeit bis ausverkauft“ speichert Lugru Deals nicht (nur Status) |
| 11.4 | Keepa-Schnappschuss beim Eingang (Buy Box vs. Ø, Schwankung, Einbrüche, Tief, Angebote/Trend, FBA-Anteil, Amazon-Anteil, Rang/Trend, Saison, ROI/Marge, EK zum Tief, Kontext) | ❌ | ✅ | aus dem Keepa-Zwischenspeicher der Deal-Ampel – keine zusätzlichen Tokens. „Aktionsmuster“ nur als Anzahl Einbrüche |
| 11.5 | Modell: Kennzahlen + ähnliche Deals; ab 100 Deals mit Ergebnis Lernmodell (logistische Regression) | ❌ | ✅ | `wert-logic.ts`; Begründung „Passt zu dir (X/100): … Gegen: …“; Rot deckelt auf 30 |
| 11.6 | Monatsbericht (Trefferquote, verpasste gute Deals, Fehlkäufe, wichtigste Merkmale) | ❌ | ✅ | `/deal-eingang/lernen`, Claude `deal_lernen_bericht` |
| 11.7 | Auswertung für die Deal-Gruppe (optional, nur nach Freigabe) | – | – | bewusst nicht gebaut – erst nach Freigabe durch Ludwig |
| 11.8 | MCP `deal_wert`, `deal_lernen_bericht`, `deal_bewerten`, `deal_gekauft` | ❌ | ✅ | `src/lib/assistant/tools/deal-eingang.ts`; ändernd nur auf ausdrücklichen Wunsch (`deal_gekauft` gelb) |
| – | Öffentliche Adresse: Deal-Kurzbefehl und Lugru Deals bekamen „Nicht freigegeben“ | 🐞 | ✅ | `deploy/claude-oeffentlich.sh` gibt `/api/deal-eingang` und `/api/public/lugru-deals/*` frei (beide prüfen ihren Schlüssel selbst) |

Abnahme 11 durchgespielt (e2e `deal-wert`): History-Import mit Reaktionen ✅ · neuer Deal zeigt Deal-Wert mit Begründung
und ähnlichen Deals ✅ · 👍/👎 aus Push und Discord gespeichert ✅ · Bestellbestätigungs-Mail markiert gekauft ✅ ·
Wareneingang + 30 Tage → reales Ergebnis ✅.

## B16 – Wochenrückblick privat vollständig (Nachtrag 31.10.)

Gilt nur mit Privat-Freigabe im Konnektor und vollem Privat-Umfang, nur für die eigene Person – nie für VA oder Konten
„nur Familie“ (`src/lib/feierabend/service.ts`: `privateScope === "voll"`). Das Protokoll speichert bei Privat-Werkzeugen
keine Inhalte (nur „Privat-Eintrag geändert (Feldnamen)“), die Rückgängig-Daten liegen verschlüsselt.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 16.1 | Beobachtungen der Woche im Format Situation \| Problematik \| gewünschte Veränderung, nach Tag, Kennzeichen „enthält [?] – unvollständig“ | ❌ | ✅ | `src/lib/private/rueckblick-logic.ts` (`beobachtungTeile`, `therapieBogen`); nur eigene Beobachtungen; ältere Einträge (nur Text) werden an „\|“ bzw. „Problematik:“-Zeilen zerlegt |
| 16.2 | Zuwendung/Nähe: Anzahl je Art (Streicheln, Massage), wer gibt/empfängt | ❌ | ✅ | `wochePrivat` → `zuwendung[{art, anzahl, wer[{richtung, anzahl}]}]`; nur „stattgefunden“, ausgefallene getrennt |
| 16.3 | Paar-Gespräche (Themen), Danke, Stimmung (Ø + Verlauf), Dateideen, private Aufgaben erledigt/offen | ❌ | ✅ | `wochePrivat`; Stimmung nur der eigenen Person, Aufgaben „für mich“ oder „für beide“ |
| 16.4 | Vergleich zur Vorwoche (mehr/weniger) | ❌ | ✅ | `vergleichVorwoche`; Feierabend-Seite „Privates zeigen“ (`src/app/(app)/kalender/feierabend/page.tsx`, `fa-privat`) |
| 16.5 | Export „Therapie-Bogen seit letzter Sitzung“ (Druck/PDF, Tabelle wie der Papierbogen), Zeitraum wählbar bzw. ab letztem Paartherapie-Termin | ❌ | ✅ | `src/app/(privat)/privat/therapie-bogen/page.tsx` (`letzteSitzung`: letzter vergangener, nicht ausgefallener Termin „Paartherapie“); Reiter unter Partnerschaft, Links aus Rückblick, Tagebuch und Feierabend |
| 16.6 | Beobachtungen bearbeitbar und löschbar (UI) | 🟡 nur löschen, nur Freitext | ✅ | ADHS-Tagebuch → Beobachtungen: drei Felder beim Anlegen, „bearbeiten“ je eigener Beobachtung (`updateObservationAction`) |
| 16.7 | MCP `privat_eintrag_aendern(id, …)` / `privat_eintrag_loeschen(id)` – nur auf ausdrücklichen Wunsch | ❌ | ✅ | `src/lib/assistant/tools/privat.ts`, `src/lib/private/aendern.ts`; Arten wie `privat_eintrag_anlegen`, eigene Arten nur der Verfasser; 7 Tage rückgängig (nur dieselbe Person, auch der Inhaber nicht für andere) |
| 16.8 | `feierabend(rueckblick, mit_privat)` liefert alles oben | 🟡 nur Familienzeit/Paarzeit | ✅ | Werkzeugbeschreibung und Felder in `src/lib/assistant/tools/herzstueck.ts` |

Abnahme durchgespielt (e2e `privat-rueckblick`, Unit `privat-rueckblick`, `privat-aendern`): Beobachtung mit drei Feldern
und „[?]“ angelegt ✅ · `feierabend` mit Privat liefert Beobachtung (unvollständig), Zuwendung „Ina → Tom“, Gespräch,
Danke, Stimmung, Vorwochen-Vergleich ✅ · ohne Privat-Freigabe `privat: null` ✅ · Therapie-Bogen beginnt am letzten
Paartherapie-Termin, Zeitraum wählbar ✅ · ändern per Claude und per Formular ✅ · löschen per Claude, im Assistent-Verlauf
rückgängig mit derselben ID ✅ · Protokoll ohne Inhalte ✅ · Konto „nur Familie“: keine Claude-Verbindung, Therapie-Bogen und privater Rückblick gesperrt ✅.

## Siri-Schnellerfassung – Befund vom 31.10.

Befund: „Hey Siri, Seller-System, erinnere mich morgen an die Retouren“ kam an, landete aber als `art: unklar`,
`angelegt: false` in der Eingangsliste; der Link in der Antwort zeigte auf `https://localhost:3000/schnell`.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| S.1 | Weckwort/Anrede vorne („Seller-System, …“, „Hey Siri, …“, „Kannst du …“) verhinderte die Erkennung | 🐞 | ✅ | `src/lib/schnell/logic.ts` (`ohneWeckwort`) |
| S.2 | Eindeutige Befehle direkt anlegen: „erinner(e) mich …“, „erstelle/leg (morgen um 10 Uhr) eine Aufgabe …“, „neue Aufgabe …“, „denk dran …“ | 🟡 nur wenige Formen | ✅ | `befehlRest`; Antwort zum Vorlesen z. B. „Aufgabe angelegt für 01.11.: Retouren“ |
| S.3 | Titel ohne Befehl, Zeitangaben und zuständige Person („erinnere mich morgen an die Retouren“ → „Retouren“) | 🟡 | ✅ | `titelAus`, `ohneZeitangaben`; Uhrzeit steht in der Antwort und vor dem Titel |
| S.4 | Befehl ohne Inhalt („Erstelle morgen eine Aufgabe“) | 🟡 landete unklar in der Liste | ✅ | Rückfrage „Was soll die Aufgabe sein?“ statt leerer Aufgabe |
| S.5 | Unklares weiter zur Bestätigung; Privates nur mit vollem Privat-Zugang, Privat-Zeiten immer bestätigen | ✅ | ✅ | unverändert (`einordnen`, KI nur bei „unklar“, legt nur geschäftliche Aufgaben/Notizen direkt an) |
| S.6 | Link fürs Handy zeigte `https://localhost:3000/schnell` | 🐞 | ✅ | `linkBasis` in `src/lib/public-url.ts`: Hauptadresse (APP_URL), sonst die Adresse der Anfrage – nie localhost; gilt auch für den Deal-Kurzbefehl |

Hinweis zum Link: Die Claude-Adresse lässt absichtlich nur Claude, Anmeldung und die Handy-Schnittstellen durch – eine
Seite wie /schnell zeigt dort „Nicht freigegeben“. Der Link geht deshalb auf die normale Adresse des Seller-Systems
(APP_URL), unter der man im Browser angemeldet ist.

Abnahme (Unit `schnell`, `link-basis`; e2e `schnell-familie`): Siri-Satz mit Weckwort → Aufgabe für morgen „Retouren“
✅ · Link ohne localhost ✅ · Befehl ohne Inhalt → Rückfrage ✅ · Unklares → Eingangsliste ✅ · Privat-Zeit nie direkt ✅.

## Lugru Deals → Seller-System (Bauauftrag 31.10., zweiter Anlauf)

**Schritt 0 – Bericht.** Lugru Deals ist eigene Software (Go, Ordner `lugru-deals/` im Repo), läuft als Programm auf
Ludwigs PC (nicht auf dem Server) und postet die Deals als **Klartext über Discord-Webhooks** in die Deal-Kanäle. Ein
eigener Reaktions-Bot setzt ✅ = gekauft und ❌ = nicht (mehr) verfügbar. Die History liegt in der SQLite-Datenbank des
Programms (Tabelle `deals` mit Discord-Kanal-/Nachrichten-ID) **und** in Discord. Die bisherige Anbindung
„Lugru Deals (Shop-Monitor)“ war nur der eBay-Schlüssel des Programms plus ein Push-Endpunkt
`/api/public/lugru-deals/deals`, der nur Daten bekommt, wenn das Programm auf dem PC läuft und aktualisiert ist – deshalb
kam nichts an. **Gewählt: beide Wege, zusammengeführt über die Discord-Nachrichten-ID** (kein Deal doppelt):
- **Weg A – direkt von der Lugru-Deals-Seite (Hauptweg, Nachtrag 31.10. auf Ludwigs Hinweis):** Jeder Deal wird über
  die Seite gepostet – die Seite schickt ihn jetzt **sofort nach dem Posten** ans Seller-System (nicht mehr nur
  stündlich), ebenso nach „ausverkauft“, „bearbeiten“ und neuen Reaktionen. Ein frischer Deal (≤ 2 Std.) läuft dort
  sofort in den Deal-Eingang mit Ampel und Push. Läuft, sobald das Programm aktualisiert ist und Seller-Adresse +
  Verbindungsschlüssel eingetragen sind.
- **Weg B – Seller-System liest die Deal-Kanäle selbst (optional, Rückfall):** Bot mit Leserechten; fängt Reaktionen
  auch dann auf, wenn der PC mit der Lugru-Seite aus ist.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| L.1 | Datenmodell: Herkunft (Discord-Nachricht, Kanal, Link), Produkt (ASIN bzw. „unsicher“), Shop, Preise, Reaktionen je Emoji, Gruppen-Käufe, ausverkauft, Stand | 🟡 nur Push-Felder | ✅ | `src/db/tables/deal-eingang.ts` (`lugruDealsHistorie`, `lugruKanaele`), Migration `drizzle/0108_lugru_discord.sql` |
| L.2 | Keepa-Schnappschuss zum Zeitpunkt des Postens (History: aus dem Keepa-Verlauf) | ❌ | ✅ | `keepaSchnappschuss` in `src/lib/lugru-deals/auswertung-logic.ts`; Nachholen stündlich (`lugruKeepaNachholen`) |
| L.3 | Ampel zum Zeitpunkt des Postens, Entscheidung (gekauft/verworfen), Ergebnis nach Kauf | ❌ | ✅ | Live-Deals laufen durch den Deal-Eingang (Ampel, Entscheidung, reales Ergebnis); `lugruDeal` zeigt alles zusammen |
| L.4 | Live: neuer Post → Deal-Eingang „Lugru Deals · #kanal“ → Deal-Ampel → Push bei Grün/Gelb, ≤ 2 Min. | ❌ | ✅ | `src/lib/lugru-deals/discord.ts` (`lugruAbgleich`, jede Minute im Scheduler); Post-Leser `src/lib/lugru-deals/post-logic.ts` |
| L.5 | Reaktionen nachziehen: in den ersten 48 h alle 5 Min., danach stündlich (bis 30 Tage) | ❌ | ✅ | `reaktionenFaellig`, `tiefAbgleich` |
| L.6 | Doppelte Deals (gleiche ASIN + Shop < 24 h) zusammenfassen | ❌ | ✅ | `dublettenSchluessel` – zweiter Post hängt am ersten Eingang |
| L.7 | History-Import: wiederaufnehmbar, rückwärts je Kanal, Fortschritt in der Oberfläche | ❌ | ✅ | `lugruHistorie` (5 Seiten je Lauf im Hintergrund, Knopf „History importieren“), Stand je Kanal auf der Seite |
| L.8 | Eigene Käufe automatisch erkennen (Bestellung mit gleicher ASIN ≤ 14 Tage nach dem Post), Kennzeichen „automatisch erkannt“ | ❌ | ✅ | `lugruKaufAbgleich` + `kaufZuDeal`; täglich |
| L.9 | Deal-Wert 0–100 mit Begründung, dafür/dagegen, ähnliche frühere Deals, Gruppen-Käufe anonym; Rot-Kriterien gelten immer | 🟡 nur für Eingänge | ✅ | `lugruWerte` in `src/lib/deal-eingang/wert.ts` (gleiche Logik wie der Deal-Eingang, gedeckelt bei Rot) |
| L.10 | Seite „Lugru Deals“: Liste mit Filtern (Zeitraum, Kanal, Ampel, Deal-Wert, gekauft), Detail mit Keepa-Mini-Chart, Reaktionen, Ergebnis; Kacheln (Deals/Woche, Ø Reaktionen, Anteil grün, gekauft, Ø realer ROI, beste Marken/Kategorien) | ❌ | ✅ | `src/app/(app)/deal-eingang/lugru/page.tsx`, `…/lugru/[id]/page.tsx`; Link im Deal-Eingang |
| L.11 | MCP `lugru_deals`, `lugru_deal`, `lugru_statistik`; `deal_quellen` zeigt „Lugru Deals“ (gemeldet/grün/gekauft/Gruppen-Käufe) | ❌ | ✅ | `src/lib/assistant/tools/lugru.ts`, `deal_quellen` in `src/lib/deal-eingang/service.ts` |
| L.12 | Keine Mitglieder-Namen oder -IDs | – | ✅ | Gespeichert werden nur Anzahlen je Emoji; Text und Autor des Posts nicht (nur die ausgelesenen Zahlen) |
| L.14 | Direkt von der Lugru-Deals-Seite: sofort nach dem Posten senden (Folge-Posts in weitere Channels im selben Paket), auch nach Ausverkauft/Bearbeiten/neuen Reaktionen; Shop, Einkaufslink, EK netto/brutto, Max-Menge mitsenden | 🟡 nur stündlich, ohne Live-Eingang | ✅ | `lugru-deals/internal/web/sellerdeals.go` (`stosseSellerAn`, Aufrufe in `deal.go`, `postaktionen.go`, `reaktionen.go`); Seller: `lugruImport` legt für frische Deals den Eingang an (`lugruLiveEingang` in `src/lib/lugru-deals/discord.ts`, gemeinsam mit Weg B); Go-Test `TestNachDemPostenGehtDerDealSofortAnsSellerSystem`, e2e „Direkt von der Lugru-Deals-Seite“ |
| L.13 | Anbindung: Kanal-IDs, Bot-Token (eigener oder der Discord-Bot des Seller-Systems), Emojis für „gekauft“/„weg“, „Verbindung testen“ liest je Kanal den letzten Deal | 🟡 nur eBay-Schlüssel | ✅ | `src/lib/integrations/registry.ts` (Karte „Lugru Deals“), `src/lib/integrations/clients/lugru-deals.ts` |

Abnahme 1–7 (e2e `lugru-deals` mit erfundenen Posts im Discord-Nachbau, Unit `lugru-post`):
1. Bericht Schritt 0 ✅ (oben).
2. History: alte Posts mehrerer Kanäle importiert, je Deal Reaktionen sichtbar, `lugru_statistik` liefert Summen ✅ –
   live erst nach Bot-Einladung (To-do 29).
3. Live: Test-Post erscheint nach „Jetzt abrufen“ (im Betrieb jede Minute) im Deal-Eingang mit Ampel; Push nur bei
   Grün/Gelb ✅.
4. Reaktion hinzugefügt → Gruppen-Käufe im Seller-System aktualisiert ✅.
5. `deal_quellen` zeigt „Lugru Deals“ (gemeldet, grün, gekauft) und „Lugru Deals · #kanal“ ✅.
6. Jeder Lugru-Deal hat Deal-Wert mit Begründung und ähnlichen Deals (`lugru_deals`: alle mit `deal_wert`) ✅.
7. Keine Namen/IDs von Mitgliedern in der Datenbank (Prüfung im Test) ✅.

## B17 – Befunde aus dem Werkzeug-Test vom 31.10.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 17.1 | Lugru Deals kommen nicht an | 🐞 | ✅ | siehe Abschnitt oben |
| 17.2a | Fall-Zentrale: „Verkauft, Jetzt liefern“, „Amazon hat … versandt / a expédié / ha enviado“, „Tu pago está en camino“ als „Markenbeschwerde“, rot | 🐞 | ✅ | `istRoutineMail` in `src/lib/amazon-faelle/logic.ts` (nur Betreff, alle EU-Sprachen): nie ein Vorgang; geprüfte Mails stehen in `amazon_mail_uebersprungen` (Migration `0109`) und werden nicht erneut gelesen |
| 17.2b | Ursache „Marke“: nackte Wörter wie „Copyright“, „Patent“, „Echtheit“ aus der Fußzeile | 🐞 | ✅ | Fußzeilen (©, „Alle Rechte vorbehalten“, Abmelden) zählen nicht (`ohneFusszeile`); Marke nur bei echten Rechte-/Echtheitsmails (Rechteinhaber, Markenrechts-/Urheberrechtsverletzung, Fälschung, IP-Beschwerde in allen Sprachen) |
| 17.2c | Marktplatz „US“ bei Absender amazon.com | 🐞 | ✅ | `marktplatzAus` in `src/lib/amazon-todos/logic.ts`: amazon.com ist allgemeiner Absender → Domain im Text (amazon.fr, sellercentral.amazon.es), sonst Sprache der Mail; „US“ nur mit klarem Hinweis, sonst offen. Gilt auch für Amazon-ToDos |
| 17.2d | Bestehende Fehlzuordnungen neu einstufen | ❌ | ✅ | `neuEinstufen` in `src/lib/amazon-faelle/service.ts` läuft vor jedem Abgleich: Routine → „Info“ (grau, ohne Frist, eigene System-Aufgabe geschlossen), Bereich/Frist neu, Marktplatz berichtigt; von Hand bearbeitete Vorgänge behalten Bereich und Phase. Nichts wird gelöscht; jede Änderung steht im Verlauf („Neu eingestuft: …“) |
| 17.2e | 2× „Wichtige Informationen zu Ihrer VAT auf Amazon.de“ (02.10., Frist 05.10.) | ❓ | ✅ geklärt | Die Frist 05.10. stand **nicht** in der Mail – es war die Standardfrist „Antwort nötig“ (+3 Tage). Neu: Steuer-/VAT-Hinweise ohne eigene Frist in der Mail sind „Info“ ohne Frist; nennt die Mail selbst ein Datum („bis zum …“), gilt dieses und der Vorgang ist „bitte prüfen“. „Sonstiges“ bekommt keine Standardfrist mehr. Inhaltlich bitte selbst lesen (keine Steuerberatung durch das System) – To-do 31 |
| 17.3 | BQool-Vorschau: Soll-Regeln falsch (Tefal B0DGLJPK7Y, Lierac sollen Liquidation bleiben; DJI B0CFF4RYDM DE „Abverkauf DE“; Philips DE nur „Abverkauf DE“) | 🐞 | ✅ | `regelFuer` in `src/lib/bqool/export-logic.ts`: Liquidation laut letztem BQool-Ist bleibt (Min als feste Untergrenze), andere Nicht-Standard-Regeln laut Ist („Abverkauf DE“) bleiben, Regelnamen je Land aus dem Katalog (`regelNameFuerLand`: DE „Abverkauf DE“, FR/IT/ES „Abverkauf“); Katalog „Abverkauf“ nur FR/IT/ES. Reihenfolge: feste Zuweisung → Liquidation (Ist) → Markenregel → Abverkaufs-Liste → Ist → „ia“ |
| 17.4 | Min aus dem Upload vom 28.10. über der Buy Box (min_ist > effektiver Min) | ❌ | ✅ | `minBlockiertBuybox`: eigene Warnung je Zeile „Min aus Upload blockiert Buy Box – neuer Upload mit Min = effektiver Min empfohlen (…)“ in Vorschau und `bqool_export_vorschau` |
| 17.5 | Anruf „DHL Geschäftskunden …“ ohne Telefonnummer | ❌ | ✅ | `src/lib/mobil/telefon.ts`: Vorschlag aus Lieferanten-Profil → Kontakten → Signatur in Mails des Absenders → auf Knopfdruck Websuche; nie von selbst gespeichert. Startseite: „📞 Nummer fehlt – Vorschlag …“ mit „Übernehmen“/„Nummer im Web suchen“; `aufgabe_anlegen` fragt nach (`rueckfrage`, `telefon_vorschlag`), `aufgabe_aendern(telefon)` speichert; Siri-Antwort nennt die fehlende Nummer |
| 17.6 | `anbindungen_status.postfaecher` leer, obwohl 2 Postfächer abrufen | 🐞 | ✅ | Mit `nur_probleme` wurden fehlerfreie Postfächer ausgeblendet, ohne Hinweis. Neu: immer `postfaecher_uebersicht` (gesamt, aktiv, rufen ab ohne Fehler, mit Fehler, letzter Abruf) und `postfaecher_hinweis`; „seit 24 h kein Abruf“ zählt als Problem (`src/lib/assistant/tools/geschaeft.ts`) |

Abnahme B17 (Unit `amazon-faelle`, `amazon-todos`, `bqool-export`, `mobil-logic`; e2e `amazon-faelle`, `handy-tesla`,
`bqool-dateien`, `werkzeuge`): Routine-Mails in DE/FR/ES/EN → kein Vorgang, grau, Marktplatz aus Inhalt ✅ · Fußzeile mit
„Copyright/Patent“ → keine Markenbeschwerde ✅ · echte IP-/Fälschungsmails weiter rot ✅ · alter Fehl-Vorgang (Marke, rot,
US) → Info, FR, Verlauf „Routine-Mail … kein Fall“ ✅ · VAT ohne Frist → Info ohne Frist ✅ · BQool: Liquidation/„Abverkauf
DE“ laut Ist bleiben, Markenregel „Abverkauf“ in DE → „Abverkauf DE“ ✅ · Min-Warnung ✅ · Anruf ohne Nummer → Rückfrage,
Vorschlag aus Mail-Signatur, auf der Startseite übernommen ✅.

## B18 – VA-Automatik: Ansprüche, Fristen, Fälle, Tagesübersicht (Ergänzung 31.10.)

Teil 1–3 des Bauauftrags „VA-Discord, EK-Sync, BQool“ waren schon gebaut (VA-1, VA-2, VA-Sprache, EK-1, BQ-1, AU-1).
Neu war nur der Abschnitt „Automatik“. Alles Neue steht in `src/lib/va/automatik.ts` (Ablauf) und
`src/lib/va/automatik-logic.ts` (Regeln, Texte; Unit-Test `tests/va-automatik.test.ts`), Migration `0110`.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 18.0 | VA-Zeitzone Asia/Manila, VA spricht nur Englisch | 🟡 Standard „Europe/Berlin“ | ✅ | Standard `Asia/Manila` (`src/lib/settings.ts`); ist noch Berlin gespeichert, zeigt die VA-Seite einen Hinweis (To-do 34). Alles an die VA ist Englisch |
| 18.1a | Jeder neue Anspruch → Thread mit Art, SKU/ASIN/FNSKU, Sendung/Bestellung, Menge, erwartetem Betrag, Frist, Belegen, Anleitung „File reimbursement claim“ | ❌ (nur Aufgaben gingen an die VA) | ✅ | `anspruchAnVa`: Thread „Claim: …“, Falltext auf Englisch, Rechnungen als Anhang nur mit „VA darf Einkaufsrechnungen sehen“ (sonst ohne EK); Anleitung aus dem Wissen, sonst Standard-Anleitung. Anspruch wird „vorgemerkt“. Von Hand: Knopf „An die VA“ auf der Anspruchs-Seite |
| 18.1b | Erinnerungen 7, 3 und 1 Tag vor der Frist um 09:00 Manila | ❌ (nur Fälligkeitstag/überfällig) | ✅ | `fristErinnerung`/`anspruchFristen`: einmal am Tag ab der Uhrzeit (VA-Zeit), nie in der Ruhezeit; Tage und Uhrzeit einstellbar |
| 18.1c | Am Fristtag Info an Ludwig | ❌ | ✅ | Meldung „Anspruch: Frist heute – noch nicht eingereicht“ (Push/Discord), einmal je Anspruch |
| 18.1d | Fallnummer der VA → `anspruch_eingereicht` automatisch | 🟡 (nur von Hand bzw. über Claude) | ✅ | `fallnummerInAntwort` → `markiereEingereicht` (Verlauf „… über VA (Discord)“), Bestätigung im Thread. Auch im Sammel-Thread („#3 case …“) und im Fall-Thread der Fall-Zentrale (Vorgang → „eingereicht“) |
| 18.1e | Abgelaufene Ansprüche ohne Einreichung → Liste an Ludwig (Premium-Support/PSTAM), nicht mehr an die VA | 🟡 (nur allgemeine Aufgabe „über der Frist“) | ✅ | Thread wird mit Hinweis an die VA geschlossen; Aufgabe „N Ansprüche: Frist bei der VA verpasst – Premium-Support/PSTAM versuchen“ mit Liste und Summe; abgelaufene Ansprüche gehen nie an die VA |
| 18.2a | Regeln je Kategorie (an die VA / erst Ludwig / nie) | ❌ („zuständig VA“ war nur ein Etikett) | ✅ | `fallKategorie` + `vaEntscheidung` nach der Tabelle des Auftrags; je Kategorie änderbar unter Delegation → VA → „Automatik – Regeln“; Ergebnis je Fall in der Liste „Automatik“ mit Grund |
| 18.2b | Alles mit Betrag > 500 € erst an Ludwig (Einstellung), Knopf „an VA geben“ | 🟡 (ab 200 € nur Zusatz-Info) | ✅ | `va.automatik.schwelle`; Meldung „Amazon-Fall erst bei dir“ bzw. „Anspruch erst bei dir“; Knopf „An die VA“ in der Liste und auf der Fall-Seite |
| 18.2c | Modus „Vorschlag“, bis B17.2 behoben ist | ❌ | ✅ Standard | Nichts geht von selbst an die VA; Liste „wäre an die VA gegangen“ und tägliche Aufgabe „VA-Automatik (Vorschlag): …“. Beim Umschalten auf „automatisch“ gilt ab dann (`seit`) – Altes geht nicht von selbst raus |
| 18.2d | Höchstens 30 neue Threads am Tag (Einstellung), darüber Sammel-Thread | ❌ | ✅ | Zählung je VA-Tag; darüber ein Sammel-Thread „More tasks – …“ mit nummerierten Einträgen; Antworten „#n case …“ / „#n done“; Erinnerungen und „verpasst“ auch dort |
| 18.3 | „Daily overview“ jeden Arbeitstag 09:00 Manila (Englisch): neu seit gestern, Fristen heute/morgen, überfällig, offene Rückfragen, je mit Thread-Link | ❌ | ✅ | `tagesuebersicht` im VA-Kanal, Links als `<#thread>`; Arbeitstage (Standard Mo–Fr) und Feiertage einstellbar; einmal am Tag |
| 18.4 | Zeile „VA heute: X erledigt, Y Rückfragen, Z automatisch beantwortet, N Fristen verpasst“ (rot) im Feierabend-Check und Morgenbericht | 🟡 (ohne „Fristen verpasst“) | ✅ | `vaHeute`: verpasst = Aufgabe der VA heute überfällig geworden + Anspruch bei der VA ohne Einreichung abgelaufen; rot im Feierabend, auf der VA-Seite und auf der Startseite („VA: N Fristen heute verpasst“); Morgenbericht über `ueberblick.va`, dazu `va_aufgaben` |

Abnahme B18 (e2e `va-automatik.spec.ts`, 3 Abläufe; Unit `va-automatik`): Anspruch mit Frist in 8 Tagen → Thread sofort ✅
· Erinnerung an Tag −7, −3, −1, an Tag −5 keine (09:00 Manila = 02:00 Berlin im Unit-Test) ✅ · „Submitted, case
12345678901“ im Thread → Anspruch „eingereicht“ mit Fallnummer ✅ · Markenbeschwerde → nur bei Ludwig, kein Thread ✅ · Fall
„Antwort nötig“ mit 120 € → automatisch bei der VA ✅ · Fall mit 800 € → erst bei Ludwig, Knopf „An die VA“ ✅ · „Daily
overview“ auf Englisch mit Thread-Links, einmal am Tag; Mo–Fr und Feiertage im Unit-Test ✅ · Frist verpasst → Liste an
Ludwig, Zeile rot ✅ · Tagesgrenze → Sammel-Thread, „#n case …“ ✅.

## B19 – Browser-Test Teil 2 und Lugru (Nachtrag 31.10.)

Reihenfolge wie im Nachtrag: B19.2 → B19.1 → B19.3 → B19.4 → Rest. Status: ✅ gebaut · 🟡 teilweise · ❌ fehlt ·
👤 entscheidet Ludwig.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 19.2a | Neue Konten bekommen nie Privat-Zugang | 🐞 (Vorgabe „voll“ möglich) | ✅ | `src/lib/auth/rollen.ts` (Vorlagen VA / Nur Familie / Mitarbeiter / Inhaber), `addUser` in `src/app/(app)/einstellungen/actions.ts`: Privat nur mit Vorlage „Nur Familie“ (dann eng) |
| 19.2b | Benutzerliste: Spalte „Privat-Zugriff“, Warnungen | ❌ | ✅ | `zugriffsWarnungen`: Privat voll bei Nicht-Inhaber (rot), weiteres/ungenutztes Inhaber-Konto, Mitarbeiter mit allen Bereichen, VA ohne VA-Rolle; Rolle je Konto umstellbar (`setRolleAction`), Konto entfernen wie bisher |
| 19.2c | „Nur Familie“ sieht nie Beobachtungen, Therapie, Tagebuch, Finanzen | 🟡 | ✅ | `familieDarf` in `src/lib/private/service.ts`: nur Termine mit „Familie“ und Schulbriefe – kein Tagebuch, Therapie-Bogen, Geld, keine Paar-/Arzttermine, auch nicht per direktem Link; e2e `zugriffe.spec.ts` |
| 19.2d | Live-Konten (test, Partnerin, va@va.de, du@firma.de) | – | 👤 | Das System ändert keine Live-Konten selbst – To-dos 37–38 |
| 19.1a | Alle Lugru-Deals mit Ampel und Eingang „Lugru Deals“ | ❌ (nur neue Posts) | ✅ | `src/lib/lugru-deals/historie.ts` + `historie-logic.ts`: Hintergrund alle 5 Min., erst die letzten 90 Tage, dann rückwärts bis zur Aufbewahrungsfrist; Ampel nach den Regeln der Deal-Ampel aus Post-Zahlen und Keepa-Schnappschuss (keine neuen Keepa-Abrufe), Eingang „historisch“ ohne Push, nicht im normalen Posteingang und nicht in Kauf-Meldungen (Migration `0111`); Knopf „Jetzt nachtragen“ |
| 19.1b | Trefferquote-Link führt ins Leere (Filter leer) | 🐞 | ✅ | `quellen` in `src/lib/deal-eingang/service.ts`: Filter „Lugru Deals“ trifft alle Lugru-Kanäle; solange dort nichts steht, Link auf `/deal-eingang/lugru` |
| 19.1c | Weg A zeigt „Noch nicht eingerichtet“ | 🐞 | ✅ | `lugruKanalStand` in `src/lib/lugru-deals/discord.ts`: „Weg A – direkt von der Lugru-Seite“ mit zuletzt übertragen; Warnung erst nach 24 Std. ohne Post |
| 19.1d | Reaktionen `{}` | 🐞 | ✅ | `reaktionenVon` in `auswertung-logic.ts`: je Emoji (Discord); bei Weg A, wo die Seite nur Kaufzeichen schickt, ✅ = Käufe und ❌ = „nicht verfügbar“ mit Hinweis „nur Kaufzeichen“ statt `{}` |
| 19.1e | Zeitraum und Gesamtzahl | ❌ | ✅ | Seite und `lugru_statistik`/`lugru_deals`: Zeitraum von–bis und `gesamt` |
| 19.1f | Kanalnamen mit Leerzeichen, Testkanäle | 🐞 | ✅ | `kanalName` (trimmt, auch rückwirkend per Migration `0111`), Schalter „Testkanäle ausblenden“ (Standard an), `mit_test` im Werkzeug |
| 19.1g | Kategorie leer | ❌ | ✅ | `kategorieAus` in `src/lib/keepa/auswertung.ts`; alte Schnappschüsse werden gedrosselt nachgezogen (`lugruKategorieNachholen`) |
| 19.1h | Schwelle je Quelle (Lugru = 60) | ❌ | ✅ / 👤 | `wertSchwelleFuer` in `src/lib/deal-eingang/logic.ts`, Feld „je Quelle“ im Kasten „Kaufen mit einem Tap: Budget und Deal-Wert“ auf der Deal-Eingang-Seite; den Wert 60 setzt Ludwig (To-do 39) |
| 19.1i | „Selbst gekauft“ = 0, obwohl gekauft (Rückmeldung 31.10.) | 🐞 | ✅ | `lugruKaufAbgleich` in `src/lib/lugru-deals/discord.ts` suchte nur Einkaufs-Bestellungen des Seller-Systems und „gekauft“ im Deal-Eingang. Neu: auch Chargen mit Kaufdatum (aus der SKU bzw. dem EK-Import, ohne Rücksendungen), Vergleich je Tag ab dem Tag des Posts (`kaufZuDeal`), alle offenen Deals neueste zuerst (vorher höchstens 5.000 in beliebiger Reihenfolge). Knopf „Eigene Käufe abgleichen“ an der Kachel, sonst täglich; Unit `lugru-kauf`, e2e `b19-rest` |
| 19.3a | Kopf und Überleitung aus verschiedenen Quellen | 🐞 | ✅ | `gewinnBasis` + `ueberleitung` in `src/lib/money/profit-logic.ts`: eine Basis für Kacheln, Gewinnwerte und Überleitung je Kanal; Summe „diese Seite“ = Kacheln |
| 19.3b | Jeder Gewinnwert beschriftet | ❌ | ✅ | Kasten „Welche Gewinnzahl ist welche?“ in `src/app/(app)/gewinn/page.tsx` (vorläufig, vollständig erfasst, sellerboard Netto/DB/Monatswert mit Quelle) |
| 19.3c | Zeitraum ab 01.10. | 🐞 (30 Tage) | ✅ | Standard „Dieser Monat“; Link von der Startseite mit `zeitraum=monat` |
| 19.4a | Einkaufs-, Versand- und Zahlungsmails als Fälle | 🐞 | ✅ | `routineArt` in `src/lib/amazon-faelle/logic.ts` (auch Amazon Business, alle EU-Sprachen, Unicode-Wortgrenzen): nie ein Fall; „Zahlung abgelehnt“ = eine Aufgabe je Bestellung (`zahlungsAufgabe`) |
| 19.4b | Gruppierung nach Bestellnummer | ❌ | ✅ | `zuordnen`: Mails mit derselben Bestellnummer landen im selben Vorgang |
| 19.4c | „erfolgreich / elaborato / successo“ als A-bis-z | 🐞 | ✅ | `ERFOLG_RE`: nie A-bis-z |
| 19.4d | „zuständig: VA“ bei Routine | 🐞 | ✅ | `echterFall`: VA-Zuständigkeit und VA-Automatik (`src/lib/va/automatik.ts`) nur bei echten Fällen; `neuEinstufen` nimmt die VA bei bestehenden Routine-Vorgängen heraus – nichts gelöscht, Verlauf |
| 19.5a | „Rückgängig“ versprochen, aber kein Knopf | 🐞 | ✅ | Assistent-Verlauf: Regel oben (welche Werkzeuge, 7 Tage, nur grün) und je Eintrag der Grund, warum es keinen Knopf gibt (`keinRueckgaengigGrund` in `src/lib/assistant/verlauf-logic.ts`); `aufgabe_aendern` jetzt rückgängig machbar |
| 19.5b | Tokenzähler zu niedrig | 🐞 | ✅ | Zwischengespeicherte Eingabe zählt mit (`eingabeTokens`: input + cache_creation + cache_read) in `src/lib/assistant/chat.ts`; Hinweis unter Einstellungen → Claude, dass ältere Gespräche zu klein gezählt sind |
| 19.6a | Deal-Blatt als Bild | ❌ (nur PDF/Text) | ✅ | `src/lib/b2b/blatt-bild.ts`, `/b2b/[id]/blatt?format=svg`, Knopf „Deal-Blatt (Bild)“; ohne EK und Verdienst |
| 19.6b | Sammelbestellung, Export fürs Prep-Tool | 🟡 (gebaut, nicht im Werkzeug) | ✅ | Gebaut seit B2B-5 (Deal-Seite, Freigabe nötig); neu im Werkzeug `deal`: `deal_blatt`, `sammelbestellung`, `export_prep_tool` je Kunde. PrepTool-API selbst ❌ – wartet auf Unterlagen (To-do 13) |
| 19.7a | „überbucht“ ohne Zahl | 🐞 | ✅ | `planeTag`/`tages` in `src/lib/tagesplan/logic.ts`: „überbucht – x Min. zu viel (y Min. frei)“, sobald fällige und überfällige Aufgaben mehr Zeit brauchen als frei ist; `tagesplan` liefert `faellig_min`, `zu_viel_min` |
| 19.7b | Wöchentlicher Rückblick | 🟡 (nur im Feierabend-Werkzeug) | ✅ | Seite `/privat/rueckblick/woche` (nur mit vollem Privat-Zugang, für die eigene Person) |
| 19.7c | Bereich „Beobachtungen“ | 🟡 (im Tagebuch versteckt) | ✅ | Reiter `/privat/beobachtungen`: eigene + über mich, drei Felder, bearbeiten/löschen, Link zum Therapie-Bogen |
| 19.8a | LPN-Feld an der Retouren-Station | ❌ | ✅ | Eingabe „LPN / FNSKU / EAN“ + „LPN übernehmen“ in `src/app/(station)/remissionen/station/station.tsx` (wie ein Scan) |
| 19.8b | Handy-Anleitung Kurzbefehl „Deal prüfen“ | 🟡 (nur im Deal-Eingang) | ✅ | Anleitung im Wissen (`src/lib/mobil/anleitungen.ts`), Links unter Einstellungen → Handy & Tesla und Schnellerfassung auf `/deal-eingang/kurzbefehl` |
| 19.8c | „AI Win Sales Booster“ = Liquidation | 🐞 (unbekannte Regel) | ✅ | Alias im Regel-Katalog `src/lib/bqool/export-logic.ts` |
| 19.8d | Bestellvorschläge mit 0 % Kaufquote oder negativer Marge in der Summe | 🐞 | ✅ | `pruefGrund` in `src/lib/purchasing/reorder-logic.ts`: eigener Kasten „Erst prüfen“, nicht im Kapitalbedarf; `bestellvorschlaege.zu_pruefen`; gilt auch in der Liquidität |
| 19.8e | Paletten ohne Kunde | 🟡 | ✅ | `paletten` meldet `nicht_abgerechnet` mit Link `/paletten?kunde=__ohne` |
| 19.8f | sellerboard-Fehler unsichtbar | 🐞 | ✅ | `anbindungen_status`: `letzter_fehler` je Abruf und `sellerboard_letzter_fehler` |
| 19.8g | Liquidität: Temu fehlt | 🐞 | ✅ | Ersatz aus den Temu-Aufträgen der letzten 28 Tage, als „geschätzt“ beschriftet (`src/lib/money/liquiditaet-service.ts`) |
| 19.8h | Liquidität: Steuertermine | ❌ | 👤 | Warnung bleibt, bis Ludwig die Termine einträgt (To-do 40); keine Steuerberatung durch das System |

Abnahme B19 (Unit 1944 Tests grün, darunter `rollen`, `lugru-historie`, `profit-logic`, `amazon-faelle`,
`assistent-verlauf`, `b2b-blatt-bild`, `tagesplan`, `bqool-export`, `datenbasis`; e2e `zugriffe`, `lugru-deals`
(History mit Ampel, ohne Push, Testkanal draußen, Weg A), `b15-zahlen` (eine Basis, Überleitung je Kanal), `herzstueck`,
`b19-rest`): „Nur Familie“ öffnet Tagebuch, Therapie-Bogen und Geld nicht – auch nicht per Link ✅ · History-Deal hat
Ampel und Eingang, kein Push ✅ · Trefferquote-Link → Lugru-Seite ✅ · Gewinn-Kopf = Summe der Überleitung ✅ ·
Bestell-/Versand-/Zahlungsmail → kein Fall, zwei Mails einer Bestellung → ein Vorgang ✅ · drei halbe Tage Arbeit an einem
Tag → „überbucht – … Min. zu viel“ ✅ · Deal-Blatt als SVG ohne EK ✅ · LPN-Feld, Handy-Anleitung, Werkzeug-Felder ✅.
Gesamtlauf aller Ablaufprüfungen (Desktop): 115 von 115 grün.

## B20 – Browser-Test Teil 3 (Nachtrag 31.10., 16:00)

Reihenfolge wie im Nachtrag: B20.1 → B20.2 → B20.5 → B20.8 → B20.7 → Rest. Status: ✅ gebaut · 🟡 teilweise ·
❌ fehlt · 👤 entscheidet Ludwig.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 20.1a | Mitarbeiter/VA können Privat nicht auf „voll“ setzen | 🐞 | ✅ | `privatStufeErlaubt` in `src/lib/auth/rollen.ts`; Auswahl „voll (nur Inhaber)“ gesperrt, Server lehnt ab (`setPrivateAccess`) |
| 20.1b | „Nie angemeldet“ > 30 Tage automatisch deaktivieren | ❌ | ✅ | `nieAngemeldeteDeaktivieren` in `src/lib/auth/konten.ts` (täglich, mit Aufgabe als Hinweis; ein angemeldeter Inhaber bleibt immer aktiv); Login, Sitzung, Token und Konnektor prüfen `deaktiviertAm` |
| 20.1c | 🔴-Warnung als Dialog beim Inhaber-Login | ❌ | ✅ | `PrivatWarnDialog` auf der Startseite, solange ein Nicht-Inhaber Privat „voll“ hat |
| 20.1d | Live-Konten umstellen | – | 👤 | To-dos 37–38 |
| 20.2a | Nachtrag stoppt bei 1.000 | 🐞 (Aufbewahrungsgrenze 12 Monate) | ✅ | `lugruHistorieEingaenge` in `src/lib/lugru-deals/historie.ts` ohne Zeitgrenze; Lugru-Eingänge fallen nicht unter die Aufbewahrung (`aufraeumen`); Fortschritt „x / gesamt“ mit Zeitpunkt des letzten Laufs |
| 20.2b | Vier Zahlen widersprechen sich | 🐞 | ✅ | Eine Zählbasis `lugruZaehlung` („Deals im Deal-Eingang mit Ampel“) für Lugru-Seite, Kachel „Anteil grün“ (mit Zeitraum), Trefferquote (eine Zeile „Lugru Deals“, dazu „von x gepostet“), Deal-Eingang-Liste und Werkzeuge |
| 20.2c | ROI/Marge „11,136491 %“ | 🐞 | ✅ | `runde1`/`prozentText` in `src/lib/numbers.ts`; Import der Lugru-App rundet auf eine Stelle |
| 20.2d | Ampel zu streng („Für alle Quellen“, Entscheidung Ludwig) | 🐞 | ✅ | `dealAmpel` in `src/lib/deal-ampel/logic.ts`: mehr Angebote als eingestellt → Gelb; Amazon > 90 % in der Buy Box → Rot. Alte Historie-Ampeln werden im Hintergrund neu bewertet (`lugruHistorieNeuBewerten`, Regel-Stand je Zeile) |
| 20.3 | Platzhalter „Lugru Deals=60“ sieht wie ein Wert aus | 🐞 | ✅ / 👤 | Platzhalter „leer = überall 70 (Beispiel: Quelle=60)“, darunter „gilt: Lugru Deals 70 (allgemein) · …“ je Quelle; den Wert trägt Ludwig ein (To-do 39) |
| 20.4a | „85 % des Umsatzes“ vs. Kachel „99 %“ | 🐞 | ✅ | Warnhinweis auf `/gewinn` nutzt dieselbe Basis wie die Kachel (`basis.coverage`) |
| 20.4b | „Abrechnung fehlt noch“ | 🟡 | ✅ nach Import | Der Transaktionsbericht über den Datei-Import (unten) liefert die Abrechnungen; danach rechnet Amazon aus der Abrechnung (To-do 47) |
| 20.5a | Buy-Box-Hinweise als Fälle | 🐞 | ✅ | `BUYBOX_RE` in `src/lib/amazon-todos/mail-muster.ts` (alle EU-Sprachen) → ein ToDo „Buy-Box-Berechtigung prüfen (Land)“ je Land (`buyBoxTodo`), kein Fall, Mail archiviert |
| 20.5b | Bewertungsanfragen mit „Antwort nötig“ | 🐞 | ✅ | `BEWERTUNG_RE` → Archiv, auch mit Fall-ID nie Antwort im Fall; Routine-Mails ändern Phase/Frist echter Fälle nicht mehr (`neuEinstufen`) |
| 20.5c | „Versendet:“/„expédié“/„Spedito“ | 🐞 | ✅ | `VERSAND_RE` um „versendet“ ergänzt → Archiv (Vorgang erledigt) |
| 20.5d | „paiement en cours“/„Zahlung wird bearbeitet“ als A-bis-z | 🐞 | ✅ | `ZAHLUNG_IN_BEARBEITUNG_RE` → Info |
| 20.5e | Auszahlungsmitteilungen → Liquidität | ❌ | ✅ | `auszahlungAus` (Betrag, Konto-Endung, Datum) + Marktplatz → Tabelle `amazon_auszahlung_meldungen` (Migration `0114`) → Liquidität „Amazon-Auszahlung FR laut Mitteilung … erwartet 3.–5. Tag“, ersetzt die Schätzung und fällt mit der passenden Gutschrift weg; Mail archiviert; nie Fall/A-bis-z/VA |
| 20.5f | Fälle 369,71 € und 115,52 € schließen | – | ✅ | Ausdrücklich angeordnet: `neuEinstufen` schließt Auszahlungs-Vorgänge automatisch (auch wenn angefasst), mit Verlaufseintrag und Buchung in der Liquidität – läuft beim nächsten Abgleich nach dem Update |
| 20.5g | „keine passende Regel“ in Frist-Kategorie | 🐞 | ✅ | A-bis-z/Kontozustand nur, wenn das Thema im Betreff/Anfang steht; sonst „bitte prüfen“ in Sonstiges ohne Standardfrist und ohne Zuständigkeit |
| 20.6 | Rückgängig-Knopf nirgends sichtbar | 🟡 (alte Einträge ohne Vorher-Werte) | ✅ | Abnahme als Ablaufprüfung: neuer Aufruf `mail_markieren` → „↩ Rückgängig“ im Verlauf → Mail wieder offen (`e2e/b20-rest.spec.ts`) |
| 20.7a | Tagesplan legt zu viel auf kleine Tage | 🐞 | ✅ | `planeTage` in `src/lib/tagesplan/logic.ts`: eingeplant nur bis zur Kapazität; Rest „nicht eingeplant (x Aufgaben, y Min.)“ mit Vorschlag „auf Mi/Do verteilen“ bzw. „oder an die VA geben“ (wenn die VA eingerichtet ist); Seite + Werkzeug `tagesplan` (`nicht_eingeplant`) |
| 20.7b | 22 Konflikte am freien Samstag | 🐞 | ✅ | Konflikte nur an Arbeitstagen |
| 20.8a | MSI-Monitor (Kaufquote 0 %) und Brother in der Summe | 🐞 | ✅ | `kaufquoteFuer` (SKU, sonst ASIN – wie die Hebel-Seite) und `PRUEFEN_AB_EUR` (10.000 €) in `src/lib/purchasing/reorder-logic.ts` → „prüfen“, nicht im Kapitalbedarf |
| 20.8b | Startseite nennt die Prüffälle nicht | ❌ | ✅ | Zeile „+ x zu prüfen (y €)“ im Kasten „Nachbestellen“ mit Link auf den Prüfblock |
| 20.9a | Therapie-Bogen fest 30 Tage | 🐞 | ✅ | `istPaartherapie` in `src/lib/private/rueckblick-logic.ts`: Sitzung auch an Terminen mit Titel „Paartherapie/Paarberatung“ (z. B. aus dem externen Kalender) – dann gilt „seit letzter Sitzung“ |
| 20.9b | VA-Nachrichten ohne Sprachkennzeichen | ❌ | ✅ | Tag je Nachricht auf `/delegation/va` („EN → DE“ bei übersetzten, sonst „DE“/„EN“) |
| 20.9c | Liquidität: Temu „keine“, Gewinn-Seite zeigt Temu | 🐞 | ✅ | Gleiche Aufträge wie die Gewinn-Seite (alle Temu-Kanäle); fehlt der Positionspreis, zählt der Auftragsbetrag; ohne beides klarer Hinweis „Temu-Bestellexport hochladen“ |
| 20.9d | „AI Win Sales Booster“ als Strategie | 🟡 (nur Alias) | ✅ | Eigene Zeile mit Erklärung im Regel-Katalog (`AI_WIN_SALES_BOOSTER`, auch in gespeicherten Katalogen ergänzt); verhält sich wie Liquidation (feste Untergrenze) |
| 20.9e | B2B: Deal-Blatt, Sammelbestellung, Prep-Export | „offen“ | ✅ gebaut (B19.6) | Seit B19 im Code (Deal-Blatt als Bild/PDF/Text, Sammelbestellung mit Freigabe, Export je Kunde; Werkzeug `deal`); auf dem Server erst nach dem Update sichtbar |
| B15.3 | Bestand −144 (8U-P4IG-LL5O) | 🟡 | 🟡 / 👤 | Reparatur gebaut; alte Prep-Center-Buchungen werden nur auf ausdrücklichen Klick zurückgebucht (keine automatische Datenänderung) – To-do 48 |

Abnahme B20 (Unit 1977 Tests grün, darunter `deal-ampel`, `lugru-historie`, `amazon-faelle`, `tagesplan`,
`datenbasis`, `privat-rueckblick`, `bqool-export`; e2e `zugriffe` (B20.1), `b20-lugru` (Deal von vor 400 Tagen im
Eingang, alte Ampel „rot wegen 30 Angeboten“ → gelb, gleiche Zahl auf Lugru-Seite/Werkzeug/Trefferquote/Deal-Eingang,
Marge 11,1 %), `b20-faelle` (Auszahlung 369,71 € → Liquidität, Konto …123, FR, 3–5 Tage; alter A-bis-z-Fall 115,52 €
geschlossen; Buy-Box → ein ToDo DE mit beiden ASINs; Bewertung/Versand archiviert; Fußzeile → bitte prüfen ohne Frist),
`b20-einkauf` (Kaufquote 0 % über die ASIN, 30.160 € → prüfen, Startseite „+ 2 zu prüfen“), `b19-rest` (Tagesplan
„nicht eingeplant“ mit Vorschlag), `b20-rest` (Schwelle „gilt“, Rückgängig nach `mail_markieren`, Sprachkennzeichen,
AI Win Sales Booster), `amazon-faelle`, `herzstueck`, `lugru-deals`, `deal-eingang`.

## Datei-Import über den Konnektor (Bauauftrag „Datei-Import-Werkzeug“)

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| DI-1 | Datei ins System laden ohne Oberfläche | ❌ | ✅ | `import_link` (nur Inhaber, ändernd) → einmalige Upload-Adresse `…/api/import/upload/<token>` (15 Min., 50 MB, PUT/POST) → `import_status`, `importe` |
| DI-2 | Gleiche Verarbeitung wie der Upload | – | ✅ | `importVerarbeiten` in `src/lib/datei-import/service.ts` nutzt die zentrale Erkennung (`dateiArt`, `detectReport`, `applyReport`); falsche Art → klarer Fehler |
| DI-3 | Dieselbe Datei zweimal | – | ✅ | SHA-256 → „bereits importiert“, nichts doppelt |
| DI-4 | Transaktionsbericht → Abrechnungen, Auszahlungen | ❌ | ✅ | `src/lib/reports/transaktionen.ts`: Abrechnungen und Zeilen aus dem Bericht (werden ersetzt, sobald die echte Flat File kommt), „x neu, y bereits vorhanden“, Lücken-Hinweis |
| DI-5 | Lagergebühren je Monat | ❌ (Datei unbekannt) | ✅ | Berichtsart „Monthly Storage Fees“ (.csv oder .txt, Erkennung an den Spalten – alle fünf hochgeladenen Dateien werden erkannt), Tabelle `amazon_lagergebuehren`; gleiche Datei → übersprungen, gleicher Monat aus zweiter Datei → ergänzt |
| DI-6 | USt-Transaktionsbericht je Periode, OSS | 🟡 (ein Monat) | ✅ | `leseUstBerichtJePeriode`, Zusammenführen je Periode per Datei-Prüfsumme, Werkzeuge `umsatzsteuer` und `umsatzsteuer_oss` – nur Zahlen, keine Steuerberatung |
| DI-7 | Sicherheit | – | ✅ | Nur Inhaber; VA/Familie nie (auch nicht im Fragefeld); Token gehasht, einmalig; Dateien verschlüsselt abgelegt und nach 90 Tagen gelöscht; Caddy-Freigabe nur für `/api/import/upload/*` |
| DI-8 | Lagergebühren: Maße, übergroß, Ergebnis-Block | 🟡 (nur Summen) | ✅ | `src/lib/reports/lagergebuehren-logic.ts`: cm/inch, kg/lb, m³/ft³ umgerechnet, übergroß aus Größenklasse oder längster Seite > 45 cm, Gefahrgut, Rabatt (Migration `0115`). `import_status`: Monate, Länder, Anzahl ASINs, davon übergroß, Top 10, Abgleich |
| DI-9 | Werkzeug `amazon_lagergebuehren(monat?, land?, asin?, sortierung)` | 🟡 (hieß `lagergebuehren`, ohne Land/Sortierung) | ✅ | Umbenannt wie im Bauauftrag; je ASIN Gebühr, Ø Bestand, je Stück, Volumen, Größenklasse, Reichweite, „Remission prüfen“; Abgleich mit Amazon-Abrechnung (Folgemonat) und sellerboard-Fixkosten „Lager…“ (`lagerAbgleich` in `src/lib/reports/lagergebuehren.ts`) |
| DI-10 | Nutzen: Kapital-Ampel, Abverkauf, Remission | ❌ | ✅ | `bewerteKapital`: „Lagergebühr frisst Marge“ (Gebühr bis zum Verkauf ≥ 50 % vom Gewinn je Stück → nicht grün) mit Vorschlag Abverkauf/Remission; „Remission prüfen“ bei übergroß bzw. ≥ 0,1 m³ + Reichweite ≥ 180 Tage + ≥ 5 €/Monat; Werkzeug `kapital_ampel` mit `lagergebuehr`/`remission` |
| DI-11 | Nutzen: Gewinn/Liquidität als Fixkostenposten | ❌ | ✅ / 👤 | Gewinn-Seite: Zeile „darin: FBA-Lagergebühr“ je Monat des Zeitraums. **Nicht** zusätzlich abgezogen und nicht als eigene Ausgabe in der Liquidität, weil Amazon die Gebühr schon von der Auszahlung abzieht (sonst doppelt) – To-do 51 |
| DI-12 | Nutzen: Größenklasse im B2B-Scanner | ❌ | ✅ | `fbaNachGroesse`: ohne Keepa-/Artikelgebühr Ø FBA-Gebühr eigener Artikel derselben Größenklasse (ab 3 Artikeln), als Warnung „geschätzt nach Größenklasse“ (`src/lib/b2b/scanner.ts`, `gebuehrenFuer`) |
| DI-13 | „Format nicht erkannt“ mit Vorschlag + Protokoll | 🟡 (nur 12 Spalten) | ✅ | `formatVorschlag` in `src/lib/reports/format-vorschlag.ts`: „Sieht aus wie „Monatliche Lagergebühren“ (8 von 10 typischen Spalten; es fehlen: …) – als diese Art importieren: … import_link art=…“; alle Spalten im Upload-Verlauf, Liste „Unbekannte Formate“ auf `/uploads` |
| DI-14 | USt-Bericht in `buchhaltung_status` und Monatsdatei | ❌ | ✅ | `buchhaltungStatus` → `ust` (importiert ja/nein, Brutto, Steuerländer, Verbringungen, ohne Steuerland); „CSV + Belege (ZIP)“ für den Steuerberater enthält `Amazon-Umsatzsteuer_JJJJ-MM.csv` (`ustMonatsdatei`). Keine Steuerberatung |

### Ergänzung 01.11. (08:50): ArbitrageOne – Exporte automatisch abholen

Prüfung zuerst (wie verlangt): ArbitrageOne hat **keine öffentliche API und keine Export-Links mit Token**. Die Doku
(docs.arbitrageone.de) beschreibt nur den Download-Knopf unter app.arbitrageone.de/export. Die dort verlinkte
OpenAPI-Datei ist ein Muster der Doku-Plattform („Plant Store“), keine ArbitrageOne-Schnittstelle. Deshalb holt eine
Browser-Automatik die Dateien ab, im gleichen Muster wie bei BQool.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| AO-1 | Anbindung „ArbitrageOne (Browser-Automatik) – optional“ mit E-Mail, Passwort (nur im Tool, verschlüsselt), Export-Seite | ❌ | ✅ | `arbitrageone_web` in `src/lib/integrations/registry.ts`; Felder auch für abweichende Kartennamen, Nachtlauf an/aus, „sellerboard-Datei weiterreichen“ |
| AO-2 | „Verbindung testen“ (muss von Anfang an gehen) | ❌ | ✅ | `aoVerbindungTesten` in `src/lib/arbitrageone/abruf.ts`: meldet sich an und sucht jede Karte auf der Export-Seite, ohne etwas herunterzuladen; Zwei-Faktor wird klar gemeldet |
| AO-3 | Takt: Einkäufe, Lagerbestand und sellerboard-COG täglich 05:30, Reimbursement montags, AccountOne COG am 1. | ❌ | ✅ | `AO_EXPORTE`/`exportFaellig` in `src/lib/arbitrageone/logic.ts`; Nachtlauf `aoNachtlauf` im Hintergrund (`src/lib/scheduler.ts`). Ob heute schon gelaufen, steht in der Datenbank: nach einem Neustart läuft er nur einmal. Ein fehlgeschlagener Export wird am nächsten Tag nachgeholt (Wochen-/Monatsexport auch) |
| AO-4 | Einkäufe → `ek_liste` | 🟡 (nur Upload von Hand, nur sellerboard-Format) | ✅ | Format „Einkäufe“ wird an den Spalten erkannt (ASIN, Kaufdatum, Menge, EK, optional SKU/Lieferant/Rechnung). Jede Einkaufszeile landet in `ao_einkaeufe`, eine Zeile, die schon bekannt ist, wird übersprungen. EK ohne Warnung wird beim Abruf **sofort übernommen** (`ekImportAutomatisch`); EK-Sprünge über 20 % und Platzhalter bleiben als Vorschau mit Aufgabe |
| AO-5 | Lugru „gekauft“ aus Einkäufen (B22.2) | 🟡 (SKU/Charge/Sendung) | ✅ | `lugruKaufAbgleichMitStand` nutzt die ArbitrageOne-Einkäufe zuerst (genaue Menge, EK, Lieferant); nach jedem Abruf läuft der Abgleich sofort |
| AO-6 | Einkaufssumme je Monat (Monatsrahmen) | 🟡 (SKUs + Rechnungen) | ✅ | `monatEingekauft`: Gibt es für den Monat ArbitrageOne-Einkäufe, zählen nur diese, sonst wie bisher (sonst würden dieselben Käufe doppelt gezählt). Die Deal-Eingang-Seite nennt die Quelle |
| AO-7 | Liquidität: Wareneinkauf | 🟡 (Ø Rechnungen) | ✅ | Ø Wareneinkauf je Woche aus den ArbitrageOne-Einkäufen (vollständiger als Rechnungen), dazu die Zeilen „Wareneinkauf im Monat (ArbitrageOne)“ und „Lagerwert (ArbitrageOne)“ als Anzeige, ohne zusätzliche Zahlungsposten |
| AO-8 | Lagerbestand (Stichtag) → `ao_lagerbestand` | ❌ | ✅ / 🟡 | Neue Import-Art (Spaltenerkennung, Stichtag aus Spalte oder Dateiname). Abgleich je SKU mit dem eigenen Lager (`aoLagerAbgleich`) im Import-Ergebnis und im Werkzeug `bestandsabweichungen` (nur Anzeige, nichts wird korrigiert). Lagerwert in der Liquidität. **Kapital-Ampel nutzt den Lagerbestand noch nicht** (🟡, To-do 62) |
| AO-9 | Sellerboard (COG) an die „EK → sellerboard“-Übertragung | 🟡 (nur Knopf) | ✅ | Die Datei von ArbitrageOne läuft als EK-Liste durch (EK übernehmen). Mit „weiterreichen: ja“ geht sie **unverändert** an sellerboard (`anSellerboardDateiUebertragen`), ohne Neubau. Standard ist „nein“ (To-do 61) |
| AO-10 | AccountOne COG (NEU) → Stotax-Belegübergabe | ❌ | ✅ | Neue Import-Art `ao_accountone_cog` mit Tabelle `ao_accountone_cog` je Monat (am 1. geholt = Stand Ende Vormonat). Liegt als `AccountOne-COG_JJJJ-MM.csv` in „CSV + Belege (ZIP)“; `buchhaltung_status.accountone_cog` |
| AO-11 | Inventory Reimbursement → `amazon_reimbursements` | 🟡 | ✅ / 👤 | Läuft über die bestehende Berichtsart. Ob der ArbitrageOne-Export dieselben Spalten wie der Amazon-Bericht hat, ist ungeprüft. Wenn nicht: klarer Fehler mit Spaltenliste und Vorschlag, dazu eine Aufgabe (To-do 63) |
| AO-12 | BQool **nicht** abholen, nur Vergleich | ❌ | ✅ | Neue Import-Art `ao_bqool_vergleich`: Die Datei wird gelesen und je Land mit dem Soll des Seller-Systems verglichen, aber nie als Ist übernommen und nie hochgeladen. Die Seite „BQool-Dateien“ zeigt „Abweichung ArbitrageOne ↔ Seller-System: n SKUs“ mit Beispielen |
| AO-13 | Gleiche Datei zweimal = überspringen | – | ✅ | Prüfsumme wie beim Datei-Import (`dateiAnnehmen`): „bereits importiert – nichts doppelt“ |
| AO-14 | Ergebnis je Abruf unter Anbindungen → Importe | ❌ | ✅ | Abschnitt „Importe – ArbitrageOne“ auf /anbindungen: Auslöser „täglich 05:30“, letzter und nächster Lauf, Knopf „Jetzt abholen“, Läufe und Dateien mit Zeilen und neu/geändert. Werkzeuge `importe` (Herkunft) und `anbindungen_status.arbitrageone` |
| AO-15 | Fehler → Aufgabe, kein stilles Scheitern; 2FA → Abbruch | – | ✅ | Ein fehlgeschlagener Export → Aufgabe „ArbitrageOne-Abruf: … fehlgeschlagen“, die übrigen laufen weiter. Anmeldung oder Zwei-Faktor → Abbruch mit kritischer Aufgabe, ohne Wiederholung. Jeder Schritt mit Bildschirmfoto |
| AO-16 | Exportvorlagen nicht verändern | – | ✅ | Die Automatik klickt nur Download bzw. Bestätigen im Download-Dialog; sie speichert in ArbitrageOne nichts |
| AO-17 | Echtheits-Ordner (Lieferant + Rechnung je Marke) | ❌ | 🟡 | Lieferant und Rechnungsnummer stehen je Einkauf in `ao_einkaeufe`, im Echtheits-Ordner werden sie **noch nicht** angezeigt (To-do 62) |

Hinweis zur Regel „Browser-Automatik nur auf Knopfdruck“ (AU-1): Für ArbitrageOne läuft sie auf ausdrücklichen Wunsch
des Bauauftrags nachts. Sie **liest nur** (lädt herunter). Hochladen zu sellerboard passiert nachts nur, wenn
„weiterreichen: ja“ eingestellt ist; BQool wird nie automatisch hochgeladen.

**Abnahme (e2e `e2e/arbitrageone.spec.ts`, Test-Nachbau der Export-Seite):** „Verbindung testen“ grün (alle sechs
Karten gefunden, nichts heruntergeladen) → „Jetzt abholen“ (derselbe Ablauf wie der Nachtlauf) lädt sechs Dateien
herunter, die Einkäufe über den Zeitraum-Dialog, AccountOne die NEU-Karte statt der alten → Einkäufe gespeichert und
EK übernommen → Lugru-Deal „gekauft“ (Ref „ArbitrageOne-Einkauf“) → `fehlende_einkaufspreise` ohne die SKU (dieselbe
EK-Quelle wie die Bestellvorschläge) → Liquidität mit „Wareneinkauf im Monat (ArbitrageOne)“ und Lagerwert →
Monatsrahmen aus den Einkäufen → BQool-Vergleich sichtbar, nichts als Ist übernommen → `importe`, `buchhaltung_status`,
`anbindungen_status` → zweiter Abruf „bereits importiert“, nichts doppelt → fehlende Karte → „teilweise“ + Aufgabe →
Zwei-Faktor → Abbruch + kritische Aufgabe. Der Zeitplan (täglich/montags/am 1., Nachholen) ist als Unit-Test geprüft
(`tests/arbitrageone.test.ts`), ebenso die Formaterkennung. Die zwei echten ArbitrageOne-Dateien aus den Uploads
(sellerboard-Export, BQool-Export) werden richtig erkannt; die Probe gab nur Format und Zeilenzahl aus.

## B21 – Call-Transkripte sofort beim Eintreffen verarbeiten (31.10., 17:15)

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 21.1 | Auslöser statt Zeitplan | ❌ (wöchentlich, nur Google-Doc-Links) | ✅ | Live-Verbindung zu Discord (Gateway, `src/lib/discord/gateway.ts`): `MESSAGE_CREATE` im Call-Kanal sofort verarbeitet. Erkennung `transkriptKandidat` (`src/lib/calls/live-logic.ts`): Anhang .txt/.md/.vtt/.srt/.json/.docx/.pdf (auch .odt), Text > 2.000 Zeichen oder Link auf Google Doc, Notion, Fireflies, tl;dv, Otter; mehrere Anhänge = ein Call |
| 21.2 | Eine Kette ≤ 5 Min. | ❌ | ✅ | `callNachrichtVerarbeiten` (`src/lib/calls/live.ts`): Datei holen → Call-Archiv (Datum/Titel aus der Nachricht, Sprecher erkannt) → KI-Auswertung (Punkte) → Wissen (mit Insider-Kennzeichen wie bisher) → Push an die Inhaber „Call vom … ausgewertet: x Wissenseinträge, y Aufgaben“. Im Test wenige Sekunden |
| 21.3 | Bearbeitete Nachricht | ❌ | ✅ | `MESSAGE_UPDATE` → derselbe Call (Kennung `discord:<Nachricht>`) wird ersetzt und neu ausgewertet, nicht doppelt. Kommt die Bearbeitung, während die erste Verarbeitung noch läuft, wartet sie darauf und wird danach verarbeitet (nicht verworfen); unveränderter Inhalt → nichts zu tun |
| 21.4 | Zeitplan nur Sicherheitsnetz | ❌ | ✅ | Täglich 06:00 die letzten 7 Tage nachlesen (`callsSicherheitsnetz`); VA-, Gruppen- und Lugru-Kanäle lesen ab der zuletzt gelesenen Nachricht weiter (lückenlos nach Ausfall) und laufen um 06:00 zusätzlich einmal („Discord-Kanäle: Nachlese 06:00“) |
| 21.5 | Anbindungen: Auslöser, letzter/nächster Lauf | ❌ | ✅ | Anbindungen → Hintergrund-Abrufe: „Discord – Call-Kanal: Auslöser: live (Discord) – verbunden seit … · zuletzt empfangen …“, Tabelle je Abruf mit Auslöser, letztem und nächstem Lauf (`ABRUF_PLAN`, `naechsterText` in `src/lib/today/abruf-plan.ts`); dieselben Felder in `anbindungen_status` und `calls` |
| 21.6 | Fehler → Aufgabe | ❌ | ✅ | Datei nicht lesbar, > 25 MB, kein Text erkannt, Link verlangt Anmeldung → Aufgabe „Call-Transkript aus Discord nicht verarbeitet“ mit Link zur Nachricht (eine je Nachricht) |

Abnahme: Unit `calls-live` (Erkennung, Titel/Sprecher, JSON-Export, nächster Lauf); e2e `b21-calls-live` gegen den
Discord-Nachbau mit echter WebSocket-Verbindung: Transkript (.vtt) hochladen → Call ausgewertet, Wissen und Aufgaben da,
Meldung an den Inhaber; Anhang ersetzt → derselbe Call neu (neuer Inhalt per `calls_durchsuchen` gefunden); 30-MB-PDF →
Aufgabe mit Link; Anbindungen, `calls` und `anbindungen_status` zeigen „live“ und den Zeitpunkt. Ergebnis 31.10.: e2e
`b21-calls-live` grün (17 s), dazu `teil2`, `werkzeuge`, `va-discord`, `lugru-deals`, `deal-eingang` grün; Unit 2001/2001.
**Voraussetzung live:** im Discord-Entwicklerportal beim Bot
„Message Content Intent“ einschalten (To-do 53).

## B22 – Reflexion sichtbar, Lugru-Lernen, Apple Watch (Nachtrag 01.11.)

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 22.1a | Beobachtungen über die Partnerin sichtbar | 🟡 (Filter war schon „Verfasser = ich“, aber schwer zu finden; Sitzung nur aus dem Privatkalender) | ✅ | Privat → Partnerschaft → „Beobachtungen & Reflexion“ (`privat/beobachtungen/page.tsx`): alle selbst verfassten Einträge (egal über wen), nach Tag und Eingabereihenfolge (`nachTag`), „[?] unvollständig“. Zusätzlich Hinweis auf der Privat-Startseite, Zeile im Monatsrückblick, Hinweis welches Konto mit Claude verbunden ist (`claudeKonten`) |
| 22.1b | Wochenrückblick jeden Tag, Woche wählbar | 🟡 (7 Tage bis heute, nur blättern) | ✅ | `privat/rueckblick/woche`: Auswahl Kalenderwoche (`wochenAuswahl`, 12 Wochen) + Vor/Zurück; Feierabend-Seite mit Wochen blättern; Werkzeug `feierabend` mit `woche_bis` |
| 22.1c | Therapie-Bogen seit letzter Sitzung | 🟡 (nur Privatkalender) | ✅ | `paarSitzungen` (`src/lib/private/sitzungen.ts`): Privatkalender + abgeglichene Kalender (Titel „Paartherapie/Paarberatung“); Spalten Situation · Problematik · gewünschte Veränderung (leer erlaubt); ohne Sitzung 30 Tage mit Hinweis |
| 22.1d | Art `reflexion` + Block „Für die nächste Sitzung“ | ❌ | ✅ | Formular auf der Beobachtungen-Seite, `privat_eintrag_anlegen(art: reflexion, text, sitzung?)` (Sitzung sonst die nächste laut Kalender), ändern/löschen über `privat_eintrag_aendern/_loeschen`; Block im Wochenrückblick, Therapie-Bogen, Feierabend und `feierabend.fuerNaechsteSitzung`. Nur für den Verfasser sichtbar |
| 22.1e | Alte Zeilen 2 und 3 löschen | – | offen | Nur auf ausdrücklichen Wunsch per `privat_eintrag_loeschen` (Claude im Gespräch) – nicht automatisch |
| 22.2a | Eigene Käufe erkennen | ❌ (nur Chargen/Bestellungen, 14 Tage – sellerboard-SKUs wurden nie gelesen) | ✅ | `lugruKaufAbgleich` (`src/lib/lugru-deals/discord.ts`): sellerboard-Produkte, FBA-Bestand und Bestandsbericht; SKU-Muster neu/alt (`skuKauf`), Datum 0–21 Tage nach dem Post (`KAUF_FENSTER_TAGE`); FBA-Sendungen als zweites Signal; Menge aus der Sendung bzw. dem Bestand, EK netto und Lieferant aus der SKU; Eintrag im Deal-Eingang „gekauft (automatisch erkannt – sellerboard-SKU …)“ ohne neue Bestellung; alle 6 Std. und per Knopf |
| 22.2b | Ergebnis nachziehen | 🟡 | ✅ | `ergebnisseAktualisieren` rechnet für die so erkannten Käufe realen ROI, Tage bis Abverkauf und Erstattungen aus sellerboard (30/60/90 Tage) |
| 22.2c | Vorwissen Lugru ≥ 60 | ❌ | ✅ | `dealWert(…, quelle)` (`wert-logic.ts`): Lugru startet mit 60; nur harte Rot-Kriterien drücken (`lugruHarteGruende`: Amazon > 90 %, Kapital-Ampel rot, Verlust-Stopp, Marke mit Beschwerde, ROI < 10 %). „Mehr als 15 Angebote“ war und bleibt nur Gelb |
| 22.2d | Deal-Wert für alle Deals | ❌ (3 von 339) | ✅ | Hintergrund-Job „Deal-Wert: nachrechnen“ (`wertNachholen`, alle 5 Min. bis fertig, ohne Keepa-Abfragen) + Knopf „Jetzt nachtragen“ |
| 22.2e | Lugru-History komplett | 🟡 (Nachtrag konnte an einem unlesbaren Post hängen bleiben) | ✅ | `lugruHistorieEingaenge`: Fehler je Post werden übersprungen und gezählt, der Rest läuft weiter |
| 22.2f | Schwelle Lugru = 60 vorbelegt | 🟡 (nur Platzhalter) | ✅ | `STANDARD_WERT_SCHWELLEN` in `deal-eingang/logic.ts`; eigene Einstellung geht vor; Seite zeigt „Lugru Deals ab 60 (vorbelegt)“ |
| 22.2g | Monatsbericht mit Trefferquote | 🟡 | ✅ | `lernBericht`: Schwelle je Quelle, eigener Block `lugru_deals` (gekauft, mit Ergebnis, Trefferquote) in `deal_lernen_bericht`; `lugru_history.selbst_gekauft` |
| 22.3 | Apple Watch | ❌ | ✅ | Eigener Bauauftrag „Apple Watch – Kurzantworten per Kurzbefehl“ (01.11.) – siehe Abschnitt „Apple Watch“ unten |

Abnahme: Unit `reflexion` (Sitzungen, Reihenfolge, Zettel offen, Kalenderwoche, Ändern) und `lugru-lernen` (SKU-Muster,
21-Tage-Fenster, Vorwissen/harte Kriterien, Schwelle, Bericht); e2e `b22-reflexion` (Beobachtungen über die andere
Person per Claude → Beobachtungen, Wochenrückblick mit Wochenwahl, Therapie-Bogen, Startseite, Monatsrückblick,
Feierabend; Reflexion per Claude und Oberfläche; Sitzung aus dem Kalender) und `b22-lugru` (SKU im Fenster → gekauft mit
Menge 4 und EK 120,00 netto, außerhalb nicht; Deal-Wert ≥ 60 mit „Vorwissen“; Liste/Monatsbericht zählen den Kauf).

## B23 – BQool-Upload: eine Adresse je Land (01.11.)

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 23.1 | Felder je Land | ❌ (ein Feld, nur DE) | ✅ | Anbindungen → BQool: DE, FR, IT, ES (FR/IT/ES aus der DE-Adresse vorbelegt: amazonde → amazonfr …), NL/BE/PL/SE/UK optional (leer = nicht hochladen); `bqoolUploadAdressen` in `src/lib/automatik/bqool-logic.ts` |
| 23.2 | Upload je Land mit Ergebnis | ❌ | ✅ | `anBqoolUebertragen`: je Land die passende Datei auf die passende Seite, nacheinander; „DE: 824 Zeilen hochgeladen · FR: Fehler – …“; ein Fehler stoppt die anderen nicht (Status „teilweise“, Aufgabe für die fehlenden Länder) |
| 23.3 | Verbindung testen | ❌ („noch kein Test“) | ✅ | `bqoolVerbindungTesten` (registriert in `clients/bqool-web.ts`): Anmeldung, je Land Upload-Seite aufrufen (nichts hochladen), Zwei-Faktor klar gemeldet, keine Aufgabe beim Test |
| 23.4 | Protokoll je Upload | 🟡 (nur am Export) | ✅ | Anbindungen → „Importe/Exporte – BQool-Uploads“: Zeitpunkt, Land, Datei, Zeilen, Ergebnis; BQool-Seite zeigt die Upload-Seite je Land |

Abnahme: Unit `bqool-laender`; e2e `bqool-dateien` gegen den BQool-Nachbau: DE und FR je auf eigener Seite (amazonde/amazonfr),
FR absichtlich kaputt → „1 von 2 Ländern hochgeladen“, DE trotzdem oben, Aufgabe „FR nicht hochgeladen“, Zeilen im
Protokoll; Formular mit vorbelegten FR/ES-Adressen; „Verbindung testen“ meldet je Land „Upload-Seite erreichbar“.

## B24 – Browser-Automatik: Anmeldeformular wird nicht gefunden (01.11., 12:00)

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 24.1 | Bei jedem Fehlschlag Bildschirmfoto + Seitentitel + Adresse, in der Meldung verlinkt, nur Inhaber, 7 Tage | 🟡 (Bildschirmfotos nur im Lauf-Protokoll, nicht an der Meldung) | ✅ | `debugFesthalten` in `src/lib/automatik/runner.ts`: ganzes Fenster als PNG, verschlüsselt abgelegt, Zeile in `automatik_debug` (Migration `0118`) mit Titel, Adresse **ohne Abfrageteil** (keine Tokens) und Fehler; Meldung „… – Bildschirmfoto: /import/debug/<zeit-dienst>.png (Seite „…“, Adresse)“; Anbindungen machen daraus den Link „Bildschirmfoto öffnen“. Route `src/app/(app)/import/debug/[datei]/route.ts` nur für Inhaber (`requireOwner`, Name streng geprüft, `no-store`); täglicher Schritt „Automatik: Bildschirmfotos aufräumen“ löscht nach 7 Tagen |
| 24.2 | Felder breiter suchen | ❌ (ein fester Selektor, 30 s) | ✅ | `emailFelder`/`passwortFelder`/`anmeldeKnoepfe`: `type=email`, Name/ID (email, username, login), `autocomplete=username`, Platzhalter „mail/Benutzer“, Beschriftung „E-Mail/Benutzername“, `form input[type=text]`; Passwort `type=password` bzw. Beschriftung; Knopf per Text („Log in“, „Anmelden“, „Sign in“, „Weiter“ …) oder Submit, sonst Enter. Zweistufige Anmeldung (erst E-Mail → „Weiter“ → Passwort) |
| 24.3 | Cookie-Banner, 60 s Wartezeit, Netzwerk-Ruhe | ❌ | ✅ | `cookiesWeg` („Akzeptieren“, „Alle akzeptieren“, „Accept all“, „Zustimmen“, OneTrust …; nie „Ablehnen/Einstellungen“) vor dem Formular, vor dem Knopf und auf jeder Upload-/Export-Seite; Wartezeit 60 s (`anmeldeWarten`, im Test 5 s), `networkidle` nach dem Laden und nach dem Absenden |
| 24.4 | Cloudflare/Captcha erkennen, keine Wiederholung | ❌ | ✅ | `browserPruefung`: Titel „Just a moment“, „Attention Required“, „Checking your browser“ bzw. Turnstile/hCaptcha/reCAPTCHA im DOM → „BQool verlangt eine Browser-Prüfung (Cloudflare/Captcha) – Automatik hier nicht möglich, Datei-Weg nutzen“ – sofort, ohne auf Felder zu warten |
| 24.5 | Ludwigs eigene Feldnamen zuerst | ❌ | ✅ | Anbindungen (sellerboard, BQool, ArbitrageOne): „Feld E-Mail“, „Feld Passwort“, „Anmelde-Knopf“ (CSS-Selektor aus „Rechtsklick → Untersuchen“) – werden vor allen anderen probiert |
| 24.6 | Gleiche Härtung für ArbitrageOne | ❌ | ✅ | `src/lib/arbitrageone/abruf.ts` nutzt dieselbe Anmeldung (`dienst: "ArbitrageOne"`, eigene Feldnamen), Cookie-Banner auf der Export-Seite; Fehlschläge im Nachtlauf mit Bildschirmfoto-Link in der Aufgabe |

Abnahme: Unit `automatik-login` (Captcha-Titel, Cookie-Knöpfe, Anmelde-Knopf, Bildschirmfoto-Name/-Muster, Adresse ohne
Abfrageteil, Meldungstext, 7 Tage); e2e `b24-automatik` gegen Nachbauten: Cookie-Banner über dem Formular + Feld nur mit
Platzhalter + Knopf „Log in“ → „Anmeldung ok“; Felder ohne erkennbare Namen → „nicht gefunden“ mit Bildschirmfoto-Link,
mit „Feld E-Mail“ → ok; Cloudflare-Seite → klare Meldung in unter 60 s; Seite ohne Formular mit `?token=…` → Meldung mit
Adresse ohne Token, Bild abrufbar (PNG) für den Inhaber, nicht für Mitarbeiter. Dazu `bqool-dateien`, `arbitrageone`,
`ek-import` ohne Rückschritt.

## Kaufen mit einem Tap · Shop-Profile · Payback · Navigation links (Bauauftrag 01.11.)

Grundsatz unverändert: kein automatischer Einkauf, kein Kauf-Bot, keine Checkout-Seiten, keine Zahlungsdaten oder Logins,
kein Headless-Browser für Einkäufe. Das System bereitet den Link vor, Ludwig tippt „Jetzt kaufen“.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| 1a | Push mit „In den Warenkorb (n)“ + „Details“ | 🟡 („Zum Angebot“ + „Gekauft …“, nur Grün/≥ Schwelle) | ✅ | `kaufMeldung` in `src/lib/deal-eingang/kauf.ts`: Kopfzeile „🟢 Deal 17: … · EK … · ROI … · Empf. 4 Stk“; Amazon-Warenkorb-Link des Einkaufs-Shops je Land (`/gp/aws/cart/add.html?ASIN.1=…&Quantity.1=n`, .de/.fr/.it/.es); Tippen auf die Meldung (iPhone) öffnet bei Grün/≥ Schwelle direkt den Warenkorb |
| 1b | Menge = Empfehlung, begrenzt durch max. Stück und Budget je Deal | ❌ | ✅ | `kaufMenge` (`shop-logic.ts`): Lugru „max. Stück“ bzw. angebotene Menge, „max. € je Deal“ nur als Mengen-Deckel (0 = keine Grenze) |
| 1c | „Kauf vorbereitet (Menge)“ beim Öffnen | ❌ | ✅ | Kurzlink `/k/17` bzw. `/k/<Deal-ID>` (`src/app/k/[nr]/route.ts`) markiert und leitet weiter; Detailseite zeigt „Kauf vorbereitet (3 Stk) am …“ |
| 1d | nach 24 Std. SKU-Abgleich, sonst Erinnerung | ❌ | ✅ | `kaufVorbereitetPruefen` (stündlich, und mit „Eigene Käufe abgleichen“): sellerboard-SKU gleiche ASIN ab dem Vortag → „gekauft (automatisch: sellerboard-SKU)“ mit Menge/EK; sonst einmal Push „Deal 17 noch offen?“; spätere SKU (bis 21 Tage) zählt trotzdem. Der Lugru-Abgleich (B22.2) übernimmt dabei die vorbereitete Menge |
| 1e | „Kaufen 17“ (Watch/Siri) | ❌ | ✅ | `POST /api/mobil/kaufen` ({nr} oder {text: "Kaufen 17"}, Handy-Schlüssel) → `url` zum Öffnen; Nummer je Deal 24 Std. gültig (kleinste freie); Anleitung „Kurzbefehl „Kaufen 17““ im Wissen |
| 1f | Rückfall Produktseite „Menge n wählen“ | ❌ | ✅ | Detailseite „Warenkorb leer? Produktseite öffnen (Menge 3 wählen)“, `/k/17?produkt=1`, Feld `fallback`; Amazon-Profil lässt sich auf „Produktseite“ umstellen |
| 2a | Tabelle `shop_profil` + Start-Profile | ❌ | ✅ | Migration `0116_kaufen_mit_einem_tap.sql`; Start-Profile im Code (AMZDE/FR/IT/ES Warenkorb-Link; MEDIA, SATUR, NOTIN, DOUGL, FLACO, MUELL, PARFU Produktseite + Hinweis); gespeicherte Profile überschreiben |
| 2b | Push nennt Shop + Gutschein, „Code kopieren“ | ❌ | ✅ | „MediaMarkt: Produktseite öffnen – Menge 4 auf der Seite wählen · Code: BLACK10“; Knopf „Code kopieren“ → Detailseite mit Code und Kopier-Knopf (`gutscheinAus`) |
| 2c | Einstellungen → Shop-Profile | ❌ | ✅ | `/einstellungen/shop-profile`: Link-Art, Link-Muster (nur https, bekannte Platzhalter), Hinweis, Payback, aktiv; neue Shops; „Standard“ setzt zurück |
| 2d | ehrlich: „Warenkorb vorbereitet“ nur Amazon | ❌ | ✅ | Text und Knopf je Profil („Produktseite öffnen“ bei allen anderen) |
| 3a | Payback-Angebot geprüft | – | ⚠️ | Stand 01.11.2026 (Recherche): **keine feste Verknüpfung im Amazon-Konto** – Punkte nur, wenn der Einkauf in der PAYBACK-App/payback.de startet (Warenkorb leer); Gewerbe- und Großmengenkäufe laut Bedingungen ausgenommen. Der Warenkorb-Link aus dem Push startet nicht über Payback |
| 3b | Anleitung im Wissen | ❌ | ✅ (ohne Bildschirmfotos) | „Payback bei Amazon.de (Stand November 2026)“ (`mobil/anleitungen.ts`, wird automatisch angelegt); Bildschirmfotos nicht möglich (kein Login in fremde Konten) |
| 3c | Schalter + Hinweis im Push | ❌ | ✅ | „Payback eingerichtet ✅“ (nur Anzeige) unter Shop-Profile; solange aus: „Payback noch nicht eingerichtet – Punkte nur mit Start in der PAYBACK-App“; keine Payback-Nummer gespeichert; Feld „Payback“ je Shop-Profil |
| 4a | keine Budgetgrenze | ❌ (über Budget → Gelb) | ✅ | `budgetAnwenden` entfernt: Budget ändert die Ampel nie; gespeicherte Grenzen per Migration auf 0 (Standard); Felder zeigen 0, kein Platzhalter |
| 4b | Monatsrahmen 150.000 € | ❌ | ✅ | `monatEingekauft`: neue sellerboard-SKUs (EK × Menge) + Wareneinkaufs-Rechnungen ohne Charge; „diesen Monat eingekauft: X € von ~150.000 €“ auf der Deal-Eingang-Seite (mit Link zur Liquidität) und im Push; beim Überschreiten nur Hinweis |
| 4c | unter der Schwelle trotzdem Warenkorb-Link | ❌ | ✅ | jede nicht rote Zeile mit Einkaufs-Shop; Zeile „Unter der Schwelle (55/60) – Details ansehen, du entscheidest“; Rot bleibt Rot |
| 5a | Seitenleiste links, Gruppen in der Reihenfolge | 🟡 (Leiste da, andere Gruppen + Reiterzeile oben) | ✅ | `NAV` in `src/lib/nav.ts`: Heute · Einkauf (Deal-Eingang, Lugru Deals, Bestellvorschläge, EK-Import, Scanner …) · Amazon (Fall-Zentrale, ToDos, Repricer, Listungen, SAS …) · *eBay & Temu* · Finanzen (Gewinn, Liquidität, Buchhaltung, Importe, Verlust-Stopp …) · Produkte & Lager (Bestand, Paletten, Retouren-Station, Aufträge & Versand …) · B2B · *Marken & Content* · Delegation (VA, Aufgaben, Anrufe) · Wissen & Calls · Privat · Einstellungen. Kursiv = nicht im Bauauftrag, damit keine Seite verschwindet |
| 5b | einklappbar (~240 px), Gruppen auf/zu gemerkt | 🟡 (nicht gemerkt) | ✅ | `AppSidebar`/`SidebarNav`: «/» schmal auf Symbole (Cookie `nav-schmal`), Gruppen-Zustand im Cookie `nav-open` (schon der Server zeichnet ihn), aktuelle Seite hervorgehoben |
| 5c | Privat-Block nur mit Privat-Zugriff, im Privatbereich offen | ❌ (eigener Rahmen ohne Leiste) | ✅ | Gruppe „Privat“ farblich abgesetzt, nur bei `canAccess(privat)`; `(privat)/layout.tsx` nutzt jetzt denselben Rahmen (`AppShell`): geschäftliche Gruppen zu, Privat-Block offen; „Sperren“ und „Zurück zum Geschäft“ bleiben |
| 5d | oben nur Suche ⌘K, Glocke, Benutzer – keine zweite Menüzeile | ❌ | ✅ | `TopBar`: ⌘K/Strg+K (`BefehlsSuche`: Seiten sofort, Aufgaben/Produkte/Mails über `GET /api/suche`), Stern, Glocke (letzte Pushs, Zahl neu seit dem letzten Öffnen), Benutzer-Menü; Bereichs-Reiter entfallen (nur Unterseiten wie Paletten bleiben als Reiter) |
| 5e | Favoriten bis 6, ganz oben | 🟡 (bis 12) | ✅ | Stern oben, höchstens 6 (danach gesperrt, nichts wird verdrängt), bleiben nach Neuladen (`prefs.favorites`) |
| 5f | Handy: Schublade + Tab-Leiste | 🟡 (nur Schublade) | ✅ | `HandyTabs`: Heute · Scan · Deals · Aufgaben · Mehr (öffnet die Schublade); nur Punkte mit Zugriff |
| 5g | alte Links gültig | – | ✅ | keine Adresse geändert; nur die Einsortierung im Menü |

Abnahme: Unit `kaufen-tap` (Warenkorb-Link je Land, Rückfall, Profile, Menge, Gutschein, Nummer, Monatsrahmen, Login-Rücksprung)
und `deal-wert` (Push-Kopfzeile ohne Restbudget); e2e `kaufen-tap`: MediaMarkt-Deal → Push „Produktseite öffnen“ + „Code
kopieren“, `/k/n` → Produktseite und „Kauf vorbereitet“; Lugru-Deal Amazon.FR (max. 3 Stück) → „In den Warenkorb (3)“,
`/k/n` → amazon.fr-Warenkorb mit 3 Stück, Rückfall Produktseite; „Kaufen n“ mit Handy-Schlüssel (falscher Schlüssel 401,
nach 24 Std. „abgelaufen“); SKU nach dem Vorbereiten → „gekauft (automatisch: sellerboard-SKU)“ mit Menge 3, ohne SKU einmal
„Deal n noch offen?“; Monatsrahmen; Shop-Profil anlegen (javascript:-Muster abgelehnt); Payback-Schalter;
`deal_eingang_detail.kauf`. Abnahme 1/3 am echten iPhone (Amazon-App öffnet sich, Watch-Kurzbefehl) siehe To-do 57.
Abnahme 5: Unit `nav` (Reihenfolge, Zuordnung alter Adressen, Rechte, gemerkte Gruppen); e2e `navigation` (Reihenfolge,
Gruppe bleibt nach Neuladen offen, Einklappen gemerkt, keine Reiterzeile, Favorit bleibt, max. 6, ⌘K → Seite/Aufgabe →
Enter öffnet, Glocke zählt und wird gesehen, alte Adressen, Privatbereich mit offenem Privat-Block; Konto ohne Privat sieht
keinen Privat-Block; Handy: Tab-Leiste + „Mehr“ öffnet die Schublade) und `oberflaeche` (alle Seiten, Kontrast/aktive Auswahl).

## Apple Watch – Kurzantworten per Kurzbefehl (Bauauftrag 01.11. = Handy-Tesla Abschnitt 10)

Adresse: `/api/mobil/watch/<befehl>` (im Auftrag „/api/kurzbefehl/…“ – im System heißen alle Kurzbefehl-Endpunkte
`/api/mobil/…`, gleicher Handy-Schlüssel je Gerät, gleiches Rate-Limit und Protokoll). Jede Antwort: `zeige`, `sprich`,
`zeilen`, `antwort` (= zeige), höchstens 3 Zeilen / 160 Zeichen, ohne Links und Tabellen (`watchAntwort` in
`src/lib/mobil/watch-logic.ts`).

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| W.1 | `watch/stand` – „Wie läuft's?“ | ❌ (Widget `/api/mobil/kurz` nur als JSON) | ✅ | `watchStand` (`src/lib/mobil/watch.ts`): Umsatz heute (sellerboard), Umsatz und Nettogewinn Monat, offene rote Fälle (Fall-Zentrale), nächster Termin (`naechsterTermin`, privat nur „Termin außer Haus“) → „Heute 2.680 €, November 100 k€, Gewinn 4,5 k€. / 2 rote Fälle. / 15:00 Termin außer Haus.“ Geld nur mit Bereich „Geld“ |
| W.2 | `watch/dringend` – „Was ist dringend?“ | ❌ | ✅ | `watchDringend`: dieselben Quellen wie „Jetzt dringend“ auf der Startseite (rote Hinweise, wichtige Aufgaben, dann gelbe), mit denselben Rechten; je Zeile „… – heute/morgen/bis Mi/überfällig/sofort“. Aufgaben sind geschäftlich; Rechtsfristen-Zeile (kann private Fälle zählen) bleibt weg |
| W.3 | `watch/erledigt` – zuletzt per Push gemeldete Aufgabe | ❌ | ✅ | `meldungen.bezug` (Migration `0119`), `watchErledigt`: neuester Push der letzten 24 Std. mit offener Aufgabe/Amazon-ToDo wird geschlossen („Erledigt: …“); ältere Meldungen ohne Bezug über ihren Link. Unklar (neuester Push ohne Aufgabe oder „welche?“) → „Welche? 1 … 2 … 3 …“, Auswahl „Nummer 2“ (`watch_rueckfragen`, 10 Min.). Damit es Pushs mit Bezug gibt: neue **wichtige** System-Aufgaben (z. B. „Versandbestätigung bei Amazon hochladen“) melden sich jetzt per Push (`src/lib/push/aufgabe.ts`, höchstens 6/Std., nie Discord) |
| W.4 | `watch/notiz` – Aufgabe; „VA …“ → VA auf Englisch; „privat …“ | ❌ | ✅ | `watchNotiz`: Aufgabe für Ludwig (Datum aus dem Diktat). „VA …“: Text wird übersetzt; Modus „Vorschlag“ (Standard) → Entwurf in `va_entwuerfe` + Aufgabe „VA-Nachricht freigeben“, auf Delegation → VA Block „Von der Watch – wartet auf deine Freigabe“ (Text änderbar, „An die VA senden“ / „Verwerfen“); erst dann geht er in den VA-Kanal. Modus „automatisch“ → sofort. „privat …“ nur Inhaber mit vollem Privat-Zugang |
| W.5 | `watch/deal` – ASIN/EAN/Name + Preis → Ampel in einer Zeile | ❌ | ✅ | `watchDeal`: „Grün, ROI 28 %, 14,96 €/Stk, Empfehlung 3 Stück.“ (Deal-Ampel über `scanPruefen`); Name → eigene Produkte, bei mehreren ASINs die beste nennen, „n weitere Treffer – Details aufs Handy“. Nur lesen |
| W.6 | `watch/bestand` – „Tefal 12 Stück“ | ❌ | ✅ | `watchBestand`: eigenes Lager suchen (SKU oder Produktname), bei mehreren Treffern Rückfrage mit Nummer; setzt die gezählte Menge, Antwort „…: 5 → 12 Stück.“, Lagerbewegung „Zählung (Apple Watch)“ + Kanal-Abgleich wie im Bestand. Ohne Menge nur nachsehen |
| W.7 | `watch/tesla` – Ladestand, Reichweite, Klima | ❌ | ✅ | `watchTesla`: nur lesen (Klima wird von der Watch nicht geschaltet – Regel „alles andere ist lesend“), nur Inhaber, „Tesla ist noch nicht verbunden“ solange keine Anbindung |
| W.8 | Push ≤ 120 Zeichen, Wichtigstes zuerst | ❌ (bis 500 Zeichen) | ✅ | `neuesteMeldung` gibt dem Service Worker Titel ≤ 60 und Text ≤ 120 Zeichen (`pushKurz`); voller Text bleibt hinter dem Link. Deal-Kopfzeile neu sortiert: „🟢 Deal 17: Name · DE: ROI 36 %, 9,10 €/Stk · Empf. 4 Stk · EK …“ (`kaufText`) |
| W.9 | Grüne Deal-Pushs mit Nummer → „Kaufen 17“ | 🟡 (Nummer im Titel und Text) | ✅ | Nummer steht vorne im Text; `POST /api/mobil/kaufen` („Kaufen 17“) unverändert |
| W.10 | Anleitung im Wissen „Handy & Tesla → Apple Watch“ | ❌ | ✅ | `src/lib/mobil/anleitungen.ts`: Kurzbefehle je Sprachbefehl, „Auf Apple Watch anzeigen“, „Ergebnis anzeigen“ + „Text vorlesen“, Komplikation „Was ist dringend“, Rückfragen per Nummer. Bildschirmfotos der Kurzbefehle-App kann das System nicht selbst machen (To-do 65) |
| W.11 | Regeln: nur erledigt/notiz/bestand ändern; nichts Privates in stand/dringend; „Stand HH:MM“ ab 30 Min. | – | ✅ | Ändernde Befehle nur per POST und nicht mit Nur-ansehen-Konten (`mobilPruefen(…, { schreibend })`); „Stand 15:12:“ vorne, wenn der letzte sellerboard-Abruf älter als 30 Min. ist |

Abnahme: Unit `apple-watch` (Beispiel aus dem Auftrag, 3 Zeilen/160 Zeichen, „Stand“, Vorlesen, Frist, Dringend,
Sprachbefehle Notiz/Deal/Bestand/Nummer, Deal-Zeile, Push ≤ 120, Deal-Nummer vorne); e2e `apple-watch`:
(1) „Wie läuft's“ antwortet in < 3 s mit 3 Zeilen; (2) Deal-Push beginnt mit „🟢/🟡 Deal n: … ROI“, „kaufen n“ bestätigt;
(3) zwei Pushs → „Erledigt“ schließt genau den neuesten, Push ohne Aufgabe → Auswahl, „Nummer 1“ schließt die andere;
(4) „Notiz VA bitte Rechnung Tefal prüfen“ → „Please check the Tefal invoice“, erst nach „An die VA senden“ im VA-Kanal;
dazu Bestand mit Rückfrage (5 → 12), Deal, Auto, 401/405/404. Siri und die echte Watch kann der Test nicht bedienen –
das Vorlesen prüft Ludwig einmal selbst (To-do 64).

## Amazon-Berichte 1–4 und Kleinanzeigen-Entwurf (Vorschlag 01.11., freigegeben mit „Ja, beides“)

Alle vier Berichte kommen über die Amazon-Schnittstelle (Anbindungen → Amazon-Berichte → „Konto-Berichte anfordern“,
danach „Fertige Berichte abholen“; im Zeitplan automatisch). Gestrandet, gesperrt, Langzeitlager und Inbound-Mängel
gehen auch als Datei (Upload-Seite bzw. `import_link`). Kein Bericht ändert Bestand oder Preise.

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| AB.1 | Kontozustand als Frühwarnung für die Fall-Zentrale (Bestellmängelquote, Richtlinienverstöße, Markenbeschwerden) | ❌ (nur Amazon-Mails) | ✅ | Bericht `GET_V2_SELLER_PERFORMANCE_REPORT` (täglich) → `leseKontozustand`/`kontoBewerten` (`src/lib/amazon-berichte/logic.ts`): je Marktplatz Kontozustand-Wert, Bestellmängelquote FBA/FBM, verspätete Sendungen, Stornoquote, Sendungsverfolgung, Verstöße (geistiges Eigentum, Echtheit, Richtlinien, Sicherheit …). Stufe **gefährdet** bei Wert < 200 bzw. AT_RISK/CRITICAL oder einer **neuen** schweren Beschwerde gegenüber dem letzten Bericht, **prüfen** bei Kennzahl außerhalb des Ziels. Tabelle `amazon_kontozustand` (Verlauf), Fall-Zentrale oben „Kontozustand“ (`#kontozustand`), Aufgabe „Amazon-Kontozustand gefährdet: …“ (wichtig → Push), wird bei „gut“ automatisch erledigt |
| AB.2 | Gestrandeter Bestand und gesperrte Angebote (gebundenes Kapital) | ❌ | ✅ | `GET_STRANDED_INVENTORY_UI_DATA` und `GET_MERCHANTS_LISTINGS_FYP_REPORT` (täglich, Stand wird ersetzt) → `amazon_gestrandet`. Fall-Zentrale „Gestrandeter Bestand und gesperrte Angebote“: SKUs, Stück, **gebunden = Menge × EK** (ohne EK gezählt, nicht gerechnet), Grund, Datum der automatischen Entfernung. Aufgaben „Gestrandeter Bestand bei Amazon: … gebunden“ (wichtig, wenn Amazon in ≤ 7 Tagen automatisch entfernt) und „Gesperrte Angebote bei Amazon: …“. Hinweis auf der Kapital-Ampel |
| AB.3 | Umsatzsteuer-Transaktionsbericht direkt von Amazon (kein Upload mehr nötig) | 🟡 (nur Datei-Upload) | ✅ | `GET_VAT_TRANSACTION_DATA` je Kalendermonat (alle 3 Tage der laufende Monat, in den ersten 10 Tagen auch der Vormonat) → dieselbe Auswertung wie beim Upload (`ustBerichtImportieren(…, { quelle: "api" })`): Summen je Land/OSS in `ust_auswertungen`, Protokoll „Quelle api“. Der Bericht von Amazon **ersetzt** hochgeladene Teile desselben Monats (sonst doppelt). Keine Steuerberatung – nur Zahlen für den Steuerberater |
| AB.4 | Weitere Gebühren: Langzeit-Lagergebühr, Lagerlimit-Überschreitung, fehlerhafte Sendungen ans Lager | ❌ | ✅ | `GET_FBA_FBA_LONGTERM_STORAGE_FEE_CHARGES_DATA` und `GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA` (wöchentlich) → `amazon_zusatzgebuehren`; Lagerlimit und Inbound-Platzierung aus dem Transaktionsbericht (`gebuehrArt`, deutsch/englisch). Bericht geht vor Transaktion (nichts doppelt, `weitereJeMonat`). Fall-Zentrale „Weitere Amazon-Gebühren“ (3 Monate je Art). **Kapital-Ampel**: Langzeit-Lagergebühr je ASIN fließt in die Lagergebühr je Stück (`lagerJeAsin`). **Verlust-Stopp**: diese Gebühren zählen als „Lager & Sonstiges“, nicht als Verkauf (`anteilVonTransaktion`) |
| AB.5 | Fehlende Berechtigung sichtbar statt stiller Fehler | – | ✅ | `anforderungFehler`: Ablehnung (z. B. 403 ohne Steuer-Rolle) steht als Zeile in der Berichtsliste unter Anbindungen mit Hinweis auf die fehlende Rolle; der Zeitplan fragt dann nicht dauernd neu an |
| KA.1 | Knopf „Kleinanzeigen-Entwurf“ am eBay-Angebot | ❌ | ✅ | eBay → Angebote prüfen → Angebot: aufklappbarer Block (`src/app/(app)/ebay/pruefen/[itemId]/kleinanzeigen.tsx`) mit **Titel** (≤ 65 Zeichen, an der Wortgrenze gekürzt, „Blitzversand/Rechnung mit MwSt“ raus), **Kategorie-Vorschlag** (aus der eBay-Kategorie bzw. dem Titel), **Zustand** (Neu / Sehr gut / Gut / Defekt), **Preis** in ganzen Euro (Festpreis), **Text** (≤ 4.000 Zeichen, eBay-Sätze wie PayPal/Bewertungen/Artikelstandort raus, Merkmale ohne EAN/„Nicht zutreffend“, „Versand möglich“, „Gewerblicher Verkauf“), je ein **Kopieren**-Knopf, bis 20 **Bilder** (antippen und sichern oder „Bilder als ZIP“), Knopf „Kleinanzeigen öffnen“. Logik `src/lib/kleinanzeigen/logic.ts` |
| KA.2 | Regeln: kein Bot, keine Automatik, kein Login | – | ✅ | Nichts wird eingestellt oder abgeschickt, das System kennt kein Kleinanzeigen-Konto. Die ZIP-Route lädt nur Bilder des Angebots (https, keine internen Adressen, keine Weiterleitungen, höchstens 20 × 8 MB), nur mit Zugang zum eBay-Bereich |

Abnahme: Unit `amazon-berichte` (Kontozustand lesen/bewerten inkl. „neue Beschwerde“, gestrandet/gesperrt
englisch+deutsch, gebundenes Kapital, Erkennung der Berichte, Langzeitlager zwei Formate, Inbound-Mängel, Gebührenart,
Bericht vor Transaktion, Verlust-Stopp-Zuordnung) und `kleinanzeigen` (Titel, Preis, Kategorie, Zustand, Text, Optionen);
e2e `amazon-berichte`: Anfordern → Abholen (6 Berichte in der Liste) → Fall-Zentrale DE „gefährdet“ (neue
Markenbeschwerde), FR gut; gestrandet 2 SKUs/8 Stück/10,50 € gebunden, 1 ohne EK, 1 bald entfernt; Tasse gesperrt;
Langzeitlager 3,40 €, Inbound 1,20 €; Aufgaben + Push; USt-Bericht mit Quelle api; Kapital-Hinweis; `amazon_faelle` und
`amazon_lagergebuehren`; Datei-Import `amazon_gestrandet` ersetzt den Stand. Kleinanzeigen: Block mit Titel ≤ 65,
Kategorie, Zustand, „25 €“, Text ohne eBay-Sätze, 2 Bilder, ZIP mit 2 Dateien, ohne Anmeldung 403.

## B25 – Browser-Prüfung Teil 4 (Nachtrag 01.11., 12:20)

Reihenfolge wie angeordnet: B25.1 → B25.9 → B25.5 → B25.4 → B25.6 → B25.2/3/7/8 → B25.12. Alle Abnahmen mit
erfundenen Daten (Unit `tests/b25.test.ts`, e2e `e2e/b25.spec.ts`).

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| B25.1 | Gewinn nutzt die importierte Transaktionsdatei für Abrechnung/Auszahlung (kritisch) | 🟡 (Ableitung nur bei neuen Importen; Hinweis „Abrechnung fehlt“ schon bei einem fehlenden Tag) | ✅ | **Ältere Importe**: `transaktionenNachziehen` (`src/lib/reports/apply.ts`) leitet Abrechnungszeilen aus den gespeicherten Transaktionen ab (`abrechnungAusGespeicherten`, `src/lib/reports/transaktionen.ts`, Kennung `txdb:`) – nach jedem Transaktions-Import und im Zeitplan („Abrechnung aus Transaktionen nachziehen“). Ein neuer Upload ist nicht nötig. Eine spätere Datei, die alle gespeicherten Zeilen einer Abrechnung enthält, **ersetzt** die Ableitung durch die genauere aus der Datei, sonst wird aus allen gespeicherten Zeilen neu abgeleitet. Der echte Abrechnungsbericht ersetzt beides. Typen: Bestellung, Erstattung, Gebühren (je eine Zeile), **Übertrag = Auszahlung** (Kopf der Abrechnung, Liquidität), nie Umsatz. **Abdeckung**: `amazonQuelle` (`profit-logic.ts`) zählt den Zeitraum als gedeckt, wenn die Daten bis gestern reichen (bis 30.10. → Oktober gedeckt am 31.10.). Der Hinweis kommt nur, wenn der Monat wirklich nicht gedeckt ist. **Keine Doppelzählung**: Umsatz bleibt aus sellerboard bzw. Abrechnung je Zeitraum (eine Quelle, B19.3). Die Kachel nennt „Amazon aus dem Transaktionsbericht (Abrechnung folgt)“ |
| B25.2 | Import-Erkennung: Lagergebühren und USt-Bericht in „Was erkannt wird“, Spalte „Ergebnis/Fehler“ | 🟡 | ✅ | `src/app/(app)/import/page.tsx`: Liste ergänzt um Lagergebühren je Monat, USt-Transaktionsbericht, Gestrandet, Gesperrt, Langzeitlager, Inbound-Mängel. „Letzte Importe“ mit Spalte **Ergebnis / Fehler** (neu/geändert/übersprungen bzw. Meldung des Imports) und zusätzlich fehlgeschlagene Uploads und abgelehnte Schnittstellen-Berichte (rot) |
| B25.3 | „Lugru Deals=60“ als echter Standardwert | 🟡 (Platzhalter) | ✅ | `src/lib/settings.ts`: `dealEingang.wertSchwelleJe = { "Lugru Deals": 60 }` als Standard, gespeicherte Werte werden darübergelegt (eigener Wert je Quelle bleibt). Feld `de-schwelle-je` zeigt den Wert |
| B25.4 | Fall-Zentrale: Bestell-/Versandstatus in DE/FR/IT/ES/NL/PL/SE, Prime/Business → Archiv, Buy Box IT | 🟡 | ✅ | `src/lib/amazon-faelle/logic.ts`: `STATUS_BESTELLT_RE` (Bestellt, Commandé, Ordinato, Pedido realizado, Besteld, Zamówiono, Beställt, Ordered), `STATUS_VERSAND_RE`/`VERSAND_PHRASE_RE` (In Zustellung, Versandt, Livraison prévue, Livré, In consegna, Consegnato, Enviado, Entregado, Verzonden, Bezorgd, Wysłano, Dostarczono, Skickat, Levererat …), `PRIME_INFO_RE` → Art „info“ (archiviert, Grund „Prime-/Business-Info – kein Fall“). Buy Box: `BUYBOX_RE` (`mail-muster.ts`) auch „Offerta in evidenza … non sei più idoneo“, „Hai perso la Buy Box“ und DE/EN/FR/ES/NL/PL/SE. Bestehende „bitte prüfen“-Vorgänge werden beim nächsten Abgleich neu eingestuft (`neuEinstufen`); echte Fälle (Fallnummer im Betreff) bleiben Fälle |
| B25.5 | Repricer-Export-Vorschau | 🟡 (`/repricer/export` = Datei-Download bzw. Umleitung) | ✅ | `/repricer/export` ohne `?format` leitet auf **BQool-Dateien** (`/repricer/bqool`): je Land neu/geändert/gleich, Regelwechsel, Warnungen; neu oben ein Block mit allen Warnungen vor der Freigabe (Min über Buy Box × 1,2, Min unter Break-even, **kein Min in BQool – erst mit diesem Upload abgesichert**). Erst danach „Erzeugen/Freigeben“ bzw. „An BQool übertragen“ (B23). CSV weiter mit `?format=bqool` |
| B25.6 | Rückgängig für die grünen Werkzeuge | 🟡 (nur `mail_markieren`, `amazon_todo_erledigen`, `verlust_ausnahme`, `privat_eintrag_aendern/_loeschen`) | ✅ | Alte Werte werden **vor** der Änderung gespeichert: `auftrag_status` (Status, Sendungsnummer, Versanddatum), `aufgabe_verschieben` (alte Frist; nur zurück, wenn seitdem niemand die Frist geändert hat), `aufgabe_zuweisen` (Zuständige/r, extern, Anleitungen; nicht bei Übergabe an die VA über Discord – die Nachricht ist schon raus), `privat_eintrag_anlegen` (Eintrag wieder entfernen). Knopf „↩ Rückgängig“ im Assistent-Verlauf. Abnahme mit neuem Testaufruf `aufgabe_verschieben` (e2e) |
| B25.7 | Startseite „Jetzt dringend“: Paletten ohne Kunde, Versandbestätigungen | 🟡 | ✅ | Neu: Signal „N Paletten ohne Kunde – werden nicht abgerechnet“ mit den ersten Nummern und Link `/paletten?kunde=__ohne` (`src/lib/today/service.ts`). „N Aufträge versendet, aber bei Amazon nicht bestätigt – Frist …“ gibt es seit B15.1 (gleiche Quelle wie die Aufgabe, `offeneBestaetigungen`). Live stand vermutlich noch ein älterer Stand – nach dem Update prüfen |
| B25.8 | Tagesplan: Fahrzeit aus dem Termin-Ort, Telefonnummer bei Anruf-Aufgaben | 🟡 (Fahrzeit nur bei Tesla-Zielen/fester Zeit) | ✅ | `src/lib/mobil/fahrzeit.ts`: Schätzung aus den Postleitzahlen von Termin-Ort und „zu Hause“ (Einstellungen → Handy & Tesla): gleiche PLZ 10 Min., gleiche ersten 3 Ziffern 20, gleiche Region 30, sonst Luftlinie × 1,3 bei Ø 70 km/h + 10 Min. Puffer (höchstens 4 Std.). Ohne PLZ die Standard-Fahrzeit, Online-Termine (Zoom, Teams, Link) ohne Fahrzeit. Block „Fahrzeit N Min. → Termin (Anrufe möglich)“ vor jedem Termin mit Ort, private nur ohne Titel. Anruf-Aufgaben zeigen im Tagesplan „📞 Nummer“ (tel:-Link; Nummer aus der Aufgabe oder den Notizen) |
| B25.9 | Benutzer: Privat „voll“ bereinigen, VA-Rolle, nie angemeldete Inhaber | 🟡 (Sperre nur bei Neuwahl) | ✅ | **Sofort wirksam**: `session.ts` behandelt gespeichertes „voll“ bei Nicht-Inhabern als „kein Zugang“. **Bereinigt**: `privatVollBereinigen` (`src/lib/auth/konten.ts`) setzt alle Nicht-Inhaber mit „voll“ auf „kein Zugang“, beim Login eines Inhabers und stündlich im Zeitplan. Hinweis an Ludwig als Aufgabe „Privat-Zugang bereinigt: …“ und als Dialog nach dem Login (welche Konten). Nichts gelöscht. **VA**: Konto mit Adresse va@… bzw. Name „VA“ ohne VA-Rolle → Warnung mit Knopf „Als VA-Rolle übernehmen“ (Einstellungen → Benutzer). **Nie angemeldet**: seit B20.1 nach 30 Tagen automatisch deaktiviert – auch Inhaber, solange ein anderer Inhaber sich schon angemeldet hat (`nieAngemeldetZuDeaktivieren`) |
| B25.10 | B2B: Deal-Blatt, Sammelbestellung, Prep-Export | 🟡 (gebaut, aber ohne Deal nicht sichtbar) | ✅ (Ludwig entscheidet nur noch, ob er es nutzt) | Vorhanden seit B2B-3/B2B-5: Deal-Blatt als Bild/PDF (`/b2b/[id]/blatt`), Sammelbestellung („2. Sammelbestellung beim Großhändler“ im Ablauf je Deal), Prep-Export je Kunde (`/b2b/[id]/export` CSV/XLSX/PDF). Die drei Prüfungen liefen ohne angelegten Deal – deshalb neu ein Hilfe-Kasten auf `/b2b` („So läuft ein Deal“, offen, solange kein Deal da ist) |
| B25.11 | Apple Watch | 🟡 | ✅ | Vollständig seit W.1–W.11 (Abschnitt „Apple Watch“ oben): stand, dringend, erledigt, notiz, deal, bestand, tesla |
| B25.12 | Calls-Suchfeld; Intervall je Anbindung, echte Zeiten; Liquidität Temu + Steuertermine | 🟡 | ✅ | **Calls**: Suchfeld über Titel, Zusammenfassung und Transkript (`callsDurchsuchen`), Treffer mit Ausschnitten. **Anbindungen**: je Karte „Abrufe: Name: alle 15 Min. (zuletzt …)“; jeder Lauf speichert seinen Zeitplan (`job_runs.zeitplan`, Migration 0121) – statt „laut Plan“ steht der echte Takt, statt „unbekannt“ „nach dem ersten Lauf bekannt“; `anbindungen_status` nutzt dieselben Angaben. **Liquidität**: Temu ist eingebunden (Ø Auszahlung je Woche aus sellerboard, B19.8/B20.9). **Steuertermine**: täglich Erinnerung als Aufgabe 7 Tage vorher (≤ 2 Tage: wichtig, Wochenende → Montag), aus Cash Flow → Einstellungen → „Steuertermine“ (jetzt auch ohne Betrag speicherbar – dann nur Erinnerung, nicht in der Vorschau); Text „keine Steuerberatung“ |

Abnahme: Unit `tests/b25.test.ts` (Ableitung ergibt genau „Gesamt“, Übertrag → Auszahlung, Kennung `txdb:`; Abdeckung
„bis gestern“; Status-Betreffs in 8 Sprachen, Prime/Business → info, Fallnummer bleibt Fall; Buy Box in umgekehrter
Wortstellung; PLZ/Fahrzeit; Intervall-Texte; Steuertermine; VA-Erkennung) – 2.090 Unit-Tests grün. e2e `b25.spec.ts`:
Transaktionsbericht importieren → Zeilen gelöscht (wie alter Import) → nächster Import zieht sie aus den gespeicherten
Transaktionen nach (−33,40 €, Auszahlung 123,45 €) → genauere Datei ersetzt die Ableitung (−30,40 €, keine `txdb:`-Zeilen);
Import-Seite mit „nachgezogen“ im Ergebnis; „Lugru Deals=60“ im Feld; `/repricer/export` → Vorschau mit Warnblock;
`aufgabe_verschieben` → Rückgängig stellt die Frist her; Palette ohne Kunde auf der Startseite; Tagesplan mit Fahrzeit vor
dem Termin mit Ort und 📞-Link; Nicht-Inhaber mit „voll“ → Privatbereich gesperrt, Inhaber-Login bereinigt (Dialog +
Aufgabe); va@…-Konto → „Als VA-Rolle übernehmen“; Call einfügen und über das Suchfeld finden; Intervall bei Amazon; B2B-Hilfe.

## Privat-Rückblick: Zeitraum frei wählen (Wunsch 01.11.)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Individuelles Datum im Rückblick | ❌ (nur ganze Monate bzw. eine der letzten 12 Kalenderwochen) | ✅ | **Rückblick** (`/privat/rueckblick`): Formular „Von / Bis“ mit Datumsfeldern und Schnellauswahl (letzte 30 Tage, letzte 3 Monate, seit Jahresbeginn), Adresse `?von=…&bis=…`, „Zurück zum Monat“. Alle Zahlen (Nähe, Paarzeit, Wertschätzungen, Streicheln/Massage, Stimmung, Beobachtungen, erfasste Zeiten, Familienaufgaben, Therapie-Aufgaben, Tagebuch) zählen nur im Zeitraum; vertauschte Daten werden getauscht, Zukünftiges auf heute gekürzt (`rueckblickZeitraum`, `src/lib/private/rueckblick-logic.ts`). Drucken/PDF wie bisher. **Wochenrückblick**: zusätzlich „… oder 7 Tage bis [Datum]“ (auch weiter zurück als 12 Wochen) und Link „Längerer Zeitraum →“ |

Abnahme: Unit `privat-rueckblick` (Monat wie bisher, von–bis, vertauscht, nur ein Datum, Zukunft gekürzt, ungültiges
Datum ignoriert, Schnellauswahl); e2e `privat-rueckblick`: zwei Wertschätzungen vor ~400 Tagen → Zeitraum über das
Formular „2×“, engerer Zeitraum „1×“, Zukunft gekürzt, „Zurück zum Monat“, Wochenrückblick bis frei gewähltem Tag.

## Browser auf dem Server (Befund 01.11.: „Auf dem Server ist kein Browser installiert“)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Browser-Automatik (sellerboard-Kostenimport, BQool-Upload, ArbitrageOne-Abruf) auf dem Server | ❌ Image ohne Browser gebaut (`MIT_BROWSER=0` Standard, `update.sh` setzt nichts) | ✅ | `Dockerfile`: `ARG MIT_BROWSER=1` (Standard), `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` (fester Ablageort, unabhängig vom Benutzer), apt-Listen danach gelöscht. `docker-compose.yml`: Build-Argument `MIT_BROWSER: ${MIT_BROWSER:-1}` – abschalten nur bei Platzmangel mit `MIT_BROWSER=0` in der `.env`. Meldung in der App nennt jetzt den Weg (nächstes Update) |

Abnahme: Probe-Image auf demselben Basis-Image (`node:22-bookworm-slim`) mit Playwright 1.63.0 und denselben
Dockerfile-Zeilen gebaut; Chromium startet im Container aus `/ms-playwright/…/chrome` und lädt eine Seite. Das Image
wird dadurch ca. 400–500 MB größer; die Schicht wird nur neu gebaut, wenn sich `package-lock.json` ändert.

## Familienkalender „Betrifft“ und Apple-Watch-Seite (Wunsch 02.11.)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Familienkalender: einstellen, ob ein Termin mich, die Familie oder die Partnerin betrifft | ❌ (jeder Familien-Termin galt für beide und blockte auch den eigenen Tagesplan) | ✅ | Tabelle `kalender_betrifft` (Migration 0122, je Termin-UID = ganze Serie, mandantengetrennt; der Kalender selbst wird nie geändert). **Setzen**: Termin im Privatkalender antippen → Block „Wen betrifft der Termin?“ mit Knöpfen „Ina (ich)“, „Familie / beide“, „Tom“ (+ „Automatisch“). **Automatisch** ohne Auswahl: Vorname im Titel („Tom Zahnarzt“, „Yoga (Ina)“) → diese Person; beide Namen oder „Familie/alle/gemeinsam“ → Familie; sonst Familie (`src/lib/private/betrifft-logic.ts`). **Wirkung**: Termine nur der anderen Person blocken den eigenen **Tagesplan** nicht (keine Fahrzeit, nicht „Privat belegt“; damit auch nicht im „nächsten Termin“ an der Watch), heizen den **Tesla** nicht vor, stehen auf der **Startseite** als „Termin Tom“ statt „Privat belegt“; im **Privatkalender** mit „nur Tom“ und nur im Personenfilter dieser Person |
| Apple Watch: Teil fehlt scheinbar | 🟡 (alle Befehle gebaut, aber Anleitung nur im Wissen, in den Einstellungen nur „Kaufen“) | ✅ | Neue Seite **Einstellungen → Apple Watch** (`/einstellungen/watch`, auch verlinkt unter Handy & Tesla): Erklärung, Schlüssel-Status, Einrichtung **eines** Kurzbefehls „Seller“ (Diktat → `POST /api/mobil/watch/frage` → „zeige“ anzeigen, „sprich“ vorlesen, `url` öffnen), alle Sätze im Überblick, **Ausprobieren** (zeigt die Antwort wie auf der Uhr; ändernde Befehle laufen dort nicht). Neuer Endpunkt `watch/frage` ordnet freie Sätze zu (`watchBefehl`): Wie läuft's, Was ist dringend, Erledigt, „Nummer 2“ (jüngste offene Rückfrage), Notiz/VA/privat, Bestand, Deal, Tesla, Kaufen n – gleiche Rechte, ändernde nur per POST und nicht mit Nur-ansehen-Konten. Eine eigene App aus dem App Store ist nicht nötig (bräuchte Mac + Xcode + Apple-Entwicklerkonto) |

Abnahme: Unit `betrifft` (Vorname als Wort, beide Namen/„Familie“, gesetzt vor Titel, blockt nur bei mir/Familie) und
`apple-watch` (freie Sätze → Befehl, ändernde Befehle, Hilfe ≤ 160 Zeichen); e2e `familie-watch`: „Tom Zahnarzt“ blockt
Inas Tagesplan nicht, Elternabend schon (mit Fahrzeit) → auf „Tom“ gestellt → blockt nicht mehr, Kalender zeigt „nur Tom“ →
zurück auf Familie → blockt wieder; Apple-Watch-Seite über Handy & Tesla erreichbar, Adresse und Schlüssel angezeigt,
Ausprobieren „Was ist dringend?“ zeigt die Uhr-Antwort, „Erledigt“ nur erkannt; `watch/frage`: Wie läuft's → stand,
GET dringend, Notiz per GET 405 / per POST legt die Aufgabe an, „Blumen“ → Hilfe (422), falscher Schlüssel 401.

## Familienkalender „To do <Name>: …“ → To-do-Liste (Wunsch 02.11.)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Termin „To do Ludwig : Sachen Tafel herrichten“ im Familienkalender wird Aufgabe mit höchster Priorität | ❌ | ✅ | Bei jedem Kalender-Abgleich (alle 14 Min., beim „Jetzt abgleichen“ und nach Änderungen an Aufgaben) prüft `kalenderTodosUebernehmen` (`src/lib/calendar/kalender-todos.ts`) alle Kalender außer dem eigenen „Seller-System“-Kalender, von vor 3 bis in 14 Tagen. Erkannt werden „To do / ToDo / To-Do / Aufgabe / Erledigen (für) <Vorname>: …“ und „<Vorname>: To do …“ (`kalenderTodo`, Vorname aus dem Konto und aus den Privat-Einstellungen). Daraus entsteht eine Aufgabe für diese Person: Titel = Text nach dem Doppelpunkt, Priorität **wichtig** (höchste), Frist = Termintag, Notiz mit Kalender, Uhrzeit, Ort. Neue wichtige Aufgaben melden sich per **Push** (Watch: „Erledigt“). Je Termin (bei Serien je Vorkommen) genau einmal, danach nie überschrieben: erledigt bleibt erledigt, eigene Änderungen bleiben. Ohne Namen („To do: Einkaufen“) wird niemandem etwas zugeordnet. Der Kalender selbst wird nicht geändert |

Abnahme: Unit `kalender-todo` (Schreibweisen wie im Familienkalender, ganzer Titel ohne Text, keine Fehltreffer bei
„Ludwig Zahnarzt“, „Ludwiga“, „Fortbildung Arbeit“, „To do: …“ ohne Namen); e2e `familie-watch`: Termin „To do Ina :
Sachen Tafel herrichten“ → nach dem Abgleich genau eine Aufgabe „Sachen Tafel herrichten“, wichtig, Ina zugeordnet, Notiz
mit Kalendername; als erledigt markiert → nächster Abgleich legt nichts neu an und öffnet nichts wieder.

## Bauauftrag Push aufs Handy ohne Discord · DHL-Label aus Chat/Screenshot (03.11.)

### A. Push aufs Handy

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| A1 Web-Push der App: Erlaubnis beim ersten Öffnen am iPhone, Abo speichern (Gerät, Nutzer, Zeitpunkt), VAPID | 🟡 (Push-Schalter und VAPID da, aber nur von Hand einzuschalten; Abo ohne Zustand) | ✅ | Als App vom Home-Bildschirm geöffnet und noch nicht gefragt → Hinweis „Push erlauben“ (iOS fragt nur nach einem Tipp; „Später“ 7 Tage) – `src/components/push-pruefen.tsx` im App-Rahmen. Abo mit Gerätename, Person, Zeitpunkt, letzter Erfolg (`push_abos`, Migration 0124); Versand VAPID (`src/lib/push/service.ts`) |
| A1 Dreimal Zustellung fehlgeschlagen → „abgelaufen“, beim nächsten Öffnen neu anfordern | ❌ (Fehler nur gemerkt, nach 7 Tagen ignoriert, 404/410 gelöscht) | ✅ | Fehlversuche in Folge zählen; ab 3 (bzw. sofort bei 404/410 vom Push-Dienst) `abgelaufen_am`. Beim Öffnen prüft die App `GET /api/push/abo?endpoint=` → abgelaufen/unbekannt → still neu abonnieren, sonst Hinweis „Neu einrichten“ (`aboStand`, `src/lib/push/client.ts`) |
| A2 Einstellungen → Benachrichtigungen: je Art an/aus mit Standard (Deal grün/gelb mit „In den Warenkorb“, Amazon kritisch, Frist heute, Paletten-Sendung heute, Morgenbericht, VA-Rückfrage) | ❌ | ✅ | Seite `/einstellungen/benachrichtigungen` (je Person, alle Arten Standard an; dazu „Neue wichtige Aufgabe“, „Sonstiges“). Arten: `MELDE_ARTEN` in `src/lib/push/logic.ts`. Zuordnung: Deal-Eingang/Lugru → `deal` (Knöpfe wie Kaufen-mit-einem-Tap), Amazon-Aufgaben mit Priorität kritisch → `amazon_kritisch`, VA-Rückfrage/VA fragt → `va_rueckfrage` (neu auch als Push), Fristen/Paletten/Morgenbericht morgens |
| A3 Ruhezeit 22–6 Uhr nur „kritisch“, Rest morgens mit dem Morgenbericht | ❌ | ✅ | `zustellung()` (Art aus → nur Protokoll; Ruhezeit + nicht kritisch → zurückgehalten). Morgens nach Ruhezeit-Ende (Zeitplan alle 9 Min., je Person einmal am Tag): „☀️ Morgenbericht liegt vor“ mit Link + Zahlen (Fristen heute, wichtige Aufgaben, Paletten-Sendungen heute, über Nacht), dann „Frist heute“/„Paletten heute“ und die neueste zurückgehaltene Meldung mit ihren Knöpfen (`morgenAuslieferung`). Knopf „… zurückgehalten – jetzt ausliefern“ auf der Seite. Ruhezeit je Person einstellbar |
| A4 Discord parallel, Protokoll je Meldung: Discord ja/nein, App-Push gesendet/zugestellt/fehlgeschlagen | ❌ (Discord nur, wenn kein Push ging) | ✅ | Discord läuft jetzt **immer parallel** (außer Privates: „–“). Protokoll auf der Seite: Zeit, Art, Meldung, Discord ja/nein/–, App-Push (gesendet / fehlgeschlagen / kein Gerät / Ruhezeit / Art aus / morgens nachgereicht, mit Geräteanzahl), **Zugestellt** = Uhrzeit, zu der das Gerät die Meldung abgeholt hat (`meldungen.zugestellt_am`) |
| A5 Prüfseite „Test-Push an dieses Gerät“ mit Zustellzeit | ❌ | ✅ | Knopf auf `/einstellungen/benachrichtigungen` → nur an das Abo dieses Geräts (`POST /api/push/test`), zeigt „Zugestellt um … (nach x s)“ (`GET /api/push/test?id=`). Andere Geräte sehen den Test nicht |
| A6 Apple Watch über das iPhone, Watch-Endpunkte bleiben | ✅ | ✅ | Unverändert; Hinweis auf der Seite. „Erledigt“ an der Watch schließt weiter die zuletzt gemeldete Aufgabe |

### B. DHL-Label aus Chat oder Screenshot

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B1 Seite „Versand → Label erstellen“ (auch Handy, „Mehr“), Text einfügen oder Bild (Drag-and-Drop, Einfügen, Kamera, iPhone-Teilen) | ❌ | ✅ | `/versand/label` (Navigation „Produkte & Lager → Label aus Chat (DHL)“, am Handy über „Mehr“). iPhone-Teilen-Menü über Kurzbefehl an `POST /api/mobil/label` (Handy-Schlüssel) → Entwurf, Seite öffnet vorausgefüllt (Anleitung auf der Seite) |
| B1 KI liest Name, Straße, Hausnr., PLZ, Ort, Land, Telefon, Mail, Packstation/Postnummer; unsichere Felder gelb; DHL-Adressprüfung mit Vorschlag | ❌ | ✅ | `adresseErkennen` (Claude mit Bild bzw. Text; ohne KI nach Regeln, nur Text) – `src/lib/versand-label/service.ts`, Regeln `adresseAusText` in `logic.ts`. Gelb = von der KI unsicher oder Pflichtfeld fehlt. „Adresse prüfen (DHL)“ = Parcel DE Shipping `validate=true` (es entsteht kein Label), Meldungen/Vorschläge im Klartext (`pruefeDhlSendung`) |
| B1 Artikel frei oder SKU/EAN (Scanner), Gewicht, Maße, Wert | ❌ | ✅ | Felder im Formular; Scanner tippt in „SKU/EAN“ (Enter sendet nicht ab). Maße gehen an DHL mit. Waage: von Hand (keine Waagen-Anbindung) |
| B2 Produkte: DHL Paket 2/5/10/20/31,5 kg, Päckchen, Warensendung (Internetmarke), Retourenlabel; Services Versicherung bis 2.500 €, Alterssichtprüfung, Packstation; keine Nachnahme/Wunschzeit | ❌ | ✅ | `VERSAND_PRODUKTE`; Gewichtsklasse wird nach Gewicht vorgeschlagen; Päckchen = DHL Kleinpaket (Abrechnungsnummer aus Einstellungen → Versand); Warensendung über die vorhandene Internetmarke; Retoure = Kunde als Absender, ihr als Empfänger (kein Auftrag). Versicherung (`additionalInsurance`, über 500 €) und Alterssicht (A16/A18) in `createDhlLabel`; Packstation über Feld Packstation + Postnummer |
| B3 Gefahrgut LQ (UN, Menge je Packstück, Klasse), Hinweis nur LQ/EQ, LQ-Raute 100 × 100 mm; Lithium UN3481/UN3091 mit Batterie-Kennzeichen; Klasse 1, 6.2, 7, Vollgefahrgut gesperrt „per Spedition“ | ❌ | ✅ | `gefahrgutPruefen` (Pflichtangaben, LQ höchstens 30 kg, gesperrte Klassen, Vollgefahrgut). Knopf „Label erstellen“ ist bei Sperre aus. Druckseite `/etikett/gefahrgut?art=lq|lithium` (100 × 100 mm, A4, QL-800 62 mm = 50 × 50 mm mit Hinweis) |
| B4 Label über Parcel DE Shipping, PDF 100 × 200, Auftrag mit Kanal Kleinanzeigen/WhatsApp/B2B (Käufer, Artikel, Preis, Zahlungsart), Tracking-Link kopieren + Textbaustein | ❌ | ✅ | `labelErstellen`: Label-PDF (Druckformat aus Einstellungen → Versand), Auftrag „L-<Sendungsnummer>“ mit neuen Kanälen `kleinanzeigen`/`whatsapp`/`b2b` (ohne Marktplatzgebühren), Position (SKU, Artikel, Menge, Preis), Paket mit Label, Status „Label erstellt“ (Bestand bucht wie gewohnt beim „Versendet“), Versender „selbst“. Knöpfe „Tracking-Link kopieren“ und „Text für WhatsApp/Kleinanzeigen kopieren“ („dein Paket ist unterwegs: …“) |
| B5 Stammadressen (B2B-Kunden, Palettenkunden); Absender LuGru GmbH, zweiter Absender wählbar | ❌ | ✅ | Auswahl „Stammadresse“: B2B-Kunden (Adresse), Palettenkunden (nur Name – dort ist keine Adresse hinterlegt), zuletzt verwendete Empfänger. **Die VA sieht keine B2B-Kunden**. Zweiter Absender in den Einstellungen unten auf der Seite (nur Inhaber) |
| B6 DHL lehnt ab → Klartext, Formular bleibt; ohne DHL-Verbindung → Vorlage + Hinweis | ❌ | ✅ | Fehlertext von DHL wird angezeigt, alle Felder bleiben; ohne Zugang/Abrechnungsnummer → „als Vorlage gespeichert“, Liste „Vorlagen und Abgelehntes“ zum Wieder-Öffnen |
| B7 VA darf Labels erstellen, Ludwig sieht Protokoll (wer, wann, an wen, Kosten laut Preisliste) | ❌ | ✅ | Zugriff über den Bereich „Service“ (in der VA-Rolle enthalten). Protokoll: Inhaber alle Labels mit Wer und Kosten, alle anderen nur die eigenen ohne Kosten. Kosten aus der Preisliste in den Einstellungen (leer = nicht hinterlegt). Tabelle `versand_labels` (Migration 0125, Adresse verschlüsselt; Chat-Text und Bild werden nicht gespeichert) |

### Abnahme

| Abnahme | Ergebnis |
|---|---|
| 1. WhatsApp-Screenshot hochladen → Formular gefüllt, Label-PDF < 30 s, Auftrag angelegt | ✅ automatisch (`e2e/label-aus-chat.spec.ts`, Testbild, unsicheres Feld gelb, Zeit gemessen) |
| 2. Kleinanzeigen-Nachricht als Text → gleiches Ergebnis | ✅ automatisch |
| 3. Gefahrgut LQ mit UN-Nummer → Label + LQ-Kennzeichen; unzulässige Klasse gesperrt | ✅ automatisch (Klassen 1.4S, 7, 6.2 und Vollgefahrgut gesperrt; LQ- und Batterie-Kennzeichen druckbar) |
| 4. Test-Push erreicht das iPhone bei geschlossener App; Deal-Push mit Warenkorb-Knopf; Protokoll zeigt Zustellung | ✅ automatisch gegen den Push-Nachbau (`e2e/push-handy.spec.ts`: Test-Push mit Zustellzeit, Deal-Push „In den Warenkorb“ → Amazon-Warenkorb, Protokoll „zugestellt“, Art aus, Ruhezeit → morgens, 3 Fehler = abgelaufen → neu angefordert). **Am echten iPhone bei geschlossener App: von Ludwig zu prüfen** (Prüfseite „Test-Push an dieses Gerät“) |

Claude-Werkzeuge: keine neuen oder geänderten Werkzeuge in diesem Bauauftrag – kein `notifications/tools/list_changed`.

**To-dos für Ludwig:**

1. Discord am iPhone (sofort): Einstellungen → Benachrichtigungen → „Push-Benachrichtigungen“ auf **„Immer“**; Server Lugru →
   Kanal Deals → Benachrichtigungen **„Alle Nachrichten“**; iPhone-Fokus/„Nicht stören“ prüfen.
2. Seller-App am iPhone vom **Home-Bildschirm** öffnen → „Push erlauben“ → Einstellungen → Benachrichtigungen →
   **„Test-Push an dieses Gerät“**, App wegwischen, Mitteilung abwarten (Zustellzeit steht danach auf der Seite).
3. Arten und Ruhezeit auf derselben Seite prüfen (Standard: alles an, 22–6 Uhr nur kritisch).
4. Label-Seite, unten „Einstellungen“: **zweiter Absender** (Wittmann & Grunert, Anschrift) und **Preise laut DHL-Vertrag**
   eintragen (sonst zeigt das Protokoll keine Kosten). Für Päckchen die Abrechnungsnummer Kleinpaket in Einstellungen →
   Versand eintragen.
5. **Gefahrgut bei DHL**: prüfen, ob für LQ-Sendungen mit DHL Paket eine Zusatzvereinbarung nötig ist, und das
   Batterie-Kennzeichen gegen eine offizielle Vorlage abgleichen (die Druckseite ist eine vereinfachte Darstellung).
6. **QL-800**: druckt höchstens 62 mm breit – die LQ-Raute in 100 × 100 mm geht nur auf A4 bzw. einem 100-mm-Etikettendrucker;
   50 × 50 mm auf dem QL-800 nur, wenn das Paket für 100 × 100 mm zu klein ist.
7. Optional iPhone-Kurzbefehl „Label erstellen“ fürs Teilen-Menü einrichten (Anleitung auf der Label-Seite).

## Privat-Rückblick: Nähe / Intimität je Woche, Ausgeschlafen mit Wochentagen (Wünsche 03./04.11.)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| „Nähe / Intimität: 4×“ nach Wochen aufgliedern, ohne genaues Datum | ❌ (nur Summe) | ✅ | Hinter der Summe stehen je Kalenderwoche des Monats bzw. Zeitraums die Wochentage, wie bei Ausgeschlafen (Wunsch 04.11.), z. B. „— KW 44: So · KW 45: Di, Do · KW 46: – · KW 47: Mi“. Wochen ohne Eintrag zeigen „–“. Gilt auch für den Druck und das PDF. `jeWoche` in `src/lib/private/rueckblick-logic.ts`, Anzeige in `src/app/(privat)/privat/rueckblick/page.tsx` |
| Ausgeschlafen mit Wochentagen | ❌ (nur Anzahl und Stunden je Person) | ✅ | Unter der Tabelle „Erfasste Zeiten“ steht je Person, an welchen Wochentagen ausgeschlafen wurde, nach Kalenderwoche, z. B. „KW 45: Sa, So · KW 46: – · KW 47: Mi“. Gezählt wird nur, was stattgefunden hat, wie in der Tabelle. Eine Person ohne Eintrag fehlt in der Liste. `wochentageJeWoche` in `src/lib/private/rueckblick-logic.ts` |

**Abnahme:** `tests/privat-rueckblick.test.ts` prüft Wochen ohne Eintrag, Tage außerhalb des Zeitraums und den
Jahreswechsel. `e2e/privat-rueckblick.spec.ts` prüft zwei Einträge im Abstand einer Woche: Summe 2×, in beiden Wochen
derselbe Wochentag, sonst „–“, kein Datum. Für Ausgeschlafen prüft es Sa und So in der einen Woche und Mi in der nächsten, nur für die Person
mit Einträgen. Keine neuen Claude-Werkzeuge.

## VA in Discord: Fragen und Bitten kamen nicht an (Befund 03.11., Screenshot #va)

Befund: Die VA hat in Threads gefragt bzw. um Rechnungen und Liefernachweise gebeten. Im Tool kam nichts an, es gab
keine Meldung, und Rechnungen wurden nicht automatisch in den Kanal geschickt.

Ursachen:
1. **Threads, die die VA selbst anlegt** („INVOICE FOR REEVALUATION“, „NEED PROOF DELIVERY ORDER & INVOICE …“), wurden
   nie gelesen. Im Kanal steht davon nur die Systemnachricht „… hat einen Thread begonnen“ (Discord-Typ 18), und die
   wurde übersprungen.
2. **Bitten mitten im Satz** („Hi, the sourcing cost not approved yet, i need invoice …“) galten in Aufgaben- und
   Anspruchs-Threads als Notiz. Erkannt wurden nur „?“ oder ein Satzanfang wie „can you / please“.
3. **In Anspruchs-Threads** wurde nie selbst nach Rechnungen gesucht; im Kanal nur nach einer ASIN je Nachricht.
4. **„already … reimbursement id …“** wurde nicht erkannt; die Erstattungs-ID hätte sogar als Fallnummer gelten können.
5. **Kein Nachholen:** Was einmal als Notiz gespeichert war, blieb liegen.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Threads der VA lesen | ❌ | ✅ | Systemnachricht „Thread begonnen“ → Thread gemerkt (`vaThreadMerken`). Zusätzlich holt jeder Abgleich die Liste der aktiven und archivierten Threads im VA-Kanal (Besitzer = VA, letzte 14 Tage, `threadsEntdecken`). Alle Nachrichten der VA im neuen Thread werden zusammen mit dem Thread-Titel als **eine** Anfrage gelesen. `src/lib/va/service.ts`, `src/lib/va/discord.ts` (`aktiveThreads`, `archivierteThreads`), Spalte `va_threads.titel` (Migration 0126) |
| Bitte mitten im Satz erkennen | 🟡 | ✅ | Erkannt werden u. a. „i need“, „please send/provide“, „kindly“, „could you“, „waiting for“, „not approved yet“, „ich brauche“: `threadAntwortArt` und `bedarfAusText` in `src/lib/va/logic.ts`. Bei unklaren Antworten fragt die KI, ob es eine Bitte/Frage ist (`kiBitte`). Eine klare Bitte um Rechnung oder Nachweis wird nie als Info abgelegt |
| Rechnungen automatisch in den Thread | 🟡 (nur Kanal, eine ASIN) | ✅ | Mehrere ASINs auf einmal, sonst die ASIN/SKU des Anspruchs bzw. der Aufgabe: `rechnungenSammeln`, `bitteImThread` (`src/lib/va/service.ts`), `anspruchBitte` (`src/lib/va/automatik.ts`). Höchstens 10 Dateien je Antwort. Nur wenn „VA darf Einkaufsrechnungen sehen“ an ist |
| Was fehlt, geht an Ludwig | ❌ | ✅ | Gemeint sind: Rechnung nicht im System, Liefernachweis/POD, Entscheidung. Ludwig bekommt eine Aufgabe, einen Push „VA-Rückfrage“ und Discord. Die Aufgabe nennt das Fehlende im Titel („… – offen: Rechnung B0… (nicht im System)“) und verlinkt den Anspruch. Im Thread steht „📌 Still open: … – it is with Ludwig“. Ludwigs Antwort aus „Delegation → VA“ erscheint im Thread |
| „already reimbursed / reimbursement id …“ | 🐞 (Erstattungs-ID konnte als Fallnummer gelten) | ✅ | Ludwig bekommt die Aufgabe „Anspruch prüfen – laut VA schon erstattet: …“ mit Erstattungs-ID und Link. Dazu kommen eine Notiz am Anspruch und eine Bestätigung an die VA. **Der Status wird nicht automatisch geändert.** `bereitsErstattet` (`logic.ts`); `fallnummerInAntwort` ignoriert Erstattungs-IDs (`automatik-logic.ts`) |
| Einmal nachholen | ❌ | ✅ | Beim ersten Abgleich nach dem Update. Nachgeholt werden Notizen der VA aus Aufgaben- und Anspruchs-Threads, die eine Bitte sind (letzte 14 Tage, höchstens 30; `nachpruefen`, Zeitpunkt in `va_stand.nachgeprueft_am`). Threads, die die VA in den letzten 14 Tagen selbst angelegt hat, findet die Thread-Liste |
| Aufgabentitel bei vielen fehlenden Rechnungen (Befund 03.11., 22:44: Titel brach mitten im Wort ab) | 🐞 | ✅ | Ist die Liste lang, nennt der Titel nur die Anzahl („– offen: 5 Rechnungen nicht im System; Liefernachweis …“). Die volle Liste steht in der Notiz der Aufgabe. `offenKurz` in `src/lib/va/logic.ts`. Bestehende Aufgaben bleiben, wie sie sind |
| Infos ohne Bitte | ✅ | ✅ | Ein Beispiel ist „FNSKU ist laut Removal-Seite schon angekommen“. Solche Infos landen als Notiz am Anspruch bzw. an der Aufgabe, ohne neue Aufgabe |

**Abnahme** (automatisch, erfundene Daten): `e2e/va-anfragen.spec.ts`

1. Eigener Thread der VA mit zwei ASINs: Die Rechnung der einen geht in den Thread, die andere wird Aufgabe und Push.
2. „i need invoice“ im Anspruchs-Thread:
   - Rechnung im System: Sie geht automatisch in den Thread, ohne Aufgabe, mit Info-Push.
   - Keine Rechnung: Ludwig bekommt eine Aufgabe mit Link zum Anspruch.
3. „already … reimbursement id 1234567890“: Ludwig bekommt „Anspruch prüfen“. Der Anspruch bleibt „vorgemerkt“, ohne
   Fallnummer.
4. Threads ohne Hinweis im Kanal (aktiv und archiviert) werden gefunden. POD plus Rechnung ohne ASIN wird eine Aufgabe.
5. Eine alte Notiz wird einmal nachgeholt, beim zweiten Abgleich nicht mehr.

Unit-Tests: `tests/va-anfragen.test.ts`.

Regression grün: va-discord, va-automatik, va-sprache, amazon-faelle, b20-faelle, push-handy, apple-watch,
recht-discord, deal-eingang, lugru-deals, b21-calls-live, deal-wert, familie-watch. Den apple-watch-Test habe ich
angepasst: Er räumt jetzt zu Beginn alle Pushs der letzten 24 Std. ab, weil sonst ein Push aus der Prüfung davor als
„neuester“ galt.

**Claude-Werkzeuge:** keine neuen oder geänderten, daher kein `notifications/tools/list_changed`. `va_nachrichten` und
`va_aufgaben` zeigen die neuen Anfragen wie bisher.

**To-dos für Ludwig:**
1. Server aktualisieren: `bash /opt/seller-system/deploy/update.sh` (Migration 0126 läuft beim Start).
2. Die Rechte des Bots im VA-Kanal prüfen: „Kanal ansehen“, „Nachrichtenverlauf lesen“, „Nachrichten in Threads
   senden“ und „Dateien anhängen“. Sonst sieht er die Threads der VA nicht. Fehler zeigt „Delegation → VA“ als „Threads
   der VA finden: …“.
3. Unter Delegation → VA (Discord), Kasten „Einstellungen“, muss „VA darf Einkaufsrechnungen sehen (automatisch
   schicken)“ angehakt sein (Standard: an). Sonst geht jede Rechnungsbitte an dich.
4. Nach dem Update einmal „Jetzt abgleichen“ unter Delegation → VA drücken. Das holt die Anfragen aus dem Screenshot
   nach:
   - Rechnungen, die im System sind, gehen sofort in die Threads der VA.
   - Für den Rest bekommst du Aufgaben.
5. Fehlende Rechnungen im System hochladen und der Charge zuordnen. Dann schickt das System sie beim nächsten Mal selbst.

## Bauauftrag 06.11.: Abholung DHL/UPS aus dem Tool (auch per Sprache) · Rechnungsstation

**Prüfung (vorher):**

| Punkt | vorher | Fundstelle |
|---|---|---|
| A1 Seite „Versand → Abholung“, Werkzeug `abholung_anlegen` | ❌ | – |
| A2 Stammdaten (Abholadressen je Absender, Ansprechpartner, Telefon, Kundennummer, Zeitfenster, Fahrer-Hinweis) | 🟡 nur ein Absender für Labels (Einstellungen → Versand) | `settings.shipper` |
| A3 Technik: DHL-Abhol-API, sonst Browser-Automatik | ❌ – die API gibt es (DHL Parcel DE Pickup v1), also kein Browser nötig | – |
| A4 Automatik-Vorschlag (mehr als n Labels, nichts gebucht → Aufgabe + Push) | ❌ | – |
| A5 Protokoll je Abholung, Stornieren über denselben Weg | ❌ | – |
| B1 Seite „Rechnungsstation“ im Vollbild | ❌ (nur „Belege scannen“ einzeln mit dem Handy) | `/rechnungen/belege` |
| B2 Auslöser bei stillem Blatt, Mehrseiter ≤ 5 s | ❌ | – |
| B3 KI-Erkennung (Lieferant, Nr., Datum, Netto/Brutto/USt, Positionen, Zahlungsziel), unsicher = gelb, Kachel | 🟡 Kassenzettel: Händler/Datum/Brutto/USt, keine Positionen, keine Ampel | `readReceipt` |
| B4 Zuordnung zu Einkäufen, an den ASIN, Duplikate | 🟡 Rechnungen aus Drive → Chargen; keine Zuordnung zu Bestellungen | `matchInvoice` |
| B5 Weiterleitung an Stotax (rot erst nach Prüfung, gelb mit Vermerk) und Drive | 🟡 Stotax nur für Handy-Belege, ohne Ampel; Drive nur lesend | `sendPendingReceipts` |
| B6 Stapelende: Zusammenfassung als Aufgabe, Prüfliste mit Bild | ❌ | – |
| B7 Beide Wege: Kamera live und Scanner-Ordner (PDF an Rechnungsnummern trennen) | ❌ | – |
| C UPS-Abholung (OAuth, PRN, Storno, Vorschlag) | ❌ | – |
| Rechte (VA bucht/bedient, keine Stammdaten/Zugänge; Protokoll wer/wann) | ❌ | – |

**Nachher:**

| Punkt | Stand | Fundstelle |
|---|---|---|
| A1 Seite | ✅ Versand → Abholung: Dienst DHL/UPS (Reiter), Abholort, Datum (nächster Abholtag), Fenster und Paketzahl vorbelegt (Paketzahl = heute erstellte Labels), Paletten/Gewicht/Hinweis optional. Kommende Abholungen und Protokoll darunter | `src/app/(app)/versand/abholung/` |
| A1 Werkzeug (Sprache über Claude) | ✅ `abholung_anlegen` (ändernd, Stufe gelb): erst ohne `bestaetigt` → Rückfrage mit Zusammenfassung und Hinweisen, nichts gebucht; nach „Ja“ mit `bestaetigt=true` → Buchung, Bestätigungsnummer zurück. Datum wie gesagt („morgen“, „Montag“, „7.11.“), Fenster wie gesagt („10-12“, „10 bis 12 Uhr“), Abholort per Name („LuGru“). Doppelte Buchung (gleicher Tag/Ort/Dienst) wird abgelehnt. Rückgängig = Storno | `src/lib/assistant/tools/abholung.ts`, `src/lib/abholung/logic.ts` |
| A2 Stammdaten | ✅ Einstellungen → Abholung (nur Inhaber, verlinkt unter Einstellungen → Versand): beliebig viele Abholorte mit Firma, Adresse, Ansprechpartner, Telefon, Mail, DHL-Kundennummer (EKP) je Absender, optional Abrechnungsnummer/UPS-Konto, Standard-Zeitfenster, Fahrer-Hinweis, Standardort. Keine echten Daten im Programm – die Adressen aus dem Bauauftrag trägst du ein (To-do 94) | `src/app/(app)/einstellungen/abholung/` |
| A3 DHL | ✅ DHL Parcel DE Pickup v1 (gleicher Zugang wie der Versand + API „Parcel DE Pickup“). Regeln vorher geprüft: Mo–Sa, keine Feiertage (bundesweit + Bayern), nicht am selben Tag, bis 22 Uhr für morgen, höchstens 30 Tage im Voraus. DHL bucht **keine feste Uhrzeit** – das Fenster geht als Öffnungszeit mit; über 10 Pakete ist es eine einmalige Abholung (Anfrage, Bestätigung per Mail) – beides steht in der Rückfrage | `src/lib/integrations/clients/dhl-pickup.ts` |
| A4 Vorschlag | ✅ Abends 17–22 Uhr stündlich: mehr als n fertige Labels (Standard 5, einstellbar) und für den nächsten Abholtag nichts gebucht → Aufgabe „Abholung buchen? 6 DHL-Labels fertig, für Sa, 07.11. nichts gebucht“ mit Push; der Link öffnet die Seite mit „Jetzt buchen“ (ein Klick bucht genau das). Nie automatisch gebucht. Zusätzlich „Vorschlag jetzt prüfen“ auf der Seite | `abholVorschlag` (`src/lib/abholung/service.ts`), Schritt im Hintergrund-Takt |
| A5 Protokoll / Storno | ✅ je Abholung Dienst, Datum, Fenster, Pakete/Paletten, Abholort, Status (gebucht/angefragt/storniert/nicht gebucht + Fehler), Bestätigungsnummer, Abholart (BDA/EZA/EMA, kostenpflichtig), wer gebucht hat (Seite/Claude/Vorschlag), wer storniert hat. Storno über die API (Seite oder `abholung_stornieren`) | Tabelle `abholungen` (Migration 0133) |
| C UPS | ✅ UPS Pickup v2409 mit OAuth (Anbindungen → UPS: Client-ID, Secret, Kontonummer, Umgebung, „Verbindung testen“). Gleiche Seite und gleiches Werkzeug (`dienst = ups`): Mo–Fr, Fenster = bereit ab / spätestens bis, Gewicht geschätzt 5 kg je Paket, wenn keins genannt. PRN wird gespeichert, Storno per PRN. Vorschlag wie A4, wenn UPS-Labels oder Palettenkunden-Sendungen per UPS (Versand, geplant) vorliegen | `src/lib/integrations/clients/ups.ts` |
| B1 Station | ✅ `/rechnungsstation` im Vollbild (Menü Finanzen → „Rechnungsstation (Kamera)“ und „Rechnungsstation: Prüfliste“, sichtbar für Service, Buchhaltung und Geld): „Station starten“, Livebild mit erkanntem Blattrand, Kacheln am Rand (Lieferant, Betrag, Datum, Nummer, Status, Zuordnung, grün/gelb/rot), Summe oben | `src/app/(station)/rechnungsstation/` |
| B2 Auslöser | ✅ Blatt erkannt (helle Fläche auf dunkler Ablage, vier Ecken) und ≥ 0,9 s still → Foto in voller Auflösung, entzerrt (Homographie), Ton „ok“, nächstes Blatt; ein Blatt löst nur einmal aus, das nächste nach Bewegung + neuem Bild. Fußtaster: Leertaste/Enter/Bild↓/→ (USB-Fußtaster senden solche Tasten). Mehrseiter: Blatt ≤ 5 s nach dem vorigen mit gleicher Rechnungsnummer (oder Folgeseite ohne Kopf) wird angehängt (ein PDF, Summen von der letzten Seite). Ohne Netz wird erneut gesendet | `blattFinden`, `ausloeserSchritt`, `entzerren`, `gehoertZumVorigen` |
| B3 KI | ✅ Art (Rechnung/Kassenzettel/Lieferschein/Gutschrift), Lieferant, Nr., Bestellnr., Datum, Netto/Brutto/USt-Sätze, Positionen (ASIN/EAN/Artikel/Menge/EK), Zahlungsziel/Fälligkeit, Zahlungsart, unsichere Felder. Ampel: rot = Betrag/Datum/Lieferant fehlt, kein Beleg oder Nummer schon erfasst; gelb = Felder unsicher, Netto + USt ≠ Brutto, Nummer fehlt; sonst grün. Kassenzettel: Original-Foto in voller Auflösung archiviert | `STATION_PROMPT`, `ampelVon` |
| B4 Zuordnung | ✅ automatisch zu offenen Bestellungen (ArbitrageOne-Bestellungen aus B30, Deal-Käufe, von Hand) über Lieferant + Betrag + Datum (oder gleiche Bestellnummer), nur eindeutig; B2B-Deal-Bestellungen über Lieferant + Netto. Die Bestellung bekommt die Rechnung, Positionen mit ASIN hängen an der Charge → VA (`rechnungenFuer`) und `wissen` finden sie am ASIN. Doppelte Rechnungsnummer (gleicher Lieferant) → rot; dasselbe Foto zweimal → „war schon da“ | `besteZuordnung`, `anChargenHaengen`, `duplikatVon` |
| B5 Weiterleitung | ✅ Takt „Belege an Stotax“ (alle 15 Min., ohne Klick): grün sofort, gelb mit Vermerk im Mailtext, rot erst nach der Prüfung (dann sofort). Kamera-Belege frühestens 1 Minute nach dem letzten Blatt (Mehrseiter vollständig). Optional Kopie in einen Drive-Belegordner (Dienstkonto mit Schreibrecht); eigene Ablagen liest der Rechnungs-Abruf nicht noch einmal ein. Status je Beleg: erfasst → zugeordnet → an Stotax (mit Zeit) | `ausstehendeWeitergeben`, `stotaxMailStation`, `driveHochladen` |
| B6 Stapelende | ✅ „Stapel fertig“ (oder 30 Min. Ruhe) → Aufgabe „Rechnungsstapel prüfen: n Belege, Summe, k unklar“; Prüfliste `/rechnungsstation/pruefen`: gelbe/rote Belege mit Bild daneben, Felder korrigieren → „Speichern & freigeben“ bzw. „Kein Beleg“; Aufgabe erledigt sich, wenn nichts mehr offen ist | `stapelBeenden`, `belegPruefen`, `src/app/(station)/rechnungsstation/pruefen/` |
| B7 Beide Wege | ✅ Kamera live und Scanner-Ordner: PDFs in `./scan-eingang` (Docker: `/scan-eingang`) werden jede Minute verarbeitet – KI trennt an den Rechnungsnummern und liest je Beleg (bis 30 Seiten je Aufruf), jede Seite gehört zu genau einem Beleg, Original danach unter `verarbeitet/` (Fehler: `fehler/` + Aufgabe). Ohne Ordner: „PDF-Stapel hochladen“ in der Prüfliste | `pdfStapelVerarbeiten`, `ordnerPruefen` |
| Rechte | ✅ Abholung buchen/stornieren: Inhaber und Bereich Service (VA). Abholorte und Zugänge (Anbindungen) nur Inhaber. Rechnungsstation und Prüfliste: Service, Buchhaltung oder Geld; Station-Einstellungen nur Inhaber. Jede Buchung/jeder Stapel mit wer und wann | `requireArea`, `/api/rechnungsstation` |

**Verhaltensänderungen / Entscheidungen (bitte bestätigen oder ändern):**
- Claude bucht nie ohne Rückfrage: der erste Aufruf gibt nur die Zusammenfassung, erst „Ja“ bucht.
- UPS-Samstag biete ich nicht an (Aufpreis); DHL Mo–Sa.
- Kassenzettel sind Ausgaben ohne Einkauf: grün, aber nicht „zugeordnet“ und nicht in der Prüfliste.
- Handzeichen als Auslöser habe ich nicht gebaut (optional laut Bauauftrag) – Fußtaster per Taste geht.
- Rechnungen von der Station landen auch unter Eingangsrechnungen (Quelle „station“/„ordner“).

**Abnahme:**
1. ✅ automatisch (`e2e/abholung.spec.ts`, DHL-Nachbau): Abholort unter Einstellungen → Abholung angelegt → „DHL-Abholung morgen 10–12 Uhr, 12 Pakete, <Abholort>“ über den Claude-Konnektor → Rückfrage mit Zusammenfassung, nichts gebucht → nach Bestätigung angefragt (12 > 10 Pakete) mit Auftragsnummer, Protokoll „über Claude“, an DHL gingen 12 Pakete, Adresse, Kundennummer und Fenster. Doppelt und Sonntag abgelehnt, Storno per Werkzeug. *(live)* Erste echte Buchung (To-dos 93–96).
2. ✅ automatisch (`e2e/rechnungsstation.spec.ts`, Bilder über die Prüf-Hilfe der Station, KI-Nachbau): 50 Blätter durch die VA → 49 Belege (Zweiseiter angehängt), alle mit Lieferant und Datum, **42 automatisch zugeordnet**, Rest (1 gelb, 2 rot) in der Prüfliste mit Bild; Aufgabe „Rechnungsstapel prüfen: 49 Belege, …, 2 unklar“; 47 an Stotax (gelb mit Vermerk), rot erst nach Prüfung; nach der Prüfung Aufgabe erledigt. Dauer im Test unter einer Minute. *(live)* Kamera an der Werkbank mit echtem Papier.
3. ✅ automatisch: PDF mit 22 Seiten (20 Rechnungen, 2 davon zweiseitig) im Scanner-Ordner → 20 Belege, Original unter `verarbeitet/`. *(live)* echter Einzugsscanner (To-do 99).
4. ✅ automatisch: Versand → Abholung → „UPS“ → „Abholung buchen“ (Paketzahl aus der UPS-Palettenkunden-Sendung vorbelegt) → PRN gespeichert, Storno an UPS. VA bucht DHL, Einstellungen → Abholung bleibt gesperrt.
5. ✅ automatisch: 5 fertige Labels über dem Stand → kein Vorschlag; das 6. → Aufgabe mit Push, nichts gebucht; ein Klick bucht genau den Vorschlag, Aufgabe erledigt. Der Abendlauf (17–22 Uhr) ist derselbe Aufruf im Hintergrund-Takt.

Unit-Tests: `tests/abholung.test.ts` (14), `tests/rechnungsstation.test.ts` (10: Blatt-Erkennung, Auslöser, Homographie/Entzerren, KI-Antworten, PDF-Trennung, Ampel, Mehrseiter, Zuordnung, Stotax-Text). Alle 2246 Unit-Tests grün.

Regression: 172 Ablaufprüfungen, 170 im ersten Lauf grün. Nachgeprüft: Keepa-Aufrufzähler (Ausreißer, einzeln grün) und Navigation (Breite wurde während der Einklapp-Animation gemessen – der Test wartet jetzt das Ende ab), beide grün.

**Werkzeuge:** neu `abholung_anlegen` (ändernd), `abholung_stornieren` (ändernd), `abholungen` (lesend) – Bereich Service. `notifications/tools/list_changed` geht beim Verbinden raus.

## Umbau 06.11.: linke Menüleiste („seller-system-menue-umbau“)

**Prüfung (vorher):**

| Punkt | vorher | Fundstelle |
|---|---|---|
| Struktur: 11 Gruppen / 82 Einträge statt 12 / 95 (+ 5 Zähler-Links), jede Seite genau einmal | ❌ 12 Gruppen, Dubletten (Alle Aufgaben, Anrufe, eBay-Tabs, Temu-Rechner, Einstellungs-Unterseiten) | `src/lib/nav.ts` |
| Untergruppen (zweite Ebene, einklappbar), kein Block über 8 Zeilen | ❌ (Einkauf 13, Produkte & Lager 13, Finanzen 15 Zeilen) | – |
| Akkordeon: nur eine Gruppe offen, aktive klappt auf | 🟡 aktive klappte auf, aber beliebig viele offen | `sidebar-nav.tsx` |
| Fester Kopf (Favoriten + Zähler-Chips stehen, Gruppen scrollen) | ❌ ganze Leiste scrollte | – |
| Zähler-Chips | 🟡 nur Zähler > 0, dazu „Versand“ und „Paletten-Meldungen“, wechselnde Reihenfolge | `navCounters` |
| Favoriten (max. 8, per Ziehen sortierbar), „Zuletzt besucht“ | 🟡 max. 6, nicht sortierbar, kein Verlauf | `fav-toggle`, `nav-actions.ts` |
| Suche: Platzhalter, Gruppe › Untergruppe je Treffer, Unterseiten findbar | 🟡 nur Gruppe; Seiten ohne Menüpunkt nicht findbar | `befehls-suche.tsx` |
| Eingeklappter Modus mit Flyout | 🟡 64 px, Klick klappte die Leiste wieder aus | `app-sidebar.tsx` |
| Zustand je Nutzer merken | ✅ Cookie (offene Gruppen, schmal) | `NAV_OPEN_COOKIE` |
| Badges nur an 5 Einträgen, Summe am zugeklappten Kopf | 🟡 Summe an Gruppen ja, aber auch Versand/Paletten | – |
| Rollen-Sichtbarkeit, leere Gruppen ausblenden | ✅ | `visibleNav` |
| Einstellungen in Tabs/Sprungleiste | ❌ eine lange Seite + 4 Knöpfe oben | `einstellungen/page.tsx` |
| `/rechnungsstation/pruefen` ohne Seitenleiste | ❌ lag im Vollbild-Layout | `(station)` |
| Benutzerkonten bereinigen | – Daten im Live-System, kein Code | – |

**Nachher:**

| Punkt | Stand | Fundstelle |
|---|---|---|
| Struktur | ✅ Heute · Einkauf & Deals (› Lieferanten) · Amazon (› Fälle & Erstattungen, › Angebote & Lager) · eBay & Temu · Lager & Versand (› Lager, › Versand, › Retouren) · Finanzen (› Rechnungen) · B2B · Marken & Content · Team & Verwaltung (Delegation + Wissen & Calls + Rechtsfälle) · Privat · Einstellungen (ein Eintrag). 82 Einträge, 35 davon in Untergruppen, direkt höchstens 47; Bezeichnungen laut Auftrag („Tagesplan (Anrufe)“, „Uploads“, „Scanner“, „Deal-Ampel“, „Feeds“ …). Keine Route entfernt oder umbenannt | `NAV` in `src/lib/nav.ts` |
| Seiten ohne eigenen Eintrag | ✅ eBay-Artikel/Verlauf/Rechnungen/Einstellungen (Symbol-Reiter auf `/ebay`), Temu-Rechner (auf Temu / Wawi), Alle Aufgaben, Anrufe, Anbindungen und alle Einstellungs-Unterseiten: direkt aufrufbar, in Strg+K mit ihrem Ort („Einstellungen (Reiter)“), beim Aufruf ist die Hauptseite markiert (`/anbindungen` → Einstellungen) | `NEBENSEITEN`, `SUBPAGES["/einstellungen"]` |
| Akkordeon | ✅ immer nur eine Gruppe offen; Seitenwechsel öffnet Gruppe und Untergruppe des aktiven Eintrags; Untergruppen mehrfach offen; ohne aktive Seite die gemerkte Gruppe, sonst „Heute“; im Privatbereich nur „Privat“ | `startZustand`, `SidebarNav` |
| Fester Kopf | ✅ Favoriten, „Zuletzt besucht“ (eingeklappt, eine Zeile) und Zähler-Chips bleiben oben stehen, nur die Gruppen scrollen | `.nav-kopf` |
| Zähler-Chips | ✅ immer die fünf: Aufgaben · Amazon-ToDos · Posteingang · Belege · Ansprüche (je nach Rechten), auch bei 0, in zwei Zeilen | `ZAEHLER_CHIPS` |
| Favoriten | ✅ max. 8, per Ziehen sortierbar (oder Alt+↑/↓), Reihenfolge beim Benutzer gespeichert. „Zuletzt besucht“: 5 Seiten, nur in diesem Browser, nie Privat | `favoritenSortierenAction`, `ZuletztBesucht` |
| Suche | ✅ Knopf „Seite, ASIN, Aufgabe … (Strg+K)“; Seiten-Treffer mit „Gruppe › Untergruppe“ (z. B. „Amazon › Angebote & Lager“); Treffer im Titel zuerst | `befehls-suche.tsx` |
| Eingeklappter Modus | ✅ nur Gruppen-Symbole (56 px); Zeigen oder Tippen öffnet ein Flyout mit Einträgen und Untergruppen, Esc schließt | `.nav-flyout` |
| Zustand merken | ✅ offene Gruppe, offene Untergruppen und schmaler Modus im Cookie (Server zeichnet ohne Springen) | `zustandAlsCookie` |
| Badges | ✅ Zahlen nur an Tagesübersicht, Posteingang, Amazon-ToDos, Ansprüche, Eingangsrechnungen; zugeklappte Gruppen- und Untergruppen-Köpfe zeigen die Summe | `badgeSumme` |
| Rollen | ✅ unverändert; Gruppen und Untergruppen ohne sichtbare Einträge fallen weg (VA: kein Privat, kein Geld, keine Einstellungen; Finanzen nur mit der Rechnungsstation) | `visibleNav` |
| Einstellungen | ✅ Reiter oben: Allgemein · Anbindungen · KI-Assistent · Geräte: Handy & Tesla · Apple Watch · Benachrichtigungen · Shop-Profile · Abholung · Testumgebung; auf der Hauptseite Sprungleiste (Allgemein · Ansprüche & Retouren · B2B · Preise · Versand & Prep · Postfächer & Rechnungen · Shops · Benutzer), bleibt beim Scrollen oben | `einstellungen/page.tsx` |
| Prüfliste | ✅ `/rechnungsstation/pruefen` jetzt mit Seitenleiste; die Kamera-Station bleibt Vollbild mit „← Seller-System“ | `src/app/(app)/rechnungsstation/pruefen/` |
| Benutzerkonten | To-do 102 (nur im Live-System, nichts automatisch gelöscht) | Einstellungen → Benutzer |

**Verhaltensänderungen / Entscheidungen (bitte bestätigen oder ändern):**
- „Versand“ (offene FBM-Aufträge) und „Paletten-Meldungen“ zählen nicht mehr in der Leiste (Auftrag: Zahlen nur an fünf Einträgen). Die Paletten-Meldungen stehen weiter auf „Paletten-Lager“ und „Sendungen“.
- Favoriten vorbelegen: Es gibt keinen Seitenverlauf im System – laut Auftrag bleibt die Liste leer. „Zuletzt besucht“ sammelt ab jetzt je Browser.
- „Geräte“ als drei Reiter (Handy & Tesla, Apple Watch, Benachrichtigungen) statt einem – so bleibt jede Seite mit einem Klick erreichbar. „Abholung“ (Abholorte) ist ebenfalls Reiter.
- Seitenleiste 8 px breiter (252 px), damit die fünf Chips in zwei Zeilen passen.
- Gemerkter Zustand aus der alten Leiste (mehrere offene Gruppen) gilt einmalig nicht mehr: es öffnet die Gruppe der Seite bzw. „Heute“.

**Abnahme (automatisch, `e2e/navigation.spec.ts`, Unit `tests/nav.test.ts`):**
1. ✅ Alle 82 Menü-Seiten und die 14 Seiten ohne eigenen Eintrag antworten unter ihrem bisherigen Pfad mit 200 (88 verschiedene Seiten aus Abschnitt 5).
2. ✅ Jede alte Seite hat genau einen Eintrag am neuen Ort (Tabelle aus Abschnitt 5 im Unit-Test) oder ist Reiter/Kachel auf ihrer Hauptseite (Abschnitt 6).
3. ✅ Beim Aufruf jeder Seite ist genau ihre Gruppe offen, ggf. die Untergruppe, und der Eintrag markiert.
4. ✅ Alle Gruppen zu: Leiste bei 715 px Fensterhöhe ohne Scrollen (11 Gruppenköpfe + fester Kopf).
5. ✅ Kein Block über 8 Zeilen (Einkauf offen: 8 Einträge + „Lieferanten“ zu).
6. ✅ Strg+K findet jede Seite (82 + 15 ohne Eintrag) und zeigt ihre Gruppe › Untergruppe.
7. ✅ Rollen wie vorher: VA-Rolle ohne Privat, Geld und Einstellungen; Büro ohne Privat/Einstellungen.
Dazu: Akkordeon, Untergruppe gemerkt, fester Kopf beim Scrollen, Chips in ≤ 2 Zeilen, Favoriten (8, Ziehen, Alt+↑), Zuletzt besucht, Flyout über dem Inhalt, Reiter/Sprungleiste der Einstellungen, Prüfliste mit Leiste, Handy-Schublade.

Regression: 174 Ablaufprüfungen, 171 im ersten Lauf grün; nachgeprüft und grün: Keepa-Zähler und Privat-Test (Ausreißer, einzeln grün), „Zuletzt besucht“ (Test wechselte die Seite, bevor sie fertig war – wartet jetzt). 2251 Unit-Tests grün. Menütexte in Anleitungen/Hinweisen auf die neuen Pfade angepasst (z. B. „Team & Verwaltung → VA & Delegation“).

**Werkzeuge:** keine neuen oder geänderten Claude-Werkzeuge.

## Bauauftrag 06.11.: Persönliche Mails im Posteingang · Push mit fertigem Antwortentwurf (+ Abschnitt 5 Postausgang)

**Prüfung (vorher):**

| Punkt | vorher | Fundstelle |
|---|---|---|
| 1. Persönliche Mails erfassen (alle Absender, beide Postfächer) | ❌ IMAP holte nur Marktplätze/DHL (Absender-Filter am Server), unbekannte Absender wurden verworfen; nur Termin-Mails mit Dienst-Stichwort + festem Datum kamen in den Privatkalender | `imapFetchRaw` (`ABSENDER_FILTER`), `ingestMail` |
| Newsletter/Werbung/Systemmails ausschließen | 🟡 nur über die Einstufung (marketing); kein Blick auf List-/Bulk-Kopf, noreply, Abmelde-Link | `classify.ts` |
| „persönlich“ / „persönlich?“, Festlegung je Absender | ❌ | – |
| Nur Privatbereich, VA unsichtbar, Morgenbericht nur Anzahl | ❌ (es gab keine persönlichen Mails) | – |
| 2. Termine: Absage → abgesagt, Verschiebung/Vorschlag mit Bestätigung | 🟡 nur Modul 6 (Praxis/Doctolib mit Datum, automatisch) | `termin-mail-service.ts` |
| 3. Push sofort + Discord-DM, KI-Entwurf (Sie/Du, Unterschrift, Slots), Senden im Thread, Handy-Vollbild | ❌ Entwürfe nur von Claude/von Hand an Geschäftsmails, Senden mit Häkchen; kein Push, keine DM; In-Reply-To ja, References nur eine ID | `draftAction`, `buildRaw` |
| Geschäftliche Mails mit klarer Antwort (Käufer, Lieferant): gleicher Ablauf | ❌ | – |
| 4. Datenschutz (KI ohne Speicherung, nie in Kanäle) | – | – |
| 5. Gesendet-Ordner mitlesen, „beantwortet (extern)“, Aufgabe erledigt, Entwurf verworfen | ❌ Gesendet-Ordner wurde nicht gelesen (nur zum Ablegen eigener Mails) | `smtpSend` |
| Verlauf chronologisch in der Mail-Ansicht | ❌ nur die eine Mail + Entwürfe | `posteingang/[id]` |
| „ausgehend“ + „Nachfassen in n Tagen“ | 🟡 nur für Einkaufsanfragen, die über das System gingen | `detectReplies`, `autoFollowUps` |
| Notizen an Auftrag/Fall, „beantwortet von“ | ❌ | – |

**Nachher:**

| Punkt | Stand | Fundstelle |
|---|---|---|
| Abruf | ✅ IMAP holt alle Absender: erst Kopfzeilen (Message-ID, Absender, List-Unsubscribe/List-Id/Precedence/Auto-Submitted), Bekanntes und Newsletter werden gar nicht geladen; Gesendet-Ordner (Gmail: „Alle Nachrichten“ enthält ihn, sonst „Gesendet“/„Sent“/„Gesendete Elemente“). Gmail-API lädt nur neue IDs. Jede Minute ein schneller Abruf des Posteingangs (persönliche Mails in ≤ 2 Min.), alle 14 Min. der volle Abruf mit Gesendet-Ordner; nie zwei Abrufe desselben Postfachs gleichzeitig | `imapFetchRaw`, `gmailFetchRaw`, `syncSchnell`, `mail_gesehen` |
| Einstufung | ✅ „persönlich“ (Freemail, Personenname, Praxis, Anrede mit eigenem Vornamen/Nachnamen, private Inhalte) / „persönlich?“ (unsicher) / sonst geschäftlich. Nie persönlich: Listen-/Bulk-Kopf, Auto-Submitted, noreply, Abmelde-Link, Marktplätze, Rechtsfälle, Lieferanten, B2B-Kunden, Behörden, Antworten auf eigene Mails, Mails mit eigener Regel, alles was die Einstufung schon als geschäftlich erkennt. Termin-Mails mit festem Datum (Modul 6) laufen wie bisher | `persoenlich-logic.ts`, `persoenlichPruefen`, `ingestMail` |
| Festlegung je Absender | ✅ „persönlich?“ mit Knöpfen Persönlich · Geschäftlich → Posteingang · Ignorieren; gilt dauerhaft (Kontakte, Adresse verschlüsselt) | `mail_kontakte`, `nachrichtEinordnen` |
| Privatbereich | ✅ Privat › Nachrichten (neuer Menüpunkt, Art „nachricht“, verschlüsselt, nur der Inhaber sieht sie – auch nicht die Partnerin/Familie); im Geschäft, bei der VA und im Posteingang nichts. Ohne Inhaber mit Privat-Zugang wird nichts gespeichert | `/privat/nachrichten`, `PERSONAL_KINDS` |
| Morgenbericht / Überblick | ✅ nur „1 persönliche Nachricht wartet“ (Inhaber mit Privat-Zugang); `ueberblick` liefert nur die Anzahl | `morgenText`, `ueberblick` |
| Termine | ✅ Absage mit passendem Termin (Tag + Name) → „ausgefallen“ mit Notiz und „Rückgängig“; Verschiebung → Knopf „Termin verschieben“; neuer Vorschlag/Bestätigung → „In den Privatkalender“; nie gelöscht, nie automatisch verschoben | `terminAktion` |
| Push + DM | ✅ sofort per Web-Push (Art „Persönliche Mail“, nie Discord-Kanal): Absender, ein Satz, „Antwort prüfen“; wahlweise Discord-Direktnachricht über den VA-Bot (Einstellung mit eigener Discord-ID) | `benachrichtigen`, `discordDm` |
| Entwurf | ✅ KI (Anthropic-Anbindung) bzw. Vorlage: Sie/Du aus früherem Schriftverkehr, sonst aus der Mail, sonst Sie (umschaltbar, je Kontakt gemerkt); kurz, freundlich, Unterschrift = Name des Inhabers; Absage → Dank, gute Besserung, neuer Termin (+ 2 freie Slots, wenn eingestellt); Bestätigung kurz; Rückfragen mit [Platzhaltern] | `entwurfErstellen`, `entwurfPrompt` |
| Senden | ✅ nur auf „Senden“ (ein Tipp) über das Postfach, in dem die Mail ankam: In-Reply-To + References, eigene Message-ID, Kopie im Gesendet-Ordner (Anbieter bzw. IMAP-Ablage); danach „beantwortet“, Push-Karte weg (auch auf dem Gerät beim Öffnen) | `nachrichtSenden`, `KartenSchliessen` |
| Handy | ✅ Vollbild-Ansicht, unten fest: Senden · Bearbeiten · Später (Später = Erinnerung nach 3 Std.), „Ohne Antwort erledigt“ | `entwurf-form.tsx`, `.nachricht-leiste` |
| Geschäftlich gleicher Ablauf | ✅ Käuferfrage bzw. Lieferanten-Antwort → Entwurf an der Mail + Push „Antwort vorbereitet“ an alle mit Posteingang; Senden wie bisher mit „Geprüft“ – darf jeder mit Bereich Posteingang (also auch die VA, wenn freigegeben); persönliche nur der Inhaber | `geschaeftsEntwurf` |
| Datenschutz | ✅ Inhalte nur im Privatbereich und an die KI-Anfrage (kein Training über die API; Null-Speicherung nur mit Vertrag, siehe To-do); Discord nur als DM mit einem Satz, nie in Kanäle | – |
| Postausgang | ✅ Gesendete Mail (eigene Absenderadresse) → Zuordnung über In-Reply-To/References, sonst Betreff + Empfänger (30 Tage). Antwort auf Geschäftsmail → „beantwortet (extern, am …) von Postfach + Name“, Aufgabe `mail:<id>` erledigt, offene Entwürfe verworfen, Push-Karten weg, Notiz an Auftrag (Bestellnummer) bzw. Anspruch (Fall-ID). Persönlich → in den Verlauf im Privatbereich, „beantwortet (extern)“ | `ausgangErfassen`, `alsBeantwortet` |
| Verlauf | ✅ Mail-Ansicht zeigt eure Mail davor, die Mail, gesendete Antworten und Antworten darauf chronologisch; Liste „beantwortet“. VA sieht nur geschäftliche Verläufe | `geschaeftsVerlauf`, `posteingang/[id]` |
| Ausgehend + Nachfassen | ✅ Posteingang › Ausgehend: neu angeschriebene Kontakte (B2B-Kunde, Lieferant, Kontakt) mit „Nachfassen in 3 Tagen“ (Standard einstellbar) → ohne Antwort Aufgabe „Nachfassen“; Antwort schließt sie und gilt als wichtig. Persönliche gesendete Mails → Privat › Nachrichten „ausgehend“ mit eigener Nachfass-Erinnerung | `/posteingang/ausgehend`, `nachfassenFaellig` |
| Einstellungen | ✅ Privat › Nachrichten › Einstellungen (an/aus, KI, Slots, Discord-DM + ID); Posteingang › Regeln (Gesendet-Ordner mitlesen, Nachfass-Tage). Das Speichern der Posteingang-Einstellungen überschreibt die übrigen Werte nicht mehr | `persoenlichEinstellungenAction`, `posteingangEinstellungen` |

**Verhaltensänderungen / Entscheidungen (bitte bestätigen oder ändern):**
- Reihenfolge beim Eingang: Deal-Eingang → Postausgang (eigene Absenderadresse) → Rechtsfall → Termin-Mail (Modul 6, automatisch wie bisher) → eigene Regeln/Einstufung → persönlich. Eine Praxis-Mail mit festem Datum („Termin am 10.11. fällt aus“) wird also weiter direkt im Kalender umgesetzt (ohne Entwurf); Mails von Personen bzw. ohne festes Datum („morgen“) bekommen Nachricht + Entwurf. Wer als „persönlich“ festgelegt ist, bekommt immer Nachricht + Entwurf.
- „persönlich?“-Mails waren früher stillschweigend verworfen; jetzt stehen sie in Privat › Nachrichten zum Einordnen (einmal je Absender) – ohne Push und ohne KI-Kosten (Entwurf aus der Vorlage), damit unbekannte Werbe-Absender nicht aufs Handy klingeln. Sie zählen im Morgenbericht mit.
- Vom System selbst verschickte Mails (eBay-Rechnungen, Einkaufsanfragen, Bestellmails, Antworten) merkt sich das System beim Senden; ihre Kopie im Gesendet-Ordner erscheint nicht unter „Ausgehend“. Mails an die eigenen Adressen gelten nie als persönlich.
- Absage mit eindeutigem Termin (gleicher Tag + Name im Titel) wird automatisch als „ausgefallen“ markiert (laut Auftrag), mit „Rückgängig“. Alles andere nur mit Klick.
- Entwürfe zu Käuferfragen und Lieferanten-Antworten entstehen jetzt automatisch (mit Push „Antwort vorbereitet“). Wer das nicht will: Meldeart „Antwort vorbereitet“ unter Benachrichtigungen ausschalten; KI-Entwurf aus → Vorlage.
- „Senden“ im Posteingang nutzt jetzt das Postfach, in dem die Mail ankam (vorher immer das Standardpostfach).
- Outlook: gesendete Mails werden über Betreff + Empfänger zugeordnet (Graph liefert hier kein In-Reply-To).
- „Jetzt abrufen“ ist unverändert; neu: „Fällige jetzt prüfen“ unter Ausgehend.

**Abnahme (automatisch, `e2e/persoenliche-mails.spec.ts`, Unit `tests/persoenlich.test.ts`):**
1. ✅ Private Test-Mail „muss den Termin morgen leider absagen, bin krank“ → sofort Push „Antwort prüfen“ (ohne Discord-Kanal, DM an die eingestellte ID), KI-Entwurf mit „gute Besserung“ und Unterschrift, „Senden“ mit einem Tipp → Antwort mit In-Reply-To der Mail (gleicher Verlauf), Karte erledigt. (Zeit: im Test sofort beim Eingang; live Minuten-Abruf → ≤ 2 Min.)
2. ✅ Termin morgen „Physio Petra Probe“ als „ausgefallen“ markiert, Hinweis mit „Rückgängig“, im Entwurf neuer Termin angeboten.
3. ✅ Newsletter (List-Unsubscribe) und Amazon-Mail laufen wie bisher (Amazon im Posteingang); nichts davon im Privatbereich, kein persönlicher Push.
4. ✅ Büro (mit Posteingang) und Familie sehen die Mail nicht (Posteingang leer, Nachricht nicht aufrufbar); Morgenbericht „1 persönliche Nachricht wartet“, Überblick nur `anzahl` – ohne Namen.
5. ✅ Käuferfrage → Aufgabe + vorbereiteter Entwurf; Antwort aus dem Mailprogramm (Gesendet) → „Beantwortet (extern) … von Ina Inhaber“, Aufgabe erledigt, Entwurf verworfen, Verlauf zeigt die Antwort. (Live: Gesendet-Ordner alle 14 Min. → ≤ 15 Min.)
6. ✅ Neue B2B-Anfrage aus dem Mailprogramm → „Ausgehend“ mit „Nachfassen in 3 Tagen“; fällig → Aufgabe „Nachfassen“; Antwort des Kunden → wichtig, Nachfassen erledigt, Verlauf zeigt eure Mail.
Dazu Handy: Vollbild, Senden · Bearbeiten · Später unten erreichbar, kein Querscrollen, Später speichert den Text.

Regression: 177 Ablaufprüfungen, 174 im ersten Lauf grün. Rot: Keepa (bekannter Ausreißer) und die beiden neuen Tests, weil ein früherer Test einen Lieferanten mit @example.com-Adresse anlegt – die Test-Absenderin galt dadurch zu Recht als „bekannter Lieferant“ (Testadresse geändert). Nachlauf mit neuem Build (persönliche Mails, Posteingang auf null, Fall-Zentrale, Formulare, Push, Recht, Postfach, B2B-Preislisten, Bestellmail, Keepa): 29/29 grün. 2264 Unit-Tests grün.

**Werkzeuge:** keine neuen Claude-Werkzeuge. Geändert: `ueberblick` (Beschreibung + Feld `persoenliche_nachrichten` nur Anzahl, nur Inhaber mit Privat-Zugang) → die Werkzeugliste ändert sich, Claude erhält `notifications/tools/list_changed`.

## Wunsch 06.11.: Einstellungen – eigener Reiter „Hintergrund & Importe“

Anlass: Hintergrund-Abrufe und Importe standen unten auf der langen Seite „Anbindungen“. Gewünscht: eigener Reiter
oben bei Einstellungen, neben Anbindungen und KI-Assistent.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Reiter | ❌ alles unter Anbindungen | ✅ Reiter „Hintergrund & Importe“ direkt nach „KI-Assistent“ (nur Inhaber, über Strg+K findbar) | `SUBPAGES["/einstellungen"]`, `NEBENSEITEN` (`src/lib/nav.ts`) |
| Inhalt | – | ✅ Hintergrund-Abrufe (Jetzt alles abrufen, letzter/nächster Lauf, Discord live), Amazon-Berichte sofort anfordern/abholen, Importe – ArbitrageOne (Jetzt abholen, Läufe, Erneut verarbeiten), BQool-Uploads („hat geklappt“), Sprungleiste | `src/app/(app)/einstellungen/hintergrund/page.tsx`, `src/app/(app)/anbindungen/abrufe.ts` |
| Anbindungen | lang | ✅ nur Zugänge/Verbindungen (eBay, sellerboard, Postfächer, Karten mit Intervall je Abruf, Erweitert) + Hinweis-Kasten mit Link auf den neuen Reiter | `src/app/(app)/anbindungen/page.tsx` |
| Knöpfe | Rücksprung auf /anbindungen | ✅ Rücksprung in den neuen Reiter an die passende Stelle (`#amazon-berichte`, `#importe-arbitrageone`, `#importe-exporte`) | `src/app/(app)/anbindungen/actions.ts` |
| Verweise | „Anbindungen → Importe“ | ✅ „Einstellungen → Hintergrund & Importe“ in Aufgaben-Texten (BQool, sellerboard-Kostenimport), Upload-Erkennung, Repricer-Hinweis, Anbindungs-Hilfe ArbitrageOne | `src/lib/automatik/uebertragen.ts`, `src/lib/uploads/erkennen.ts`, `src/app/(app)/repricer/bqool/page.tsx`, `src/lib/integrations/registry.ts` |

Abnahme: ✅ automatisch (`e2e/navigation.spec.ts`: Reiterreihe, Klick auf „Hintergrund & Importe“, Abruf-Tabelle da,
unter Anbindungen nur der Hinweis); die Abläufe ArbitrageOne, Amazon-Berichte, Discord live, sellerboard-Budget,
BQool-Uploads laufen jetzt gegen den neuen Reiter (`arbitrageone`, `amazon-berichte`, `b21-calls-live`, `b27-automatik`,
`b29-sellerboard-budget`, `b30-ao-bestellungen`, `bqool-dateien`, `bqool-upload-erkennung`, `geschaeft`).

**Werkzeuge:** keine neuen. Geändert: `import_status` (Beschreibung nennt den neuen Ort für „Erneut verarbeiten“) und
`anbindungen_status` (zusätzlich `link_abrufe` auf den neuen Reiter) → Claude erhält `notifications/tools/list_changed`.
Keine To-dos für Ludwig.

## Wunsch 06.11.: „Meldung offen“ bei anderen Kanälen auf einmal schließen

Anlass: Unter Aufträge → „Meldung offen“ ließen sich nur Amazon-Meldungen gesammelt schließen (Versandbestätigung
hochgeladen). Temu, Kleinanzeigen, WhatsApp und von Hand angelegte Aufträge blieben offen und mussten einzeln
erledigt werden.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Sammel-Schließen | ❌ | ✅ Häkchen je Nicht-Amazon-Auftrag (vorausgewählt), „Ausgewählte als erledigt markieren“ mit Rückfrage. Es wird nichts an den Kanal gemeldet, nur hier geschlossen | `meldungenErledigtAction` (`src/app/(app)/auftraege/actions.ts`), `meldungenSchliessen` (`src/lib/orders/bestaetigung.ts`) |
| Einzeln am Auftrag | ❌ nur „Erneut melden“ | ✅ „Im Kanal erledigt – schließen“ (nicht bei Amazon) | `src/app/(app)/auftraege/[id]/page.tsx` |
| Nachvollziehbar | – | ✅ „Meldung von Hand als erledigt markiert am …“ statt „An … gemeldet“ (Spalte `tracking_upload_manuell`, Migration 0131) | `src/db/tables/orders.ts` |
| Amazon | – | bleibt beim Weg über die Versandbestätigungs-Datei, sonst endete die Erinnerung, ohne dass Amazon etwas weiß | – |

Abnahme: ✅ automatisch (`e2e/meldungen-schliessen.spec.ts`): eBay und Kleinanzeigen angehakt und geschlossen,
Temu und Amazon bleiben offen; Amazon ohne Häkchen und ohne Knopf; Temu einzeln auf der Detailseite geschlossen.
Regression: `amazon-todos-versand`, `labels`.

WhatsApp und von Hand angelegte Aufträge (Entscheidung 06.11.: ausblenden): Dort gibt es nie einen Kanal, dem man
etwas melden kann. Sie stehen nicht mehr unter „Meldung offen“, beim Versand entsteht kein Meldefehler mehr
(`OHNE_MELDUNG_KANAELE` in `src/lib/orders/bestaetigung-logic.ts`). Bestehende offene Meldungen dort schließt die
Migration 0132 als „von Hand erledigt“ (nichts gelöscht). Geprüft in `e2e/meldungen-schliessen.spec.ts` und
`tests/meldung-ohne-kanal.test.ts`.

## Nachtrag B31 (07.11.): BQool-Upload aus dem Seller-System, nicht über ArbitrageOne

Befund 07.11.: Der ArbitrageOne-Lauf versuchte täglich den Export „BQool“ und scheiterte (Vergleichswerkzeug, das
erst die BQool-Datei hochgeladen braucht). Die eigene BQool-Datei wurde nie hochgeladen: Der Upload lief bisher nur
auf Knopfdruck (AU-1) – es gab weder einen Zeitplan noch eine Freigabe-Meldung.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B31.1 ArbitrageOne-Schritt „BQool“ | ❌ täglich versucht, Fehler nach 300 s | ✅ aus dem Nachtlauf genommen; Lauf-Ergebnis „BQool: entfällt (Seller-System erzeugt die Datei)“, kein Import, „Verbindung testen“ sucht die Karte nicht mehr | `AO_EXPORTE`, `AO_BQOOL_ENTFAELLT` (`src/lib/arbitrageone/logic.ts`), `aoAbholen` (`abruf.ts`) |
| B31.2.1 Ist holen 06:00 | ❌ nur Datei-Upload von Hand | ✅ je Land DE/FR/IT/ES die Export-Seite (FR/IT/ES aus DE abgeleitet), „Download File → Full Template“ (oder eigener Knopf-Text), Einlesen als Repricing-Datei bzw. „Manage Listings“; Zwei-Faktor → Bildschirmfoto, Aufgabe, Lauf abgebrochen | `src/lib/automatik/bqool-ist.ts`, `istHolen` (`src/lib/bqool/kreislauf.ts`) |
| B31.2.2 Soll erzeugen | 🟡 nur Knopf/Werkzeug | ✅ automatisch nach dem Ist, nur Änderungen, mit Zusammenfassung (je Land, Regelwechsel, Warnungen, Min unter Break-even) | `bqoolExportErzeugen` (`src/lib/bqool/export-service.ts`) |
| B31.2.3 Freigabe | ❌ nur Häkchen auf der Seite | ✅ Push „BQool-Upload freigeben“ (Freigeben / Ansehen) + Aufgabe; Kasten „Täglicher BQool-Lauf“ auf Repricer → BQool-Dateien („Freigeben und hochladen“, „Heute nicht hochladen“); Erinnerung 12:00, Verfall 18:00 (später Lauf: frühestens +2 / +6 Std.); Standard Freigabe nötig, „automatisch“ nur eingeschaltet + Min-Verhalten bestätigt, nie bei Regelwechsel oder Min unter Break-even | `kreislauf.ts`, `kreislauf-logic.ts`, `src/app/(app)/repricer/bqool/kreislauf-karte.tsx` |
| B31.2.4 Upload | 🟡 nur Knopf, ohne Dateityp und Rückmeldung | ✅ nach Freigabe je Land, Dateityp „Repricing Central“ (in der Anbindung änderbar), Rückmeldung übernommen/Fehler, Bildschirmfoto je Schritt; Fehlerzeilen als Aufgabe mit SKU und Fehlertext | `anBqoolUebertragen`, `rueckmeldungLesen`, `dateiHochladen` (`src/lib/automatik/runner.ts`) |
| B31.2.5 Nachkontrolle | ❌ | ✅ 30 Min. nach dem Upload Ist erneut holen, Min/Regel je SKU gegen die Datei; Abweichungen → Aufgabe + Push; Knopf „Nachkontrolle jetzt“ | `nachkontrolleAusfuehren`, `nachkontrolle` |
| B31.3 Soll-Export vorlegen | – | ✅ nach dem Update startet der erste Hintergrund-Takt nach 06:00 den Lauf (oder „Jetzt starten“) und schickt den Push zur Freigabe; hochgeladen wird erst nach Ludwigs Freigabe. Die Zahlen werden mit dem frischen Ist neu gerechnet | `kreislaufTakt` (`src/lib/scheduler.ts`) |
| B31.3 Datei-Min vs. effektiver Min | 🟡 Datei-Min bei Margen-Regeln = Break-even ohne Marge (Annahme „BQool rechnet den Min selbst“), nie geprüft | ✅ Standard jetzt **effektiver Min** (Break-even + Mindestmarge der Altersstufe) als harte Untergrenze – sicher in beiden Fällen; umstellbar auf „Break-even (Sicherheitsnetz)“, falls das Nachsehen in BQool zeigt, dass BQool den Min selbst rechnet; „automatisch hochladen“ geht erst mit Häkchen „Min-Verhalten in BQool geprüft“ | `dateiMin` (`src/lib/bqool/export-logic.ts`), Einstellung `bqool.kreislauf.minInDatei` |
| B31.4 `anbindungen_status` | ❌ | ✅ Abrufe „BQool: Ist holen“, „BQool: Upload“, „BQool: Nachkontrolle“ mit letztem Erfolg; Block `bqool`: Ist je Land, heutiger Lauf mit Freigabe-Status, letzter Upload (übernommen je Land, Fehler, Nachkontrolle) | `src/lib/assistant/tools/geschaeft.ts`, `src/lib/today/abruf-plan.ts` |
| B31.4 `repricer` | Stand = Datum des Datei-Uploads | ✅ `bqool_stand: "heute 06:05"`, Datenstand „BQool-Stand: …“ | `repricer` (`geschaeft.ts`), `standText` |
| B31.4 Morgenbericht | ❌ | ✅ „BQool-Upload gestern: freigegeben 12:10, DE … übernommen, 0 Fehler“ bzw. „BQool-Upload wartet auf Freigabe (…)“ – nur Inhaber | `morgenZeile`, `morgenText` (`src/lib/push/logic.ts`) |

Hinweis zum Standard „effektiver Min“: Bei Margen-Regeln liegt der Datei-Min jetzt höher als bisher (Marge der
Altersstufe statt 0 %). Der erste Lauf zeigt deshalb mehr Änderungen als die Vorschau vom 07.11. – genau das ist die
Absicherung gegen Verkäufe unter Break-even, solange das Min-Verhalten in BQool nicht geprüft ist.

| Abnahme | Ergebnis |
|---|---|
| 1. Nachtlauf ArbitrageOne ohne BQool-Fehler | ✅ automatisch (`e2e/arbitrageone.spec.ts`): Lauf-Zeile „BQool: entfällt (Seller-System erzeugt die Datei)“, kein BQool-Download, kein Import; `b27-automatik` ohne BQool |
| 2. 06:00 Ist aller vier Länder, `repricer` Datenstand heute | ✅ automatisch (`e2e/b31-bqool-kreislauf.spec.ts`, Lauf über „Jetzt starten“ = gleicher Ablauf wie 06:00): DE/FR/IT/ES eingelesen mit Stand heute, `repricer.bqool_stand` „heute …“, `anbindungen_status.bqool` |
| 3. Push mit Zusammenfassung, Freigeben → Datei bei BQool, Rückmeldung, Nachkontrolle bestätigt neue Min | ✅ automatisch gegen den BQool-Nachbau: Push „DE 2 / FR 1 / IT 1 / ES 1 Änderungen, 0 Regelwechsel, …“ mit Freigeben/Ansehen; nach „Freigeben“ 4 Dateien mit Typ „Repricing Central“, Rückmeldung „DE 1 / FR 1 / IT 1 / ES 1 übernommen, 1 Fehler“, Fehlerzeilen-Aufgabe; Nachkontrolle „Min und Regel stimmen bei allen 4 SKUs“; neuer Min DE = effektiver Min und liegt unter der Buy Box. Mit den echten BQool-Seiten nur live (To-dos 107–109) |
| 4. Ohne Freigabe wird nichts hochgeladen | ✅ automatisch: vor der Freigabe kein Upload; verfallener Lauf lädt nichts hoch; „automatisch“ lässt sich erst mit bestätigtem Min-Verhalten einschalten |

Regression: `bqool-dateien`, `bqool-upload-erkennung`, `b24-automatik`, `b27-automatik`, `b30-ao-bestellungen`,
`werkzeuge`, `geschaeft`, `push-handy`; Unit-Tests `tests/bqool-kreislauf.test.ts`, `tests/bqool-export.test.ts`,
`tests/arbitrageone.test.ts`.

**Werkzeuge:** keine neuen Claude-Werkzeuge, keine neuen ändernden. Geändert: `repricer` (Beschreibung + Feld
`bqool_stand`), `anbindungen_status` (Block `bqool`, drei neue Abrufe), `bqool_export_vorschau` (Hinweis folgt der
Einstellung „Min in der Datei“) → Claude erhält `notifications/tools/list_changed`.

### B31.5 (Ergänzung 07.11.): BQool-Berichte „Listing Performance“ und „Daily Sales“

Vorher wurde keiner der beiden Berichte erkannt (Upload landete als unbekanntes Format). Jetzt:

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Erkennung (Kopfzeile, BOM, deutsche Zahlen, „-“ = leer) | ❌ | ✅ `bqool_listing_performance` (Kopf beginnt mit „Products“, dazu „Buy Box Wins“, „Below Min %“ …) und `bqool_daily_sales` („Date“, „Sales (FBA)“, „Buy Box Wins“); auch über Claude (`import_link`, neue Art `bqool_bericht`, Land/Zeitraum im Hinweis) | `berichtArt`, `zahlDe` (`src/lib/bqool/berichte-logic.ts`), `tabellenArt` (`src/lib/uploads/erkennen.ts`) |
| SKU aus „Products“ | ❌ | ✅ eigene SKU-Spalte, sonst aus der Zelle („SKU: …“, bekannte SKU, einzelnes Wort); Zeilen ohne SKU werden gezählt und gemeldet | `produktTeile` |
| Land ableiten | ❌ | ✅ (1) Regelname („Abverkauf DE“ → DE, „Abverkauf“ schließt DE aus), (2) Abgleich mit dem letzten Ist je Land (SKU-Überlappung + gleiche Regel), (3) sonst Rückfrage „Welches Land?“ mit Vorschlag als Knöpfe beim Upload (7 Tage gemerkt). Daily Sales: Umsatz der Tage gegen die Listing-Performance-Summe je Land | `landAusRegeln`, `landVorschlag`, `tagesLand`; `src/app/(app)/uploads/land-rueckfrage.tsx` |
| Zeitraum | ❌ | ✅ Listing Performance: Stichtag = Upload-Tag, Standard 7 Tage, beim Upload änderbar (7/30); Daily Sales: Datum je Zeile (TT.MM.JJJJ, JJJJ-MM-TT, a/b/JJJJ über aufeinanderfolgende Tage entschieden) | `leseDailySales`, Upload-Formular „Angaben für BQool-Berichte“ |
| Speichern je SKU/Land/Zeitraum | ❌ | ✅ Sales, Orders, Units, Est. Profit, Buy Box Wins, Below/At Min, At Max, Avg Offers/Position, Reprice/Price Up/Down/Changes, Buy Box Lost Amazon/FBA/FBM; übrige Spalten bleiben als Zusatz. Doppelte SKU (zwei Regeln) zusammengefasst, Regel der Zeile mit Daten | Tabellen `bqool_leistung`, `bqool_tageswerte`, `bqool_berichte`, `bqool_berichte_offen` (Migration 0137) |
| Reiter „Leistung“ | ❌ | ✅ Repricer hat jetzt Reiter Übersicht / Leistung / BQool-Dateien. Leistung: Stand je Land, Buy-Box-Anteil je Land und Woche, Listen „Steht unter Min, keine Buy Box“ (Below Min ≥ 50 %, Buy Box < 10 % → „Min senken auf effektiven Min“), „Verkauft mit Verlust“ (Min anheben oder Liquidation bestätigen), „Auffällige Preisbewegung“ (\|Price Changes\| > 500 € oder > 200 Erhöhungen bei Below Min 100 % → Aufgabe „BQool-Regel prüfen“ je Land) | `src/app/(app)/repricer/leistung/page.tsx`, `leistungAuswerten`, `SUBPAGES["/repricer"]` |
| Daily Sales auf der Gewinn-Seite | ❌ | ✅ Abschnitt „Zum Vergleich je Tag: laut BQool“ (Umsatz, Bestellungen, Stück, Est. Profit, Buy Box je Tag; daneben sellerboard Amazon); Werkzeug `umsatz` mit Block `bqool` | `src/app/(app)/gewinn/page.tsx`, `umsatz` (`tools/wawi.ts`) |
| Buy-Box-Anteil in `repricer` und Morgenbericht | ❌ | ✅ `repricer.buybox_anteil` (je Land und Woche); Morgenbericht-Zeile „Buy Box DE … %, FR … %, IT … %, ES … %“ (nur Inhaber, Berichte höchstens 8 Tage alt) | `buyboxUebersicht`, `buyboxMorgenZeile`, `morgenText` |
| Verlust-Stopp zweite Quelle | ❌ nur sellerboard | ✅ Abschnitt „Zweite Quelle: BQool (Est. Profit)“ mit „auch oben“-Kennzeichen; je sellerboard-Fall `bqool_est_profit`; Werkzeug `verlust_stopp` mit `bqool_zweite_quelle` | `bqoolVerlustQuelle`, `verlustStopp` |
| Automatik | ❌ | ✅ Täglicher Lauf (Schritt 1) lädt je Land „Listing Performance“ mit „Last 7 days“ und „Daily Sales“, sobald unter Anbindungen → BQool die Berichtsseiten DE eingetragen sind (FR/IT/ES abgeleitet); Land kennt der Lauf, keine Rückfrage; Abruf „BQool: Berichte“ | `berichtHerunterladen` (`src/lib/automatik/bqool-ist.ts`), `berichteEinlesen` (`kreislauf.ts`) |

| Abnahme | Ergebnis |
|---|---|
| 5. Fünf Dateien per Drag-and-Drop → Typ und Land erkannt, Reiter „Leistung“ mit drei Listen, Buy-Box-Anteil je Land stimmt | ✅ automatisch mit erfundenen Dateien gleichen Formats (`e2e/b31-5-bqool-berichte.spec.ts`): 4 × Listing Performance (DE über Regelname, FR/IT/ES über SKU-Abgleich), Daily Sales DE über die Umsatzsumme; Buy Box je Land wie in den Dateien; drei Listen mit Vorschlag, Aufgabe „BQool-Regel prüfen“; Gewinn-Spalte, Verlust-Stopp, Claude (`repricer`, `umsatz`, `verlust_stopp`); unbekannte SKUs → „Welches Land?“ → Knopf FR. Mit den echten Dateien vom 07.11. nur live (To-do 111) |
| Automatik | ✅ automatisch gegen den BQool-Nachbau: „Last 7 days“ je Land gewählt, 4 × Listing Performance + 4 × Daily Sales ohne Rückfrage eingelesen, Abruf „BQool: Berichte“ |

Annahme (die echten Dateien lagen für den Bau nicht vor): Die Spalte „Products“ enthält die SKU (eigene Spalte, „SKU: …“ oder als Wort neben Titel/ASIN). Findet der Upload keine SKU, nennt er die
Zahl der Zeilen ohne SKU und die Spalten – dann bitte eine Datei-Zeile (ohne Preise) zeigen. Buy-Box-Anteil je Land
= Summenzeile der Datei, sonst Mittel der SKUs.

**Werkzeuge B31.5:** keine neuen. Geändert: `repricer` (Feld `buybox_anteil`, Beschreibung), `umsatz` (Block
`bqool`, Beschreibung), `verlust_stopp` (`bqool_zweite_quelle`, Beschreibung), `import_link` (neue Art
`bqool_bericht`), `anbindungen_status` (Abruf „BQool: Berichte“) → `notifications/tools/list_changed`.


### B31.6 (Ergänzung 08.11.): Min unter Mindestmarge nur mit Regel „Liquidation“

Befund 08.11.: Ein Min unter dem effektiven Min der Regel (Marge unter 10 % bei ia, 7 % bei „Abverkauf DE“, 4 % bei
„Abverkauf“) setzt BQool bei der nächsten Preisberechnung auf den Margen-Wert zurück; nur „Liquidation“ nimmt den
hochgeladenen Min als feste Untergrenze. Vorher konnte die Datei einen solchen Min ohne Regelwechsel enthalten
(Einstellung „Break-even als Sicherheitsnetz“ aus B31.3, Untergrenze von Hand unter dem effektiven Min).

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Regel 1: gewünschter Min ≥ effektiver Min | ✅ Min = effektiver Min (Standard) | ✅ Regel bleibt, gewünschter Min als Sicherheitsnetz (ohne Wunsch: effektiver Min) | `minEntscheidung` (`src/lib/bqool/export-logic.ts`) |
| Regel 2: gewünschter Min < effektiver Min → „Liquidation“ + fester Min | ❌ Min wanderte ohne Regelwechsel in die Datei (bzw. Einstellung „Sicherheitsnetz“) | ✅ Rule Name „Liquidation“ (Name aus dem Katalog), Min fest; die Datei enthält nie einen Min unter dem effektiven Min ohne Regelwechsel. Einstellung „Break-even (Sicherheitsnetz)“ entfernt (Erklärung im Kasten „Täglicher BQool-Lauf“) | `minEntscheidung`, `bqoolVorschau`/`bqoolExportErzeugen` (`export-service.ts`), `kreislauf-karte.tsx` (`bq-min-regel`) |
| Regel 3: Rückkehr, „Regel vor Liquidation“ merken | ❌ | ✅ Tabelle `bqool_liquidationen` (Regel vorher, Min gewünscht/gesetzt, effektiver Min vorher, Break-even, Status vorgeschlagen → aktiv → zurück vorgeschlagen → beendet). Täglich (BQool-Lauf und einmal täglich im Hintergrund): Buy Box (BQool-Ist, sonst Keepa) über effektivem Min der ursprünglichen Regel + 3 % zählt Tage am Stück; nach 14 Tagen Vorschlag + Aufgabe „zurück von Liquidation …?“, Freigabe per Knopf „zurück auf ia“ (oder „bleibt“) | `rueckkehrStand`, `liquidationenPflegen`, `rueckkehrFreigeben`/`rueckkehrAblehnen` (`src/lib/bqool/liquidation.ts`), Migration 0139 |
| Untergrenze Break-even, „Mindest-Verlust akzeptiert bis x €“ | ❌ | ✅ Liquidation-Min nie unter Break-even (EK + FBA + Provision, ohne Mindestgewinn); gewünschter Min darunter wird angehoben (Warnung). Mit „Verlust akzeptiert bis x € je Stück“ (Freigabe-Seite) bis Break-even − x. Freigabe-Liste „Min unter Break-even“ mit Eingabe; zählt als „Min unter Break-even“ → kein automatischer Upload | `minEntscheidung`, `verlustFreigabeSetzen`, `verlustFreigabeAction` |
| Verlust-Stopp | 🟡 Liquidation-Ausnahme nur von Hand | ✅ Sobald das BQool-Ist Liquidation mit dem gesetzten Min zeigt: Ausnahme automatisch übernommen („BQool-Liquidation DE (Min unter Marge, vorher „ia“) seit … – nur bis Break-even“ bzw. „Verlust bis x € je Stück freigegeben“). Neuer Fall nur, wenn der Verlust je Stück den Rahmen (+ 0,50 €) übersteigt; bei Rückkehr wird die Ausnahme entfernt | `liquidationIstAbgleich`, `verlustStopp` (`src/lib/money/verlust-service.ts`) |
| Repricer „Regel seit“ + Filter | ❌ | ✅ Spalte „Regel seit“ (Datum des ersten Ist mit dieser Regel), Filter „Liquidation: wegen Min unter Marge“, Kennzeichen „wegen Min unter Marge (vorher ia)“; für diese SKUs kein Hinweis „Min unter System-Min“ und kein Ist≠Soll-Fall im Abgleich | `src/app/(app)/repricer/page.tsx`, `bqoolAnsicht` (`service.ts`), `abgleich` |
| Kapital-Ampel / Morgenbericht | ❌ | ✅ Zeile „n SKUs auf Liquidation (Min unter Marge), davon m unter Break-even“ (Kapital-Ampel mit Link, Morgenbericht nur Inhaber) | `liquidationsZeile`, `src/app/(app)/kapital/page.tsx`, `morgenText` |
| Freigabe-Seite: Regelwechsel getrennt | ❌ | ✅ Abschnitt „Liquidation wegen Min unter Marge“ auf Repricer → BQool-Dateien: SKU, alte Regel → Liquidation, Min alt → neu (gewünscht), Marge neu, Break-even, Buy Box, Status; Push-/Freigabe-Text „(davon n auf Liquidation wegen Min unter Marge)“; Hinweis „Liquidation ist AI Win Sales Booster: der Preis kann bis zum Min fallen“ | `src/app/(app)/repricer/bqool/page.tsx` (`bq-liquidation`), `freigabeText` |
| Test vor dem ersten automatischen Upload | ❌ | ✅ Bis der Test bestanden ist, kommen Regelwechsel auf Liquidation nicht in die Datei (auch nicht im täglichen Lauf). „Test-Export nur für diese SKU“ erzeugt eine Datei mit genau einer SKU (Liquidation + fester Min). Zeigt ein BQool-Ist mindestens 12 Std. nach dem ersten Treffer Liquidation und Min noch, gilt der Test als bestanden; sonst von Hand „In BQool nachgesehen – Test bestanden“ | `liquidationStehtNoch`, `liquidationTestExportAction`, Einstellung `bqool.liquidationTest` |

| Abnahme | Ergebnis |
|---|---|
| 6. Export mit Min unter effektivem Min enthält Rule Name „Liquidation“ und den festen Min; nach dem BQool-Lauf bleibt der Min stehen | ✅ automatisch (`e2e/b31-6-liquidation.spec.ts`, erfundene SKU): Wunsch weit unter Break-even → Min auf Break-even angehoben; Wunsch zwischen Break-even und effektivem Min → Freigabe-Liste „ia → Liquidation“, „wartet auf Test“; voller Export ohne die SKU; Test-Export mit genau einer Zeile `Liquidation` + fester Min; BQool-Ist mit Liquidation → aktiv + Verlust-Stopp-Ausnahme; zweites Ist 13 Std. später → Test bestanden, `repricer` zeigt Liquidation mit dem Min und „regel_seit“; danach voller Export mit Liquidation. Mit dem echten BQool nur live (To-do 115) |
| 7. Buy Box 14 Tage über effektivem Min + 3 % → Vorschlag „zurück auf ia“ | ✅ automatisch: nach 13 Tagen kein Vorschlag, nach 14 Tagen Status „zurück vorgeschlagen“, Aufgabe, Knopf „zurück auf ia“, `bqool_export_vorschau.liquidation.rueckkehr_vorgeschlagen`; nach Freigabe Soll wieder ia mit effektivem Min, Liquidation beendet, Ausnahme entfernt |

Unit-Tests: `tests/b31-6-liquidation.test.ts` (Min-Entscheidung, Break-even-Untergrenze und Verlust-Rahmen, Marge beim
neuen Min, Rückkehr-Zähler, Test-Erkennung, Texte). Regression: `bqool-dateien`, `b31-bqool-kreislauf`,
`b31-5-bqool-berichte`, `bqool-upload-erkennung`, `teil2` (Kapital-Ampel, Verlust-Stopp), `werkzeuge`, `push-handy`, `geschaeft`, `kennzahlen` – 39 Tests grün; Unit-Tests gesamt 2314 grün.

**Werkzeuge B31.6:** keine neuen, keine neuen ändernden. Geändert: `bqool_export_vorschau` (Beschreibung, Block
`liquidation`: Test, Regelwechsel mit Min alt/neu, Marge neu, Break-even, aktive, unter Break-even, Rückkehr-Vorschläge;
Hinweis) und `repricer` (Beschreibung, Felder `regel_seit`, `liquidation_wegen_min_unter_marge`) →
`notifications/tools/list_changed`.

### B31.6a/b, B31.7, B31.8 (Ergänzung 08.11.): „Liquidation bis“, Regel-Leiter, Zustand, Schnelldreher

Prüfung vorher (Stand vor diesem Nachtrag): Liquidation hatte kein Enddatum, die Rückkehr ging auf die „ursprüngliche
Regel“, einen Zustand der Ware und ein Schnelldreher-Kennzeichen gab es nicht (alles ❌). Hinweis zu B31.6 umgesetzt:
Regelwechsel auf Liquidation nur, wenn die Buy Box unter dem effektiven Min der aktuellen Regel liegt – sonst genügt die
Min-Korrektur (Warnung „kein Regelwechsel, die Buy Box … liegt darüber“), ohne bekannte Buy Box kein Wechsel.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B31.6 Hinweis: Wechsel nur bei Buy Box unter effektivem Min | ❌ | ✅ sonst Min = effektiver Min, `keinWechsel` mit Grund; laufende Liquidation bleibt bis „Liquidation bis“ stehen (auch wenn die Buy Box steigt) | `minEntscheidung` (`buybox`, `laeuft`) in `src/lib/bqool/export-logic.ts` |
| B31.6a „Liquidation bis“ (45 Tage, global/fester Termin) | ❌ | ✅ Datum beim Aktivieren (BQool-Ist zeigt Liquidation + Min), Standard 45 Tage oder fester Termin (Einstellungen → Repricer → Leiter); Migration setzt laufenden Liquidationen Start + 45 Tage | `liquidationBis`, `liquidationIstAbgleich`, Migration 0140 |
| B31.6a frühere Rückkehr (a) Bestand 0, (b) Lageralter-Stufe gewandert, (c) 14 Tage | 🟡 nur (c) | ✅ alle drei; (b) bei Min-unter-Marge nur, wenn der effektive Min der alten Regel unter dem Wert beim Wechsel liegt; bei Liquidationen der Leiter gilt B31.6b „Stufe 2 ≤ Buy Box“ | `fruehereRueckkehr` (`leiter-logic.ts`), `liquidationenPflegen` (`liquidation.ts`) |
| B31.6a Ablauf: 7 Tage vorher Push/Aufgabe mit drei Knöpfen, ohne Antwort weiter | ❌ | ✅ Push + Aufgabe „Liquidation läuft ab“, Knöpfe „+30 T“ / „zurück“ / „dauerhaft“ (Repricer → BQool-Dateien → Liquidation); abgelaufen ohne Rückkehr-Bedingung → +30 Tage, Morgenbericht „Liquidation um 30 Tage verlängert“; offene Rückkehr nach Ablauf → „Liquidation überfällig“ | `ablaufEntscheiden`, `ablaufAction`, `leiterMorgenZeilen` |
| B31.6a Anzeige: Spalte „Liquidation bis“ + Restdauer, Filter „läuft in 7 Tagen ab“ | ❌ | ✅ Repricer-Liste (`bqool-liq-bis`) und Liquidations-Tabelle (`bq-liq-bis`), Filter „Liquidation läuft in 7 Tagen ab“ | `src/app/(app)/repricer/page.tsx`, `repricer/bqool/page.tsx` |
| B31.6b Stufen 1–3, Wechsel 1→2, 2→3, 2→1 (Vorschlag mit Freigabe) | ❌ | ✅ täglicher Lauf nach dem BQool-Ist: 1→2 (Reichweite > 90, Lagerdauer > 60 mit Kapital > 300 €, Hebel Ladenhüter, effektiver Min 7 Tage über Buy Box + Quote < 10 %), 2→3 (Stufe 2 seit 7 Tagen über Buy Box und Kapital > 300 € oder Lagerdauer > 90; Min = max(Break-even, Buy Box − 1 %) ≤ effektiver Min Stufe 2), zurück nur auf Stufe 2, auf Stufe 1 nur bei Lageralter 0–30 | `leiterPruefen`, `rueckkehrZiel`, `liquidationsMin` (`leiter-logic.ts`), `leiterPflegen`/`vorschlagEntscheiden` (`leiter.ts`), Tabelle `bqool_vorschlaege` |
| B31.6b Reihenfolge wählbar, Schwellen änderbar | ❌ | ✅ Einstellungen → Repricer → Leiter (Reihenfolge ia → Abverkauf → Liquidation oder Liquidation als Brücke; alle Schwellen) | `leiterEinstellungenAction`, `LEITER_STANDARD` |
| B31.6b Anzeige: Spalte Stufe (+ seit), Freigabe je Stufenwechsel, Morgenbericht „Stufe 2: n, Stufe 3: m, davon k unter Break-even“ | ❌ | ✅ Spalte „Stufe“ (Regel seit steht daneben), Abschnitt „Regel-Leiter“ mit einer Zeile je Wechsel, Morgenbericht und Kapital-Ampel | `bq-leiter`, `bqool-stufe`, `stufenZeile`, `kapital-stufen` |
| B31.7a Zustand erkennen (SKU-Muster, ArbitrageOne, Amazon, Retouren-Station, sonst unbekannt) | ❌ | 🟡 Reihenfolge Hand → RET_/LPN → Amazon-Bestand (Zustandsfeld) → Retouren-Station-Befund → Einkauf (neu) → unbekannt; ArbitrageOne-Zustand wird noch nicht gelesen (die bisherigen Parser kennen kein Zustandsfeld; Eingang in `zustandBestimmen` vorbereitet – Beispieldatei mit Zustandsspalte nötig, To-do 125); unbekannt = nicht in der Datei + Aufgabe „Zustand prüfen“ | `zustandBestimmen` (`leiter-logic.ts`), `bqoolVorschau`, Tabelle `artikel_zustand` |
| B31.7a Zustand von Hand (Mehrfachauswahl) | ❌ | ✅ Repricer-Liste: Häkchen + „Zustand setzen“ (auch „automatisch erkennen“) | `zustandAction`, `bqool-zustand-setzen` |
| B31.7b Zielpreis, Min gebraucht, Max, Verlust-Entscheidung | ❌ | ✅ Keepa-Gebrauchtpreis je Grad, sonst Neupreis × Faktor (ArbitrageOne-Abschläge 1,00/0,90/0,88/0,86/0,84/0,80, änderbar); Min gebraucht = Break-even + 3 % (0–5 % einstellbar); Max = Zielpreis × 1,10; Zielpreis unter Break-even → Warnung „Verlust – Entscheidung“ | `zielpreisGebraucht`, `bqoolVorschau` |
| B31.7c BQool: eigener Min/Max, Regel Abverkauf, Liquidation nach 14 Tagen Stillstand, pausiert → aktivieren | ❌ | ✅ gebrauchte SKUs nie mit ia, Vorschlag Liquidation nach 14 Tagen Stillstand, Vorschlag „pausiertes Angebot aktivieren“ (nach Freigabe Enable = 1 in der Datei); Used-Buy-Box-Test in BQool: To-do 120 | `leiterPruefen`, `leiterPflegen` |
| B31.7d Anzeige, Filter, Morgenbericht, Hebel, eBay | ❌ | ✅ Spalte „Zustand“ mit Zielpreis/Min gebraucht, Filter „Gebraucht ohne eigenen Preis“, Morgenbericht „n gebrauchte SKUs werden mit Neupreis-Min geführt“, Hebel „Gebrauchte mit Lagerdauer > 30 Tage“, Vorschlag „auf eBay verkaufen?“ mit Netto-Vergleich | `bqool-zustand`, `gebrauchtAltHebel` (`hebel/rules.ts`), `ebayVergleich` |
| B31.8a Kennzeichen Schnelldreher (Kriterien, von Hand) | ❌ | ✅ Vorschlag bei ≥ 15 Verkäufen/30 T oder Reichweite ≤ 45, Lageralter ≤ 60, Buy-Box-Quote > 30 %; von Hand per Mehrfachauswahl an/aus | `schnelldreherKandidat`, `schnelldreherAction`, Tabelle `bqool_sku_pflege` |
| B31.8b Boden 7 %, Sperre 1→2/2→3, Morgenbericht, BQool-Regel | ❌ | ✅ Min mindestens Break-even + 7 % (nie unter dem effektiven Min der Regel), keine Leiter- und keine Liquidations-Vorschläge, Morgenbericht „Schnelldreher unter Min: n SKUs, Buy Box seit x Tagen darunter“; eigene BQool-Regel „Schnelldreher“ nur, wenn ihr Name unter Leiter eingetragen ist (To-do 119) | `minEntscheidung` (`boden`), `leiterPruefen`, `leiterMorgenZeilen` |
| B31.8c Ende der Sperre (21 Tage ohne Buy Box, < 5 Verkäufe, alt + langsam) | ❌ | ✅ Vorschlag mit drei Knöpfen „Schutz +14 T“ / „Abverkauf zulassen“ / „Min manuell“ + Aufgabe | `schnelldreherEnde`, `vorschlagEntscheiden` |
| B31.8d Spalte/Marke mit „bis“, Filter | ❌ | ✅ „⚡ Schnelldreher bis …“ in der Spalte Stufe, Filter „Schnelldreher“ | `bqool-schnell` |

| Abnahme | Ergebnis |
|---|---|
| B31.6 (geändert): Liquidation nur bei Buy Box unter effektivem Min | ✅ automatisch (`e2e/b31-6-liquidation.spec.ts`): Buy Box darüber → kein Regelwechsel, Warnung; Buy Box darunter → Liquidation wie bisher; laufende Liquidation bleibt, wenn die Buy Box steigt; Rückkehr mit Lageralter 0–30 auf ia |
| B31.6a/b | ✅ automatisch (`e2e/b31-6ab-7-8-b32.spec.ts`, erfundene SKUs): Vorschlag 1 → 2 „keine Verkäufe“, Freigabe → Soll „Abverkauf DE“ (Quelle Regel-Leiter); 2 → 3 mit Min = max(Break-even, Buy Box − 1 %) unter dem effektiven Min der Stufe 2, wartet auf den Liquidation-Test; Liquidation 5 Tage vor Ablauf → Aufgabe mit drei Knöpfen, „+30 T“, abgelaufen → +30 Tage automatisch (Morgenbericht-Zähler), „dauerhaft“; Repricer Spalten Stufe/Liquidation bis und Filter „läuft in 7 Tagen ab“ |
| B31.7 Abnahme 1–4 | ✅ automatisch: RET_-SKU (erfunden) → gebraucht, Zielpreis = Neupreis × 0,84, Min gebraucht in der Export-Vorschau statt Neupreis-Min, Regel Abverkauf; SKU ohne Zustandsinfo → unbekannt, nicht in der Datei, Aufgabe „Zustand prüfen“; Zustand von Hand „akzeptabel“ → Zielpreis × 0,80; Vorschlag „aktivieren“ für die pausierte Retoure. Mit echten SKUs nur live |
| B31.8 Abnahme 1–4 | ✅ automatisch: Kennzeichen von Hand, Min = Break-even + 7 % (ia-Stufe 5 %), trotz Ladenhüter-Kriterien und Buy Box unter Min kein Stufenwechsel, Morgenbericht-Zähler; 21 Tage ohne Buy Box → Vorschlag mit drei Knöpfen, „Schutz +14 T“ setzt „bis“ |

Unit-Tests: `tests/b31-6ab-7-8-leiter.test.ts` (Stufen, Wechsel, Liquidation-Min, Rückkehr-Ziel, „Liquidation bis“,
Ablauf, frühere Rückkehr, Zustand aus Texten/Befunden/Reihenfolge, Zielpreis, eBay-Vergleich, Schnelldreher-Kriterien
und Ende, Morgenbericht-Zeilen), `tests/b31-6-liquidation.test.ts` (Buy-Box-Bedingung, laufende Liquidation).

## B32 Listing-Check: regelmäßige Analyse aller Listings (08.11.)

Prüfung vorher: ❌ – es gab keinen regelmäßigen Check; Befunde wie „Min über Buy Box“ oder „pausiert trotz Nachfrage“
fielen nur zufällig auf.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B32.1 neun Befunde je SKU/Marktplatz mit Bestand | ❌ | ✅ 1 Min über Buy Box (und über 30-Tage-Schnitt − 3 %), 2 pausiert trotz Bestand/Nachfrage, 3 Schnelldreher, 4 keine Verkäufe trotz Markt, 5 Max zu niedrig (Buy Box 3 Tage darüber), 6 unter Break-even ohne Liquidation-Freigabe, 7 gebraucht mit Neupreis-Min, 8 Preis über Markt, 9 Ladenhüter – je mit Vorschlag und Euro-Potenzial (fehlende Verkäufe × Marge); Schnelldreher (auch Kandidaten): Ziel-Min Break-even + 7 % | `befundePruefen` (`src/lib/bqool/listing-check-logic.ts`) |
| B32.1 Schwellen änderbar | ❌ | ✅ Einstellungen → Listing-Check (auf der Seite, nur Inhaber; leer = Standard) | `schwellenMitStandard`, `schwellenAction` |
| B32.2 Stufen A/B/C, Budget, „Check unvollständig“ | ❌ | ✅ A täglich: 150 wertvollste (Kapital × Nachfrage) + Schnelldreher + offene Befunde; B wöchentlich; C monatlich ohne Bestand (nur Befund 1/6); Keepa nur für A, 24 Std. Zwischenspeicher, höchstens 60 Abrufe je Lauf, Reserve 20 Tokens; sonst „Check unvollständig“ (Seite + Morgenbericht); Dauer und Abdeckung gespeichert | `listingCheck` (`src/lib/bqool/listing-check.ts`), `stufeA`, `stufeFuer` |
| B32.2 Zeitplan nach dem BQool-Ist 06:00 | ❌ | ✅ im täglichen BQool-Lauf nach der Liquidations-/Leiter-Pflege, sonst einmal täglich im Hintergrund („BQool: Listing-Check“) und auf Knopfdruck | `kreislauf.ts`, `scheduler.ts` |
| B32.3 Seite „Listing-Check“ mit Freigeben/Ablehnen/Später | ❌ | ✅ Repricer → Listing-Check: Tabelle nach Potenzial, Filter je Befund, Knöpfe; Freigabe wirkt nur über die nächste BQool-Datei (Min als Soll, Aktivieren, Max, Schnelldreher, Stufe 2) | `src/app/(app)/repricer/listing-check/`, `befundEntscheiden` |
| B32.3 Morgenbericht, Push nur bei 1/2 an Schnelldrehern oder Kapital > 1.000 € | ❌ | ✅ Zeile „Listing-Check: n neue Befunde (m offen) – größte 5 mit ASIN, Befund, Potenzial“; Push nur in diesen Fällen | `checkMorgenZeile`, `pushNoetig` |
| B32.4 Preisband, Befund „Verkaufspreis dauerhaft unter Min“, Trefferquote | ❌ | 🟡 Preisband aus BQool Listing Performance (Umsatz/Stück je Bericht, 14 Tage), Befund 10 ab 3 Verkäufen; Trefferquote der Freigaben nach 14 Tagen auf der Seite und im Werkzeug. Einzelverkäufe je Tag (Daily Sales/sellerboard) fließen noch nicht ins Preisband; Anzeige in der Lernschleife B28.8 fehlt noch | `median`, `checkTrefferquote` |
| B32.5 Grenzen | – | ✅ nichts ohne Freigabe, Keepa-Zahlen als Marktdaten gekennzeichnet, sellerboard-Verzug auf der Seite genannt | Seite, Werkzeug `listing_check` |

| Abnahme | Ergebnis |
|---|---|
| 1. Lauf mit BQool-Stand von heute: Befund 1 und 2 (und Schnelldreher-Kandidat) | ✅ automatisch mit erfundener SKU (Min 80 über Buy Box 40, pausiert, Keepa-Nachfrage); Kandidat per Unit-Test (Kriterien brauchen eigene Verkäufe). Mit der echten SKU nur live |
| 2. Vorschlag Min (bei Schnelldreher Break-even + 7 %), nach Freigabe im nächsten Upload | ✅ automatisch: Freigabe → Export-Vorschau zeigt den neuen Min, „aktivieren“ für die pausierte SKU; Schnelldreher-Ziel per Unit-Test |
| 3. Stufe A im Budget, bei Token-Mangel „Check unvollständig“ | ✅ automatisch (Abrufe ≤ 60, Hinweis auf der Seite) |
| 4. Verkauf erscheint am Folgetag im Preisband | 🟡 nur live – Preisband kommt aus dem BQool-Bericht Listing Performance |
| 5. Morgenbericht enthält die Zeile „Listing-Check“ | ✅ automatisch (Morgenbericht über „jetzt ausliefern“) |

Unit-Tests: `tests/b32-listing-check.test.ts` (Befunde 1–10, Schwellen, Stufen, Median, Push, Morgenbericht-Zeile).

**Werkzeuge B31.6a/b, B31.7, B31.8, B32:** ein neues Lesewerkzeug `listing_check` (offene Befunde nach Potenzial,
Stand/Abdeckung, Trefferquote; Freigaben nur auf der Seite). Geändert: `bqool_export_vorschau` (Block `leiter`, je Zeile
`stufe`, `zustand`, `zielpreis_gebraucht`, `min_gebraucht`, `schnelldreher`, `schnelldreher_boden`, `break_even`) und
`repricer` (`stufe`, `liquidation_bis`, `schnelldreher`) → `notifications/tools/list_changed`. Keine neuen ändernden
Werkzeuge.

## Bauauftrag Druckagent im Lager (08.11.): Etikettendruck aus dem Seller-System · Scanner-Arbeitsplatz

Prüfung vorher: ❌ – Etiketten nur über den Browser-Druck (Etiketten-Seite, Lieferschein → Labels, Label aus Chat);
kein Agent am Arbeits-PC, keine Warteschlange, kein Druckerstatus, kein Scanner-Arbeitsplatz.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Agent „lugru-druckagent“: Windows-Dienst (Start vor der Anmeldung, Neustart bei Absturz), Ausweich-Mini-PC mit Linux | ❌ | ✅ ein Programm ohne Abhängigkeiten (Node ≥ 18); WinSW-Dienst „Automatisch“ + Neustart nach 10/20/60 s; Installationsskript (Node per winget, Token-Abfrage, Energiesparen aus, Update-Nutzungszeit 06–23 Uhr); Linux: systemd-Dienst oder Docker; Paket als ZIP unter Einstellungen → Drucker; sauberes Beenden beim Dienst-Stopp | `druckagent/`, `agentPaket` (`src/lib/druck/dateien.ts`) |
| Gerätetoken: „Agent anlegen“, einmal angezeigt, jederzeit widerrufbar, Agent bekommt „abgemeldet“ | ❌ | ✅ nur die Prüfsumme wird gespeichert; widerrufen/Umzug → 401 `abgemeldet`, der Agent fragt dann nur noch alle 10 Min. | `agentAnlegen`, `agentPerToken` (`src/lib/druck/service.ts`), `einstellungen/drucker/` |
| Verbindung nur ausgehend (WebSocket, Ausweich Abfrage alle 10 s) | ❌ | ✅ anders gelöst: langes Abfragen (bis 25 s offen, Auftrag nach ≤ 1,5 s beim Agenten), bei Fehlern alle 10 s neu – nur ausgehendes HTTPS, keine Portfreigabe; Pfad `/api/druckagent/*` in der öffentlichen Freigabe | `auftragAbholen`, `deploy/claude-oeffentlich.sh` |
| Brother-Raster: QL-800 62 × 29 (DK-11209), QL-1100 102 × 152 (DK-11241) und 103 × 164 (DK-11247), weitere Medien | ❌ | ✅ Rasterstrom auf dem Server (Medium, Schnitt je Etikett, gespiegelte Zeilen, Versatz QL-1100), Prüfsumme je Auftrag; 62 mm endlos zusätzlich; weitere Medien in der config.json des Agenten („medien“). 🟡 103 × 164: Werte aus dem Datenblatt, Versatz live prüfen | `src/lib/druck/brother.ts` |
| Status online/offline, Papier leer, Deckel offen, letzte Druckzeit – Symbol neben jedem Druckknopf | ❌ | ✅ Heartbeat alle 30 s mit Gerätename, Betriebssystem, Version, Druckerliste (Zustand, Fehler, Medienbreite, Seriennummer), letztem Windows-Start und letztem Druck; Symbol grün/gelb/rot/grau auf Drucken, PDF drucken, Etiketten, Palettenlabel, Scanner. 🟡 Auf „Label erstellen“ und „Lieferschein → Labels“ gibt es den neuen Knopf „An QL-1100 im Lager“, dort noch ohne Symbol | `druckerSymbol` (`src/lib/druck/logic.ts`), `src/components/drucker-symbol.tsx` |
| Warteschlange 7 Tage (wer, von welcher Seite, Anzahl, Status, „erneut drucken“) | ❌ | ✅ Lager → Drucken: Warteschlange mit Abbrechen und „erneut drucken“, Protokoll 90 Tage; „Wartende prüfen“ (Inhaber) | `src/app/(app)/drucken/` |
| Strom Weg 1: Auto-Aus aus (Anleitung Printer Setting Tool) | ❌ | ✅ Anleitung „PC einrichten“ auf Einstellungen → Drucker | `einstellungen/drucker/page.tsx` |
| Strom Weg 2: Shelly Gen1/Gen2, Auto Power On, bereit in ≤ 20 s, aus nach 10 Min. Leerlauf, Fehlermeldungen nach 30 s | ❌ | ✅ im Agenten: Steckdose vor dem Druck an, warten bis „bereit“, nach 30 s „Drucker startet nicht (Auto Power On aktiv? Deckel zu?)“ bzw. „Shelly nicht erreichbar“ – Auftrag bleibt in der Warteschlange; Leerlaufzeit einstellbar; IPs nur in Einstellungen → Drucker | `bereitMachen`, `leerlaufStarten`, `shellyUrl` |
| Update-Prüfung täglich mit Protokoll | ❌ | ✅ Version + Prüfsumme vom Server, neue Datei nur bei passender Prüfsumme, Dienst startet neu; Protokoll in den Einstellungen | `updatePruefen`, `/api/druckagent/version`, `/download` |
| PC offline → rot „Arbeits-PC nicht erreichbar seit …“, Push wenn ein Auftrag > 15 Min. wartet (Ruhezeiten) | ❌ | ✅ offline nach 90 s ohne Heartbeat; Push-Art „Druckauftrag wartet“ (abschaltbar, Ruhezeiten gelten), je Auftrag einmal; Prüfung alle 2 Min. im Hintergrund | `druckPruefen`, `scheduler.ts` |
| Etiketten als Bild 696 px: FNSKU, EAN, Preis, Stellplatz, Retoure, Lieferschein B2B; 102 mm: DHL/Internetmarke, Palettenlabel; Vorschau; Drucker je Vorlage fest | ❌ | ✅ Druckbilder in 300 dpi mit Barcodes, Vorschau vor dem Drucken; DHL/Internetmarke-PDFs über „PDF drucken“ oder den Knopf „An QL-1100 im Lager“ direkt am Label | `src/lib/druck/etiketten.tsx`, `VORLAGEN`, `src/components/im-lager-drucken.tsx` |
| Seller-Central-PDFs (Drucken → Datei, Drag & Drop, iPhone-Teilen): Kartonlabels 102 × 152 → QL-1100, FNSKU-Bogen 27/40 → einzelne 62-mm-Etiketten → QL-800, Zuordnung zur FBA-Sendung | ❌ | ✅ Erkennung über Seitengröße und Text, Raster wählbar, leere Felder übersprungen, Sendungsnummer FBA… → Sendung verlinkt; vom iPhone über `/api/mobil/drucken` | `src/lib/druck/pdf.ts`, `dateien.ts` |
| Scanner-Arbeitsplatz (Vollbild, Steuer-Barcodes Drucken 1×/5×, Wareneingang, Stellplatz, Retoure, Abbrechen; Ton/Blitz) | ❌ | ✅ Lager → Scannen; Steuerkarte druckbar; Wareneingang bucht eigenes Lager mit Fach und Lagerbewegung; Retoure: LPN → RET-SKU-Etikett | `src/lib/druck/scanner.ts`, `lager/scannen/` |
| Rechte: VA druckt FNSKU, Retouren, DHL – keine Preisetiketten, keine Agent-Einstellungen | ❌ | ✅ VA-Konto = Rollen-Vorlage „VA“; Agent-Einstellungen nur Inhaber; Nur-ansehen ohne Druckknopf | `darfDrucken`, `istVa` |
| Druckprotokoll 90 Tage | ❌ | ✅ Aufträge und PDFs werden nach 90 Tagen gelöscht | `druckPruefen` |
| Überwachter Ordner → Upload, danach „verarbeitet“ | ❌ | ✅ PDFs nach 5 s Ruhe hochladen, zentrale Erkennung (Rechnungen, Belege) im Namen der Person, die den Agenten angelegt hat; danach `verarbeitet\JJJJ-MM-TT_Name.pdf` | `ordnerPruefen`, `/api/druckagent/upload` |

| Abnahme | Ergebnis |
|---|---|
| 0. Windows-Dienst ≤ 2 Min. nach Neustart ohne Anmeldung online; offline → rot, Aufträge warten | 🟡 automatisch: echtes Agent-Programm gegen das Seller-System und einen nachgebauten Drucker – Heartbeat → online/grün, ohne Heartbeat rot „nicht erreichbar seit …“, Auftrag wartet und wird nach der Rückkehr gedruckt. Start vor der Anmeldung nur live am Arbeits-PC |
| 1. iPhone „FNSKU-Etikett 3×“ → nach ≤ 30 s aus dem QL-800 | ✅ automatisch (Agent im Dauerbetrieb, gemessen < 30 s, drei Etiketten im Rasterstrom); echter Drucker live |
| 2. Agent offline → wartet, rot, druckt danach | ✅ automatisch, inklusive Push nach 15 Min. (genau einmal) |
| 3. Seller-Central-PDF Kartonlabels per Drag & Drop → QL-1100 alle Seiten, Sendung zugeordnet | ✅ automatisch (3 Seiten, Sendung verlinkt); FNSKU-Bogen über das iPhone → 4 Etiketten am QL-800 ✅ |
| 4. Scanner: Artikel + „Drucken 5×“ → 5 Etiketten ohne Tastatur | ✅ automatisch (Eingaben wie der Handscanner mit Enter), dazu Wareneingang mit Stellplatz |
| 5. Auto-Aus aus, Druck um 06:00 | 🟡 nur live (Einstellung am Drucker), Anleitung auf der Seite |
| 5b. Shelly: Auftrag → Steckdose an → Druck → nach Leerlauf aus; Fehler | ✅ Unit-Test gegen nachgebaute Shelly (Gen2 an/aus, „Shelly nicht erreichbar“ → Auftrag wartet); „Drucker startet nicht“ nach 30 s nur live |
| 5c. Umzug auf den Mini-PC: neuer Token, alter Agent „deaktiviert“ | ✅ automatisch (alter Agent bekommt „abgemeldet“) |
| 6. „Papier leer“ erscheint im Seller-System | ✅ automatisch (Symbol rot „Papier leer (Etikettenrolle leer)“, Einstellungen); Statusbytes des Druckers per Unit-Test |

Unit-Tests: `tests/druck-logik.test.ts` (Raster, Medien, Rechte, Symbol, Warteschlange, Scanner, PDF-Erkennung),
`tests/druck-agent.test.ts` (Agent gegen nachgebautes Seller-System, Drucker über TCP 9100 und Shelly; Ordner; Stoppen),
`tests/druck-pdf.test.ts` (Kartonlabels, FNSKU-Bogen, Druckbilder). Ablauftest: `e2e/druckagent.spec.ts`, dazu
`e2e/label-aus-chat.spec.ts` (Knopf „An QL-1100 im Lager“).

**Werkzeuge Druckagent:** keine neuen Claude-Werkzeuge – Drucken bleibt im System (kein ändernder Zugriff für Claude),
deshalb kein `notifications/tools/list_changed`.

## B33 BQool-Formel, Regel-Katalog und Min-Verhalten (08.11.)

Prüfung vorher: effektiver Min = Break-even-Formel mit EK netto, Fix- und Zusatzkosten und den **DE-Gebühren für alle
Länder**; Katalog mit einer Staffel je Regel (ia 10/8/7/5/3/1/0, Abverkauf DE 7/5/3/1/0, FR/IT/ES 4/3/2/1/0), ohne
Stufentyp und Bedingung; Min-Korrekturen bei ia/Abverkauf zählten als Änderung und gingen in den Upload; Ist holen über
„Full Template“; Nachkontrolle nur „Min x statt y“ (jede Abweichung = Fehler); Processing Report nicht gelesen.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B33.1 Formel: P(m) = (F + C/(1+v)) / (1/(1+v) − r − m), Marge = Est. Profit / P, C brutto, r vom Brutto-Preis, kaufmännisch gerundet | ❌ | ✅ `bqoolPreisFuerMarge`, `bqoolMarge`; effektiver Min, Schnelldreher-Boden und „Marge neu“ rechnen damit (Break-even bleibt die eigene Kostenrechnung) | `src/lib/bqool/export-logic.ts` |
| B33.1 F je Land, r je Kategorie (nicht pauschal, nicht aus DE) | ❌ | ✅ Quellen: BQool-Liste („Referral Fee“/„FBA Fee“ aus „Download listings“) → Amazon-Gebührenvorschau des Landes (Spalte „amazon-store“) → Produktwert DE als „geschätzt (Gebühren DE)“. Neue Tabelle `bqool_gebuehren`; Preisstufen der Provision je Kategorie (Beauty/Drogerie bis 10 € 8 %, Bekleidung 5/10/15 %) nur, wenn der beobachtete Satz passt. Vorschau zeigt je Zeile „F · r · Quelle“ | `gebuehrenFuerLand`, `provisionFuer`, `gebuehrenAusListing` (`src/lib/bqool/logic.ts`), `parseFees` (`src/lib/reports/amazon.ts`), `src/lib/bqool/gebuehren.ts`, `drizzle/0142_b33_gebuehren.sql` |
| B33.1 Abnahme: 20 Eichzeilen < 0,05 € / 0,1 Pp | ❌ | ✅ 20 Eichzeilen (Anlage im Auftrag, nicht im Repo) – 31 Werte, max. Abweichung 0,02 € bzw. 0,06 Prozentpunkte, auch die Referenz-SKU in IT bei 10 %. Eine IT-Zeile stimmt nur mit der Preisstufe „bis 10 € 8 %“ (Kategorie muss aus der Gebührenvorschau kommen) | Rechnung im Arbeitsverzeichnis, Formel in `tests/b33-bqool-formel.test.ts` |
| B33.2 Min-Reset: ia/Abverkauf überschreiben den Min täglich, Liquidation/mbb nicht; Max bleibt | ❌ | ✅ Katalogfeld „Min-Reset täglich“ (ia/Abverkauf an, Liquidation/mbb aus, je Regel schaltbar); reine Min-Abweichungen bei Reset-Regeln zählen nicht mehr als Änderung (kein wirkungsloser Upload); Hinweis „Min aus Upload blockiert Buy Box“ nur noch ohne Reset; Steuerhebel im Text: Regel, Max, Cost, Aktiv/Pause, bei Liquidation der Min | `setztMinZurueck`, `vergleiche(…, { minZaehlt })`, `export-service.ts` |
| B33.3 Katalog je Land mit Typ (Marge / Lowest Price + x / Sales Maximizer), Marge, Bedingung, Regel-IDs | ❌ | ✅ Stufen je Land laut Tabelle (ia DE/FR/IT/ES, Abverkauf DE/FR/IT/ES), IDs ia 37/39/40/38, Abverkauf 47/48/50/49, Liquidation 43/45/46/44, mbb 33, AI Win Sales Booster 2; Stufen ohne feste Marge → „keine feste Marge (Wettbewerbspreis)“, kein Min, keine Prozentzahl; Tabelle „je Land und Stufe“ auf Repricer → BQool-Dateien, Eingabe je Land („30:10 SB [Available ≥ 1], 90:LP+6 SM, 270:SM …“). Gespeicherter Katalog: Knopf „Stufen je Land übernehmen“ (erst nach Abgleich mit dem Screenshot) | `KATALOG_STANDARD`, `IA_JE_LAND`, `ABVERKAUF_JE_LAND`, `staffelAusText`, `KatalogJeLand` (`repricer/bqool/page.tsx`), `katalogB33Action` |
| B33.4 Frischbestand-Falle im Listing-Check | ❌ | ✅ Befund 11: Stufe 0–30 T, Min (BQool) über Buy Box, 7 Tage kein Verkauf → Hinweis „Regel wechseln (Liquidation mit Min = P(7 %) bzw. Regel „Schnelldreher“); Min-Upload allein wirkt nicht“; Befund 1 nennt bei Reset-Regeln den Regelwechsel. Wer die Regel umgestellt hat, ist aus BQool nicht ablesbar | `befundePruefen` (`listing-check-logic.ts`) |
| B33.5 Schnelldreher Variante 1/2/3 | 🟡 | ✅ V1: Liquidation ohne festen Min → Min = P(7 %), „Liquidation bis“ + Kennzeichen bleiben; V2: Knopf „Regel „Schnelldreher“ in Katalog übernehmen“ (Kopie ia, alle Stufen 7 %, Reset) – Zuordnung über Rule Name; V3: dieselbe Regel „ohne Min-Reset“ (ungeprüft, erst Test-SKU) | `schnelldreherRegel`, `schnellRegelAction`, `minEntscheidung` |
| B33.6 Export = Listen-Seite + „Download“ → „Download listings“ (kein Export-Link, kein Zeitplan) | 🟡 | ✅ Automatik klickt „Download“ → „Download listings“ (Vorrang vor „Full Template“), nur lesen; Anbindung „Listen-Seite DE“ mit Vorgabe `…/repricing/amazonde`, FR/IT/ES abgeleitet; Berichtsseiten mit `locale=DE` → FR/IT/ES abgeleitet | `src/lib/automatik/bqool-ist.ts`, `bqoolAbleiten`, `registry.ts` |
| B33.6 Processing Report der Uploads (07.11. je 1 Fehler) lesen, Fehlerzeile je Land in Hinweisen | ❌ | ✅ täglicher Lauf liest den Upload-Verlauf je Land, öffnet „View Processing Report“ und speichert die Fehlerzeilen; nach jedem Upload mit „n Error“ ohne Zeilen wird der Bericht sofort gelesen; Karte „Upload-Fehler laut BQool“ (+ Knopf „Processing Reports lesen“) und Aufgabe; Zeiten deutsch + BQool-Zeit (UTC+02:00, Feld „Zeitzone“) | `verlaufLesen`, `processingReportZeilen`, `bqoolZeit`, `uploadFehlerSpeichern`, `uploadVerlaufLesen` |
| B33.6 Nachkontrolle: Ist per „Download listings“, je SKU Min vorher / Datei / nachher; ia/Abverkauf → Hinweis, Liquidation → Fehler | 🟡 | ✅ Datei merkt sich „Min vorher“ und „Min-Reset“; Ergebnis mit Tabelle je SKU; bei Reset-Regel „Min wird täglich zurückgesetzt – kein Fehler“ (keine Aufgabe), bei Liquidation „Min hätte stehen bleiben müssen“ (Aufgabe + Push) | `nachkontrolle` (`kreislauf-logic.ts`), `kreislauf-karte.tsx` |
| B33.7 Einstellungen nur zur Kenntnis | – | ✅ nichts geändert; Hinweis im Katalog: Liquidation zählt gegen das AI+CR-Kontingent | `KATALOG_STANDARD` (Liquidation) |

| Abnahme | Ergebnis |
|---|---|
| 1. Effektiver Min der 20 Eich-SKUs ≤ 0,05 € von BQool (inkl. Referenz-SKU IT bei 10 %) | ✅ Formel nachgerechnet (max. 0,02 €); automatisch: FR-Min mit FR-Gebühren aus „Download listings“ (nicht DE), Vorschau und Werkzeug |
| 2. Katalog je Land und Stufe mit Typ, Marge, Bedingung; ohne feste Marge keine Prozentzahl | ✅ automatisch (ia DE/FR, Abverkauf DE/IT) – Zuordnung der Stufen vor Übernahme einmal gegen den Screenshot prüfen |
| 3. Export-Vorschau markiert ia/Abverkauf „Min wird von BQool täglich überschrieben“ | ✅ automatisch (nicht bei Liquidation) |
| 4. Nachkontrolle nach Eintragen der Listen-URL mit „Download listings“, Min vorher/nachher | ✅ automatisch gegen den Nachbau (ia mit Reset → Hinweis, Liquidation → Fehler); echte BQool-Seite live |
| 5. Fehler der Uploads vom 07.11. ausgelesen und sichtbar | ✅ automatisch (Upload-Verlauf mit zwei Berichten, deutsche und BQool-Zeit); echte Berichte vom 07.11. beim nächsten Lauf live |

Unit-Tests: `tests/b33-bqool-formel.test.ts` (Formel, Preisstufen, Gebühren je Land, Katalog, Reset, Frischbestand-Falle,
Schnelldreher, Nachkontrolle, Processing Report, BQool-Zeit), angepasst `tests/bqool-export.test.ts`,
`tests/bqool-kreislauf.test.ts`. Ablauftest: `e2e/b33-bqool-formel.spec.ts`.

**Werkzeuge B33:** keine neuen Werkzeuge; `bqool_export_vorschau` liefert je Zeile `effektiver_min_text`, `stufe_text`,
`min_reset` und `gebuehren` (FBA, Provision, Quelle, geschätzt, Preisstufen); Beschreibung erweitert →
`notifications/tools/list_changed` geht beim Verbinden raus.

## B34 Ideen aus dem Wochen-Call vom 04.11.2026 (Stand 10.11.)

Insider-Wissen nur für Ludwig: nichts davon in Texten nach außen. Preisliste, Brief und Anschreiben enthalten keinen
EK, keinen Break-even und keine internen Gründe (geprüft im Unit- und Ablauftest); der Ankauf-Abschnitt ist nur für
den Inhaber sichtbar. Keine Käufe, Mails oder Briefe automatisch, keine Bots, kein Scrapen, nichts gelöscht ohne
Freigabe.

Prüfung vorher: `scan_pruefen` (EAN + Preis → Ampel, bestes Land, Gewinn, ROI, Menge, Bestand) und eine einfache
`/scan`-Seite (B13) waren da – ohne Ziffernfeld, Rückvergütung, ROI p. a., Modus Laden/Online, Teilen-Ziel,
Einkaufsliste und Offline-Nachprüfung. Rechnungsstation (Kamera-Stapel, Scanner-Ordner, Stotax), Sparkasse-CSV/PDF und
der Bank-Abgleich waren da – ohne Agent am Arbeits-PC, Umbenennen, Monats-/Lieferantenordner, Dubletten-Ordner,
MT940/PayPal und „Beleg ohne Zahlung“. B2B-Bereich, Hebel „Ladenhüter“ und Kapital-Ampel waren da – ohne Preisliste,
Leads, Briefe. Deal-Eingang mit „Gekauft“, Preis-Szenario, Umschlag/ROI p. a. und Lernschleife war da – ohne Ankauf.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B34.1 `/scan`: Kamera (BarcodeDetector, Ausweich ZXing), Ziffernfeld, brutto/netto gemerkt, Menge, Rückvergütung % | 🟡 | ✅ Hochformat-Seite mit großem Ziffernfeld; Rückvergütung senkt den effektiven EK | `src/app/(app)/scan/scanner.tsx`, `ekMitRueckverguetung` (`src/lib/scan/logic.ts`) |
| B34.1 Ergebnis < 3 s: Ampel, bestes Land, Gewinn, ROI, ROI p. a., Menge, Bestand + Kapital-Ampel, Satz | 🟡 | ✅ wie `scan_pruefen` (Keepa aus dem Zwischenspeicher), dazu ROI p. a., Umschlag, Kapital-Ampel, Begründung; Vorlesen per Schalter | `scanAusfuehren` (`src/lib/scan/service.ts`), `scanPruefen`, `kapitalStand` (`src/lib/mobil/service.ts`) |
| B34.1 Modus Laden/Online, Teilen-Menü (Web Share Target), „Kauf vorbereiten“ über den Warenkorb-Link | ❌ | ✅ `manifest.ts` mit Teilen-Ziel → `/api/deal-eingang` leitet einen geteilten Amazon-Link auf `/scan` um; Kauf-Link auf den Shop des Links | `src/app/manifest.ts`, `teilenZiel`, `src/app/api/deal-eingang/route.ts` |
| B34.1 Einkaufsliste, Als Deal, Verwerfen; „Heute gescannt“ mit Summe und Kapital | ❌ | ✅ Tabelle `scan_eintraege`, Aktionen je Scan, Tagesliste mit Summe und Restbudget | `src/db/tables/scan.ts`, `aktionSetzen`, `heuteSumme` |
| B34.1 Schlechtes Netz: zwischenspeichern, nachprüfen, Push | ❌ | ✅ Warteschlange im Browser, Nachprüfung bei Netz, Push mit Ergebnis | `offlineMelden`, `offeneNachpruefen` |
| B34.1 Foto Preisschild/Kassenbon → Rechnungsstation | ❌ | ✅ Kassenbon als Beleg im Kamera-Stapel, Preisschild in der Ablage | `belegZumScan` |
| B34.2 Agent am Arbeits-PC überwacht den Download-Ordner | ❌ | ✅ Druckagent 1.1.0 `belegePruefen()` (aus, bis Pfad eingetragen), Einstellungen → Drucker „Belege-Ordner“/„Ablage“ | `druckagent/lugru-druckagent.mjs`, `src/app/api/druckagent/beleg/route.ts` |
| B34.2 Kontoauszug erkennen, nicht als Rechnung | 🟡 | ✅ Kontoauszug (auch MT940/PayPal) wird zur Bank, nicht zur Rechnung | `istKontoauszugText` (`src/lib/uploads/erkennen.ts`), `belegAusOrdner` |
| B34.2 Umbenennen `JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr`, Ordner Monat/Lieferant | ❌ | ✅ Agent verschiebt nach Rückmeldung des Servers | `zielName`, `zielOrdner` (`src/lib/belege/ablage-logic.ts`) |
| B34.2 Dubletten (Hash, Nr + Betrag) in „Dubletten“, Löschen nur nach Freigabe | 🟡 | ✅ Seite Rechnungsstation → Download-Ordner, Freigabe je Datei, Agent löscht erst dann | `dubletteVon`, `loeschenFreigeben`, `src/app/(app)/rechnungsstation/ablage/page.tsx` |
| B34.2 Zahlungsabgleich CSV/CAMT/MT940/PDF + PayPal, „Zahlung ohne Beleg“/„Beleg ohne Zahlung“, Export Stotax | 🟡 | ✅ MT940- und PayPal-Leser, beide Listen, Export „Abgleich (CSV)“ | `leseMt940`, `lesePaypal` (`src/lib/bank/logic.ts`), `abgleichCsv`, `buchhaltung/export/route.ts` |
| B34.2 Entgeltabschluss als eigener Beleg | ❌ | ✅ aus dem Kontoauszug als Beleg erfasst | `entgeltBelegAusAuszug` (`src/lib/belege/entgelt.ts`) |
| B34.3 Preisliste aus Ladenhütern (Reichweite > 90 T oder Lager > 60 T, Kapital > 300 €), Preis = Break-even + Aufschlag, Staffeln, PDF/Excel, ohne Insider | ❌ | ✅ Kandidaten aus der Kapital-Ampel, Staffeln nie unter Break-even, PDF und Excel nur mit Artikel/ASIN/Menge/Preis/Staffel | `istKandidat`, `preisPosition` (`src/lib/abverkauf/logic.ts`), `preislistePdf` (`pdf.ts`), `preislisteDatei` |
| B34.3 Lead-Liste per CSV (Firma, Anschrift, Kategorie, E-Mail nur aus Impressum, Quelle, Datum, Status, Rechtsgrundlage), kein Scrapen | ❌ | ✅ Import mit Pflicht-Quelle und Datum, Anschrift und E-Mail verschlüsselt, Dubletten über Schlüssel (Rechtsform egal) | `leadsAusTabelle`, `leadsImportieren`, Tabelle `abverkauf_leads` |
| B34.3 Brief als Standard: Serienbrief-PDF mit Absender, Anschrift, Datenschutzhinweis Art. 14 DSGVO, Abmeldung | ❌ | ✅ je Händler eine Seite; Hinweis mit Verantwortlichem, Quelle + Datum, Zweck, Art. 6 Abs. 1 lit. f, Speicherdauer, Widerspruch, Abmelden/Sperrliste | `serienbriefPdf`, `datenschutzHinweis` |
| B34.3 E-Mail an Fremdkontakte gesperrt, solange „Rechtlich geprüft“ aus; nur Bestandskunde oder dokumentierte Einwilligung | ❌ | ✅ Sperre beim Freigeben (Fehler am Anschreiben, keine Mail), Schalter nur für den Inhaber; Hinweis „keine Rechtsberatung“ | `mailErlaubt`, `freigeben` |
| B34.3 Sperrliste, Löschfrist, Quelle und Zweck dokumentiert | ❌ | ✅ Sperrliste aus Prüfsummen (Firma+PLZ, E-Mail), Löschfrist je Lead (Standard 180 T) mit Liste „Löschfrist abgelaufen“ | `leadSperren`, `loeschfaellig`, `abverkauf_sperrliste` |
| B34.3 KI-Entwurf je Händler, nie automatisch; Freigabe einzeln/Charge ≤ 20, Tageslimit | ❌ | ✅ Entwurf (KI, sonst Vorlage) ohne EK/Gründe, Freigabe nur Inhaber, Charge höchstens 20, Tageslimit | `entwuerfeErstellen`, `kiAuftrag`, `tagesRest` |
| B34.3 Antworten in den Posteingang + Aufgabe | ❌ | ✅ Bezug „AV-…“ oder Lead-E-Mail → Anschreiben „beantwortet“, Aufgabe; „keine Angebote“ → Sperrliste; Mail immer im geschäftlichen Posteingang (eigene Mails zählen nicht) | `antwortAusMail`, Haken in `ingestMail` (`src/lib/inbox/service.ts`) |
| B34.3 Erfolg je Charge (Rücklauf, Umsatz, Marge) in der B2B-Erfolgskontrolle | ❌ | ✅ Tabelle je Charge, Summe in der B2B-Bilanz | `erfolgJeCharge`, `AbverkaufErfolg` (`b2b/bilanz/page.tsx`) |
| B34.4 Ankaufspreis am Deal, Szenario Amazon vs. Ankauf (Gewinn = Ankaufspreis − EK + Rückvergütung, Marge, ROI, Zahlungsziel) | ❌ | ✅ Abschnitt „Ausstieg: Amazon oder Ankauf“ (nur Inhaber): beide Wege nebeneinander mit Gewinn je Stück/gesamt, Marge, ROI, Geld nach, ROI p. a. und Fazit | `ausstiegVergleich` (`src/lib/deal-eingang/ankauf-logic.ts`), `deal-eingang/[id]/ankauf.tsx`, Spalte `deal_eingaenge.ankauf` |
| B34.4 Risikofelder Ankäufer, Rang/Legit-Check, Menge angemeldet, Annahmefrist | ❌ | ✅ im selben Formular | `ankaufSpeichern` (`src/lib/deal-eingang/ankauf.ts`) |
| B34.4 Keine Bot-Käufe, kein Mitlesen fremder Discord-Server | – | ✅ nichts dergleichen gebaut; Hinweis im Abschnitt | – |
| B34.4 Wissenseintrag „Ankaufserver“ (Einzelmeinung) | ❌ | ✅ beim ersten Ankauf angelegt: insider, Herkunft Call, Datum 04.11.2026, „Gruppe – Einzelmeinung“ (Name nicht im Code) | `ankaufWissenSicherstellen`, `ANKAUF_WISSEN` |
| B34.5 Warnung „Menge beim Ankäufer anmelden“ bei „Gekauft“ (Checkliste, kein Stopp) | ❌ | ✅ Warnkasten im Kaufen-Abschnitt und offene Punkte in der Meldung nach „Gekauft“ (Knopf, Bestellmail, Claude, Sprache) | `AnkaufKaufWarnung`, `ankaufNachKauf` (Aufruf in `alsGekauft`) |
| B34.5 Aufgabe „Ankauf bestätigen“ mit Frist | ❌ | ✅ Frist = Annahmefrist, sonst in 2 Tagen; dringend, solange die Menge nicht angemeldet ist | `ankaufFrist`, `aufgabeAnlegen` |
| B34.5 Ausgang angekauft / liegt / Verlust → Lernschleife (B28.8) | ❌ | ✅ Ausgang erledigt die Aufgabe; „liegt“/„Verlust“ legen eine Frage in der Lernschleife an (fließt über die Antwort als ähnlicher Fehlkauf in den Deal-Wert); Zähler im Lernbericht | `ankaufAusgangSetzen`, `lernschleifeBericht().ankauf` |

| Abnahme | Ergebnis |
|---|---|
| B34.1 (1) Scan mit bekannter EAN < 3 s wie `scan_pruefen` | ✅ automatisch (`b34-scan.spec.ts`) |
| B34.1 (2) Rückvergütung 2 % ändert den ROI | ✅ automatisch |
| B34.1 (3) Amazon-Link teilen öffnet das Ergebnis | ✅ automatisch (Teilen-Ziel); echtes Teilen-Menü am Handy live |
| B34.1 (4) Offline-Scan wird später nachgeprüft | ✅ automatisch (mit Push) |
| B34.1 (5) Kassenbon-Foto landet in der Rechnungsstation | ✅ automatisch |
| B34.2 Testordner mit 5 Rechnungen + 2 Dubletten: sortiert, umbenannt, Dubletten verschoben, nichts gelöscht | ✅ automatisch mit dem echten Agent-Programm (`b34-ablage.spec.ts`), dazu Kontoauszug und Löschen nach Freigabe |
| B34.3 Preisliste generiert (PDF + Excel ohne Insider) | ✅ automatisch (`b34-abverkauf.spec.ts`) |
| B34.3 10 Test-Leads per CSV | ✅ automatisch (E-Mail nur mit Quelle Impressum, 1 verworfen) |
| B34.3 E-Mail ohne „Rechtlich geprüft“ gesperrt | ✅ automatisch (keine Mail raus, Fehler am Anschreiben); mit Schalter + Einwilligung geht sie mit Datenschutzhinweis raus |
| B34.3 Brief-PDF mit Datenschutzhinweis | ✅ automatisch (Art. 14 DSGVO, Quelle, Rechtsgrundlage, Widerspruch, Abmelden) |
| B34.4 Beide Szenarien nebeneinander | ✅ automatisch (`b34-ankauf.spec.ts`: 26 € − 20 € + 2 % = 6,40 €/Stk, 7 Tage, ROI p. a. 1669 %) |
| B34.5 Warnung beim Kauf, Aufgabe, Ausgang → Lernschleife | ✅ automatisch |

Unit-Tests: `tests/b34-scan.test.ts`, `tests/b34-ablage.test.ts`, `tests/b34-abverkauf.test.ts`, `tests/b34-ankauf.test.ts`.
Ablauftests: `e2e/b34-scan.spec.ts`, `e2e/b34-ablage.spec.ts`, `e2e/b34-abverkauf.spec.ts`, `e2e/b34-ankauf.spec.ts`.
Migrationen: `0143_b34_scan_ablage`, `0144_b34_abverkauf`, `0145_b34_ankauf`.

**Werkzeuge B34:** keine neuen Werkzeuge, keine neuen ändernden Werkzeuge. Geändert: `scan_pruefen` – neue Eingabe
`rueckverguetung` (%), Ausgabe zusätzlich `rueckverguetung`, `ek_effektiv`, `roi_pa`, `umschlag`, `kapital_ampel`,
`begruendung_kurz` → `notifications/tools/list_changed` geht beim Verbinden raus. `deal_lernen_bericht` liefert in
`lernschleife` zusätzlich `ankauf` (angekauft/liegt/Verlust/offen, nur Ausgabe).

**Offene Fragen an Ludwig** (bis zur Antwort mit diesen Annahmen gebaut):
1. Wie nutzt du `scan_pruefen` heute, und wie oft kaufst du im Laden? – Annahme: beide Modi, Laden = Regalpreis brutto.
2. Briefe als Standard in Ordnung? Welche Ladenhüter zuerst? – Annahme: Brief; alle Kandidaten vorausgewählt, Auswahl per Haken.
3. Läuft die Ordnerüberwachung auf dem Druckagent-PC? – Annahme: ja, im selben Agent (1.1.0), aus, bis ein Pfad eingetragen ist.
4. Der „B34.2-Prüfauftrag zum Kontoauszug vom 09.11.“ ist nicht angekommen – Kontoauszug-Erkennung nach eigener Regel; bitte nachreichen.

### B34 Ergänzung (10.11.): Drive-Rechnungsordner, AdelPrep-Beilage, Briefversand per API, Kampagnen

„Ordner auf einem PC (Downloads oder Scanner-Ausgabe)“: **ist umgesetzt** – Druckagent 1.1.0 überwacht den
Download-Ordner (B34.2 oben), die Rechnungsstation liest zusätzlich den Scanner-Ordner. Neu ist der Weg ohne
PC-Programm direkt im Drive-Rechnungsordner. Firmendaten der Logistik-Firma, Preise der Briefanbieter und
Lager-Koordinaten stehen nicht im Code – sie werden in den Einstellungen eingetragen.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B34.1 (0) Verknüpfung auf dem Handy-Startbildschirm, Test mit 3 bekannten EANs | 🟡 Manifest mit Kurzbefehl „Scan-Modus“ | ✅ Anleitung iPhone/Android auf `/scan` + 3 Probe-EANs aus den eigenen Produkten (ein Tipp setzt die EAN im Laden-Modus ein, Regalpreis eintippen, „Prüfen“) | `src/app/(app)/scan/page.tsx`, `src/app/manifest.ts` |
| B34.2.1 Drive-Ordner regelmäßig lesen (neu seit letztem Lauf), nur lesen bis Freigabe; Rechnung/Beleg/Kontoauszug erkennen, Kontoauszug nicht als Rechnung | 🟡 stündlicher Abruf als Rechnung | ✅ je neuer Datei direkt im Ordner ein Vorschlag; Kontoauszug → Vorschlag „Kontoauszüge/JJJJ-MM“ (Import erst bei Freigabe), keine Rechnung; Schreibrecht-Schalter (Inhaber), aus = nur lesen | `driveDateiVorschlagen` (`src/lib/belege/drive-ablage.ts`), `syncDrive` (`src/lib/invoices/service.ts`) |
| B34.2.2 Umbenennen `JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr`, Ablage Monat/Lieferant – erst Vorschlag mit Vorschau, Ausführung nach Freigabe (Charge) | ❌ | ✅ Vorschau (alter/neuer Name, Zielordner, PDF ansehen), Freigabe Auswahl/alle (≤ 50) → Unterordner anlegen, verschieben, umbenennen per Dienstkonto | `driveFreigeben`, `ordnerSichern`/`dateiVerschieben` (`src/lib/integrations/clients/drive.ts`), `rechnungsstation/ablage/drive-abschnitt.tsx` |
| B34.2.3 Dubletten (Prüfsumme, Nr + Betrag) nach „Dubletten“, Löschen nur nach Freigabe, Liste vorher | ❌ | ✅ Dublettenliste; nach Freigabe in „Dubletten“ verschoben; Papierkorb (30 Tage wiederherstellbar) nur mit eigener Freigabe, nie endgültig gelöscht | `dubletteVon`, `driveDublettenPapierkorb`, `inPapierkorb` |
| B34.2.4/5/6 Zahlungsabgleich, Entgeltabschluss, lokaler PC-Ordner | ✅ | ✅ unverändert (Stotax-Ablauf bleibt) | B34.2 oben |
| B34.3.6 AdelPrep-Beilage: eigener Brief (Absender, Impressum, Datenschutz), nicht vermischt; Textbaustein in Einstellungen; je Brief zu-/abwählbar; Lead-Feld „Zielgruppe AdelPrep“ + Filter | ❌ | ✅ eigenes Blatt mit eigenem Kopf „Eigenes Schreiben der …“, Impressum und Datenschutzhinweis; Schalter je Brief; Lead-Spalte + CSV-Spalte „Zielgruppe AdelPrep“ + Filter; Firmendaten leer bis eingetragen | `beilageSeite` (`src/lib/abverkauf/pdf.ts`), `briefeBauen` (`briefe.ts`), Abschnitt „Beilage AdelPrep“ (`b2b/abverkauf/page.tsx`) |
| B34.3.6 Formulierung „ab … € netto je Artikel“, kein „all-in“/„Komplettpreis“; unbelegte Angaben (Fläche, kostenlose Zählung, NDA, LQ-Gefahrgut) nur nach Rückfrage | ❌ | ✅ Textprüfung: „all-in“/„Komplettpreis“/ohne „netto“ = Beilage wird nicht beigelegt; Fläche/Zählung/NDA/Gefahrgut nur mit Haken „nach Rückfrage belegt“ | `beilageLint`, `beilageVollstaendig` (`src/lib/abverkauf/kampagne-logic.ts`) |
| B34.3a Schnittstelle `senden`/`status`/`stornieren`/`preis_schaetzen`, austauschbar; eBrief, LetterXpress, E-POST | ❌ | ✅ LetterXpress (API v3, Testmodus = Warenkorb), eBrief (Token, Job anlegen, live gestartet), E-POST vorbereitet (meldet „noch nicht angebunden“) | `src/lib/integrations/clients/briefversand.ts` |
| B34.3a Zugangsdaten verschlüsselt unter Anbindungen, Preise in Einstellungen | ❌ | ✅ Anbindungen „eBrief“, „LetterXpress“, „E-POST“ mit Verbindungstest; Preise je Anbieter (1. Blatt + je weitere Seite) unter Abverkauf → Briefversand, Standard leer | `registry.ts`, `ABVERKAUF_STANDARD.briefversand` |
| B34.3a PDF je Lead → Vorschau → Kostenvorschau → Freigabe (Charge ≤ 20) → Versand; Tageslimit + Gesamtbudget | ❌ | ✅ Seite „Briefversand“ je Charge: Vorschau mit Seiten und Kosten, Summe muss bestätigt werden (sonst nichts), Tageslimit/Budget nur live | `versandVorschau`, `chargeVersenden` (`src/lib/abverkauf/versand.ts`), `b2b/abverkauf/versand/[charge]/page.tsx` |
| B34.3a Testbrief zuerst an die eigene Adresse | ❌ | ✅ Pflicht vor jedem Versand (je Modus) | `testbriefSenden` |
| B34.3a Adressprüfung (Pflichtfelder, PLZ/Land, Dubletten, Sperrliste, Rechtsgrundlage) | ❌ | ✅ je Brief, Fehler sperren nur diesen Brief | `adressePruefen` |
| B34.3a Status zurück (angenommen/gedruckt/zugestellt/Fehler), Kosten je Brief → Kosten je Rücklauf | ❌ | ✅ „Status abrufen“ + stündlich; Erfolg je Charge mit Briefkosten und Kosten je Rücklauf | `briefStatusAbrufen`, `kostenJeCharge`, `erfolgJeCharge` |
| B34.3a Pflicht-Haken „AV-Vertrag liegt vor“, sonst kein Live-Versand; Fallback Sammel-PDF; nie automatisch | ❌ | ✅ live ohne Haken gesperrt (auch Testbrief), Sammel-PDF bleibt, nur Inhaber gibt frei | `anbieterFuer`, `versand/[charge]/page.tsx` |
| B34.3b Kampagne = Zielgruppe + Produkte + Preise + Brieftext + Lead-Filter; Zielgruppen Amazon-Händler, Friseure, Spielwaren, Lager & Logistik (eigener Brief) | ❌ | ✅ Seiten „Kampagnen“ und Kampagne; Lager & Logistik schreibt komplett als Logistik-Firma | `src/lib/abverkauf/kampagnen.ts`, `ZIELGRUPPEN`, `b2b/abverkauf/kampagnen/` |
| B34.3b Produktauswahl aus Bestand (Marke/Kategorie, Reichweite, Kapital); Kosmetik MHD + Charge, Mindestrestlaufzeit; Preis Einstand + Aufschlag, Staffeln, Mindestmenge, netto | ❌ | ✅ Suche im Bestand, MHD/Charge je Position, „nicht angeboten“ mit Grund; Preis = EK + Aufschlag, Staffeln, Mindestmenge | `bestandKandidaten`, `positionenSetzen`, `mhdPruefen` |
| B34.3b Lead-Filter Branche, PLZ + Umkreis um Lager, Größe, Status; nur CSV | ❌ | ✅ Koordinaten aus der CSV (Spalten lat/lng), Luftlinie zum Lager-Standort, Gründe je Lead („ohne Koordinaten“, „… km entfernt“) | `leadImFilter`, `entfernungKm`, `leadsFuerKampagne` |
| B34.3b QR-Code/Kurzlink mit Kampagnen-ID → Anfrageseite (Firma, Wunschartikel, Menge, Kontakt); Gewerbenachweis (USt-ID) | ❌ | ✅ QR + Link + Kampagnen-ID je Brief; öffentliche Seite `/anfrage/<Code>` (nur Angebot), USt-ID-Format geprüft, Honigtopf | `qrPng`, `src/app/anfrage/[code]/page.tsx`, `anfrageAnlegen`, `ustIdFormat` |
| B34.3b Anfrage → Posteingang als Aufgabe; Nachfassen nach 3 Wochen (optional) | ❌ | ✅ Aufgabe + Eintrag im Posteingang (Ordner „Anfrageseite“), Anschreiben „beantwortet“; Nachfassen als Aufgabe (täglicher Lauf), nie automatisch | `anfrageAnlegen`, `nachfassPruefen` (`scheduler.ts`) |
| B34.3b Rechtliche Hinweise (MHD/Kennzeichnung, CE/GPSR, Vertrieb, Art. 14 DSGVO) | ❌ | ✅ je Zielgruppe auf der Kampagnenseite, „keine Rechtsberatung“ | `ZIELGRUPPEN[..].hinweise` |
| B34.3b Lager-Kampagne: Umkreis 100 km, Lagerkostenrechner (Europalette 1,44 m³ × Preis), Palettenlager nutzbar, offene Punkte | ❌ | ✅ Rechner (Paletten → m³, je Palette/m³/Monat), Hinweis aufs Palettenlager (Abrechnung je Palette/Monat), Checkliste Kapazität/Versicherung/Gefahrgut/Mindestmenge/AGB | `lagerkosten`, `OFFENE_PUNKTE_LAGER` |
| B34.3b.6 Rechnung an Unternehmen bei Erstbestellung | ❌ | 🟡 USt-ID-Format wird auf der Anfrageseite geprüft und steht in der Aufgabe; Rechnung bleibt Handarbeit, solange Lexoffice für diese Firma nicht angebunden ist | `ustIdFormat`, `anfrageAnlegen` |
| B34.3b.7 Lokaler Besuch als Tourenliste (optional später) | ❌ | ⏸ nicht gebaut (laut Auftrag „optional später“); Leads mit Entfernung stehen schon in der Kampagne | `leadsFuerKampagne` |
| B34.4.3 Discord nur für abonnierte Kanäle | ✅ | ✅ unverändert: gelesen werden nur unter Anbindungen eingetragene Kanäle; Hinweis im Wissen | `src/lib/deal-eingang/profitpath.ts`, `src/lib/discord-wissen/` |
| B34.4.4 Wissen „Einsteiger bekommen kaum Deals“ (Einzelmeinung) | ❌ | ✅ im Wissenseintrag „Ankaufserver“; bestehender Eintrag wird nachgezogen | `ANKAUF_WISSEN`, `ankaufWissenSicherstellen` |
| B34.5 Checkliste: Menge angemeldet, Ankäufer kauft noch an (Datum), Versandfrist – Warnung, Aufgabe, Ausgang → Lernschleife | 🟡 ohne „kauft noch an“/Versandfrist | ✅ zwei neue Punkte (Bestätigung ≤ 7 Tage alt, Versandfrist nicht vorbei); Aufgabe-Frist = früheste offene Frist | `ankaufCheckliste`, `ankaufFrist` (`ankauf-logic.ts`), Felder im Formular |

| Abnahme | Ergebnis |
|---|---|
| B34.1 (0) Startbildschirm + 3 bekannte EANs | ✅ automatisch (`b34-scan-start.spec.ts`: Manifest-Kurzbefehl, Anleitung, 3 Probe-EANs je mit Ampel); echtes Handy live |
| B34.2 Drive: Test-Ordner mit 5 Rechnungen + 2 Dubletten → Vorschau mit neuen Namen + Dublettenliste; nach Freigabe sortiert; nichts gelöscht | ✅ automatisch gegen den Drive-Nachbau (`b34-drive.spec.ts`), dazu Kontoauszug, Schreibrecht-Sperre, Papierkorb nur nach Freigabe |
| B34.3a Testanbieter im Testmodus, 3 Test-Leads, Kostenvorschau stimmt, Testbrief an Absender, Status zurück, ohne AV kein Live, ohne Freigabe nichts verschickt | ✅ automatisch gegen den LetterXpress-Nachbau (`b34-briefversand.spec.ts`), dazu Beilage-Prüfung und Kosten je Rücklauf |
| B34.3b Kampagne „Friseure“ mit 2 Testprodukten, MHD-Filter, Umkreis 50 km, Brief-PDF mit QR + Kampagnen-ID, Anfrage → Aufgabe im Posteingang | ✅ automatisch (`b34-kampagnen.spec.ts`), dazu Lagerkostenrechner |
| B34.5 neue Checklistenpunkte | ✅ automatisch (`b34-ankauf.spec.ts` + Unit-Tests) |

Unit-Tests: `tests/b34-kampagnen.test.ts` (neu), `tests/b34-ankauf.test.ts` (erweitert).
Ablauftests: `e2e/b34-drive.spec.ts`, `e2e/b34-briefversand.spec.ts`, `e2e/b34-kampagnen.spec.ts`, `e2e/b34-scan-start.spec.ts`.
Testdienste: Nachbau Google Drive (`/drive/v3`, Token, Ordner, Verschieben, Papierkorb), LetterXpress v3, eBrief.
Migration: `0146_b34_drive_brief_kampagnen`.

**Werkzeuge:** keine neuen und keine geänderten Claude-Werkzeuge → kein `notifications/tools/list_changed` nötig.

**Offene Fragen an Ludwig** (mit diesen Annahmen gebaut):
1. `scan_pruefen` noch nie genutzt – bitte `/scan` auf den Startbildschirm legen und die 3 Probe-EANs antippen (Abnahme 0).
2. Briefe als Standard / welche Ladenhüter zuerst? – Annahme: Brief; Auswahl per Haken bzw. je Kampagne.
3. Drive-Schreibrechte: erst nach deiner Freigabe (Schalter auf der Belegablage + Dienstkonto als Bearbeiter) – bis dahin nur Vorschau.
4. Absender und Text der AdelPrep-Beilage: bitte selbst eintragen und prüfen (Firmendaten, Impressum, Preis „ab … € netto je Artikel“); unbelegte Angaben bleiben gesperrt, bis du sie bestätigst.
5. eBrief als erster Anbieter bestätigen? – Annahme: ja, Preis laut Preisseite selbst eintragen; LetterXpress ist gleichwertig angebunden.

### B34.3c Lead-Beschaffung in Stufen + Zählung (11.11.) – nur als Pull Request

Umsetzung auf dem Branch `b34-3c-lead-stufen` mit Pull Request gegen main (kein Push nach main). Keine Zugangsdaten
im Chat; Stufe 2 (automatischer Apify-Lauf) ist **nicht** gebaut – erst nach rechtlicher Prüfung.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B34.3.6 „Kostenlose Zählung“ gibt es nicht (Ludwig 11.11.) | 🟡 nur nach Rückfrage erlaubt (Haken) | ✅ Textprüfung lehnt die Aussage in allen Varianten immer ab („… bei direktem FBA-Versand kostenlos“, „kostenfreie Mengenzählung“, „inklusive Zählung“); Haken entfernt; Hinweis bei der Lager-Zielgruppe angepasst | `beilageLint` (`KOSTENLOSE_ZAEHLUNG`), `ZIELGRUPPEN.adelprep_lager.hinweise` |
| B34.3c.1 Apify-Export per CSV, Quelle und Datum automatisch, Sperrliste | 🟡 Quelle/Datum von Hand (Pflicht) | ✅ Apify-, LUCID-, Keepa-, Helium-10-Export an Spalten/Dateiname erkannt; Quelle „Apify-Export (Datei)“, Datum aus `scrapedAt`/„Datum“, sonst heute; Apify-Spalten (`title`, `postalCode`, `emails/0`, `location/lat` …) gelesen; Sperrliste wie bisher | `quelleErkennen`, `quelleDatumAus`, `leadsImportieren` |
| B34.3c.2 E-Mail (Website/Impressum) nur speichern, Quelle „Impressum“, keine Werbe-E-Mail, nur Antworten | 🟡 nur mit Spalte „E-Mail-Quelle“ | ✅ Apify-Mails mit Quelle „Impressum (Website, Apify-Export)“, Eingabe von Hand („Impressum (von Hand)“, Link „Website öffnen“ – das System ruft keine Websites ab); Mail-Weg für gefundene Adressen immer gesperrt (auch mit „Rechtlich geprüft“), erlaubt nur für Antworten (Status geantwortet/Kunde), Bestandskunden oder dokumentierte Einwilligung | `mailErlaubt`, `impressumMailSetzen`, Spalte „E-Mail“ |
| B34.3c.3 Vorschläge „Zielgruppe AdelPrep“ (ab 80 Stück je Artikel) aus LUCID/Keepa/Helium 10; LUCID vorher klären | ❌ | ✅ Spalte „Stück je Artikel“/„Units“ aus der Datei; Liste „Vorschläge“ mit Übernahme von Hand (Schwelle einstellbar); LUCID-Leads ohne Entwurf/Brief und aus Kampagnen-Filtern raus, bis „LUCID geklärt“ gesetzt ist | `adelprepVorschlag`, `adelprepVorschlaege`, `quelleSperre` |
| B34.3c.4 Briefe automatisch vorbereitet, Versand nur nach Freigabe, Tageslimit/Budget | ✅ | ✅ unverändert (B34.3/B34.3a) | `entwuerfeErstellen`, `chargeVersenden` |
| B34.3c.5 Stufe 2: automatischer Apify-Lauf mit Monatslimit | ❌ | ⏸ nicht gebaut – erst nach rechtlicher Prüfung (Hinweis auf der Seite) | – |
| B34.3.6 Regeln 11.11. (2. Fassung): „all-in“ nur mit Aufzählung der enthaltenen Leistungen, nie „Komplettpreis“; Karton getrennt nennen | 🟡 „all-in“ immer gesperrt | ✅ „all-in“ erlaubt, wenn „Enthalten: …“ im Text steht; „Komplettpreis“/„alles inklusive“ gesperrt; Hinweis „Karton gesondert nennen“, wenn FBA-Preis ohne Karton | `beilageLint` |
| B34.3.6 Mengenzählung: bei direktem FBA-Versand durch das Verpacken erfasst, bei Einlagerung optional zubuchbar – nie „kostenlos“/„inklusive“, nie „Pflicht“ | 🟡 nur „kostenlos“ gesperrt | ✅ „kostenlos/inklusive/im Preis enthalten“ und „Pflicht“ werden abgelehnt (mit der empfohlenen Formulierung als Hinweis); „Mengenzählung inkl. EAN-Prüfung + Preis“ bleibt erlaubt; Regeln stehen unter dem Textbaustein | `ZAEHLUNG_GRATIS`, `ZAEHLUNG_INKL`, `ZAEHLUNG_PFLICHT`, `av-ap-regeln` |
| B34.3.6 Fläche/Paletten, NDA, LQ-Gefahrgut bestätigt (11.11.); EAN-Prüfung bei direktem FBA-Versand noch offen | 🟡 Haken für Fläche/NDA/Gefahrgut | ✅ Haken bleiben (Inhaber setzt sie – keine Firmendaten im Code); neuer Haken „EAN-Prüfung bei direktem FBA-Versand inklusive“, ohne Haken wird die Aussage abgelehnt | `UNBELEGT.eanFba`, `av-ap-ean` |
| Briefanbieter: welcher angebunden, was kostet ein Brief | 🟡 Einstellungen ohne Übersicht | ✅ Zeile „Aktuell: Anbieter · Zugang hinterlegt/fehlt · Preis · Testmodus/live“ | `av-bv-stand` |

| Abnahme | Ergebnis |
|---|---|
| Stufe 1: CSV-Import eines Apify-Exports → Leads mit Quelle/Datum, E-Mail gespeichert aber im Versandweg „Mail“ gesperrt, Brief nur nach Freigabe | ✅ automatisch (`b34-lead-quellen.spec.ts`), dazu Antwort erlaubt nach Rückmeldung, Impressum-Mail von Hand, AdelPrep-Vorschlag, LUCID-Sperre |
| Textregeln Beilage (all-in mit Aufzählung, Zählung nie kostenlos/Pflicht, EAN-Prüfung nur bestätigt, Karton-Hinweis) | ✅ Unit-Tests (`tests/b34-kampagnen.test.ts`) und Ablauf (`b34-briefversand.spec.ts`) |

Unit-Tests: `tests/b34-lead-quellen.test.ts` (neu), `tests/b34-kampagnen.test.ts` (erweitert). Migration: `0147_b34_3c_lead_quellen`.

**Werkzeuge:** keine neuen und keine geänderten Claude-Werkzeuge → kein `notifications/tools/list_changed` nötig.

**Offene Fragen an Ludwig:** (1) LUCID für Werbung zulässig? (2) Welcher Briefanbieter ist aktuell angebunden und
was kostet ein Brief? (3) Stufe 2 (automatischer Apify-Lauf) erst nach rechtlicher Prüfung – Bescheid geben, wenn
freigegeben. (4) Widerspruch auf der Website (Zählung „Pflicht“ vs. „dazubuchbar“, FAQ „Komplettpreis“) vor dem
Brief klären.

## B35 Lead-Maschine (11.11.) – nur als Pull Request

Umsetzung auf dem Branch `b35-lead-maschine` (aufbauend auf `b34-3c-lead-stufen`) mit Pull Request – kein Push nach
main. Grundsatz eingehalten: nichts wird automatisch verschickt, jede Charge braucht die Freigabe; keine Werbe-E-Mails
an Leads (UWG § 7). Stufe 2 ist gebaut, aber **gesperrt**, bis das Datum der rechtlichen Prüfung eingetragen ist.
Zugangsdaten (Apify, Google Places) nur über Anbindungen. Keine echten Firmennamen im Code – Konfliktbranchen,
Großmarken und Sperrnamen trägt der Inhaber unter Leads → Schutzregeln ein (leer vorbelegt).

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B35.1 Quellen je einzeln schaltbar, Budget je Lauf/Monat, Abbruch, Laufprotokoll | 🟡 nur Datei-Import (B34.3c) | ✅ Datei, Lieferantensuche (Übernahme), Apify, Google Places, Impressum; je Quelle an/aus, Budget je Lauf und Monat (ohne Budget kein Lauf), Abbruch bei Überschreitung, Protokoll je Lauf (Kosten, neu, zusammengeführt, Meldung) | `lead-quellen.ts`, Tabelle `abverkauf_lead_laeufe`, `laufBudget` |
| B35.1 LUCID | 🟡 Datei-Import, gesperrt bis „geklärt“ | 🟡 unverändert – kein automatischer Lauf (LUCID hat keine Suche nach Branche); Datei-Import bleibt bis zur Klärung gesperrt | `quelleSperre` |
| B35.1 Amazon/eBay-Verkäufer | ❌ | ✅ über Apify (Actor + Eingabe einstellbar) oder „Aus Lieferantensuche übernehmen“; nie über das Verkäuferkonto | `apifyLauf`, `ausLieferantensuche` |
| B35.1 Google Maps/Branchen nach Branche + Umkreis | ❌ | ✅ Google Places Text-Suche („Branche \| Ort/PLZ \| Radius“), Kosten je Abruf mit Budget; kein Auslesen der Google-Suchseite | `placesLauf`, `placesSuche` |
| B35.1 GPSR/Impressum | ❌ | ✅ Impressum der Firmenwebsite: robots.txt, ≥ 6 s Pause, eigener User-Agent, nie parallel, nur öffentliche Adressen; liest USt-IdNr., Register, Anschrift, E-Mail (nur leere Felder) | `impressumLauf`, `impressumFakten` |
| B35.1 Eigene Daten (Posteingang, QR-Anfragen, Kunden/Lieferanten) | 🟡 Antworten im Posteingang | ✅ Abgleich mit Lieferanten, Lieferantensuche, B2B-Kunden, Palettenkunden, Rechnungskunden, Sperrnamen; Antworten/QR-Anfragen merken den Kontakt am Lead | `bestandLaden`, `kontaktMerken` |
| B35.2 Anreichern (Rechtsform, Domain, USt-IdNr., Register, Größe, Entfernung; Quelle/Abrufdatum/Rechtsgrundlage/Löschdatum automatisch) | 🟡 Quelle/Datum/Löschfrist | ✅ Rechtsform aus dem Namen, Domain, USt-IdNr./Handelsregister normalisiert, Mitarbeiter/Artikel/Stückzahl/letzte Aktivität aus der Datei, Entfernung zum Lager; Verlauf je Lead („Gefunden: …“, „Zusammengeführt mit …“) | `rechtsformAus`, `ustNorm`, `registerAus`, Spalten `abverkauf_leads` |
| B35.2 E-Mail-Finder „Impressum“, nur für Antworten | 🟡 aus der Datei/von Hand | ✅ zusätzlich automatisch aus dem Impressum („Impressum (Website, automatischer Abruf)“) – Versandweg Mail bleibt gesperrt | `impressumAbrufen`, `mailErlaubt` |
| B35.3 Bewerten: Abverkauf, Friseure/Spielwaren lokal, AdelPrep FBA-Prep (≥ 80 Stück), AdelPrep Lager; Erreichbarkeit; Priorität = Fit × Erreichbarkeit × Nutzen; empfohlene Kampagne + Beilage | ❌ | ✅ Punkte je Zielgruppe, ohne Postadresse Priorität 0 (nicht im Versand), Empfehlung + Beilage je Lead, sichtbar in Liste und Einzelansicht | `leadBewerten`, `leadsBewerten` |
| B35.4 Dubletten (Name+Adresse, Website, Steuer-/Registernummer) | 🟡 Name+PLZ | ✅ in der Datei und gegen den Bestand: Name+PLZ, Website-Domain, USt-IdNr., Handelsregister (mit Gericht); leere Felder werden ergänzt, nichts überschrieben | `dublettenGruppen`, `leadsSpeichern` |
| B35.4 Abgleich Lieferanten/Kunden/Mitbewerber/Personen | ❌ | ✅ Ausschluss mit Grund (z. B. „Bestand: eigener Lieferant“); Mitbewerber (Prep/Logistik) markiert; vermutliche Privatperson und unklare Zuordnung nicht aufgenommen | `bestandTreffer`, `leadBewerten` |
| B35.4 Sperrliste, Löschfrist 12 Monate ohne Kontakt, Auskunft/Löschen mit einem Klick | 🟡 Sperrliste, Löschfrist 180 T | ✅ Löschfrist 365 Tage, jeder Brief/jede Antwort verlängert; Auskunft als JSON-Datei; „Alle Daten löschen“ (offene Entwürfe/Briefe weg, versendete Texte geleert, Sperrliste bleibt als Prüfsumme) | `kontaktMerken`, `leadAuskunft`, `leadLoeschenKomplett`, `/b2b/leads/[id]/auskunft` |
| B35.4 Art.-14-Hinweis, eigener Absender je Firma | ✅ (B34.3/B34.3.6) | ✅ unverändert; Hinweis bleibt Platzhalter bis zur rechtlichen Prüfung | `datenschutzHinweis`, AdelPrep-Absender |
| B35.4 Ohne Rechtsgrundlage oder mit Sperre kein Versand; Mail nur als Antwort | 🟡 Mail „nach rechtlicher Prüfung“ | ✅ Charge und Versand prüfen Sperre, Ausschluss, Rechtsgrundlage, Postadresse, Mindestabstand; Werbe-E-Mail an Leads gibt es nicht mehr (auch nicht mit „Rechtlich geprüft“ + Einwilligung) – nur Antwort an Händler, die sich gemeldet haben | `chargeSperre`, `versandVorschau`, `mailErlaubt` |
| B35.5 Wöchentlich Charge vorbereiten (z. B. 20), eine Freigabe je Charge, Tageslimit/Budget/Testbrief | 🟡 Freigabe/Versand (B34.3a) | ✅ „Charge vorbereiten (Top N)“ und wöchentlicher Lauf (nur nach rechtlicher Prüfung, Haken „wöchentlich“): beste Leads ohne Sperre, gruppiert nach Kampagne, nur Entwürfe – Freigabe, Kostenvorschau, Testbrief und Versand wie bisher | `chargeVorbereiten`, `wochenLauf`, Zeitplan „Leads: Wochenlauf“ |
| B35.5 Nachfass nach 3 Wochen, Antworten über Kampagnen-ID/QR | ✅ (B34.3b) | ✅ unverändert; Antwort/QR-Anfrage setzt zusätzlich den Kontakt am Lead | `nachfassPruefen`, `anfrageAnlegen` |
| B35.6 Seite „Leads“ (Filter, Karte/Umkreis, Einzelansicht mit Quelle/Verlauf), Wochenbericht, Morgenbericht, KPIs | ❌ | ✅ B2B → Leads: Filter Kampagne/Quelle/Status/Priorität/Umkreis/Suche, Karte (Lager + Leads + Umkreis), Einzelansicht (Stammdaten, Herkunft, Bewertung, Anschreiben, Verlauf); Wochenbericht mit gemeldeten Läufen (Captcha/Abbruch); Kosten je Lead, Kosten je Rücklauf, Umsatz je Kampagne; Morgenbericht-Zeile „Leads: …“ | `src/app/(app)/b2b/leads`, `leadsWoche`, `leadKennzahlen`, `leadsMorgen` |
| B35.7 Stufen | 🟡 Stufe 1 teilweise | ✅ Stufe 1 komplett; Stufe 2 gebaut, gesperrt bis Datum der rechtlichen Prüfung; Stufe 3 teilweise (Nachfass und Auswertung je Kampagne vorhanden, Auto-Priorität = Bewertung) | `stufe2Sperre` |
| B35.9 Kein Auslesen der Google-Suche; Places-API mit Schlüssel/Budget; robots.txt/Captcha überspringen und melden; ≥ 6 s, eigener User-Agent, nie parallel | ❌ | ✅ wie oben; Captcha/Sperre → Seite übersprungen, am Lead vermerkt, im Wochenbericht gemeldet, nicht erneut versucht | `istCaptcha`, `robotsErlaubt`, `LEAD_USER_AGENT` |
| B35.9 Dedup über HRB/USt-IdNr. | ❌ | ✅ siehe B35.4 | `dublettenSchluessel` |
| B35.9 Sperrliste vor jeder Charge, Mindestabstand 1 Brief je 6–12 Monate | ❌ | ✅ Mindestabstand einstellbar (Standard 12 Monate), letzter Brief aus Versand/„als verschickt markiert“ | `chargeSperre`, `letzteBriefe` |
| B35.9 Größenfilter (Großmarken, Kleinst-Arbitrage, Aktivität > 2 Jahre) | ❌ | ✅ Abwertung mit Markierung (Liste „Großmarken“, ≥ 250 Mitarbeiter, < 20 Stück bzw. ≤ 2 Artikel, letzte Aktivität > 2 Jahre) | `leadBewerten` |
| B35.9 Lebensmittel/Wein/Kosmetik „Lagerbedingungen klären“, nicht in der Standard-Charge; Frischware/Insolvenz/unklare Zuordnung nicht aufnehmen | ❌ | ✅ Liste einstellbar (vorbelegt nur mit Branchenwörtern); Frischware/Insolvenz/unklar ausgeschlossen | `chargeSperre`, `RE.frisch`, `RE.insolvenz` |
| B35.9 Konfliktbranche (eigene Marke) standardmäßig aus, Ausnahme per Freigabe | ❌ | ✅ Liste „Konfliktbranchen“ (leer vorbelegt), Freigabe je Lead in der Einzelansicht | `konfliktFreigeben` |
| B35.9 Protokoll je Lead (Quelle, Abrufdatum, Impressum-URL, Versanddatum); Läufe erzeugen nur Entwürfe | ❌ | ✅ Verlauf + Felder je Lead; alle Läufe legen nur Leads bzw. Entwürfe an | `verlauf`, `impressumUrl`, `letzterBriefAm` |

| Abnahme | Ergebnis |
|---|---|
| 1. 50-Zeilen-CSV: Dubletten zusammengeführt, Lieferant ausgeschlossen, Bewertung und Empfehlung sichtbar | ✅ automatisch (`b35-lead-maschine.spec.ts`): 47 neu + 3 Dubletten (Name+PLZ, USt-IdNr., Website), Nachtrag mit gleicher USt-IdNr. zusammengeführt |
| 2. Ohne Anschrift oder mit Sperre nie in einer Charge | ✅ automatisch (ohne Anschrift, Widerspruch per Klick, Mindestabstand, Lieferant, Konflikt, Wein, Frischware) |
| 3. Charge mit 20: Vorschau, Kostenvorschau, Freigabe nötig, ohne Freigabe nichts verschickt | ✅ automatisch: 20 Entwürfe, keine Charge, kein Brief beim Anbieter; nach Freigabe Versand-Vorschau mit 20 Briefen, weiterhin nichts beim Anbieter |
| 4. AdelPrep-Beilage nur bei „Zielgruppe AdelPrep“, je Brief abwählbar | ✅ automatisch |
| 5. Kein Weg schickt eine Werbe-E-Mail an einen Lead | ✅ automatisch (`b34-abverkauf.spec.ts`, `b34-lead-quellen.spec.ts`): auch mit „Rechtlich geprüft“ und Einwilligung gesperrt, keine Mail im Testpostfach |
| 6. Apify-Budget: Lauf bricht bei Überschreitung ab | ✅ automatisch (Nachbau mit steigenden Kosten, Abbruch beim Anbieter, Lauf „abgebrochen“); Places stoppt vor dem 2. Abruf |
| B35.9 Sperrliste/Mindestabstand → nicht in der Charge; Dedup über USt-IdNr.; Captcha → Quelle übersprungen und gemeldet | ✅ automatisch (Captcha-Seite einmal abgerufen, übersprungen, im Wochenbericht, zweiter Lauf: 0 Websites) |

Unit-Tests: `tests/b35-lead-maschine.test.ts` (neu, 18 Tests), `tests/b34-abverkauf.test.ts` und
`tests/b34-lead-quellen.test.ts` (Mail-Regel strikt), `tests/nav.test.ts` (88 Einträge). Migration: `0148_b35_lead_maschine`.
Testdienste: Apify-, Places- und Website-Nachbau (`/apify`, `/places`, `/leadweb`).

**Werkzeuge:** keine neuen und keine geänderten Claude-Werkzeuge → kein `notifications/tools/list_changed` nötig.

**Offene Fragen an Ludwig:** (1) Welche Zielgruppen zuerst (Vorschlag: AdelPrep FBA-Prep + Spielwaren lokal)?
(2) Briefe je Woche und Budgets (Briefe, Apify, Places)? (3) Wer prüft rechtlich und bis wann (Stufe 2, Art.-14-Text,
Google-Places-Speicherregeln, LUCID)? (4) Welcher Briefanbieter, welcher Preis? (5) Kinderprodukte-Mitbewerber
ausschließen (Vorschlag ja – unter Schutzregeln eintragen)? (6) Lebensmittel/Wein/Kosmetik für AdelPrep überhaupt
anbieten?

## B36 Video-Pipeline (YouTube) (11.11.) – nur als Pull Request

Umsetzung auf dem Branch `b36-video-pipeline` mit Pull Request – kein Push nach main. Das Seller-System steuert nur
(Kanäle, Aufträge, Freigaben, Kosten, Dateien); Recherche, Skript, Sprache, Bilder, Render und Paket macht der **Worker
`unter-der-decke/`** (Python 3.12 + ffmpeg, Dockerfile) auf dem **Arbeits-PC**. Er holt sich die Aufträge selbst ab
(Token `vw_…`, alle ~30 s) – keine offenen Ports am PC. Claude, ElevenLabs und OpenAI ruft der Worker über die
**Anbieter-Brücke** des Seller-Systems auf: die Schlüssel bleiben verschlüsselt unter Anbindungen, der PC kennt nur sein
Token, und die Kosten werden je Auftrag gezählt. Der YouTube-Zugang (Refresh-Token) bleibt verschlüsselt im
Seller-System; der Worker bekommt nur ein kurzlebiges Upload-Token. **Upload immer privat** (fest im Code, im System
nicht änderbar; das Seller-System prüft die Sichtbarkeit danach). Keine echten Kanalnamen, Handles oder Stimmen im Code –
Kanäle legt Ludwig auf der Seite an.

**Widerspruch im Auftrag (umgesetzt nach der Entscheidung vom 11.11.):** B36.2 nennt noch „Worker bietet eine
HTTP-Schnittstelle, Seller-System ruft sie auf“ und die Umsetzungshinweise „Worker-Container in Coolify, Limit 1 CPU/
1,2 GB“. Beides gehört zum alten Plan (Worker auf dem Server). Gebaut ist der Abhol-Weg (Worker fragt an, keine offenen
Ports), Start per Docker Desktop oder Python am Arbeits-PC; CPU/RAM-Grenzen setzt man dort mit `--cpus/--memory`
(README).

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B36.2 Aufteilung: Seller-System nur Steuerung, kein ffmpeg/Python im Seller-Container | ❌ | ✅ Seller-System: Tabellen, Seite, Schnittstelle, Brücke; kein ffmpeg/Python. Worker: eigenes Projekt mit Dockerfile (python:3.12-slim + ffmpeg) | `src/lib/video/*`, `unter-der-decke/Dockerfile` |
| B36.2 Worker auf dem Arbeits-PC, holt Aufträge selbst (Token, ~30 s), keine Ports | ❌ | ✅ `worker.py` fragt `GET /api/video-worker/auftrag` ab, Lebenszeichen alle 30 s (auch während des Renders), Token als Bearer; Caddy-Freigabe für `/api/video-worker/*` | `worker.py`, `src/app/api/video-worker/*`, `deploy/claude-oeffentlich.sh` |
| B36.2 Fertige Dateien ins Seller-System, danach Arbeitsdateien löschen nach Bestätigung | ❌ | ✅ MP4, Thumbnail, Skript, Quellen, Untertitel als Strom hochgeladen (Platz-Prüfung, Reserve); Ordner am PC wird gelöscht, sobald das Seller-System ihn freigibt (fertig/abgebrochen), spätestens nach 14 Tagen | `dateiSpeichern`, `workerMelden`, `udd/projekt.py › aufraeumen` |
| B36.2 PC aus → „wartet“, „Worker zuletzt gesehen: …“, Warnung nach 10 Min. | ❌ | ✅ Hinweis oben auf der Seite; Aufträge eines schweigenden Workers zeigen „wartet (Worker aus)“; nach 10 Min. darf ein anderer Worker übernehmen | `workerStand`, `anzeigeStatus`, `naechsterAuftrag` |
| B36.2 Später auf einen Server: nur Token + Startort | ❌ | ✅ Worker braucht keine eingehende Verbindung; Token je Gerät, deaktivierbar | README „Später auf einen Server umziehen“ |
| B36.3 Seite „Video“ mobil: Kanalauswahl, „Neues Video“ mit Zeitpunkt („heute Nacht“) | ❌ | ✅ Marken & Content → Video: Kanal-Reiter, Thema, Start sofort/heute Nacht (23 Uhr)/Zeitpunkt, vidIQ-Felder, Kosten-Schätzung | `src/app/(app)/marken/video` |
| B36.3 Auftragsliste: Status je Schritt, Fortschritt je Szene, Fehler mit „Schritt wiederholen“ | ❌ | ✅ Schritt-Chips (research … upload) mit „n/m“ je Szene, Fortschrittsbalken, Fehlertext + „Schritt wiederholen“ (bezahlte Dateien werden weiterverwendet), Seite lädt sich während des Laufs neu | `SchrittChips`, `schrittWiederholen` |
| B36.3 Freigaben (Gliederung+Quellen, Skript, Vorschau+Thumbnail+Titel), je Kanal einstellbar | ❌ | ✅ drei Freigabe-Punkte mit Anmerkung, „Neu recherchieren“/„Skript neu schreiben“, Titelwahl bei der Vorschau; je Kanal an/aus | `freigeben`, `neuMachen`, `nachSchritt` |
| B36.3 Quellenliste (URL, Studie, Jahr), keine Aussage ohne Quelle | ❌ | ✅ Quellen mit ID, Jahr, Art, Link; Warnung, wenn eine Quelle nicht aus den Suchtreffern stammt; Skript-Prüfung: jede Punkt-Szene mit Quelle, nur IDs aus der Liste (sonst ein zweiter Versuch, danach Hinweis) | `udd/schritte.py › skript_pruefen` |
| B36.3 Kosten je Video (Schätzung vorab, Ist danach), Summe je Monat/Kanal, Wochenbericht | ❌ | ✅ Schätzung beim Anlegen, Ist aus der Brücke (Claude-Tokens + Websuchen aus der Antwort bzw. dem Stream, ElevenLabs-Zeichen, Bilder), Posten je Anbieter, Monatssumme je Kanal, Zeile im Wochenrückblick (Feierabend); Preise auf der Seite einstellbar | `anbieter.ts`, `kostenUebersicht`, `videoWochenZeile` |
| B36.3 „Privat hochladen“ je Video, öffentlich nicht einstellbar | ❌ | ✅ Schalter je Auftrag (Standard aus); Sichtbarkeit fest `private`; Seller-System prüft nach dem Upload „private“ – sonst Fehler mit Hinweis | `hochladenSchalten`, `PRIVAT`, `youtubeBestaetigen` |
| B36.3 Zugangsdaten nur über das sichere Formular | ❌ | ✅ Anbindungen „ElevenLabs“ und „OpenAI (Bilder)“ neu, Claude wie bisher, Google-App mit YouTube-Bereichen; YouTube je Kanal per Anmeldung (Refresh-Token verschlüsselt); Worker-Token nur einmal angezeigt (nur Prüfsumme gespeichert) | `registry.ts`, `api/oauth/youtube/*`, `workerAnlegen` |
| B36.4 Kanalprofil (Name, Handle, Sprache, Themenbereich, Stimme, Bildstil, Sicherheitsstufe, Musik, YouTube) | ❌ | ✅ im Seller-System editierbar; der Worker legt je Kanal `kanal.json` ab (zum Nachsehen) | Tabelle `video_kanaele`, `Lauf.__init__` |
| Zielgruppe je Kanal (Nachtrag 11.11.: „Männer 55+, nicht allgemein“) | – | ✅ Feld „Zielgruppe“ im Kanalprofil (Wert nur in der Oberfläche, nicht im Code); steht in jedem Prompt (Recherche, Skript, Paket): Ansprache, Beispiele und Sorgen auf diese Gruppe, Studien mit dieser Altersgruppe bevorzugen | `video_kanaele.zielgruppe`, `Lauf.kopf` |
| Videolänge 16–20 Min. (Nachtrag 11.11., wie die englischen Vorbilder) – **abgelöst 12.11.: fest 1.500–1.700 Wörter (s. Nachtrag 12.11.)** | – | ✅ Länge je Kanal (Standard 16–20 Min., einstellbar 3–60); daraus eine Quelle für alle Ziele: 2.300–2.900 Wörter (145 Wörter/Min.), 27–45 Szenen à 50–100 Wörter, 3–6 Szenen je Punkt, Render-Prüfung 16–20 Min., Kostenschätzung (≈ 17.200 Zeichen, ≈ 40 Bilder); Zielzeile über „Neues Video“ | `laengeZiel`, `typischFuer`, `auftragFuerWorker.laenge`, `skript_pruefen(ziel)` |
| Englische Vorlage oder eigenes Skript je Auftrag (Nachtrag 11.11.) | – | ✅ optionales Feld beim Anlegen (bis 40.000 Zeichen). „Vorlage“: nur Muster für Hook, Aufbau, Spannungsbogen – nicht übersetzen, keine Sätze/Zahlen ungeprüft übernehmen, alles neu belegen. „Mein Skript“: wird möglichst wörtlich übernommen, in Szenen geteilt, Quellen werden gesucht; seit 13.11. nie verlängert (Länge bleibt, −10 %/+5 %), über 1.700 Wörter auf 1.500–1.700 gekürzt; Sicherheitsstufe gilt | `video_auftraege.vorlage/vorlage_art`, `Lauf.vorlage_text` |
| B36.5 research: Gliederung + Quellen (Websuche) | ❌ | ✅ Claude mit Websuche (`web_search_20260209`), „pause_turn“ wird fortgesetzt; vidIQ-Keywords und Anmerkung fließen ein | `research()` |
| B36.5 script: Hook → Fear Activation → 5–7 Punkte mit Studie → Zusammenfassung → CTA, 1.500–1.700 Wörter, JSON je Szene | ❌ | ✅ strukturierte Ausgabe (JSON-Schema) je Szene {abschnitt, text, bildidee, einblendung, quelle_ids}; Prüfung Wörter/Punkte/Quellen. Wortzahl seit Nachtrag 11.11. aus der Kanallänge (Standard 16–20 Min. = 2.300–2.900 Wörter) | `script()`, `SKRIPT_SCHEMA` |
| B36.5 voice: ElevenLabs je Szene | ❌ | ✅ je Szene über die Brücke (Stimme aus dem Kanalprofil, eleven_multilingual_v2, MP3) | `voice()` |
| B36.5 visuals: Symbolbilder, OpenAI gpt-image-1, 1536×1024, medium, Anbieter austauschbar | ❌ | ✅ wie gefordert; Anbieter-Aufruf an einer Stelle (`_bild_holen`) | `visuals()` |
| B36.5 render: ffmpeg + Pillow, Untertitel, Musik | ❌ | ✅ Szenenbild 1920×1080 mit Einblendung (Pillow), Clip je Szene mit eingebrannten Untertiteln, Zusammenfügen, Musik leise unterlegt (optional); Prüfung 1920×1080 und Länge laut Kanal (Standard 16–20 Min., vorher 10–12) | `render()`, `udd/medien.py` |
| B36.5 package: Thumbnail 1280×720 (max. 4 Wörter), 5 Titel, Beschreibung mit Kapiteln, Tags | ❌ | ✅ Kapitel aus den Szenenlängen (YouTube-Regeln: 0:00, ≥ 3, ≥ 10 s), Quellen in der Beschreibung, Tags ≤ 480 Zeichen | `package()`, `medien.kapitel` |
| B36.5 upload: YouTube Data API, privat | ❌ | ✅ resumable Upload (Fortsetzen nach Abbruch), Thumbnail setzen, danach Sichtbarkeits-Prüfung durchs Seller-System | `upload()` |
| B36.5 Jeder Schritt einzeln startbar/wiederaufnehmbar, bezahlte Dateien nie doppelt | ❌ | ✅ `state.json` je Projekt; Sprache/Bilder mit Inhalts-Hash (nur Geändertes kostet), atomar geschrieben; Schritt wiederholen setzt nur diesen und spätere zurück | `udd/projekt.py`, `ausfuehren()` |
| B36.6 Platz am PC (mind. 5 GB empfohlen, < 3 GB kein Lauf, Meldung im System) | ❌ | ✅ Worker meldet freien Platz; < 3 GB: Worker startet nichts und das Seller-System gibt keinen Auftrag heraus („Zu wenig freier Speicher …“); < 5 GB Warnung | `naechsterAuftrag`, `frei_gb`, Seite „GB frei am PC“ |
| B36.6 Zwischenclips nach dem Render löschen, Projekt nach Bestätigung/14 Tagen | ❌ | ✅ siehe oben | `zwischendateien_loeschen`, `aufraeumen` |
| B36.6 Seller-Server nimmt nur fertige Dateien; vorher Platz schaffen oder Google Drive | ❌ | ✅ Ablage wählbar (Entscheidung 11.11.: Drive). **Google Drive**: einmal „Google Drive verbinden“ (Bereich drive.file, Refresh-Token verschlüsselt); der Worker lädt MP4, Thumbnail, Skript, Quellen und Untertitel per resumable Upload direkt nach „Seller-System Videos/<Kanal>/<Datum Thema>“ – kein Video läuft über den Seller-Server, dort nur die kleinen Dateien; Vorschau und Download öffnen Drive; der YouTube-Upload holt das Video bei Bedarf aus Drive. **Seller-Server**: wie bisher mit Platz-Prüfung und Reserve | `driveZugangFuerWorker`, `driveDateiMerken`, `udd/schritte.py › _dateien_sichern`, `_video_holen` |
| Claude-Modell (Rückfrage 11.11.) | – | ✅ wählbar auf der Seite (Modell und Ablage); Standard **Opus 5.5**, Sonnet 5.5 als günstigere Wahl; Kosten je Aufruf nach Listenpreis des Modells (oder eingetragenem Preis), Schätzung nennt das Modell | `VIDEO_MODELLE`, `claudePreis`, `Lauf.modell` |
| B36.6 Nur ein Render gleichzeitig (Warteschlange) | ❌ | ✅ ein Auftrag je Mandant gleichzeitig, Rest wartet der Reihe nach | `naechsterAuftrag` |
| B36.6 Filter für Bildideen und Titel, Ersatzbild bzw. Rückfrage | ❌ | ✅ gemeinsame Wortliste `filter.json` (Seller + Worker); Bildidee mit Treffer → ruhiges Ersatzmotiv (streng zusätzlich Bett/Kuss/Berührung); Titel mit Treffer → neuer Versuch, sonst Warnung bei der Vorschau-Freigabe; Anbieter lehnt ab → Ersatzmotiv, sonst lokales Ersatzbild | `filter.json`, `bild_treffer`, `titelTreffer` |
| B36.8 vidIQ Stufe 1: Felder „Keywords/Ideen“ und „Titelvorschläge“, Claude trägt ein | ❌ | ✅ Felder beim Anlegen und je Auftrag; Werkzeug `video_vidiq_eintragen`; Seller-System und Worker rufen vidIQ nie auf | `vidiqEintragen`, `tools/video.ts` |
| B36.8 Stufe 2 (eigene vidIQ-API) | ❌ | ❌ nicht gebaut – nur falls vidIQ eine offizielle API für den Tarif bietet | – |
| Video aus dem claude.ai-Chat anlegen (Rückfrage 11.11., „Ja“ 12.11.) | ❌ | ✅ ändernde Werkzeug `video_auftrag_anlegen` (Stufe gelb): Kanal per Name, Thema, optional englische Vorlage oder eigenes Skript (ab 200 Zeichen, bis 40.000), Start sofort/nacht/Zeitpunkt, vidIQ-Daten; erst Rückfrage mit Zusammenfassung (Kanal, Stil, Länge, Zielgruppe, Start, Kostenschätzung, Freigaben, Worker), angelegt erst mit `bestaetigt=true`; ohne Änderungsrecht nicht sichtbar; Protokoll im Assistent-Verlauf | `tools/video.ts › videoAuftragAnlegenTool`, `auftragAnlegen` |
| B36.1 Später je Video 3 Shorts | ❌ | ❌ nicht Teil dieses Auftrags („später“) | – |

| Abnahme | Ergebnis |
|---|---|
| 1. Kanal wählen, Thema „Kein Sex mehr in der Beziehung? 5 Gründe, über die keiner spricht“ → Gliederung mit Quellen zur Freigabe | ✅ automatisch (`b36-video.spec.ts`, echter Python-Worker gegen die Nachbauten): 5 Punkte, 6 Quellen, Websuche angefragt, vidIQ-Keywords in der Recherche |
| 2. Skript 5–7 Punkte, 1.500–1.700 Wörter (seit 11.11.: 16–20 Min. = 2.300–2.900 Wörter), alle Studien in der Quellenliste | ✅ automatisch: 2.600 Wörter (Prompt verlangt 2.300–2.900, Zielgruppe „Männer ab 55“ und „16–20 Minuten“ stehen in der Recherche), 5 Punkte, jede Punkt-Szene mit Quelle, alle IDs in der Liste |
| 3. Nach den Freigaben MP4 (seit 11.11.: 16–20 Min., 1920×1080) mit Untertiteln; Thumbnail, 5 Titel, Beschreibung mit Kapiteln, Tags | ✅ automatisch: ffprobe 1920×1080 und 16–20 Min., Untertitel-Datei, Thumbnail 1280×720, 5 Titel, „Kapitel: 0:00 Intro …“, Quellen, Tags; Video im Player (Range-Abruf 206) |
| 4. Abbruch mitten im Lauf → Neustart setzt fort, ohne Sprache/Bilder neu zu bezahlen | ✅ automatisch: Worker während „Sprache“ hart beendet, neu gestartet: jede Szene genau einmal bei ElevenLabs (höchstens die beim Abbruch laufende doppelt), Bilder je Szene einmal |
| 5. Upload erzeugt ein privates Video | ✅ automatisch: YouTube-Anmeldung (Nachbau), „Privat hochladen“ an, Vorschau freigegeben → Nachbau meldet `private`, gewählter Titel, Thumbnail gesetzt; Seller-System prüft „privat“ |
| 6. Kosten pro Video in der Liste | ✅ automatisch: Ist > 0 mit Posten Claude/ElevenLabs/OpenAI, Monatssumme je Kanal, Zeile im Wochenrückblick |
| 7. Worker auf dem Arbeits-PC; Seller-System unbelastet; Worker aus → „wartet“ + Warnung | ✅ automatisch: vor dem Start „wartet“ + Warnung; nach 11 Min. ohne Meldung „wartet (Worker aus)“ + „seit 11 Min. keine Meldung“; Render nur im Worker (kein ffmpeg im Seller-System); < 3 GB frei → kein Auftrag |
| 8. OpenAI gpt-image-1 erzeugt die Bilder; bei Ablehnung greift ein Ersatzbild | ✅ automatisch: alle Bilder gpt-image-1/1536×1024/medium; abgelehnte Bildidee → Ersatzmotiv; „Bett“ (Sicherheitsstufe streng) erreicht den Anbieter gar nicht |
| B36.6 Ablage Google Drive (Nachtrag 11.11.) | ✅ automatisch (zweiter Test): Drive verbinden (Nachbau), Kanal ohne Freigaben → MP4 nur in Drive im Ordner „Seller-System Videos/<Kanal>/<Datum Thema>“ (gleiche Größe), kleine Dateien zusätzlich im Seller-System, kein MP4 auf dem Server; Vorschau/Download leiten nach Drive; nach dem Aufräumen am PC holt „Privat hochladen“ das Video aus Drive → privat auf YouTube; Claude lief mit Opus 5.5. Dabei Thema des ersten echten Durchlaufs („Mit 60, 70 oder 80: …“), Kanallänge 12–14 Min. (Prompt verlangt 1.750–2.050 Wörter, Skript in der Spanne) und eine englische Vorlage (erfundener Text) – Recherche-Prompt enthält Vorlage + „Nicht übersetzen“ |

Unit-Tests: `tests/b36-video.test.ts` (neu, 12 Tests: Schrittfolge/Freigaben, Worker-Stand, „heute Nacht“, Kosten aus
JSON und Stream je Modell, Länge je Kanal, Filter, kein Render im Seller-System), `unter-der-decke/tests/test_worker.py` (13 Tests: Filter, state.json, Aufräumen, Untertitel,
Kapitel, Skript-Prüfung je Länge, Zielgruppe/Vorlage im Prompt, Bilder, ffmpeg-Clip; dazu 9 Whiteboard-Tests), `tests/nav.test.ts` (89 Einträge). Migrationen: `0149_b36_video`, `0150_b36_zielgruppe_laenge`, `0151_b36_whiteboard`.
Testdienste: Nachbau ElevenLabs (stille MP3 je nach Textlänge), OpenAI-Bilder (PNG, Ablehnung), YouTube (Anmeldung,
resumable Upload, Sichtbarkeit, Thumbnail), Claude-Antworten für Recherche/Skript/Paket (auch als Stream). GitHub-Prüfung
installiert dafür Python 3.12 + ffmpeg und führt die Worker-Tests aus.

**Werkzeuge:** drei neue – `video_auftraege` (lesend: Status je Auftrag, Freigaben, Fortschritt, Kosten, Worker-Stand,
Claude-Modell, Ablage, je Kanal Zielgruppe, Länge und Stil, je Auftrag Vorlage/eigenes Skript),
`video_vidiq_eintragen` (ändernd, Stufe grün, Rückgängig 7 Tage) und `video_auftrag_anlegen` (ändernd, Stufe gelb,
Nachtrag 12.11.: neues Video aus dem claude.ai-Chat mit Thema, optional englischer Vorlage oder eigenem Skript, Startzeit
und vidIQ-Daten; erst Rückfrage mit Zusammenfassung, angelegt erst nach „Ja“). `notifications/tools/list_changed`
nötig – geht beim Verbinden raus.

**Geklärt (11.11.):** Ablage in **Google Drive** (gebaut, s. o.); Claude-Modell **Opus 5.5** (Standard, umschaltbar);
Zeitlux-Kanal auf YouTube ist Ludwig bekannt – angelegt wird er auf der Seite Video (nicht im Code). Zielgruppe
„Männer 55+“ und Länge 16–20 Min. (Nachtrag 11.11.) – Zielgruppe wird im Kanalprofil eingetragen, 16–20 Min. ist Standard.
Erstes echtes Video: Thema „Mit 60, 70 oder 80: Warum manche Männer lange können und andere nicht“.

**Offene Fragen an Ludwig:** (1) Zeitlux: Themenbereich, Stimme (ElevenLabs-Voice-ID), Bildstil. (2) vidIQ: reichen
170 Credits/Monat, gibt es eine API für den Tarif (sonst bleibt es bei Stufe 1)? (3) Docker Desktop auf dem Arbeits-PC
vorhanden, oder lieber Python direkt? (4) ElevenLabs-Tarif und Preis je 1.000 Zeichen, OpenAI-Preis je Bild (für die
Kostenanzeige). ~~(5) Neues Video aus dem claude.ai-Chat anlegen~~ – geklärt 12.11.: ja, gebaut als
`video_auftrag_anlegen` (s. u.).

### B36.9 Stilprofil „Whiteboard-Collage“ (Nachtrag 11.11., nach Bildschirmfotos aus dem Kanal)

Gilt je Kanal (Kanalprofil → „Stil der Bilder: Whiteboard-Collage“); der bisherige Stil „Vollbild“ bleibt für andere
Kanäle. Länge seit 12.11. fest 1.500–1.700 Wörter (≈ 10–12 Min.) für alle Kanäle.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B36.9 Stil: weißer Hintergrund, 3–5 Cartoon-Clipart-Motive je Szene, kräftige Umrisse, flache Farben | ❌ (ein Vollbild je Szene) | ✅ Motive einzeln (gpt-image-1, 1024×1024, `background: transparent`, Qualität je Kanal), Stil-Text + bis zu 4 **Stil-Referenzbilder** aus dem Kanalprofil über `images/edits`; weißer Hintergrund beim Freistellen wird durchsichtig | `udd/schritte.py › visuals_wb, _motiv_holen`, `udd/whiteboard.py › freistellen`, Brücke `bildBearbeiten` |
| B36.9.1 Layout-Engine mit festen Raster-Vorlagen | ❌ | ✅ 3er, 4er (2×2), 5er (3+2), Figur links + Liste, Gegenüberstellung; Kopfzone (Überschrift, roter Balken) und Fußzone (Kernaussage, Schritt) werden freigehalten | `whiteboard.py › slots, elemente` |
| B36.9.2 Text nicht vom Bildmodell, feste Schrift, Umlaute | ❌ | ✅ Schrift **Anton** (OFL, im Worker unter `schriften/`); Überschrift schwarz, Aussagesatz im **roten Balken** weiß, Kernaussage **rot**, „Schritt N: …“ im **schwarz umrandeten Kasten**, Stichpunkte mit orangem Punkt; Bild-Prompts verbieten Schrift | `whiteboard.py › _text_ebene, _balken, _schritt_kasten` |
| B36.9.3 Aufdeck-Animation, Hand folgt, Dauer nach Sprecherlänge, danach blasser Hintergrund | ❌ | ✅ Elemente nacheinander von links nach rechts aufgedeckt, **Hand mit Stift** an der Kante (einmal je Kanal erzeugt, sonst gezeichnet), Zeitplan passt sich der Szenenlänge an; vorige Szene bleibt mit **15 %** stehen | `whiteboard.py › animation, hintergrund`, `medien.clip_bilder` |
| B36.9.4 Untertitel als YouTube-Untertitel, nicht eingebrannt | ❌ (eingebrannt) | ✅ SRT aus dem Sprech-Timing, beim privaten Upload per `captions.insert` als Spur „Deutsch“; Recht `youtube.force-ssl` ergänzt (bei Fehler Hinweis statt Abbruch) | `_untertitel_hochladen`, `YT_SCOPES` |
| B36.9.5 Stil-Bibliothek im Kanalordner, Wiederverwendung, feste Figuren | ❌ | ✅ `motive/` + `index.json` je Kanal; Claude bekommt die Liste und verwendet Schlüssel wieder (kostet nichts); Figuren im Kanalprofil („kurzname: Beschreibung“) werden immer gleich beschrieben und einmal gezeichnet | `whiteboard.Bibliothek`, `_wb_regeln`, `figurenAus` |
| B36.9.6 Freigabe: Übersicht aller Szenen vor dem Render, einzelne Motive neu erzeugen | ❌ | ✅ neue Freigabe „Szenen-Übersicht (Motive)“ nach den Bildern (im Kanal einschaltbar); Raster aller fertigen Szenen + Motiv-Chips; „Ausgewählte Motive neu erzeugen“ verwirft nur diese (je Runde einmal, auch nach Neustart nicht doppelt) | `FREIGABE_NACH.visuals`, `motiveNeu`, Seite `vd-szenen` |
| Kosten | – | ✅ Preis je Motiv (eigenes Feld, sonst Preis je Bild); Schätzung zeigt die Obergrenze ohne Wiederverwendung (16–20 Min. ≈ 160 Motive) | `typischFuer(…, "whiteboard")`, `motivPreis` |

| Abnahme | Ergebnis |
|---|---|
| Testvideo neben dem Referenzvideo: Hintergrund, Schrift, Farben, Collage-Aufbau, Hand und blasser Hintergrund stimmen sichtbar überein | 🟡 automatisch geprüft (`b36-video.spec.ts › B36.9`, echter Worker, Nachbauten): Motive 1024×1024 transparent mit Referenzbild, jede Motiv-Art nur einmal bezahlt, Hand einmal, feste Figur aus dem Profil, Ablehnung → Ersatzmotiv, Szenen-Übersicht + „neu erzeugen“ (genau 1 neues Bild), Video 1920×1080 beginnt mit leerem Whiteboard, Szene 1 mit Überschrift/Motiven auf Weiß, **keine eingebrannten Untertitel**, roter Balken in Szene 2, Kosten je Motiv, privater Upload mit Untertitel-Spur „Deutsch“. Pixelprüfungen der Bausteine in `test_worker.py` (Balken rot, Kernaussage rot, Weiß, 15 % blass, Hand während des Aufdeckens, keine Hand am Ende, Anton mit Umlauten). **Offen:** der Sichtvergleich mit dem echten Referenzvideo – geht nur mit echten Motiven (To-do 176–178) |

### B36 Nachtrag 12.11.: Robuste Aufrufe, Skript und Recherche abschnittsweise

Anlass: Schritt „Skript“ brach ab mit „peer closed connection without sending complete message body (incomplete chunked
read)“ – das ganze Skript kam bisher in **einem** Aufruf (bis 32.000 Tokens, mehrere Minuten), und die Verbindung riss
mittendrin ab. Entscheidung 12.11.: **Skriptlänge fest 1.500–1.700 Wörter für alle Kanäle** (≈ 10–12 Min.; ersetzt die
Länge im Kanalprofil). Schlüssel unverändert.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| 1. Skript abschnittsweise (Hook, Fear Activation, jeder Punkt einzeln, Zusammenfassung, CTA), kurze Antworten | ❌ ein Aufruf für alles | ✅ je Abschnitt ein Aufruf (max. 4.000 Tokens, Whiteboard 6.000) mit Gliederung, Quellenliste und dem bisher geschriebenen Text als Anschluss; Wortziel je Abschnitt so verteilt, dass die Summe 1.500–1.700 ergibt (Hook 7 %, Fear 10 %, Punkte 70 %, Zusammenfassung 8 %, CTA 5 %) | `udd/schritte.py › script`, `_abschnitt_schreiben`, `abschnitt_ziele` |
| 2. Fertige Abschnitte sofort speichern, bei Fehler nur den fehlenden neu | ❌ | ✅ `<Projekt>/skript/<Eingabe-Hash>/<abschnitt>.json` (bzw. `recherche/…`) atomar nach jedem Abschnitt; neuer Versuch holt nur fehlende. Andere Eingabe (Gliederung, Anmerkung, Vorlage, Modell) = neuer Ordner. „Skript neu schreiben“/„Neu recherchieren“ (Schritt war fertig) verwirft die Abschnitte, „Schritt wiederholen“ nach Fehler behält sie | `Ablage`, `ausfuehren` (`ABSCHNITT_ORDNER`) |
| 3. Streaming mit Timeout (120 s je Aufruf) | 🟡 Streaming ohne Gesamtfrist (900 s) | ✅ Claude gestreamt, Gesamtfrist 120 s je Aufruf (mit Websuche 240 s), Lesefrist 120 s; Stream ohne Abschluss gilt als abgebrochen. ElevenLabs/OpenAI ebenfalls gestreamt gelesen, Frist 120 s (Bilder 180 s, weil der Anbieter dafür oft länger braucht) | `udd/ki.py › _einmal`, `udd/netz.py › lesen`; `KI_TIMEOUT_S` |
| 4. Abbruch, Timeout, 429, 5xx: bis zu 4 Wiederholungen nach 2, 4, 8, 16 s, dann Fehler mit Abschnittsname | 🟡 SDK 2 Versuche (nicht bei Abbruch mitten im Stream), Brücke 3 Versuche à 5/10/15 s | ✅ ein Muster für alle: `mit_wiederholung` (5 Versuche, 2/4/8/16 s; 400/401/Ablehnung nicht wiederholt). Fehler z. B. „Skript – Punkt 3: nach 5 Versuchen nicht geklappt (peer closed connection …)“ | `udd/netz.py` |
| 5. Gleiches Muster für Recherche und alle Aufrufe an Claude, ElevenLabs, OpenAI | ❌ | ✅ Recherche: erst Gliederung (kleine Websuche), dann je Punkt ein Aufruf für die Quellen (bis 3 Suchen), IDs Q1… beim Zusammenführen, gleiche URL nur einmal. Paket, Sprache je Szene, Bilder/Motive je Szene mit Namen („Sprache – Szene 7“, „Motiv „banane“ (Szene 3)“). Brücke im Seller-System: abgebrochene Anbieter-Antwort → 502 (wird wiederholt) | `research`, `Seller.anbieter`, `anbieter.ts` |
| 6. Zusammenführen und prüfen: 1.500–1.700 Wörter, 5–7 Punkte, jede Studie in der Quellenliste | 🟡 Prüfung Wörter/Punkte/IDs, Korrektur = ganzes Skript neu | ✅ Prüfung zusätzlich „Szene nennt eine Studie ohne Quelle“; Nachbesserung höchstens 2 Runden und **nur der betroffenen Abschnitte** (zu kurz: bis 3 Punkte verlängern, zu lang: die längsten kürzen, fremde/fehlende Quelle: dieser Abschnitt). Was danach bleibt, steht als Hinweis an der Skript-Freigabe | `skript_pruefen`, `_korrekturen` |
| Hinweis „Worker veraltet“ (Nachtrag 12.11. abends: Fehler kam weiter vom alten Worker am PC) | – | ✅ Worker meldet v1.1.0; meldet er eine ältere Version, zeigt die Seite Video oben „Der Worker am PC ist veraltet (v…, aktuell v1.1.0)“ mit Verweis auf README „Aktualisieren“ | `WORKER_VERSION_AKTUELL`, `workerVeraltet`, `vd-worker-alt` |
| Eigenes Skript (Entscheidung 13.11.: „kürzen“) | – | ✅ nie verlängern: kürzer als 1.700 Wörter → eigene Länge bleibt (Ziel −10 %/+5 %, Prompt „nicht verlängern, nichts auffüllen“, Minuten und Render-Prüfung passend); länger → auf 1.500–1.700 kürzen. Worker v1.1.1 | `Lauf.woerter_ziel`, `vorlage_text` |
| Länge fest 1.500–1.700 Wörter | – | ✅ Seller-System: eine Quelle `laengeZiel()` (10–12 Min., 15–34 Szenen) für Seite, Schätzung, Claude-Werkzeuge und Worker; im Kanalprofil statt „Länge von/bis“ der Hinweis „fest 1.500–1.700 Wörter“. Schätzung neu: ≈ 112k/15k Tokens, 12 Websuchen, 10.600 Zeichen, 25 Bilder (Whiteboard ≤ 100 Motive) | `SKRIPT_WOERTER`, `laengeZiel`, `typischFuer` |

| Abnahme | Ergebnis |
|---|---|
| Abbruch mitten im Stream wird wiederholt (genau der Fehler aus dem Betrieb) | ✅ automatisch: Python-Test mit echtem Abbruch („incomplete chunked read“) und 503 → dritter Versuch liefert vollständig; dauerhaft kaputt → Fehler „Skript – Punkt 2 … incomplete chunked read“. Ablauftest: Hook bricht im Nachbau einmal ab → zweiter Aufruf, Log „neuer Versuch in 2 s“ |
| Fehler mit Abschnittsname, Wiederaufnahme nur des fehlenden Abschnitts | ✅ automatisch (`b36-video.spec.ts`): „Punkt 3“ bricht 5-mal ab → Schritt-Fehler „Skript – Punkt 3: nach 5 Versuchen nicht geklappt“, im Projektordner liegen hook/angst/punkt-1/punkt-2; „Schritt wiederholen“ → nur Punkt 3–5, Zusammenfassung, CTA werden geholt (Hook, Fear, Punkt 1–2 nicht erneut) |
| Recherche abschnittsweise, 529 wird wiederholt | ✅ automatisch: Gliederung + 5 Quellen-Aufrufe mit Websuche, „Punkt 2“ nach 529 erneut, 5 Punkte, 6 Quellen |
| ElevenLabs-Abbruch wird wiederholt, ohne doppelte Kosten | ✅ automatisch: zwei Abbrüche, danach jede Szene genau einmal erzeugt |
| Endprüfung bessert nur betroffene Abschnitte nach | ✅ automatisch (Python): alle Abschnitte 25 % zu kurz + fremde Quelle in Punkt 2 → höchstens 4 Abschnitte neu, Hook nicht; Ergebnis 1.500–1.700 Wörter, keine fremde ID |
| Echte Anbieter | offen: erstes Video mit echten Zugängen (Kosten je Abschnitt in der Liste) |

### B36 Nachtrag 13.11.: Bildmodell (gpt-image-1 abgeschaltet) und falscher OpenAI-Schlüssel

Anlass: Schritt „Bilder“ brach erst mit „HTTP 401: Incorrect API key provided: .\.venv\…“ ab (statt des Schlüssels war
ein Pfad eingetragen), nach dem Neueintrag mit „HTTP 400: The model 'gpt-image-1' does not exist“ – OpenAI hat
gpt-image-1 am 23.10.2026 abgeschaltet (gpt-image-1.5/-1-mini folgen am 01.12.2026; Nachfolger laut OpenAI-Doku
gpt-image-2.5-flare/-sunburst, daneben gpt-image-2). Schlüssel unverändert.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Bildmodell aktuell | ❌ fest gpt-image-1 im Worker | ✅ Standard **GPT Image 2.5 Flare**, wählbar auf der Seite Video → „Modell und Ablage“ (Flare / Sunburst / GPT Image 2). Die Anbieter-Brücke setzt das Modell selbst – auch ältere Worker laufen ohne Update weiter | `BILD_MODELLE`, `anbieter.ts › mitBildModell`, `vd-bildmodell` |
| Modell fehlt im Konto | ❌ Abbruch | ✅ Antwort „model does not exist / not found / no access / must be verified“ → nächstes Modell der Liste; das funktionierende wird 30 Min. gemerkt (kein Fehlversuch je Bild). Inhalts-Ablehnung zählt nicht (→ Ersatzmotiv wie bisher). Fehlen alle: klare Meldung mit „Projekt → erlaubte Modelle / Verify Organization“. Kosten-Zeile nennt das benutzte Modell („Bild (GPT Image 2.5 Flare)“) | `bildModellFehlt`, `bildModellReihenfolge`, `kostenPosition` |
| Falscher Schlüssel | ❌ OpenAI-Text mit Schlüsselteilen im Auftrag | ✅ 401 von OpenAI, ElevenLabs oder Claude → „OpenAI-Schlüssel abgelehnt (HTTP 401) – unter Anbindungen → OpenAI (Bilder für Videos) den API-Key neu eintragen …“, nie Teile des Schlüssels | `schluesselAbgelehnt`, `weiterleiten` |
| „Verbindung testen“ für OpenAI | ❌ „Für diese Anbindung gibt es noch keinen Test.“ | ✅ prüft den Schlüssel über die Modellliste (kostet nichts) und nennt das tatsächlich benutzte Bildmodell („Schlüssel gültig. Bildmodell für Videos: …“) bzw. „Schlüssel abgelehnt (HTTP 401) – neu eintragen“; Hinweis am Feld „nur den Schlüssel einfügen (beginnt mit „sk-“)“ | `clients/openai.ts`, `registry.ts` |
| Worker | – | v1.1.2: Vorgabe gpt-image-2.5-flare statt gpt-image-1 (nur kosmetisch, das Seller-System entscheidet) – Update nicht nötig | `udd/schritte.py › BILD_MODELL` |

| Abnahme | Ergebnis |
|---|---|
| Vollbild-Video: Bilder mit dem Standardmodell, gpt-image-1 kommt nie beim Anbieter an | ✅ automatisch (`b36-video.spec.ts › Abnahme B36.7`): Nachbau lehnt gpt-image-1 wie OpenAI ab; alle Bilder `gpt-image-2.5-flare`, kein Fehlversuch |
| Bildmodell auf der Seite wählen | ✅ automatisch (Drive-Test): Sunburst wählen → „Gespeichert: … Bilder GPT Image 2.5 Sunburst“; alle Bilder des Laufs mit Sunburst, Kosten-Zeile „Bild (GPT Image 2.5 Sunburst)“ |
| Gewähltes Modell fehlt im Konto → Ausweichen | ✅ automatisch (Whiteboard-Test): Sunburst gewählt, im Nachbau-Konto gesperrt → alle Motive mit Flare, Sunburst genau einmal versucht |
| Verbindung testen + falscher Schlüssel | ✅ automatisch: gültig → „Bildmodell für Videos: gpt-image-2.5-flare (gewählt ist gpt-image-2.5-sunburst …)“; Pfad statt Schlüssel → „Schlüssel abgelehnt (HTTP 401)“, Brücke 401 mit eigener Meldung, ohne „.venv“/„Incorrect API key“ |
| Echtes OpenAI-Konto | offen: „Verbindung testen“ zeigt, welche Modelle freigeschaltet sind; dann „Schritt wiederholen“ |


### B36.10 Tempo: ständig etwas Neues im Bild (Nachtrag 13.11., Rückmeldung zum ersten Testvideo)

Anlass: im ersten Whiteboard-Video nur 20 Szenen für 10:37 Min. (≈ 32 s je Szene), Motive dehnten ihre Zeichenzeit über
die ganze Szene, danach ca. 5 s Stillstand. Der Referenz-Renderer `pipeline/whiteboard.py` lag dem Auftrag nicht bei –
eigener Renderer im Worker (`udd/whiteboard.py`, Abschnitt „B36.10 Tempo“).

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| 1. Kürzere Szenen + Schlüsselwörter | ❌ 15–34 Szenen, 3–5 Sätze | ✅ Skript-Prompt verlangt Szenen mit 1–2 Sätzen (12–28 Wörter, 6–12 s), bei voller Länge 55–80 Szenen; je Motiv `wort` = Schlüsselwort aus dem Szenentext; Motive sollen in Folgeszenen wiederkehren (höchstens 1–2 neue je Szene). Endprüfung: Szenen über 32 Wörter bzw. unter 55 Szenen → Nachbesserung/Hinweis | `schritte.py › WB_SZENEN, wb_pruefen, _wb_regeln` |
| 2. Zeichenzeit je Motiv (`draw_s`) | ❌ über die Szene gedehnt | ✅ fest je Motiv nach Kanalprofil **Tempo**: ruhig 2,5 s · normal 2,0 s (Standard) · schnell 1,5 s | `whiteboard.py › TEMPO, draw_s`, Kanalprofil `vd-k-tempo` |
| 3. Takt aus Wortzeiten | ❌ gleichmäßig ohne Bezug zur Sprache | ✅ ElevenLabs `/with-timestamps` (gleicher Preis) liefert Zeichenzeiten → Wortzeiten; jedes Motiv startet bei seinem Schlüsselwort, ohne Wortzeiten gleichmäßig verteilt; Lücken über 2,6 s werden mit Hervorhebungen gefüllt (höchstens 6 je Szene) | `wortzeiten`, `takt_plan`, `voice()` |
| 4. Dauernde Bewegung | ❌ Standbild nach dem Zeichnen | ✅ sanfter Zoom je Szene (`VIDEO_ZOOM`, 7 %, Ankerpunkt wechselt), Text-Pop, Unterstreichen/Einkreisen/Pfeil als kleine Zeichen-Animation (Hand folgt), blasser Vorgänger, Szenenwechsel mit 0,3 s Wisch | `animation_takt`, `medien.py › zoom_filter`, `render_wb` |
| 5. Prüfung vor dem Render | ❌ – | ✅ je Szene längste Pause und Ø-Abstand; über 3 s → Hinweis in der Szenen-Übersicht „Szene N: x s ohne neue Aktion – mehr Motive oder Hervorhebungen“; dazu „Takt: N Szenen, Ø alle x s eine neue Aktion, längste Pause …“; Takt je Szene im Skript gespeichert | `takt_hinweise`, `VideoSzene.takt` |
| 6. Referenz-Renderer | – | ⚠️ nicht beigelegt – eigener Renderer mit denselben Parametern (`draw_s`, Startzeiten, `zoom`) | – |
| Kostenschätzung | ⚠️ „höchstens 100 Motive“ | ✅ „ca. 101 neue Motive“ (67 Szenen × 1,5 neue, Rest aus der Bibliothek) | `logic.ts › NEUE_MOTIVE_JE_SZENE` |
| Worker | v1.1.2 | **v1.2.0** (Update nötig, Seite Video zeigt „veraltet“, ältere Worker bekommen keine Stories) | `udd/__init__.py`, `WORKER_VERSION_AKTUELL` |

| Abnahme | Ergebnis |
|---|---|
| Testvideo im Schnitt mindestens alle 3 s eine neue Aktion | ✅ automatisch (`b36-video.spec.ts › B36.9/B36.10 Whiteboard-Collage`, Tempo „schnell“): **Ø alle 2,0 s** eine neue Aktion (vorher ≈ 32 s je Szene mit ca. 5 s Stillstand) |
| Keine Szene länger als 3 s Stillstand | ✅ automatisch: längste Zeit ohne Bewegung **2,57 s** (Szene 48); 15 Hervorhebungen füllen Lücken. Erster Lauf fand einen Fall mit 4,6 s (Szenenanfang ohne gezeichnetes Element, Motiv-Wort spät) – behoben: dann kommt das erste Element früher |
| 10–12 Min. Video mit mindestens 55 Szenen | ✅ automatisch: **63 Szenen** in 640 s (10:40 Min.), jede Szene ≤ 32 Wörter, Sprache je Szene mit Wortzeiten |
| Sichtprüfung am echten Video | offen: nach dem Worker-Update ein Whiteboard-Video rendern und ansehen (Takt, Zoom, Wisch, Hervorhebungen) |

## B37 Instagram-Kanäle und automatische Stories (13.11.) – im Reiter „Video“

Erster Kanal: der Prep-Center-Kanal (Business-Konto, täglich 12:00, keine Personen im Bild). Firmendaten, Preise und
Leistungen stehen **nicht im Code**: sie kommen nur aus dem Kanalprofil-Feld „Bestätigte Fakten“ (pflegst du).
Anbindung über die **Instagram-API mit Instagram-Login** (Business-Konto, Facebook-Seite nicht nötig).

| Punkt | Stand | Fundstelle |
|---|---|---|
| B37.1 Stories 9:16 (1080×1920), Freigabe am Handy, Posten zur Planzeit; kein Posten ohne Freigabe außer Modus „automatisch“ | ✅ gebaut | `story.ts › storyFertig, storiesPosten`, `stories.tsx` |
| B37.2 Kanalprofil: Plattform, Zeitplan (Tage, Uhrzeiten = Stories/Tag), Inhaltsarten, Farben, Hand an/aus, Hinweistext/Link, Werbekennzeichnung, Freigabe-Modus (jedes Mal / Stichprobe jede 5. / automatisch), Monatslimit, Bestätigte Fakten; Bildstil wie B36 | ✅ gebaut | `page.tsx › vd-k-plattform, vd-k-instagram`, `story-logic.ts › profilMitVorgaben` |
| B37.2 Instagram-Konto | ✅ über „Mit Instagram verbinden“ (Konto und Ablauf des Zugangs werden angezeigt) | `api/oauth/instagram/*`, `vd-instagram-zugang` |
| B37.2 Schrift | ⚠️ teilweise: fest Anton (wie Whiteboard), nicht je Kanal wählbar | `udd/story.py` |
| B37.3.1 Themenliste im Kanal | ✅ „art: Thema“ je Zeile; Planer nimmt ungenutzte, dann die am längsten nicht genutzten | `themenAus`, `naechstesThema`, `st-themen` |
| B37.3.2 Worker: Text 1–3 Sätze, Motiv (transparent, Bibliothek), Layout Hochformat, Hand-Animation, 5–15 s | ✅ gebaut (Schritt `story`, MP4 ohne Ton bzw. PNG ohne Hand, Vorschaubild) | `udd/story.py` |
| B37.3.3 Handy-Vorschau: freigeben / ablehnen / neu erzeugen (mit „Motiv neu“) | ✅ gebaut | `stories.tsx`, `storyFreigeben/Ablehnen/Neu` |
| B37.3.4 Posten über die API, Ergebnis in der Liste, 3 Wiederholungen (5/15/45 Min.), dann Meldung | ✅ gebaut; Datei über signierten 24-h-Link (`/api/public/story/…`) | `instagram.ts › igStoryPosten`, `storiesPosten` |
| B37.3.5 Kosten je Story und Monat, Monatslimit stoppt die Erzeugung | ✅ gebaut (Erzeugen/Planen gesperrt, wartende Story „Monatslimit erreicht“) | `storyKosten`, `story-sperre.ts`, `st-kosten` |
| B37.4 Inhaltsarten Preis, Leistung, Tipp, Einblick (Foto-Mediathek, nur „keine Personen“ bestätigt; Anteil nach freien Fotos), Umfrage (Sticker-Vorschlag, setzt du in der App – die API kann keine Sticker), CTA | ✅ gebaut | `STORY_ARTEN`, `fotosHochladen`, `st-sticker` |
| B37.4 Fakten nur aus bestätigten Angaben, keine „kostenlose Zählung“, keine Versicherung, „all-in“ nur mit Aufzählung | ✅ Prompt nur mit „Bestätigte Fakten“; Prüfung im Worker (eine Korrektur-Runde) und im Seller-System (gleiche Regeln wie B34.3) – Verstoß sperrt die Freigabe | `story_regeln`, `storyRegeln` |
| B37.4 Betreiber im Profil/Impressum | ⚠️ Sache des Instagram-Profils; Story-Ende zeigt deinen Hinweistext/Link aus dem Kanalprofil | `vd-ig-hinweis` |
| B37.5 Auslöser (neuer Kunde, Saison …) | ❌ bewusst nicht gebaut („später, Stufe 2“) | – |
| B37.6 Zugang: Langzeit-Token (60 Tage), täglich prüfen, ab 7 Tagen vor Ablauf erneuern bzw. warnen, abgelaufen → Meldung | ✅ gebaut | `instagramZugangPflegen`, Zeitplan „Instagram-Zugang pflegen“ |
| B37.6 Schlüssel nur übers sichere Formular | ✅ Anbindungen → Instagram (App-ID, App-Secret); Token je Kanal verschlüsselt | `registry.ts › instagram` |
| B37.6 Stufe 1 / Stufe 2 | ✅ ohne Verbindung: Erinnerung zur Planzeit + „Herunterladen“ / „Von Hand gepostet“; nach Verbindung automatisch | `storiesPosten` |
| B37.7 Werbung, keine fremden Logos, keine Personen/Daten Dritter, nichts Irreführendes, ein Render gleichzeitig, Plattenplatz | ✅ gebaut (Werbe-Etikett im Bild, Regeln in Prompt und Prüfung; Worker-Schutz wie B36) | `udd/story.py › elemente`, `storyRegeln` |

| Abnahme (B37.8) | Ergebnis |
|---|---|
| 1. Kanal anlegen, täglich 12:00, 1 Story/Tag, Freigabe „jedes Mal“ | ✅ automatisch (`b36-video.spec.ts › B37 Instagram-Stories`): „täglich um 12:00 Uhr · 1 Story/Tag · Freigabe: Vorschau jedes Mal“ (Testkanal statt echtem Konto) |
| 2. 5 Themen → 5 Stories im Hochformat, Handy-Vorschau zeigt alle | ✅ automatisch: 5 Stories (+1 Regel-Test) als MP4 1080×1920, 5–15 s, Einblick mit eigenem Foto ohne Bildanbieter; Handy (390 px) zeigt alle 6 ohne seitliches Scrollen |
| 3. Angaben wie B34.3 | ✅ automatisch: Preis nur aus den Fakten, „Enthalten: …“, keine „kostenlose Zählung“/Komplettpreis/Versicherung, „Werbung“ bei Preis/Leistung/CTA; Verstoß (Nachbau schreibt „kostenlose Zählung“) → Hinweis, Freigabe gesperrt |
| 4. Ablehnen/Neu erzeugen ohne Doppelkosten | ✅ automatisch: neuer Text mit gleichem Motiv (kein zweites Bild, genau ein Claude-Aufruf), „Motiv neu“ genau 1 Bild, Ablehnen → nichts gepostet; Wiederholung nach Fehler nutzt bezahlten Text/Motiv (Worker-Test) |
| 5. Posten zur Planzeit, Fehler/abgelaufen gemeldet | ✅ automatisch (Instagram-Nachbau): vor der Planzeit nichts, dann gepostet (Datei über signierten Link, falsche Signatur 404); 4 Fehlversuche → „nicht gepostet“ + Meldung; abgelaufener Zugang sofort gemeldet; „Erneut posten“ |
| 6. Kosten und Monatslimit | ✅ automatisch: Kosten je Story > 0, Anzeige „Monat … von 5,00 $ · je Story ca. …“; Limit erreicht → Erzeugen/Planen gesperrt, wartende Story „Monatslimit erreicht“ |
| Echtes Instagram-Konto | offen: Meta-App, App-Prüfung, öffentliche https-Adresse (siehe To-dos 183–185) |

Neue Claude-Werkzeuge: **keine** (kein `list_changed` nötig).

## Nachtrag B30 (06.11.): ArbitrageOne-Einkäufe – eigener Parser (Bestellungen) statt EK-Liste

Befund: Seit B27.1 übergab der Abruf die Datei `ArbitrageOne_PurchaseOrders_Export_<Datum>.xls` mit der Art `ek_liste`.
Der EK-Listen-Parser erwartet aber den sellerboard-Export (ASIN | SKU | Cost). Die Datei ist eine **Bestellliste** (eine
Zeile je Einkaufsposition). Deshalb scheiterten alle Läufe vom 02.–06.11. und „Erneut verarbeiten“ mit „Pflichtspalten
fehlen (ASIN, SKU und EK)“.

**Prüfung (vorher):**

| Punkt | vorher | Fundstelle |
|---|---|---|
| B30.1.1 Kopfzeile der Datei vom 06.11. ausgeben, Parser darauf bauen | ❌ Die Datei liegt nur verschlüsselt auf dem Server und ist hier nicht lesbar. Deshalb erkennt der Parser die Spalten über Synonyme (deutsch/englisch) und schreibt ins Ergebnis, welche Spalte er wofür gelesen hat (To-do 91) | – |
| B30.1.2 Ziel Einkauf → Bestellungen, Zuordnung über ASIN, „ohne Zuordnung“ | ❌ Datei ging an den EK-Listen-Parser | `AO_EXPORTE` (`art: "ek_liste"`) |
| B30.1.3 EK je SKU aus Lieferungen als Vorschlag, Warnung > 10 % gegen sellerboard-COG | ❌ EK-Zeilen ohne Warnung wurden sofort übernommen (wenn die Datei gepasst hätte) | `ekImportAutomatisch` |
| B30.1.4 Positionen aus der nächsten Tagesdatei nicht doppelt | 🟡 nur gleiche Datei (Prüfsumme) bzw. gleiche Einkaufszeile | `aoEinkaeufeSpeichern` |
| B30.2 Abruf übergibt `ao_einkaeufe` | ❌ `ek_liste` | `src/lib/arbitrageone/logic.ts` |
| B30.2 Erkennung beim manuellen Upload | ❌ erkannt als „EK-Liste“ | `dateiArt` (`src/lib/uploads/service.ts`) |
| B30.2 Fehlertext „gefunden: …, fehlt: …“ | ❌ nur „Pflichtspalten fehlen (ASIN, SKU und EK)“ | `parseArbitrageOne` |
| B30.3 Fehlimporte 02.–06.11. nachverarbeiten, „Erneut verarbeiten“ mit neuer Art | ❌ gespeicherte Art `ek_liste`; nach dem Versuch vom 06.11. 08:05 nie wieder automatisch | `aoFehlimporteNachverarbeiten` |

**Nachher:**

| Punkt | Stand | Fundstelle |
|---|---|---|
| Neue Importart `ao_einkaeufe` „ArbitrageOne – Bestellungen“ | ✅ | Parser (rein, getestet): `src/lib/arbitrageone/bestellungen-logic.ts`; Übernahme: `src/lib/arbitrageone/bestellungen.ts` |
| Spalten | ✅ Pflicht: ASIN, Menge, Bestelldatum und EK (Einzel- oder Gesamtpreis). Optional: Bestellnummer, Positions-ID, Lieferant/Shop, SKU, FNSKU, Produktname, USt-Satz, Versandkosten, Status, Lager, Charge, Währung. Netto/brutto aus dem Spaltennamen, umgerechnet mit dem USt-Satz der Zeile (sonst 19 %). Summenspalten gelten nie als Stückpreis (Gesamtpreis ÷ Menge). „Menge geliefert“ zählt nicht als Bestellmenge. Titelzeilen vor der Kopfzeile werden übersprungen | `aoBestellSpalten`, `aoBestellungenLesen` |
| Ziel Einkauf → Bestellungen | ✅ Eine Bestellung je Bestellnummer (ohne Nummer: Lieferant + Datum), Nummer `AO-<Bestellnummer>`. Neue Lieferanten werden angelegt. Je Position: Menge, geliefert, EK brutto + USt-Satz, Status (bestellt/versendet/teilweise/geliefert/storniert), SKU. Zuordnung zum Produkt über ASIN; ohne Produkt „ohne Zuordnung“ in Liste und Detail. Neue Ansicht „ArbitrageOne“ unter Einkauf | `src/app/(app)/einkauf/page.tsx`, `src/app/(app)/einkauf/[id]/page.tsx` |
| Ergebnistext | ✅ „n Bestellungen, m Positionen, k ohne Zuordnung · neu: … · aktualisiert: … · schon bekannt: …“; im Ergebnis zusätzlich `spalten` (Feld → Spaltenname) und `status_werte` | `bestellText` |
| EK je SKU aus Lieferungen | ✅ Mengengewichteter Ø der letzten 3 gelieferten Positionen (netto, ohne stornierte) → EK-Vorschlag „EK-Vorschlag aus ArbitrageOne-Bestellungen“ unter Einkauf → EK-Import. Weicht er mehr als 10 % vom sellerboard-COG ab, steht dort „weicht +x % vom sellerboard-COG (y €) ab“. Übernahme nur von Hand; übernommene Chargen tragen die Quelle „aus ArbitrageOne-Bestellungen (Ø Lieferungen)“. Derselbe Vorschlag wird nicht jeden Tag neu angelegt | `ekAusLieferungen`, `sbCogWarnung`, `ekVorschlagAusBestellungen` |
| Positionen aus der nächsten Tagesdatei | ✅ Schlüssel je Position (Positions-ID, sonst Bestellung + ASIN + SKU + laufende Nr.) → „schon bekannt“. Geänderter Status, Menge oder Preis wird nachgeführt. Eine ältere Datei (beim Nachverarbeiten) dreht nichts zurück | Spalten `externe_id`, `externer_schluessel`, `externer_stand_am` (Migrationen 0129, 0130) |
| Abruf übergibt `ao_einkaeufe` | ✅ | `AO_EXPORTE` |
| Manueller Upload | ✅ Kopfzeile mit ASIN + Menge + Datum/Bestellnummer und Dateiname „PurchaseOrders“/„Einkäufe“/„Bestellungen“ → „ArbitrageOne – Bestellungen“. Über Claude: `import_link` mit Art `ao_einkaeufe` | `dateiArt`, `IMPORT_ARTEN` |
| Fehlertext | ✅ „ArbitrageOne – Bestellungen: Spalten fehlen – gefunden: …; fehlt: ….“ (auch wenn die Kopfzeile hinter Titelzeilen steht) | `spaltenFehlerText` |
| Lugru „gekauft“ aus ArbitrageOne-Einkäufen | ✅ wie bisher über die Einkaufszeile mit echtem Kaufdatum; die neue Bestellung zählt nicht ein zweites Mal (ihr Anlagedatum wäre nur der Importzeitpunkt) | `lugruKaufAbgleich` (`src/lib/lugru-deals/discord.ts`) |
| Nachverarbeiten | ✅ „Erneut verarbeiten“ stellt `ek_liste` auf `ao_einkaeufe` um (die alte Art steht im Ergebnis). Automatisch stündlich, im Nachtlauf und jetzt auch bei „Jetzt abholen“: Fehlimporte der letzten 14 Tage, älteste zuerst, auch die schon einmal nachverarbeiteten Einkäufe. Scheitert eine Datei wieder, wird sie erst nach einer Parser-Änderung erneut versucht (kein Fehler jede Stunde) | `importErneutVerarbeiten`, `aoFehlimporteNachverarbeiten`, `aoJetztAbholenAction` |

**Verhaltensänderungen (bitte bestätigen oder ändern):**
- ArbitrageOne-Bestellungen zählen in der Liquidität **nicht** als offene Zahlung (online schon bezahlt). Im
  Ø-Wareneinkauf (Ersatzrechnung „eigene Bestellungen“) zählen sie mit.
- Der EK aus dem Export „Einkäufe“ wird nicht mehr automatisch als Charge übernommen, er kommt nur als Vorschlag. Der
  Export „Sellerboard“ (ASIN | SKU | Cost) wird wie bisher automatisch übernommen. Weil die Einkaufs-Datei seit 02.11.
  ohnehin scheiterte, fällt nichts weg, was zuletzt lief.
- Positionen ohne Status gelten nach 21 Tagen als geliefert.
- Offene ArbitrageOne-Bestellungen stehen unter Einkauf → Offen. Ihre ASINs gelten bei den Bestellvorschlägen als
  „schon bestellt“, bis die Bestellung ganz geliefert oder storniert ist.
- Wareneingang ins eigene Lager bucht der Import nicht (die Ware geht meist übers Prep Center zu FBA).
- Rangfolge der EK-Quelle beim Übernehmen: eigene Vorlage → ArbitrageOne-Bestellungen → AccountOne → sellerboard.

**Abnahme:**
1. ✅ automatisch (`e2e/b30-ao-bestellungen.spec.ts`, erfundene PurchaseOrders-Datei als HTML-.xls mit Titelzeile):
   Ein Fehlimport mit Art `ek_liste`, der schon einmal erfolglos erneut verarbeitet wurde → „Erneut verarbeiten“ →
   „fertig“ mit „2 Bestellungen, 3 Positionen, 2 ohne Zuordnung“, Art `ao_einkaeufe`, alte Art im Ergebnis.
   *(live)* Der echte Import vom 06.11. nach dem Update (To-do 90).
2. ✅ automatisch: Einkauf → Bestellungen (Ansicht „ArbitrageOne“) zeigt beide Bestellungen mit Lieferant, Datum,
   Menge, EK und Status (teilweise bzw. storniert) und „1 ohne Zuordnung“. Das Detail zeigt „schon bezahlt“.
3. ✅ automatisch: Der nächste Abruf holt einen Fehlimport von vor 4 Tagen selbst nach, die neue Tagesdatei läuft als
   `ao_einkaeufe`. `anbindungen_status` zeigt „Einkäufe · ok · 1 Bestellung, 1 Position …“ und keinen Einkäufe-Fehler.
   *(live)* Lauf am 07.11. um 05:30.
4. ✅ automatisch: Manueller Upload derselben Datei unter Uploads → „ArbitrageOne – Bestellungen“, „schon bekannt:
   3 Positionen“, nichts doppelt, kein zweiter EK-Vorschlag.

Dazu automatisch geprüft:
- EK-Vorschlag mit Warnung gegen den sellerboard-COG (+25 %), keine Charge angelegt.
- Liquidität ohne die Bestellung.
- Fehlende Spalten → „gefunden: …; fehlt: …“.

Unit-Tests: `tests/b30-ao-bestellungen.test.ts` (16 Tests), dazu alle übrigen Unit-Tests grün. Angepasst:
`e2e/arbitrageone.spec.ts` und `e2e/b27-automatik.spec.ts` (Einkäufe als Bestellung statt Charge). Regression grün:
ArbitrageOne, B27, EK-Import, Uploads, Datei-Import, Einkauf (B20), Werkzeuge, Lugru (B22), Kaufen mit einem Tap.

**Werkzeuge:** `import_link` kennt die neue Art `ao_einkaeufe`. Das Schema ändert sich, deshalb kommt
`notifications/tools/list_changed`. Sonst keine neuen Werkzeuge; `import_status` und `importe` zeigen das neue
Ergebnis.

## Nachtrag B29 (05.11.): sellerboard-Aufruflimit (125/Tag) – Abrufe drosseln, Budget verwalten

Befund: Seit 04.11. scheiterten alle sellerboard-Abrufe mit „used up today's MCP call limit (125 of 125)“. Das Limit
gilt je Kontoinhaber für **alle** Nutzer (auch Ludwigs Morgenbericht und Nachfragen über Claude), Rücksetzung 00:00 UTC
(= 01:00 Uhr im Winter). Die Zeitpläne allein brauchten mehr als 125 Aufrufe – ein Verkaufs-Lauf kostete nicht einen,
sondern je Kanal 1 Kennzahlen-Aufruf + 2 Top-Listen + eBay-Bestellmengen.

**Prüfung (vorher):**

| Punkt | vorher | Fundstelle |
|---|---|---|
| B29.1 Verkauf alle 30 Min. | ❌ alle 30 Min., je Lauf ca. 5–7 Aufrufe | `due(sb-sales, 29)` in `src/lib/scheduler.ts` |
| B29.1 Gewinn je Produkt alle 3 Std. | ❌ 3 Tage × je Kanal Wärmen + Tabelle (35 Zeilen/Seite) | `due(sb-tage, 179)`, `syncSkuDays` |
| B29.1 Verlust-Stopp ohne eigenen Aufruf | ✅ | `refreshVerlustTasks` (nur Datenbank) |
| B29.1 FBA-Bestand/Sendungen alle 4 Std. | ❌ dazu lief jedes Mal Verkauf mit; Sendungen 150 Tage komplett | `due(sb-stock, 239)`, `syncSellerboard("bestand")` |
| B29.1 Tagesabrufe täglich | 🟡 täglich, aber zu beliebiger Uhrzeit (Zähler nur im Speicher, nach Neustart sofort alles) und mit 30-Tage-Verlauf (6 Aufrufe) | `due(sb-daily, 1435)` |
| B29.1 Keepa Buy Box, Hebel-Aufgaben, Ansprüche ohne sellerboard-Aufruf | ✅ geprüft: `sbCall` wird nur in `src/lib/sellerboard/sync.ts` benutzt | – |
| B29.2 Zähler je Tag, Anzeige in `anbindungen_status` | ❌ | – |
| B29.2 Obergrenze 80, „übersprungen (Tagesbudget)“, Verkauf mit Vorrang | ❌ | – |
| B29.2 Pause bis 00:00 UTC, ein Eintrag, Nachholen in Reihenfolge | ❌ jeder Schritt schrieb eine Fehlerzeile | `step()` in `sync.ts` |
| B29.2 Seitengröße | 🟡 35 Zeilen je Seite, ohne Feldauswahl | `tablePages` |
| B29.2 gelesene Seiten bei NOT_WARMED behalten | ✅ (B27.4) | `tablePages` |
| B29.3 CSV-Berichtsversand statt MCP | ❌ (laut Nachtrag erst, wenn B29.1/B29.2 laufen) | – |
| B29.4 Zeile im Morgenbericht | ❌ | – |

**Nachher:**

| Punkt | nachher | Fundstelle |
|---|---|---|
| B29.1 Verkauf 06–22 Uhr alle 2 Std. + nachts 02:00 (10 Läufe) | ✅ | `SB_SLOTS` (`src/lib/sellerboard/budget-logic.ts`), `sbAutomatik` (`sync.ts`), Takt in `scheduler.ts` |
| B29.1 Gewinn je Produkt 04:00 + 13:00, Verlust-Stopp danach | ✅ | Gruppe „tage“; `tageZuLesen`: 04:00 gestern + vorgestern, 13:00 nur gestern, fehlende Tage bis 3 zurück; **ein** Aufruf wärmt alle Tage |
| B29.1 FBA-Bestand/Sendungen 04:30 + 16:30 | ✅ | Gruppe „bestand“ ohne Verkauf; Sendungen nur geänderte (`last_update_date desc`, Abbruch bei bekanntem Stand) |
| B29.1 Tagesabrufe ab 02:00 nacheinander | ✅ | Gruppe „taeglich“ (Produkte & EK, Monatswerte, Fixkosten, Produkte 30 Tage, Keepa, Hebel) – startet nach dem Verkaufs-Lauf um 02:00 |
| B29.1 Zeitplan überlebt Neustarts | ✅ | letzter Lauf je Gruppe in `sellerboard_plan.laeufe` (vorher nur im Speicher) |
| B29.2 Zähler „sellerboard-Aufrufe heute: n/125 (Automatik n, Reserve n)“ | ✅ | Tabelle `sellerboard_aufrufe`; jeder beantwortete Aufruf (auch „preparing“-Wiederholungen) wird in `sbCall` gezählt. Dazu der kostenlose Stand laut sellerboard (`usage_quota`, zählt auch Claude): `sbQuota`. Anzeige in `anbindungen_status.sellerboard_aufrufe` und auf der sellerboard-Karte |
| B29.2 Obergrenze 80 → „übersprungen (Tagesbudget)“ statt Fehler | ✅ | `budgetEntscheidung` vor **jedem** Aufruf; Hinweis an den Abrufen (`job_runs.hinweis`), kein Fehler; die Gruppe bleibt fällig und wird nach der Rücksetzung nachgeholt |
| B29.2 Verkauf hat Vorrang | ✅ | `verkaufVorrang`: die übrigen Abrufe lassen je noch ausstehendem Verkaufs-Lauf 3 Aufrufe frei |
| B29.2 Limit-Fehler → Pause bis 00:00 UTC, **ein** Eintrag „pausiert bis 01:00 Uhr“ | ✅ | `istLimitFehler`, `pauseSetzen` (`budget.ts`): Abruf „sellerboard: Tageslimit“. Meldet `usage_quota` schon 125/125, pausiert das System ohne Fehlaufruf. Alte Limit-Fehler (vor dem Update) zeigen „übersprungen (sellerboard-Tageslimit)“ statt Fehler |
| B29.2 danach automatisch nachholen: Verkauf → Gewinn je Produkt → Rest | ✅ | `SB_REIHENFOLGE`, `faelligeScopes`; ein Nachhol-Lauf um 01:00 zählt auch für 02:00/04:00/04:30 (`SB_NACHHOL_FENSTER_MIN`), sonst liefe alles doppelt. Schritte, die seit der Uhrzeit schon erfolgreich waren, laufen nicht noch einmal |
| B29.2 Seitengröße | ✅ | Produkttabellen mit schlanker Feldauswahl: 200 Zeilen je Seite (Monat, Tag), 100 (30 Tage). Lehnt sellerboard die Auswahl ab, fällt der Abruf selbst auf volle Zeilen zu 35 zurück. Bestand 35, Sendungen 8, Fixkosten 50 = jeweils das Höchstmaß |
| B29.3 CSV-Berichtsversand | ❌ noch nicht gebaut | laut Nachtrag erst, wenn B29.1/B29.2 laufen (To-do 88) |
| B29.4 Zeile für den Morgenbericht | ✅ | `anbindungen_status.sellerboard_aufrufe.morgenbericht_zeile` = „sellerboard-Limit am TT.MM. erreicht, Daten von TT.MM., HH:MM“ (nur wenn das Limit am Vortag erreicht war; Zeitpunkt und Verkaufs-Stand werden beim Limit gemerkt) |

**Aufrufe je Tag (Rechnung nach Plan, Amazon + eBay):**
vorher > 125 (Befund ca. 130 ohne Claude, tatsächlich mehr). Nachher ca. **45 bis 12:00** und **72 am Tag** (bei ~2.500 Produkten in sellerboard, 150 SKUs mit FBA-Bestand):

| Gruppe | Aufrufe |
|---|---|
| Verkauf: 10 × 2 (je Kanal 1), Top heute 14 + 20 Uhr, eBay-Mengen 06 + 20 Uhr | 26 |
| Gewinn je Produkt: 04:00 = 6, 13:00 = 4 | 10 |
| Bestand + Sendungen: 2 × 8 (5 Seiten mit Bestand, 1 ausverkaufte mit Abverkauf, 2 Sendungen) | 16 |
| Tagesabrufe (Produkte 10 Seiten, Monatswerte 3, Fixkosten 1, 30 Tage 6) | 20 |

Mit Morgenbericht (ca. 15) und drei Nachfragen bleibt der Tag unter 125. Die Rechnung steht als Test in
`tests/b29-sellerboard-budget.test.ts` (`tagesSchaetzung`). Die echten Zahlen zeigt ab dem Update der Zähler.

**Weitere Einsparungen:**
- **Produkte & EK** (laut Anleitung ca. 2.500 Produkte = 72 Seiten): Das System liest höchstens 10 Seiten am Tag,
  nach Name sortiert. Es merkt sich, wo es war, und speichert jede Seite sofort. Ein Durchgang dauert dann ca. 7 Tage.
  Der eigene EK im Seller-System hat ohnehin Vorrang. In sellerboard gelöschte Produkte fallen erst heraus, wenn sie
  zwei Durchgänge lang fehlen. Vorher hätte der Abruf jeden Tag das Budget aufgebraucht und nichts gespeichert.
- **FBA-Bestand** liest nur SKUs mit Bestand, dazu ausverkaufte mit Abverkauf (Nachbestell-Kandidaten), statt aller
  jemals angelegten SKUs. Nicht mehr gelistete SKUs stehen danach mit sellerboard-Bestand 0 da, wie vorher.
- Der 30-Tage-Verlauf lädt nur noch fehlende Tage. Heute und gestern kommen ohnehin mit den Kacheln.
- Die Top-Produkte von gestern entstehen ohne Aufruf aus „Gewinn je Produkt und Tag“.
- Die Monatswerte lesen den Vormonat nur bis zum 10. des Monats.

**Entscheidungen (bitte bestätigen oder ändern):**
- Die letzten **10 Aufrufe des Tages** bleiben immer für Claude frei. Grundlage ist der Stand laut sellerboard, er
  zählt auch Ludwigs eigene Aufrufe. Sonst könnte die Automatik nach einem langen Claude-Vormittag den Rest aufbrauchen.
- „Jetzt abgleichen“ (von Hand) zählt im Zähler als „von Hand“, aber nicht zur Obergrenze 80. Die Pause gilt auch
  dafür. Ein Hand-Abgleich braucht ca. 40–60 Aufrufe (steht am Knopf).
- Neuer Knopf „Fällige Abrufe nachholen“ auf der sellerboard-Karte. Er holt nur, was laut Zeitplan fällig ist, mit
  Budget und Pause.

**Abnahme:**
1. *(live)* Am 06.11. nach 01:00 laufen alle Abrufe wieder; um 12:00 zeigt der Zähler höchstens 45 → nach dem Update
   prüfen (To-do 86). Rechnung nach Plan: 45 (am Nachholtag nach der Pause eher knapp darüber, weil um 01:00 auch
   fehlende Tage nachgeladen werden).
2. ✅ automatisch (`e2e/b29-sellerboard-budget.spec.ts`, sellerboard-Nachbau):
   - Künstliches Budget 5, „Fällige Abrufe nachholen“: Der Zähler steht in `anbindungen_status` und auf der Karte und
     stimmt mit dem Nachbau überein (höchstens 5).
   - Verkauf lief (Vorrang). FBA-Bestand, Sendungen, Produkte & EK, Fixkosten und Verlust-Stopp stehen auf
     „übersprungen (Tagesbudget) – wird nach der Rücksetzung um 01:00 Uhr nachgeholt“. Kein Fehler.
3. ✅ automatisch:
   - Der Nachbau meldet „used up today's MCP call limit (125 of 125)“. Danach gibt es genau **einen** Eintrag
     „pausiert bis 01:00 Uhr …“, auch unter `nur_probleme`, und keine Fehlerzeile.
   - Während der Pause geht kein Aufruf raus.
   - Nach der Rücksetzung holt das System alles nach: Verkauf → Gewinn je Produkt → Bestand → Tagesabrufe. Danach ist
     der Eintrag weg.
4. *(live)* Ein ganzer Tag mit Morgenbericht und drei Nachfragen endet unter 125. Rechnung nach Plan: 72 + 15 + 15 = 102.

Unit-Tests: `tests/b29-sellerboard-budget.test.ts` (20 Tests). Angepasst: `e2e/b27-automatik.spec.ts` erwartet jetzt
„Zeitplan: 04:00 und 13:00“.

## Nachtrag B28 (05.11.): Deal-Eingang – Marge, Preis-Szenario, Gründe bei 👍, Bestellmail

Anlass: ein Deal-Eingang vom 05.11. (Pfanne, großer Posten, EK netto). Ludwig rechnet in Marge statt ROI, will
„Was wäre bei VK x?“ sehen, dem Tool sagen können, **warum** ein Deal passt, und beim Kauf eine Bestellmail an den
Lieferanten schicken. Die Zahlen des Anlass-Deals stehen nicht im Repo; geprüft wird mit einer erfundenen „Testpfanne“
(Buy Box 79 €, vor 31–120 Tagen 57,99 €, in IT nur 1 Angebot).

**Marge** heißt hier überall: Gewinn ÷ Buy-Box-Preis **brutto** (Ø 90 Tage, sonst aktuell). Die Ampel rechnet weiter
mit der Netto-Marge (Gewinn ÷ VK netto, Ziel 15 %) und schreibt das jetzt auch so dazu („Netto-Marge“) – siehe Frage
unten.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B28.1 Spalte „Marge“ neben Gewinn, ROI dahinter | ❌ | ✅ | `margeBrutto`, `landKennzahlen` (`src/lib/deal-eingang/logic.ts`), Tabelle in `src/app/(app)/deal-eingang/[id]/page.tsx` |
| B28.1 „Max. EK für Ziel-Marge“ (Standard 10 %, einstellbar) neben „Max. EK für Ziel-ROI“ | ❌ | ✅ | `maxEkMarge`; Feld „Ziel-Marge %“ in den Deal-Eingang-Einstellungen (`zielMarge`) |
| B28.1 Marge im Deal-Blatt (Text, PDF, Bild) | ❌ | ✅ | `dealBlattText` (`src/lib/b2b/logic.ts`), `blatt-pdf.ts`, `blatt-bild.ts` |
| B28.1 Marge in Push-/Discord-/SMS-Meldung | ❌ | ✅ | `pushText`, `kaufText`, SMS in `ablauf.ts` („DE: Marge 12 %, ROI 23 %“) |
| B28.1 Marge in Lugru-Deals, Deal-Bilanz, deal_pruefen, deal_wert | 🟡 (nur Lugru-Post-Marge) | ✅ | `reale_marge` (`lugru-deals/liste.ts`), Spalte „Marge“ in `/b2b/bilanz`, `marge_prozent` in deal_bilanz/deal_wert/deal_eingang, deal_pruefen `marge_schnitt_90_prozent` (jetzt brutto) + `netto_marge_schnitt_90_prozent` |
| B28.2 Ziel-VK je Land (vorbelegt mit Buy Box), Gewinn/Marge/ROI sofort | ❌ | ✅ | `src/app/(app)/deal-eingang/[id]/szenario.tsx`, `szenarioRechnen` |
| B28.2 „bei diesem Preis ca. n Verkäufe/Monat“ | ❌ | ✅ | `verkaeufeBeiPreis` (`szenario-logic.ts`): letzter Zeitraum (12 Monate) mit Buy Box ±7 % um den Preis. Quelle: Keepa-„gekauft“-Verlauf, sonst aktuelle Verkäufe × Rang-Verhältnis, sonst Rang-Verbesserungen. Daten nur aus dem Keepa-Zwischenspeicher (`keepaSzenarioAusCache`), keine Extra-Tokens |
| B28.3 Gründe bei 👍 (Mehrfachauswahl + Freitext) | ❌ (nur die 👎-Liste) | ✅ | `DAUMEN_GRUENDE_HOCH`, Formular „Passt der Deal zu dir?“, `bewerten` (`src/lib/deal-eingang/wert.ts`) |
| B28.3 Begründetes 👍 zählt mehr | ❌ | ✅ | `eigenesLabel`: 👍 mit Grund Label 0,9 / Gewicht 1,1 statt 0,8 / 0,8 |
| B28.3 Gründe fließen in den Deal-Wert | ❌ (auch 👎-Gründe wurden nur gespeichert) | ✅ | `GRUND_REGELN`, `grundBeitraege` (`wert-logic.ts`). Trifft ein früherer Grund auf einen neuen Deal zu, gibt es +5 Punkte (je weitere Begründung +2, höchstens +12); ein 👎-Grund zieht entsprechend ab. Beispiel: ein Land mit höchstens 1 Angebot (neues Merkmal `angeboteMinLand`). Der Text steht unter „dafür“ bzw. „dagegen“ |
| B28.3 Lernbericht mit Gründen | ❌ | ✅ | Seite „Deal-Wert: Wie gut lag er?“ → „Deine Gründe“; `deal_lernen_bericht.gruende` |
| B28.3 Discord: nach 👍 Rückfrage im Thread | ❌ | ✅ (Abweichung: Zahl-Reaktionen statt Knöpfe) | `grundFragen`, `grundAntwortenLesen`, `grundAusAntwort` |
| B28.4 Knopf „Freischaltung im Seller Central prüfen →“ | ❌ | ✅ | `freischaltungLink`. Der Knopf steht je Angebot, auch bei verbundener SP-API (z. B. bei „Marke gesperrt“). Der Hinweis „nicht geprüft“ bleibt |
| B28.4 Verk./Monat leer trotz Keepa | 🐞 | ✅ | Keepa „x+ gekauft“, sonst letzter Wert der Verkaufshistorie (≤ 60 Tage), sonst „≈ n (geschätzt)“ aus den Rang-Drops (30 Tage): `standAusKeepa`, `verkaeufeAusRang` (`src/lib/keepa/auswertung.ts`) |
| B28.5 Lieferant je Deal-Quelle (Einstellungen → Deal-Quellen) | ❌ | ✅ | `/deal-eingang/quellen`; neue Felder in `lieferanten_profile`: Ansprechpartner, Zahlungsweg, Rechnung mit EAN, Stichworte der Quelle |
| B28.5 Schalter „Bestellmail senden“ am Gekauft-Knopf | ❌ | ✅ | Standard an, wenn zur Quelle ein Lieferant mit Mailadresse bekannt ist |
| B28.5 Entwurf (bearbeitbar), dann „Senden“ | ❌ | ✅ | `bestellmailText`, `bestellmailSenden` (`src/lib/deal-eingang/bestellmail*.ts`). Inhalt: Artikel mit ASIN/EAN, Zustand/Verpackung, Menge, Preis netto je Stück und gesamt, Lieferadresse, Rechnungsanforderung, Zahlungsweg, Bitte um Sendungsnummer. Absender: Standard-Postfach, Kopie an dasselbe Postfach |
| B28.5 Datum, Empfänger, Text, Status gespeichert; Beleg am Deal und im Einkauf | ❌ | ✅ | Tabelle `deal_bestellmails`. „Bestellung gesendet“ steht auf der Deal-Seite, in der Einkaufsliste und an der Bestellung |
| B28.5 Antwort des Lieferanten zuordnen | ❌ | ✅ | `antwortZuordnen` (Haken in `src/lib/inbox/service.ts`). Zugeordnet über die Message-ID (In-Reply-To), sonst Absender + ASIN im Betreff (60 Tage). Die Sendungsnummer geht auch an die Bestellung; „Rechnung erhalten“ aus Anhang/Betreff |
| B28.5 Felder „EAN weicht ab“ und „Verpackung“ | ❌ | ✅ | Am Deal (Gekauft-Formular bzw. „Ware“). Bei „EAN weicht ab“ kommt der Hinweis „FNSKU-Etikett nötig“ |
| B28.5 deal_gekauft | ✅ (ohne Mail) | ✅ | legt zusätzlich nur den **Entwurf** an (`bestellmail`), sendet nie |

**Befund 05.11., 13:52 (Screenshot):** Lieferant unter Deal-Quellen gespeichert, am Deal blieb „Bestellmail senden“ trotzdem
gesperrt („für die Quelle „–“ ist noch kein Lieferant hinterlegt“).
- **Ursache:** Der Deal hatte keine Quelle. Der Lieferant wurde nur über die Quelle gefunden.
- **Behoben:**
  1. Am Gekauft-Knopf gibt es die Auswahl „Lieferant“ (alle Deal-Quellen mit Mailadresse).
     - Ohne Quelle und mit nur einem Lieferanten ist er vorgewählt.
     - Der Haken „Bestellmail senden“ ist frei, sobald es einen Lieferanten mit Mailadresse gibt.
     - Ohne Quelle wird der gewählte Lieferant als Quelle gespeichert. Beim nächsten Mal passt es dann von selbst.
  2. Dieselbe Auswahl steht im Block „Bestellmail“, für schon gekaufte Deals.
  3. Ein geteilter Deal (Teilen-Menü oder Kurzbefehl) ohne Quelle und ohne Shop-Link gilt als „WhatsApp“. Er findet
     damit den Lieferanten mit diesem Stichwort.
  4. `deal_gekauft` hat neu `lieferant` (Name oder Mailadresse). Das ist eine Schema-Änderung → `list_changed`.
- **Fundstellen:**
  - `quelleFuerSuche` (`bestellmail-logic.ts`)
  - `lieferantWaehlen` (`bestellmail.ts`)
  - Auswahl in `src/app/(app)/deal-eingang/[id]/page.tsx`
- **Abnahme:** Am Ende von `e2e/deal-b28.spec.ts` laufen zwei Deals ohne Quelle durch:
  - Lieferant auf der Seite wählen → Entwurf, Quelle gespeichert.
  - `deal_gekauft` mit `lieferant` → Entwurf.
- **Test-Aufräumen:** Der Test entfernt danach seine erfundenen Pfannen-Deals, damit sie `deal-wert` nicht als
  „ähnliche Deals“ stören.

**Abweichung B28.3 (Discord-Knöpfe):** Echte Discord-Knöpfe brauchen für den ProfitPath-Bot eine ständige Verbindung
oder eine öffentliche Interaktions-Adresse. Ohne die zeigt Discord nach dem Tippen „Interaktion fehlgeschlagen“.
Deshalb fragt der Bot im Thread der ProfitPath-Nachricht und setzt selbst die Reaktionen 1️⃣–5️⃣ darunter. Ludwig
tippt eine oder mehrere an oder antwortet kurz mit Text („2, 5“ oder einem eigenen Satz = Freitext). Abgeholt wird mit
dem normalen Abgleich (alle 15 Minuten bzw. „ProfitPath abrufen“). Die Antwort ist optional, die Rückfrage bleibt 2 Tage
offen. Speichert Ludwig die Gründe auf der Seite, endet die Rückfrage.

**Abnahme** (automatisch, erfundene Daten): `e2e/deal-b28.spec.ts`

1. Testpfanne: je Land Gewinn, Marge und ROI. Darüber „Max. EK für Ziel-ROI“ und „Max. EK für Ziel-Marge (10 %)“.
   Dazu der Seller-Central-Knopf.
2. Ziel-VK DE 56 € statt 79 €: Gewinn, Marge und ROI rechnen neu. Hinweis: „Bei diesem Preis zuletzt TT.MM.–TT.MM.
   (n Tage): ca. n Verkäufe/Monat (Keepa „gekauft“)“. Bei 30 €: „kam … nicht vor“.
3. 👍 mit Grund „In einem Land kein oder nur 1 Angebot“:
   - Der Grund steht im Lernbericht.
   - Ein ähnlicher Deal (auch IT mit 1 Angebot) bekommt nach „Neu prüfen“ einen höheren Deal-Wert, mit dem Grund unter
     „dafür“.
   - Discord: Nach 👍 fragt der Bot im Thread. Reaktion 2️⃣ plus Text-Antwort werden als Grund und Freitext gespeichert.
4. Verk./Monat in jedem Land gefüllt, IT „≈ n (geschätzt)“.
5. Gekauft 84 × 25 €:
   - Es entsteht ein Entwurf an den Lieferanten („84 Stück“, „25,00 € netto je Stück, gesamt 2.100,00 € netto“, ASIN,
     „eingeschweißt“, Zahlungsweg). Vor „Senden“ geht nichts raus.
   - Nach „Senden“ ist genau eine Mail weg. Der Beleg steht am Deal und an der Bestellung im Einkauf.
   - Die Antwort als .eml mit Sendungsnummer und „Rechnung“ wird zugeordnet: Die Sendungsnummer steht am Deal und an
     der Bestellung, „Rechnung erhalten“ ist gesetzt.
   - Claude: `deal_bewerten` mit Gründen, `deal_lernen_bericht.gruende`, `deal_eingang_detail.bestellmails`.
     `deal_gekauft` legt nur einen Entwurf an.

Unit-Tests: `tests/b28-deal.test.ts` (24 Tests). Angepasst: `tests/keepa-auswertung.test.ts` (neue Felder in
`aktuell`) und `tests/b2b-logic.test.ts` (Marge im Deal-Blatt). Alle 2184 Unit-Tests grün.

Regression grün: b20-einkauf, b20-lugru, b22-lugru, b2b-deals, b2b-preislisten, deal-eingang-luecken, deal-eingang,
deal-wert, herzstueck, kaufen-tap, keepa, lugru-deals, posteingang-null, va-anfragen, va-discord, werkzeuge. In
`deal-eingang.spec.ts` zählt die ProfitPath-Prüfung jetzt nur die eigenen Meldungen. Vorher zählte sie alle des
Mandanten, und der neue Test legt ebenfalls eine an.

**Claude-Werkzeuge** (geänderte Schemas → `notifications/tools/list_changed`):

| Werkzeug | Änderung |
|---|---|
| `deal_bewerten` | neu: `gruende` (👍, mehrere aus der festen Liste), `freitext`; `grund` gilt nur für 👎; Rückgängig stellt auch Gründe/Freitext wieder her |
| `deal_gekauft` | neu: `verpackung`, `ean_abweichend`, `bestellmail` (nur Entwurf), `lieferant` (wenn die Quelle fehlt); Antwort mit `bestellmail` und `fnsku_etikett_noetig` |
| `deal_eingang_detail` | Ausgabe: `bewertung` (mit Gründen), `verpackung`, `ean_abweichend`, `bestellmails` (Status, Empfänger, gesendet/Antwort, Sendungsnummer, Rechnung) |
| `deal_lernen_bericht` | Ausgabe: `gruende` (je Grund, mit/ohne Grund, Freitexte) |
| `deal_pruefen` | `marge_schnitt_90_prozent` jetzt brutto (wie überall), dazu `netto_marge_schnitt_90_prozent`; Verkäufe „geschätzt“ aus dem Rang |
| `deal_wert`, `deal_eingang`, `deal_bilanz`, `lugru_deals` | Ausgabe: `marge_prozent` bzw. `reale_marge` |

**To-dos für Ludwig:**
1. Server aktualisieren: `bash /opt/seller-system/deploy/update.sh`. Beim Start läuft Migration 0127.
2. **Deal-Eingang → Deal-Quellen (Lieferanten, Bestellmail)** öffnen und den Lieferanten aus dem Anlass-Deal
   eintragen:
   - Name, Mailadresse, Ansprechpartner, Zahlungsweg, „Rechnung mit EAN“.
   - Als Stichwort die Quelle, unter der seine Deals ankommen (z. B. „WhatsApp-Deals“ oder der Vorname des
     Ansprechpartners).
3. Auf derselben Seite unter „Bestellmail“ die Liefer- und Rechnungsadresse sowie die USt-IdNr. prüfen. Ist das Feld
   leer, nimmt das System den DHL-Absender.
4. Discord-Bot im ProfitPath-Kanal: Für die Rückfrage nach 👍 braucht er „Nachrichten senden“, „Öffentliche Threads
   erstellen“, „Nachrichten in Threads senden“ und „Reaktionen hinzufügen“. Ohne diese Rechte wird das 👍 trotzdem
   gespeichert, nur die Rückfrage fehlt.
5. Ältere Deals: einmal „Neu prüfen“. Danach gibt es das Preis-Szenario und die genauen Werte für max. EK (Ziel-Marge).
   Vorher rechnet die Seite die Marge aus Gewinn + EK.
6. **Frage:** Die Ampel prüft weiter die Netto-Marge (Ziel 15 % vom VK netto). Die Anzeige ist jetzt überall brutto.
   Soll die Ampel auch auf brutto umgestellt werden? 15 % netto entsprechen bei 19 % USt etwa 12,6 % brutto.

### B28.6–B28.8 (Ergänzung 05.11.): ROI pro Jahr, eigene Durchlaufzeiten, Lernschleife Verlustprodukte

Geprüft mit erfundenen Daten: Testpfanne (84 Stück), ein Testlieferant mit drei erhaltenen Einkäufen samt
FBA-Sendungen und Monatswerten, zwei erfundene Verlustprodukte. Echte Zahlen (Lagerwert, Monatsumsatz,
Anlass-Deal) stehen nicht im Repo.

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B28.6 Spalten „Umschlag“ (Spanne, „geschätzt“) und „ROI p. a.“ in der Ländertabelle | ❌ | ✅ | `umschlagSchaetzen` (`src/lib/deal-eingang/umschlag-logic.ts`), gespeichert je Land in `zeilePruefen` (`service.ts`); Tabelle in `src/app/(app)/deal-eingang/[id]/page.tsx` (ältere Prüfungen: auf der Seite nachgerechnet) |
| B28.6 Rechnung: Verkäufe/Monat (Keepa bzw. Rang-Schätzung) ÷ (Angebote + 1), schnell/langsam = ein Angebot weniger/mehr, Amazon-Anteil bremst, Menge (sonst 30 Tage), Vorlauf + 14 Tage Auszahlung | ❌ | ✅ | `umschlagSchaetzen`, Erklärung als Tooltip (`umschlagErklaerung`) |
| B28.6 Reichweiten-Warnung > 60 Tage mit Menge für 45 Tage | ❌ | ✅ | Hinweis unter der Tabelle (`de-umschlag-warnung`) und als gelber Grund der Ampel |
| B28.6 Ampel/Deal-Wert mit ROI p. a., Mindestwert einstellbar (Standard 100 %) | ❌ | ✅ | Gelb unter dem Mindestwert (`zeilePruefen`); Deal-Wert `kennzahlenWert(…, minRoiPa)`: darüber bis +10, darunter bis −15 Punkte; Feld „Mindest-ROI p. a. %“ in den Deal-Eingang-Einstellungen (`minRoiPa`) |
| B28.6 Gleiche Kennzahlen in Discord-/Push-Meldung, deal_pruefen, deal_wert, lugru_deals | ❌ | ✅ | `pushText` / `benachrichtigen` („Umschlag ca. 45–70 T · ROI p. a. 180 %“), Werkzeuge siehe unten |
| B28.7 Durchlaufzeiten je Einkauf: Bestellung → Wareneingang → Versand an Amazon (FBA-Sendung erstellt) → „Empfang abgeschlossen“ → Abverkauf (90 %) + Auszahlung | ❌ | ✅ | `src/lib/money/durchlauf.ts` + `durchlauf-logic.ts`. Empfang abgeschlossen = sellerboard-Sendung geschlossen (letzte Änderung); Abverkauf aus den Monatswerten je SKU (grob) |
| B28.7 Median je Lieferant/Quelle und je Prep Center | ❌ | ✅ (ein Prep Center) | `durchlaufAuswerten` → `jeGruppe`; im System ist ein Prep Center hinterlegt (Einstellungen → Prep Center), dessen Name steht an der Phase |
| B28.7 Kapital-Ampel: „Cash-to-Cash-Zyklus“ und „Kapital ÷ Monatsumsatz“ | ❌ | ✅ | Karte auf `/kapital` (`CashToCash`), Umsatz = sellerboard letzte 30 Tage |
| B28.7 Vorlauf der Umschlagszeit aus eigenen Daten (sonst Standard 7/4/10 Tage) | ❌ | ✅ | `vorlaufFuer` (ab 3 Einkäufen je Phase; passender Lieferant, sonst alle) |
| B28.7 Hinweis/Aufgabe „Einkäufe bereinigen“ | ❌ | ✅ | Hinweis auf der Kapital-Ampel; Aufgabe `einkaeufe-bereinigen` täglich (Bestellungen > 45 Tage weder erhalten noch storniert) |
| B28.8 Am 3. Liste der Verlustprodukte des Vormonats (Gewinn < 0 oder Marge < 3 %, nur Einkäufe der letzten 6 Monate, größter Verlust zuerst) | ❌ | ✅ | `lernschleifeTakt` / `lernschleifeErstellen` (`src/lib/deal-eingang/lernschleife.ts`), Tabelle `lernschleife_fragen` (Migration 0138). Quelle: sellerboard je SKU und Monat (Est. Profit aus BQool ist nur 7 Tage je Land, daher nicht für den Monat) |
| B28.8 Drei Knöpfe + optionaler Grund (Gründe B28.3 + 5 neue) | ❌ | ✅ | Abschnitt „Lernschleife Verlustprodukte“ auf `/deal-eingang/lernen#lernschleife` |
| B28.8 Nur Ludwig beantwortet | ❌ | ✅ | Server-Aktion nur für den Inhaber; andere sehen „beantwortet nur der Inhaber“; kein Claude-Werkzeug zum Beantworten |
| B28.8 Antworten im Deal-Wert („ähnlicher Fehlkauf am …“) | ❌ | ✅ | `fehlkaufBeitraege`: gleiche Marke −10 („Nie wieder“) / −4 („Weiß nicht“) / −1 („Pech“); gleiche Kategorie + Quelle −6/−2/0; gleiche Quelle + ähnlich viele Angebote −3 (nur „Nie wieder“); höchstens −15 |
| B28.8 Trefferquote je Monat (Ziel 80 %) im Lernbericht und einmal im Monat im Morgenbericht | ❌ | ✅ | `trefferquote` (Anteil Chargen mit Marge über der Ziel-Marge), Tabelle im Lernbericht; Morgenbericht am 3.: „Trefferquote Oktober 2026: 72 % (Ziel 80 %)“ |
| B28.8 Push an Ludwig mit Link | ❌ | ✅ | neue Push-Art „Lernschleife Verlustprodukte“ (an/aus unter Einstellungen → Benachrichtigungen), nur an den Inhaber, nicht in Discord |

| Werkzeug | Änderung (Beschreibung geändert → `notifications/tools/list_changed`) |
|---|---|
| `deal_pruefen` | je Land `umschlag`, `roi_pa_prozent`; `umschlag_bestes_land` (Spanne, ROI p. a., Mindestwert, Warnung, Menge für 45 Tage, Rechnung) |
| `deal_wert` | je Angebot `roi_pa_prozent`, `umschlag`, `umschlag_warnung`; „ähnlicher Fehlkauf am …“ unter `dagegen` |
| `deal_eingang`, `deal_eingang_detail` | je Angebot `umschlag`, `roi_pa_prozent`, `umschlag_warnung` |
| `lugru_deals` | je Deal `umschlag`, `roi_pa` (aus Post-Zahlen + Keepa-Schnappschuss, geschätzt) |
| `kapital_ampel` | neuer Block `cash_to_cash` (Phasen, Tage, je Lieferant, Kapital ÷ Monatsumsatz, Einkäufe bereinigen) |
| `deal_lernen_bericht` | neuer Block `lernschleife` (Monat, offen/beantwortet, Antworten, Gründe, Produkte, Trefferquote je Monat) |

Keine neuen Werkzeuge, keine neuen ändernden Werkzeuge.

**Abnahmen** (`e2e/b28-umschlag.spec.ts`):
6. Testpfanne mit 84 Stück: Spalten „Umschlag“ (Spanne, geschätzt) und „ROI p. a.“, Reichweiten-Warnung mit Menge für
   45 Tage; deal_wert/deal_eingang_detail liefern dieselben Werte. ✅
7. Kapital-Ampel: Cash-to-Cash-Zyklus mit Medianen 4/3/8 Tagen + 14 Tage Auszahlung, je Lieferant, Kapital ÷
   Monatsumsatz, Hinweis „Einkäufe bereinigen“; kapital_ampel.cash_to_cash; Deal-Eingang nimmt danach den eigenen
   Vorlauf. ✅
8. Lernschleife: Liste des Vormonats (größter Verlust zuerst, Gewinner nicht dabei), Antwort „Nie wieder“ mit Grund
   und Freitext, im Lernbericht und in deal_lernen_bericht; eine Büro-Kraft sieht keine Knöpfe. Der Termin „am 3.“ ist
   per Unit-Test geprüft (`istLernTag`, `vormonat`), der Knopf „Liste für den Vormonat jetzt erstellen“ legt sie
   sofort an. ✅

## Nachtrag B27 (03.11.): Nächtliche Automatik – Fehler beheben

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| B27.1 ArbitrageOne Einkäufe (PurchaseOrders .xls) und Lagerbestand (.xlsx): „Falsche Art … erkannt wurde ‚Bericht/Tabelle‘“ | ❌ (Abruf übergab die Art, der Import prüfte trotzdem mit der allgemeinen Erkennung; Kopfzeile nur in Zeile 1, wenige Spaltennamen) | ✅ | **Art fest**: Dateien aus dem Abruf werden ohne Typerkennung verarbeitet (`nachArt` in `src/lib/datei-import/service.ts`, `UploadOptionen.art` in `src/lib/uploads/service.ts`). **Lesen**: Kopfzeile wird in den ersten 25 Zeilen gesucht (Titel-/Leerzeilen davor), HTML-„.xls“ wird gelesen, viele weitere Spaltennamen (Bestelldatum/Order Date, Bestellmenge/Quantity Ordered, Einzelpreis/Unit Price, PO Number …), Lagerbestand auch mit Spalte „Menge“ (`kopfzeile`, `aoFormatSuchen`, `einkaeufeAus`, `lagerbestandAus` in `src/lib/arbitrageone/logic.ts`; `parseArbitrageOne`). **Manuelle Uploads**: zusätzlich Dateiname (Lagerbestand/PurchaseOrders) + Spalten. Passt es trotzdem nicht, nennt der Fehler die **gefundenen Spaltennamen** (nur Namen, keine Werte) |
| B27.1 Fehlgeschlagene Importe vom 02./03.11. nachverarbeiten | ❌ | ✅ | **Automatisch**: stündlich (und vor dem Nachtlauf) einmal je fehlgeschlagenem ArbitrageOne-Import (Einkäufe, Lagerbestand, letzte 14 Tage) mit der Datei aus der Ablage (`aoFehlimporteNachverarbeiten`). **Von Hand**: Anbindungen → Importe „Erneut verarbeiten“ (`importErneutVerarbeiten`; dieselbe Datei schon importiert → nichts doppelt). `import_status` zeigt `erneut_verarbeitbar`, `nachverarbeitet_am` und den alten Fehler im Ergebnis. Neue Spalte `datei_importe.nachverarbeitet_am` (Migration 0123) |
| B27.2 BQool-Vergleich / Inventory Reimbursement: „Timeout 120000ms“ ohne Bild und Seite | ❌ | ✅ | Nach dem Klick: **Datei**, **Dialog** (breiter erkannt: role=dialog, aria-modal, Bootstrap/MUI/Vuetify/React-Modal/SweetAlert; leere Felder werden gefüllt: Marktplatz „alle“, Zeitraum = letzter Monat bzw. Stichtag heute, Radio „letzter Monat“) oder **„Export wird erstellt“** → Export-Liste bis 10 Min. alle 30 s neu laden und die neue Datei holen. **5 Min. je Schritt.** Bei jedem Fehler **Bildschirmfoto + Seite + Seitentitel** (`/import/debug/…`, 7 Tage, nur Inhaber) im Lauf-Ergebnis verlinkt (`herunterladen`, `ausExportListe`, `dialogAusfuellen` in `src/lib/arbitrageone/abruf.ts`). Ein Export-Fehler stoppt die übrigen nicht (wie bisher) |
| B27.2 Reimbursement lief am Dienstag | ❌ (nie geglückt → täglich nachgeholt) | ✅ | Zeitplan „wöchentlich montags“ nur noch montags; „monatlich am 1.“ am 1., bei Fehlschlag bis zum 7. nachholen; „Jetzt abholen“ geht immer (`exportFaellig`) |
| B27.3 sellerboard-Kostenimport ohne Anmeldung | 🟡 (stand als Fehlertext im Lauf) | ✅ | „übersprungen (nicht eingerichtet) – Importdatei liegt unter Anbindungen → Importe“, Export-Zeile bleibt ok; echte Fehler der Weitergabe bleiben Fehler |
| B27.4 sellerboard „Produkte 30 Tage (Hebel)“: NOT_WARMED mitten im Lesen | ❌ (Meldung „warmed data … expired“ wurde nicht erkannt, nur ein Versuch) | ✅ | Erkennung erweitert (`src/lib/sellerboard/warm.ts`); `dashboard_period` mit denselben Argumenten erneut (wartet auf „preparing“), **dieselbe Seite** nochmal, bis 3 Versuche je Seite, gelesene Seiten bleiben (`tablePages`; auch Gewinn je SKU im Monat). Jeder Schritt höchstens 20 Min. (gibt die Sperre wieder frei) |
| B27.4 Abrufe entkoppeln | 🟡 (Gewinn je Produkt und Tag + Verlust-Stopp nur im täglichen großen Abgleich) | ✅ | **Gewinn je Produkt und Tag + Verlust-Stopp** laufen eigenständig **alle 3 Std.** mit eigener Sperre und eigenem Fehlerstand (`syncSellerboard(…, "tage")`, Zeitplan im Hintergrund-Takt) – ein Fehler in „Produkte 30 Tage“ hält sie nicht auf |
| B27.4 Zeitplan-Anzeige „wird beim nächsten Lauf erfasst“ | ❌ | ✅ | Zeitplan je sellerboard-Abruf fest eingetragen (Verkauf 30 Min., Bestand/Sendungen/Hebel-Aufgaben 4 Std., Produkte/Monatswerte/Fixkosten/30 Tage/Keepa täglich, Tage + Verlust-Stopp 3 Std.) – `anbindungen_status` nennt den nächsten Lauf (`ABRUF_PLAN` in `src/lib/today/abruf-plan.ts`) |
| B27.5 Alter Abruf „Call-Archiv (Discord)“ in `nur_probleme` | ❌ | ✅ | als **„abgelöst“** markiert (durch Live-Kanal und Sicherheitsnetz 06:00) – nie „über 2 Tage alt“, nicht unter `nur_probleme`, auf der Anbindungen-Seite „abgelöst durch …“ (`ABGELOESTE_ABRUFE`). Nichts gelöscht |
| B27.6 Lauf-Ergebnis lesbar | ❌ (Playwright-Logs mit Trennlinien) | ✅ | Je Export eine Zeile **Name · Status (ok/übersprungen/Fehler) · Kurztext · Bildschirmfoto** (Anbindungen und `anbindungen_status.arbitrageone.letzter_lauf.ergebnis`); Rohmeldung nur im Detail (`fehler_details` bzw. beim Darüberfahren) (`kurzFehler`, `laufZeilen`) |

Abnahme (Test): Unit `b27-automatik` (PurchaseOrders als HTML-.xls mit Titelzeile → Einkauf + EK je SKU, englische
Spalten, Lagerbestand mit „Menge“, unbekanntes Format nennt Spalten, Playwright-Timeout → „keine Datei nach 120 s“,
Zeilen je Export, NOT_WARMED-Erkennung) und `arbitrageone` (montags/bis zum 7.); e2e `b27-automatik`: Nachbau mit
PurchaseOrders-.xls (Titelzeile), Lagerbestand-.xlsx („Menge“), BQool „wird erstellt“ → aus „Meine Exporte“ geholt,
Reimbursement über Dialog mit Pflichtfeldern, AccountOne ohne Reaktion → Fehler mit Bildschirmfoto (PNG abrufbar) und
Seite; sellerboard-Weitergabe ohne Anmeldung = übersprungen; `anbindungen_status` mit Zeilen je Export und Details;
alter fehlgeschlagener Lagerbestand → „Erneut verarbeiten“ → fertig, `import_status` zeigt `nachverarbeitet_am` und den
alten Fehler; sellerboard-Abruf mit festem Zeitplan, altes Call-Archiv „abgelöst“ und nicht unter `nur_probleme`.
Regression: arbitrageone, datei-import, uploads, ek-import, b24-automatik, bqool-dateien, b25, b21-calls-live,
amazon-berichte, b20-einkauf, geschaeft, teil2, b19-rest (alle bestanden), Unit 2119 bestanden.

Abnahme live (nach dem Update, nicht hier prüfbar): Lauf 04.11. 05:30 → Einkäufe und Lagerbestand „fertig“ mit Zeilen;
BQool-Vergleich und Reimbursement entweder importiert oder Fehler **mit Bildschirmfoto und Seite**; `anbindungen_status
(nur_probleme)` ohne NOT_WARMED und ohne altes Call-Archiv; „Gewinn je Produkt und Tag“ mit Erfolg vom 04.11.; die
Importe vom 02./03.11. sind innerhalb einer Stunde nach dem Update nachverarbeitet (oder Fehler mit Spaltennamen).

## BQool-Upload: „Keine Erfolgsmeldung“, obwohl es geklappt hat (Befund 02.11., DE/FR/IT/ES)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Erfolg erkennen | ❌ (nur feste Wörter im Seitentext innerhalb 60 s; BQool zeigt offenbar keinen davon bzw. nur kurz einen Hinweis → alle vier Länder „Fehler“) | ✅ | `src/lib/automatik/upload-logic.ts` + `dateiHochladen` in `runner.ts`. Es zählt nur, was **nach dem Klick neu** ist (feste Texte wie eine Verlaufstabelle mit „Completed/Failed“ zählen nicht): (1) neuer Fehlertext oder abgelehnte Upload-Anfrage (HTTP ≥ 400 bzw. JSON `success:false`/`error`) → Fehler; (2) neuer Erfolgstext – auch ein Hinweis, der nach einer halben Sekunde wieder weg ist (Beobachter auf der Seite), mehr Wörter („submitted“, „wird verarbeitet“, „queued“ …); (3) Dateiname neu in der Upload-Liste; (4) Server hat die Upload-Anfrage angenommen (HTTP 2xx) und 10 s kommt nichts anderes → „vom Server angenommen“. Das Protokoll nennt den Weg („Bestätigung auf der Seite“ / „Datei in der Upload-Liste“ / „vom Server angenommen“) |
| Nichts erkannt | ❌ Fehler + wichtige Aufgabe | ✅ | gelb **„bitte in BQool prüfen – keine Bestätigung erkannt“**, Status „hochgeladen – Bestätigung bitte prüfen“, nur eine normale Aufgabe. sellerboard bleibt streng (bricht ohne Bestätigung ab; die Gegenprüfung am Folgetag findet den Rest) |
| Falsche Meldung korrigieren | ❌ | ✅ | Unter **Anbindungen → Importe/Exporte** an jeder roten/gelben Zeile **„hat geklappt“** (nur Inhaber): Zeile wird „hochgeladen (von Hand bestätigt)“, Vermerk mit Name und Zeit im Protokoll (nichts gelöscht), Status neu berechnet, Aufgabe erledigt, wenn alles hochgeladen ist (`bqoolUploadBestaetigen` in `src/lib/bqool/export-service.ts`) – damit lassen sich auch die vier Einträge vom 02.11. richtigstellen |

Abnahme: Unit `upload-logic` (feste Texte zählen nicht, kurzer Hinweis, Fehler vor Erfolg, Dateiname in Liste,
Server-Annahme erst am Ende, JSON-Fehler, „nicht erfolgreich“, Status aus Protokoll); e2e `bqool-upload-erkennung`
(Test-Nachbau: DE Hinweis 0,7 s, FR ohne Meldung, IT JSON-Ablehnung → „2 von 3 Ländern hochgeladen … IT: Fehler … Invalid
header line“; Seite ohne Upload → „bitte in BQool prüfen“, normale Aufgabe → „hat geklappt“ → von Hand bestätigt, Status
fertig, Aufgabe erledigt); Regression bqool-dateien, b24-automatik, arbitrageone, teil2, geschaeft, b15-anzeige, b20-rest
(alle bestanden), Unit 2112 bestanden.

## Familientermine direkt im Tagesplan und Kalender zuordnen (Wunsch 02.11.: „Fortbildung“ der Partnerin blockt meinen Tag)

| Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|
| Auf „Fortbildung“, „Seminar“ usw. drücken und den Familientermin einer Person zuordnen, damit wieder Platz ist | 🟡 (Zuordnung gab es, aber nur versteckt im Privatkalender → Termin öffnen) | ✅ | Neue Knöpfe **„Ina (ich) · Beide · nur Tom“** (+ ↺ = wieder automatisch) direkt an jedem Familientermin: im **Tagesplan** unter „Belegt“ (mit „Private Details zeigen“; ohne Details steht dort „wen betrifft es?“, bei gesperrter PIN führt der Link übers Entsperren zurück) und im **Kalender** in der Tagesliste und der Agenda (`src/components/betrifft-knoepfe.tsx`, Aktion `betrifftSchnellAction` in `src/app/(app)/kalender/tagesplan/actions.ts`, nur mit Privat-Zugang, nur Familienkalender, gilt für die ganze Serie). Nach dem Tipp: Rückmeldung oben, Seite bleibt, wo sie war |
| Platz für richtige Termine | ❌ | ✅ | „nur Tom“ → der Termin verschwindet aus „Belegt“, die **Kapazität steigt**, er steht im neuen Kasten **„Blockt nicht“** (mit Knöpfen zum Zurückholen). Im Kalender wird er blass mit „· nur Tom – blockt deine Zeit nicht“ (auch in der Monatsansicht blass); kein „Ins Auto“ dafür (`src/lib/tagesplan/service.ts` `sperrenLaden`, `src/app/(app)/kalender/page.tsx`) |
| „To do <Name>: …“-Termine im Familienkalender blocken die Zeit | ❌ (zählten doppelt: als Termin und als Aufgabe) | ✅ | Werden im Tagesplan nicht mehr als Termin gezählt (Hinweis „Kalender-To-do zählt als Aufgabe“), egal für wen (`istKalenderTodo` in `src/lib/calendar/kalender-todo.ts`) |
| Claude-Werkzeug `tagesplan` | – | ✅ | je Tag neu `blockt_nicht` (Familientermine nur der anderen Person; nur mit Privat-Freigabe, Titel nur mit `mit_privat`); Beschreibung ergänzt. Kein neues Werkzeug; geänderte Beschreibung kommt über `notifications/tools/list_changed` beim Verbinden an |

Abnahme: Unit `kalender-todo` (To-do-Termine erkennen, auch für die Partnerin; „Fortbildung Arbeit“, „Anna Seminar“ nicht);
e2e `familie-watch` „Familientermine direkt im Tagesplan und Kalender zuordnen“: Fortbildung 09–13 Uhr und „To do Ina:
Geschenk kaufen“ 15–16 Uhr → ohne Details „Privat belegt“ 09:00–13:00 mit „wen betrifft es?“, der To-do-Termin fehlt in
„Belegt“ (Hinweis sichtbar) → Details an → „Beide“ ist markiert → „nur Tom“ → Meldung „betrifft jetzt nur Tom“, Termin
unter „Blockt nicht“, Kapazität höher → „Ina (ich)“ → blockt wieder, Kapazität wie vorher → ↺ löscht die Zuordnung →
Kalender-Tagesliste: „nur Tom“ → Meldung, Seite bleibt beim Tag, Zeile „blockt deine Zeit nicht“. Regression: herzstueck,
handy-tesla, oberflaeche, privat, b19-rest, b20-rest, b25, privat-rueckblick (30 bestanden), Unit 2104 bestanden.

## Babysitter & Putzhilfe (Wunsch vom 31.10.)

| # | Punkt | vorher | nachher | Fundstelle |
|---|---|---|---|---|
| HH-1 | Einsätze aus dem Kalender übernehmen | ❌ | ✅ | Familienkalender und Privat-Termine, deren Titel einen Begriff enthält („Babysitter…“, „Putzfrau“, frei einstellbar); Uhrzeit aus dem Termin oder aus dem Titel („17–22 Uhr“) – `helferFuer`, `zeitAusTitel`, `familyEventTimes` |
| HH-2 | Stundensatz, Babysitter wach/schlafend | ❌ | ✅ | `aufteilen`/`kosten` in `src/lib/private/haushaltshilfe.ts`: Babysitterin bis Schlafenszeit (Standard 20:00) 20 €/Std., danach 17 €/Std. (z. B. 17–22 Uhr = 3 × 20 + 2 × 17 = 94 €); Putzhilfe fester Stundenlohn; alles unter „Stundensätze und Erkennung“ änderbar, weitere Hilfen (z. B. Oma) anlegbar |
| HH-3 | Genau berechnen per Hand | – | ✅ | Je Einsatz „korrigieren“: von/bis, Stunden wach/schlafend, Betrag (geht vor), ausgefallen, bezahlt, Notiz; „Korrektur zurücknehmen“; Einsatz von Hand für Termine außerhalb des Kalenders |
| HH-4 | Privat, Ausgaben im Blick | ❌ | ✅ | Seite „Babysitter & Putzhilfe“ unter Familienalltag; Summe in „Privates Geld“; Gespeichertes verschlüsselt als Privat-Eintrag „haushaltshilfe“; **nur voller Privat-Zugang** („nur Familie“ sieht keine Kosten, auch nicht im Export) |
| HH-5 | Auswertung/Export Ende des Monats | ❌ | ✅ | Monatsauswertung (Einsätze, Stunden, Kosten je Hilfe, noch nicht bezahlt, 12-Monats-Verlauf), CSV `/privat/haushaltshilfe/export?monat=JJJJ-MM`; in den ersten 7 Tagen eines Monats Hinweis auf der Privat-Startseite „Vormonat: … – Prüfen und exportieren“; Claude: `privat_finanzen` → `babysitter_putzhilfe` |

Abnahme: Unit `haushaltshilfe` (wach/schlafend, über Mitternacht, Stundenlohn fehlt, Korrektur, ausgefallen, geplant,
CSV); e2e `privat-haushaltshilfe` (Babysitterin 17–22 → 94 €, Putzfrau 15 €/Std. → 45 €, Korrektur bis 23 Uhr → 111 €,
Einsatz von Hand, CSV, „Geld“, `privat_finanzen`, „nur Familie“ ohne Zugang).

## Abgleich mit „Umsetzungsstand 31.10. (11:00)“

Der Umsetzungsstand wurde über die Werkzeuge auf dem Server geprüft. Was dort als ❌ steht, ist zum großen Teil gebaut,
aber noch nicht auf dem Server (B16 liegt auf main; Lugru, B17 und das Folgende auf `ueberarbeitung`).

| Befund | Stand im Code | Fundstelle / was noch fehlt |
|---|---|---|
| B6 Lugru Deals ❌ | ✅ gebaut | Abschnitt „Lugru Deals“ oben; live nach Update + To-do 29 |
| B16 Wochenrückblick privat ❌ | ✅ auf main (seit 31.10.) | Server aktualisieren, Konnektor neu verbinden (To-do 27) |
| B17 Fall-Zentrale, BQool-Soll ❌ | ✅ gebaut | Abschnitt B17; danach To-dos 30 und 32 |
| `anbindungen_status.postfaecher` leer 🟡 | ✅ | 17.6 |
| Anruf-Aufgabe ohne Telefonnummer 🟡 | ✅ | 17.5 |
| M1 Tagesplan: Mo 2.11. „rot“ bei 0 von 30 Min. (privat 10:00–23:59) | ✅ | `KAUM_ZEIT_MIN` (60 Min.) in `src/lib/tagesplan/logic.ts`: Tag mit weniger freier Zeit heißt „kaum freie Zeit (30 Min.)“, nie „überbucht“; die wichtige Aufgabe wird verschoben, Konflikt „Frist fällt auf einen Tag mit nur 30 Min. freier Zeit“; `tagesplan` liefert `ampel_text` |
| M13 Liquidität: Kontostand vom 30.09., kein Wareneinkauf → zu optimistisch | ✅ | Startseite und `ueberblick`: „Kontostand vom 30.09. (31 Tage alt) – Liquidität ungenau“ (ab 8 Tagen, ab 22 Tagen rot; ohne Kontostand eigener Hinweis). Wareneinkauf: Ø Warenrechnungen, sonst Ø Chargen (Kaufdatum × EK netto + 19 %), sonst Ø eigene Bestellungen (`src/lib/money/liquiditaet-service.ts`); ohne alles steht „Einkauf fehlt in der Prognose (zu optimistisch)“ |
| B10: UAE-Mail als „US“ | ✅ | `marktplatzAus`: AED/UAE/„United Arab Emirates“ → AE, ebenso SA, UK (£/GBP), TR |
| B15.3 Bestand −144 (8U-P4IG-LL5O) | 🟡 Reparatur gebaut, wartet auf Klick | Seit B15 bucht das Prep Center nicht mehr vom eigenen Lager; alte Buchungen werden nur auf ausdrücklichen Klick zurückgebucht (Bestand → Kachel „Eigenes Lager“ → „Zurückbuchen“, `prepAbbuchungenZurueck`). Zeigt der Vorschlag 0 Aufträge, liegt die Ursache woanders (z. B. Auftrag nicht als „Prep Center“ markiert) – dann bitte melden |
| M5/M16/M17, Tesla, SMS, Discord, Asana, Lexoffice | 🔌 | brauchen Uploads bzw. Anbindungen durch Ludwig (To-dos oben) |

## Neue Claude-Werkzeuge (57) und `notifications/tools/list_changed`

B36 Nachtrag (12.11.): **ein neues ändernde Werkzeug** – `video_auftrag_anlegen` (Bereich Marken, Stufe gelb): legt ein
Video in der Pipeline an (Kanal per Name, Thema, optional englische Vorlage = nur Muster oder eigenes Skript = wörtlich,
Start „sofort“/„nacht“/Zeitpunkt, vidIQ-Keywords/Titel). Ohne `bestaetigt` nur Rückfrage „Soll ich das Video so
anlegen?“ mit Kanal, Stil, Länge, Zielgruppe, Startzeit, Kostenschätzung, aktiven Freigaben und Worker-Stand; erst nach
ausdrücklichem Ja mit `bestaetigt=true` angelegt. Protokoll im Assistent-Verlauf; Abbrechen/Löschen über die Seite
Video (als gelbe Aktion kein Ein-Klick-Rückgängig; steht die Stufe in den Einstellungen auf grün: wartender Auftrag ohne
Kosten wird gelöscht, sonst abgebrochen). Freigaben und Upload (immer privat) bleiben auf der Seite Video.
`notifications/tools/list_changed` nötig – geht beim Verbinden raus.

B36 (11.11., Video-Pipeline): **zwei neue Werkzeuge** – `video_auftraege` (lesend, Bereich Marken: Aufträge mit
Status je Schritt, offener Freigabe, Fortschritt, Kosten Schätzung/Ist, YouTube-Status, Worker-Stand, Kosten je Kanal im
Monat) und `video_vidiq_eintragen` (ändernd, Stufe grün: vidIQ-Keywords/Titelvorschläge in einen Auftrag; Rückgängig
stellt die alten Werte her). `notifications/tools/list_changed` nötig – geht beim Verbinden raus.

B33 (08.11.): **keine neuen Werkzeuge**. Geändert: `bqool_export_vorschau` (Beschreibung + Felder `min_reset`,
`stufe_text`, `effektiver_min_text`, `gebuehren`). `notifications/tools/list_changed` nötig – geht beim Verbinden raus.

Bauauftrag Druckagent (08.11.): **keine neuen Werkzeuge**, keine Änderung an bestehenden – kein `list_changed`.

Geändert am 08.11. (B31.6a/b, B31.7, B31.8, B32): **ein neues Lesewerkzeug** `listing_check` (Befunde des täglichen
Listing-Checks, Stand, Trefferquote). Erweitert: `bqool_export_vorschau` (Leiter, Zustand, Schnelldreher) und `repricer`
(Stufe, Liquidation bis, Schnelldreher). `notifications/tools/list_changed` nötig – geht beim Verbinden raus.

Geändert am 06.11. (Bauauftrag Abholung DHL/UPS): **drei neue Werkzeuge** – `abholung_anlegen` (ändernd, Stufe gelb:
erst Rückfrage mit Zusammenfassung, nach „Ja“ mit `bestaetigt=true` buchen; Rückgängig = Storno), `abholung_stornieren`
(ändernd, gelb) und `abholungen` (lesend: Protokoll, Abholorte, Labels heute, nächster Abholtag). Bereich Service (VA
darf). `notifications/tools/list_changed` nötig – geht beim Verbinden raus.

Geändert am 05.11. (Nachtrag B29, keine neuen Werkzeuge): `anbindungen_status` hat einen neuen Block
`sellerboard_aufrufe`. Er enthält den Text „sellerboard-Aufrufe heute: n/125 (Automatik n, Reserve n)“, Stand laut
sellerboard, Pause, Limit gestern und `morgenbericht_zeile`. Neu ist auch `status` je Abruf, etwa „übersprungen
(Tagesbudget)“ oder „pausiert bis 01:00 Uhr“. Die Beschreibung ist ergänzt, das Eingabe-Schema unverändert →
`notifications/tools/list_changed` geht beim Verbinden raus, nötig ist es nicht.

Geändert am 05.11. (Nachtrag B28, keine neuen Werkzeuge): `deal_bewerten` (neu `gruende`, `freitext`) und
`deal_gekauft` (neu `verpackung`, `ean_abweichend`, `bestellmail` – nur Entwurf) haben neue Eingabe-Schemas →
`notifications/tools/list_changed` nötig (geht beim Verbinden raus). Ausgaben ergänzt: Marge in `deal_pruefen`,
`deal_wert`, `deal_eingang`, `deal_bilanz`, `lugru_deals`; Gründe in `deal_lernen_bericht`; Bewertung, Ware und
Bestellmails in `deal_eingang_detail`. Einzelheiten im Abschnitt „Nachtrag B28“.

Geändert am 01.11. (B25, keine neuen Werkzeuge): Rückgängig neu bei `auftrag_status`, `aufgabe_verschieben`,
`aufgabe_zuweisen` und `privat_eintrag_anlegen` (Antwort enthält bei `privat_eintrag_anlegen` den Hinweis „rueckgaengig“).
`anbindungen_status` nennt bei `ausloeser` den echten Zeitplan des letzten Laufs. Die Eingabe-Schemas sind unverändert,
`notifications/tools/list_changed` ist dafür nicht nötig (geht beim Verbinden trotzdem raus).

Geändert am 01.11. (Amazon-Berichte 1–4 und Kleinanzeigen, keine neuen Werkzeuge): `import_link`/`importe` kennen vier
neue Arten: `amazon_gestrandet`, `amazon_gesperrt`, `amazon_langzeitlager` und `amazon_inbound_maengel`. Das
Eingabe-Schema hat sich geändert, deshalb ist `notifications/tools/list_changed` nötig (geht beim Verbinden raus).
`amazon_faelle` hat jetzt die Blöcke `kontozustand` (Stufe gut/warnung/kritisch je Marktplatz, Gründe, Verstöße, Link),
`gestrandet` (SKUs, Stück, `gebunden_eur`, ohne EK, bald entfernt, Top 10) und `gesperrt`. `amazon_lagergebuehren` hat
den Block `weitere_gebuehren` (Langzeitlager, Lagerlimit, Inbound-Mängel, Inbound-Platzierung, 3 Monate). Der
Kleinanzeigen-Entwurf hat kein Werkzeug: Er ist nur zum Kopieren gedacht.

Geändert am 01.11. (B24 + Apple Watch, keine neuen Werkzeuge): Die Watch nutzt keine Claude-Werkzeuge, sondern die
Handy-Adressen `/api/mobil/watch/{stand,dringend,erledigt,notiz,deal,bestand,tesla}`. An den Werkzeugen ändert sich
nichts am Schema, `notifications/tools/list_changed` ist dafür nicht nötig. Inhaltlich neu: Deal-Texte (z. B. in
`deal_eingang_detail`) nennen ROI vor dem EK; Fehlermeldungen der Browser-Automatik in `anbindungen_status` können einen
Bildschirmfoto-Pfad `/import/debug/….png` enthalten (nur für Inhaber abrufbar).

Geändert am 01.11. (ArbitrageOne-Anbindung, keine neuen Werkzeuge): `import_link`/`importe` kennen drei neue Arten:
`ao_lagerbestand`, `ao_accountone_cog` und `ao_bqool_vergleich` (nur Vergleich). Das Eingabe-Schema hat sich damit
geändert, deshalb ist `notifications/tools/list_changed` nötig. Es geht beim Verbinden raus, Claude sieht die neue
Liste nach dem nächsten Verbinden. `importe` hat das Feld `herkunft` (Claude bzw. ArbitrageOne-Abruf).
`anbindungen_status` hat den Block `arbitrageone` (Auslöser, letzter und nächster Lauf).
`buchhaltung_status.accountone_cog` ist neu, ebenso `bestandsabweichungen.arbitrageone_lager`.

Geändert am 01.11. (Kaufen mit einem Tap, B23, keine neuen Werkzeuge): `deal_eingang_detail` hat jetzt das Feld `kauf`
(Deal-Nummer, Shop, Menge, „Warenkorb vorbereitet“, Link zum Selbst-Kaufen `/k/<id>`, Gutschein, „Kauf vorbereitet“) –
gekauft wird nie automatisch; `deal_lernen_bericht` mit Block `lugru_deals` (B22). Neue Handy-Adresse ohne Claude:
`POST /api/mobil/kaufen` („Kaufen 17“). `notifications/tools/list_changed` geht wie bisher beim Verbinden raus; die
geänderte Beschreibung sieht Claude nach dem nächsten Verbinden.

Neu am 31.10. (Datei-Import, 6 Werkzeuge): `import_link` (ändernd, nur Inhaber: einmalige Upload-Adresse),
`import_status` und `importe` (nur Inhaber), `umsatzsteuer` (je Periode JJJJ-MM), `umsatzsteuer_oss` (je Quartal) und
`amazon_lagergebuehren` (je Monat/Land/ASIN, Sortierung nach Gebühr oder Volumen; vorher `lagergebuehren`). Geändert
(Datei-Import-Nachbau): `kapital_ampel` (`lagergebuehr`, `remission`), `buchhaltung_status` (`amazon_umsatzsteuer`),
`import_status` (Lagergebühren mit übergroß und Abgleich; Vorschlag bei unbekanntem Format). Geändert (B20, keine weiteren neuen Werkzeuge): `lugru_deals`/`lugru_statistik`
(Zählbasis „im Deal-Eingang mit Ampel“, `fortschritt` „x / gesamt“ mit Zeitpunkt, Marge gerundet), `deal_quellen`
(eine Zeile „Lugru Deals“ mit `gemeldet` = Zählbasis und `gepostet`), `tagesplan` (`nicht_eingeplant` mit Vorschlag,
Konflikte nur an Arbeitstagen), `bestellvorschlaege` (`zu_pruefen` auch Kaufquote 0 % über die ASIN und Posten über
10.000 €), `liquiditaet` (Amazon-Auszahlungen laut Mitteilung, Temu wie Gewinn-Seite), `amazon_faelle`/`amazon_fall`
(Auszahlungen, Buy-Box, Bewertung, Versand nie als Fall). `notifications/tools/list_changed` geht beim Verbinden raus –
für die neuen Werkzeuge Claude einmal neu verbinden (To-do 46).

Geändert am 31.10. (B19, keine neuen Werkzeuge): `lugru_deals` (`mit_test`, Gesamtzahl, Reaktionen je Emoji bzw.
„nur Kaufzeichen“, getrimmte Kanäle, Eingang auch für History-Deals), `lugru_statistik` (Zeitraum und `gesamt`,
Testkanäle ausgeblendet), `deal_eingang` (`mit_historie`, Feld `historisch`), `deal_quellen` (Link auf die Lugru-Seite,
solange der Filter leer ist; Testkanäle ausgeblendet), `deal` (`deal_blatt` mit Text/PDF/Bild, `sammelbestellung`,
`export_prep_tool`), `tagesplan` (`faellig_min`, `zu_viel_min`, „überbucht – x Min. zu viel“), `bestellvorschlaege`
(`zu_pruefen` mit Grund, nicht in der Summe), `anbindungen_status` (`letzter_fehler` je Abruf,
`sellerboard_letzter_fehler`), `paletten` (`nicht_abgerechnet`), `aufgabe_aendern` (jetzt rückgängig machbar),
`amazon_faelle`/`amazon_fall` (Einkauf/Versand/Zahlung kein Fall, Gruppierung nach Bestellnummer, VA nur bei echten
Fällen), `liquiditaet` (Temu aus Aufträgen, Bestellvorschläge „prüfen“ nicht eingerechnet). Neue Felder brauchen kein
Neuverbinden; `notifications/tools/list_changed` geht wie bisher beim Verbinden raus.

Geändert am 31.10. (B18, keine neuen Werkzeuge): `va_aufgaben` (Ansprüche bei der VA mit Frist/Fallnummer/„Frist
verpasst“, Abschnitt `automatik` mit Modus und Tageszahlen, Status „überfällig“, `fristen_verpasst`), `ueberblick` (Feld
`va` für den Morgenbericht, `stufe` „rot“ bei verpassten Fristen), `feierabend` (VA-Zeile mit „N Fristen verpasst“),
`amazon_fall_an_va` (wie bisher; von Hand übergebene „erst Ludwig“-Fälle stehen in der Automatik als „von Hand an die VA“).

Neu am 31.10. (Lugru-Bauauftrag, lesend): `lugru_deals(seit?, bis?, kanal?, ampel?, gekauft?, min_wert?, suche?, limit?)`,
`lugru_deal(id)`, `lugru_statistik(von?, bis?)`. Geändert am 31.10.: `deal_quellen` (Quelle „Lugru Deals“ mit
Gruppen-Käufen), `anruf_aufgaben` (`telefon_vorschlag`, `rueckfrage`, optional `websuche`), `aufgabe_anlegen` (`telefon`,
Rückfrage bei Anruf ohne Nummer), `aufgabe_aendern` (`telefon`), `anbindungen_status` (`postfaecher_uebersicht`,
`postfaecher_hinweis`), `bqool_export_vorschau` (Soll aus BQool-Ist, Warnung „Min aus Upload blockiert Buy Box“),
`amazon_faelle`/`amazon_fall` (Routine-Mails nie ein Fall, Marktplatz aus Inhalt), `tagesplan` (`ampel_text`, „kaum freie
Zeit“), `ueberblick` (Hinweis alter/fehlender Kontostand), `liquiditaet` (Wareneinkauf auch aus Chargen/Bestellungen).


Lesend: `amazon_faelle`, `amazon_fall`, `anruf_aufgaben`, `auto_status`, `bqool_export_vorschau`, `buchhaltung_status`,
`deal_eingang`, `deal_eingang_detail`, `deal_lernen_bericht`, `deal_pruefen`, `deal_quellen`, `deal_wert`,
`erstattungen_abgleich`, `fahrt_briefing`,
`feierabend`, `freischaltungen`, `fristen`, `rechtsfaelle`, `rechtsfall`, `rechtsfristen`, `scan_pruefen`, `tagesplan`,
`va_aufgaben`, `va_nachrichten`, `verkaeufe_je_asin`.

Ändernd (nur auf ausdrücklichen Wunsch, im Fragefeld mit Vorschau und Stufe): `amazon_fall_an_va`, `amazon_fall_status`,
`amazon_todo_erledigen`, `anruf_erledigt`, `aufgabe_verschieben`, `aufgabe_zuweisen`, `auftrag_status`, `auto_klima`,
`auto_navi`, `bqool_export_erzeugen`, `deal_bewerten`, `deal_eingang_pruefen`, `deal_eingang_status`, `deal_gekauft`,
`mail_markieren`,
`privat_eintrag_aendern` (B16), `privat_eintrag_anlegen`, `privat_eintrag_loeschen` (B16), `rechtsfall_mail_entwurf`,
`va_nachricht`, `verlust_ausnahme`.

Geändert (B27): `anbindungen_status` (`arbitrageone.letzter_lauf.ergebnis` = Zeilen je Export, `fehler_details` mit
Rohmeldung/Bildschirmfoto/Seite, Abrufe mit `abgeloest`, sellerboard mit festem Zeitplan), `import_status`
(`erneut_verarbeitbar`, `nachverarbeitet_am`, `herkunft`). Keine neuen Werkzeuge.

Geändert: `wissen` und `calls_durchsuchen` (Herkunft `chat|call`), `ueberblick` (Rechtsfristen in 7 Tagen, privat nur
Anzahl), `kalender` (privat nur „Termin außer Haus“), `posteingang` (Vorschlag, Termin-Mails), `anbindungen_status`,
`keepa_produkt` (Alter), `kapital_ampel`, `liquiditaet` (B15: Ø Wareneinkauf, Kontostand-Alter), `verlust_stopp`,
`bestellvorschlaege` (B15: gemeinsame Rechnung, Feld `definition`, schon angelegte Einkäufe), `repricer` (B15: Filter
`regel`, Übersicht `je_regel`), `deal_pruefen` (B15: Prozentformat, eine Verkaufszahl), `feierabend` (B16: privater
Wochenrückblick vollständig + Link zum Therapie-Bogen).

Der Konnektor meldet `listChanged: true` und schickt beim Verbinden `notifications/tools/list_changed`
(`src/lib/assistant/mcp.ts`, `src/app/api/mcp/route.ts`) – laufende Chats sehen die neuen Werkzeuge ohne Neustart;
sonst einmal den Konnektor in claude.ai trennen und neu verbinden.

## To-dos für Ludwig (damit alles live läuft)

Alles Folgende sind Angaben bzw. Freigaben, die nur Ludwig machen kann. Zugangsdaten nur in Anbindungen eintragen,
nie in Chats oder Mails.

1. **Server aktualisieren** (wie gewohnt). Die neuen Tabellen legt der Start selbst an. `APP_SECRET` nie ändern.
2. **Amazon SP-API** unter Anbindungen eintragen – dann laufen Listungen je Land, Gebühren je Land in der Deal-Ampel,
   Retouren-/Remissions-Berichte und die Übertragung bei Amazon Business.
3. **eBay** einmal neu verbinden (Berechtigung für die Listing-API).
4. **Postfächer (IMAP)**: je Postfach das App-Passwort eintragen und „Verbindung testen“.
5. **Rechtsfälle**:
   - In Asana einen persönlichen Zugangstoken anlegen und unter Anbindungen → Asana eintragen (nur lesen).
   - Auf der Seite „Rechtsfälle“ eintragen: Absender-Domain des Anwalts, seine Mail-Adresse und private Asana-Projekte.
6. **Discord-Gruppen-Kanäle**:
   - Den Server-Admin der Deal-Gruppe bitten, den Bot einzuladen. Er braucht nur „Kanal ansehen“ und „Verlauf lesen“.
   - Kanal-IDs mit Rhythmus eintragen.
   - Die Gruppe informieren (Text steht auf der Calls-Seite).
7. **SMS (Twilio)**:
   - Konto und Absender eintragen.
   - Die Antwort-Adresse `/api/sms/antwort` in Twilio als Webhook setzen.
   - Unter Einstellungen → Handy die eigene Nummer eintragen und „SMS an“ setzen.
8. **Tesla**:
   - App im Tesla-Entwicklerkonto registrieren und ein Schlüsselpaar erzeugen.
   - Den öffentlichen Schlüssel unter Anbindungen → Tesla eintragen. Das System veröffentlicht ihn unter `/.well-known/appspecific/com.tesla.3p.public-key.pem`.
   - Den virtuellen Schlüssel im Auto koppeln.
   - Bei neueren Fahrzeugen den „Vehicle Command Proxy“ eintragen.
   - Die Fahrgestellnummer (VIN) eintragen.
   - Wenn das Auto zu Hause steht: „Heim-Standort = Standort des Autos“, dann Vorheizen einschalten.
9. **Handy**: Unter „Schnellerfassung“ einen Handy-Schlüssel anlegen und das Widget bzw. die Kurzbefehle einrichten (Anleitung unter Hilfe).
10. **BQool**: Die Abverkaufs-Regeln je Land auf das Soll umstellen (4/3/2/1/0 %). Das System meldet danach Abweichungen je SKU.
11. **ProfitGo**: Die eigene Adresse für den Schnelllink eintragen.
12. **Steuerberater**:
    - Fahrtenbuch oder Pauschale? Gegebenenfalls einen GoBD-konformen Anbieter klären.
    - Den USt-Voranmeldungs-Rhythmus in den Einstellungen bestätigen.
    - Das System berät nicht steuerlich.
13. **Prep-Tool**: Die API-Adresse und die Beschreibung schicken. Bis dahin gibt es den Export je Kunde.
14. **Verlust-Stopp**: Nach dem ersten Amazon-Transaktionsbericht die Zerlegung (Verkauf / Erstattung / Abschreibung / Lager) einmal gegen sellerboard ansehen.
15. **Claude**: Falls neue Werkzeuge fehlen, den Konnektor in claude.ai einmal trennen und neu verbinden.
16. **Versandbestätigung (B15.1)**: Solange die SP-API fehlt, täglich unter Aufträge → „Meldung offen“ die Datei laden,
    in Seller Central unter Bestellungen → Bestellberichte hochladen und danach „Hochgeladen“ klicken.
17. **Nach dem Update einmal**:
    - Bestand → Kachel „Eigenes Lager“ → Hinweis zu Prep-Center-Aufträgen ansehen und nur passende zurückbuchen.
    - BQool-Export je Land neu hochladen (richtige Status-Spalte).
    - B2B → Lieferanten-Freigaben → „SKU-Kürzel“ prüfen: einem Lieferanten zuordnen oder „Ist ein Lieferant“.
    - Palettenlager: Paletten ohne Kunde nachtragen.
18. **Handy-Ansicht (B15.16)**: einmal mit dem eigenen iPhone durchklicken (Startseite, Tagesplan, Scanner, Widget) und
    Auffälligkeiten melden – das geht nur am echten Gerät.
19. **Handy-Kurzbefehle über die öffentliche Adresse**: Nach dem Update einmal
    `bash /opt/seller-system/deploy/claude-oeffentlich.sh aktualisieren` – erst dann lässt die Freigabe `/api/mobil/*`
    durch (vorher antwortete der Webserver selbst mit „Nicht freigegeben“). Die Prüfung im Skript meldet „ohne Schlüssel 401“.
20. **Testbericht**: Die Datei `Seller-System_Testbericht_2026-10-30.md` nachreichen, falls darin mehr steht als im
    Prüfauftrag (B15) – dann gleiche ich die Punkte noch einmal ab.
21. **Deal-Kurzbefehl und Lugru Deals über die öffentliche Adresse**: wie To-do 19 einmal
    `bash /opt/seller-system/deploy/claude-oeffentlich.sh aktualisieren` – danach meldet das Skript für
    `/api/deal-eingang` und `/api/public/lugru-deals/deals` „ohne Schlüssel 401“.
22. **Lugru Deals** auf dem PC auf den neuen Stand bringen. Unter Monitor → Einstellungen → eBay stehen schon Adresse und
    Verbindungsschlüssel? Dann kommt die ganze History beim nächsten Start von selbst (danach stündlich). Stand und Fehler
    stehen dort; im Seller-System unter Deal-Eingang → „Wie gut liegt der Deal-Wert?“.
23. **Budget und Schwelle** im Deal-Eingang eintragen: max. € je Deal, je Tag, je Woche und ab welchem Deal-Wert eine
    Kauf-Meldung kommt (Standard 70). 0 = keine Grenze.
24. **Amazon Business Ordering API** (nur falls gewünscht): Zugang im Solution Provider Portal beantragen (Rolle
    „Amazon Business Order Placement“). Erst nach Freigabe durch Amazon besprechen wir, ob und wie das eingebaut wird –
    automatisch gekauft wird auch dann nicht.
25. **👍/👎 in Discord**: dem ProfitPath-Bot nichts weiter freigeben – er liest die Reaktionen mit den bestehenden Rechten.
26. **Therapie-Bogen**: Paartherapie-Termine im Privatkalender als Art „Paartherapie“ eintragen und nach der Sitzung auf
    „stattgefunden“ setzen – dann beginnt der Bogen automatisch am letzten Termin. Beobachtungen am besten mit den drei
    Feldern erfassen; „[?]“ markiert Unklares, der Bogen zeigt dann „unvollständig“.
27. **Claude neu verbinden** (falls die zwei neuen Werkzeuge `privat_eintrag_aendern`/`privat_eintrag_loeschen` nicht
    erscheinen): Konnektor in claude.ai einmal trennen und neu verbinden; Privat-Freigabe dabei angehakt lassen.
28. **Siri-Link**: Prüfen, dass `APP_URL` in der Server-`.env` die normale https-Adresse des Seller-Systems ist (nicht
    localhost) – Einstellungen → Adressen-Check zeigt es. Dorthin zeigt künftig der Link in der Siri-Antwort.
29. **Lugru Deals direkt von der Seite (Hauptweg)**:
    - Das Lugru-Programm auf dem PC aktualisieren: neue `lugru-deals.exe` (ZIP aus dem Chat) entpacken, dann in
      PowerShell im entpackten Ordner `.\update.ps1 -SourceDir .` (stoppt, ersetzt, startet neu; die Daten bleiben).
    - In der Lugru-Seite unter Monitor → Einstellungen → eBay „Adresse des Seller-Systems“ (die öffentliche Adresse) und den
      Verbindungsschlüssel eintragen – derselbe wie im Seller-System unter Anbindungen → „Lugru Deals“.
    - Danach geht beim ersten Start die ganze History hinüber, und jeder neue Post steht nach Sekunden im Deal-Eingang.
      Den PC mit der Lugru-Seite einfach wie gewohnt zum Posten benutzen.
    - Optional zusätzlich der Discord-Weg (nächster Punkt), damit Reaktionen auch bei ausgeschaltetem PC ankommen.
29b. **Lugru Deals über Discord (optional)**:
    - Einen Bot mit Leserechten in den Discord-Server der Deal-Gruppe bringen. Am einfachsten der Discord-Bot, den das
      Seller-System schon hat (VA bzw. Discord-Kanäle) – oder der Lugru-Reaktions-Bot. Er braucht nur „Kanal ansehen“
      und „Nachrichtenverlauf lesen“; im Entwicklerportal muss „Message Content Intent“ an sein.
    - Unter Anbindungen → „Lugru Deals“ die IDs der Deal-Kanäle eintragen (je Zeile eine; Rechtsklick auf den Kanal →
      „Kanal-ID kopieren“). Bot-Token nur eintragen, wenn es ein anderer Bot ist als der schon hinterlegte.
    - „Verbindung testen“ – zeigt je Kanal den letzten erkannten Deal.
    - Deal-Eingang → „Lugru Deals“ → „History importieren“. Der Import läuft danach im Hintergrund weiter, bis alle
      Kanäle fertig sind (Stand je Kanal auf der Seite).
    - Neue Posts kommen danach von selbst (jede Minute); der PC mit dem Lugru-Programm muss dafür nicht laufen.
30. **Fall-Zentrale nach dem Update**: einmal „↻ Amazon-Mails einordnen“ klicken. Das stuft die bisherigen Vorgänge neu
    ein (Bestell-/Versand-/Zahlungsmails werden „Info“, Marktplatz aus dem Inhalt); die Meldung nennt die Anzahl.
    Vorgänge, die von Hand bearbeitet wurden, behalten Bereich und Phase.
31. **VAT-Mails vom 02.10.** („Wichtige Informationen zu Ihrer VAT auf Amazon.de“): die Frist 05.10. kam vom System
    (Standard +3 Tage), nicht aus der Mail. Bitte die Mail selbst lesen bzw. dem Steuerberater geben, ob etwas zu tun
    ist – das System berät nicht steuerlich.
32. **BQool vor dem nächsten Export**: die aktuellen BQool-Dateien je Land neu hochladen (Repricer → BQool). Das System
    übernimmt daraus Liquidation und „Abverkauf DE“ als Soll. Zeilen mit „Min aus Upload blockiert Buy Box“ zuerst
    ansehen – dort empfiehlt sich ein neuer Upload mit dem effektiven Min.
33. **Anruf „DHL Geschäftskunden“**: auf der Startseite bei der Aufgabe „📞 Nummer fehlt“ öffnen, Vorschlag prüfen oder
    die Nummer eintragen („Nummer im Web suchen“ braucht den Claude-Schlüssel unter Anbindungen).
34. **VA-Zeitzone**: Delegation → VA → Einstellungen → „Zeitzone der VA“ auf `Asia/Manila` setzen, falls dort noch
    „Europe/Berlin“ steht (ein gespeicherter Wert geht vor dem neuen Standard). Die Ruhezeit 20:00–08:00 gilt dann in
    Manila.
35. **VA-Automatik**: erst im Modus „Vorschlag“ lassen und einige Tage die Liste „Automatik“ auf der VA-Seite ansehen
    (dazu kommt täglich die Aufgabe „VA-Automatik (Vorschlag)“). Passt die Einstufung – nach dem Update und To-do 30 –,
    dort auf „automatisch“ umstellen. Regeln je Kategorie, Schwelle (500 €), Grenze (30 Threads/Tag), Uhrzeit,
    Arbeitstage und die Feiertage der VA (Philippinen) stehen im selben Kasten.
36. **Anleitung „File reimbursement claim“** im Wissen anlegen (Art „Anleitung“, englische Fassung prüfen und freigeben).
    Bis dahin bekommt die VA eine allgemeine Standard-Anleitung im Anspruchs-Thread.
37. **Konten prüfen (B19.2)**: Einstellungen → Benutzer. Rote Warnungen zuerst: Konto „test“ und das Konto der Partnerin
    – Rolle wählen (Partnerin: „Nur Familie“ oder voller Privat-Zugang, das entscheidest du), `va@va.de` auf die
    Vorlage „VA“ stellen. Das System ändert Live-Konten nicht selbst.
38. **`du@firma.de` entfernen**, falls es ein altes Beispielkonto ist (Knopf „Entfernen“ in der Benutzerliste).
39. **Schwelle für Lugru Deals**: Deal-Eingang → Kasten „Kaufen mit einem Tap: Budget und Deal-Wert“ → Feld „je Quelle“
    `Lugru Deals=60` eintragen und speichern (sonst gilt die allgemeine Schwelle 70).
40. **Steuertermine** auf der Liquiditäts-Seite unten unter „Steuertermine (Schätzung)“ eintragen (USt-Voranmeldung,
    Vorauszahlungen). Bis dahin steht bei den Quellen „Steuertermine: keine Daten“ und die Vorschau ist zu optimistisch;
    das System berät nicht steuerlich.
41. **Paletten ohne Kunde** (zuletzt 11): Palettenlager → Filter „ohne Kunde“ → je Palette den Kunden eintragen – sonst
    werden sie nicht abgerechnet.
42. **Lugru Deals sendet noch?** Deal-Eingang → „Lugru Deals“: Weg A zeigt „zuletzt übertragen“. Steht dort eine
    Warnung (über 24 Std. kein Post), auf dem PC prüfen, ob das Lugru-Programm läuft (To-do 29).
43. **Nach dem Update einmal**: Fall-Zentrale „↻ Amazon-Mails einordnen“ (nimmt Einkaufs-/Versand-/Zahlungsmails aus den
    Fällen und die VA aus Routine-Vorgängen) und Deal-Eingang → „Lugru Deals“ → „Jetzt nachtragen“ (History mit Ampel;
    läuft danach alle 5 Minuten weiter).
44. **Kurzbefehl „Deal prüfen“** auf dem iPhone einrichten: Einstellungen → Handy & Tesla → „Anleitung: Kurzbefehl
    ‚Deal prüfen‘“.
45. **Lugru „selbst gekauft“** nach dem Update: Deal-Eingang → „Lugru Deals“ → an der Kachel „Selbst gekauft“ einmal
    „Eigene Käufe abgleichen“ klicken. Erkannt wird ein Kauf, wenn eine Charge (SKU mit Kaufdatum) oder Bestellung mit
    derselben ASIN bis 14 Tage nach dem Post angelegt ist. Bleibt ein bekannter Kauf unerkannt, bitte ASIN und Kaufdatum
    nennen – dann prüfe ich, wo der Kauf steht (z. B. SKU ohne Datum oder andere ASIN).
46. **Nach dem Update: Claude neu verbinden** (Einstellungen → Claude), damit die 6 neuen Werkzeuge erscheinen, und auf dem
    Server einmal `bash deploy/claude-oeffentlich.sh aktualisieren` ausführen – sonst lehnt der Server die Upload-Adresse
    `/api/import/upload/…` ab.
47. **Dateien einspielen** (Upload-Seite oder im Chat mit `import_link`): Amazon-Transaktionsbericht (Zahlungen →
    Transaktionsansicht, damit „Abrechnung fehlt noch“ verschwindet), die Lagergebühren-Dateien (Monthly Storage Fees)
    und die USt-Transaktionsberichte je Monat.
48. **Bestand −144 (8U-P4IG-LL5O)**: Bestand → Kachel „Eigenes Lager“ → Hinweis „x Prep-Center-Aufträge haben … vom
    eigenen Lager abgebucht“ → „Zurückbuchen“ klicken (das System ändert alte Buchungen nicht selbst). Fehlt der
    Hinweis, liegt die Ursache woanders – dann bitte melden.
49. **Fall-Zentrale nach dem Update**: einmal „↻ Amazon-Mails einordnen“ – schließt die Auszahlungs-Fälle (369,71 € und
    115,52 €) mit Verlaufseintrag, bucht sie in die Liquidität und legt je Land ein ToDo „Buy-Box-Berechtigung prüfen“ an.
50. **Lugru-Nachtrag**: läuft nach dem Update im Hintergrund weiter, bis alle Deals im Deal-Eingang sind (Fortschritt
    „x / gesamt“ auf der Lugru-Seite); alte Ampeln werden dabei nach den neuen Regeln neu bewertet.
51. **Lagergebühr als Fixkostenposten?** Die Gewinn-Seite zeigt sie als „darin enthalten“, weil Amazon sie schon von
    der Auszahlung abzieht. Soll sie trotzdem als eigener Posten in der Liquidität stehen (dann muss die Auszahlungs-
    Schätzung um sie gekürzt werden), bitte sagen. Nach dem Update die Lagergebühren-Dateien einmal neu hochladen –
    dann sind auch Maße, Gewicht und Gefahrgut gefüllt (übergroß wird aus der Größenklasse schon nachgetragen).
52. **Babysitter & Putzhilfe**: Privat → Familienalltag → „Babysitter & Putzhilfe“ → unten den Stundenlohn der Putzfrau
    eintragen und die Sätze der Babysitterin prüfen (vorbelegt 20 € wach / 17 € schlafend ab 20:00). Stehen die Termine
    im Familienkalender unter einem anderen Wort (z. B. dem Vornamen), das Wort bei „Begriffe im Kalender“ ergänzen.
53. **Call-Kanal live (B21)**: discord.com/developers → eure Bot-Anwendung → Bot → „Privileged Gateway Intents“ →
    **Message Content Intent** einschalten und speichern. Nach dem Update steht unter Anbindungen → Hintergrund-Abrufe
    „Auslöser: live (Discord) – verbunden seit …“. Steht dort „abgelehnt“, fehlt genau dieser Schalter.
54. **Beobachtungen vom 30.10.**: die alten Zeilen 2 und 3 (ersetzt durch die korrigierte Zeile 2) bei Bedarf in Claude
    mit „lösche die Beobachtungen …“ entfernen lassen (7 Tage rückgängig) – das System löscht nichts von selbst. Steht auf
    der Beobachtungen-Seite der rote Hinweis „Claude ist mit dem Konto … verbunden“, den Konnektor mit dem eigenen Konto
    neu verbinden.
55. **Lugru-Lernen anstoßen**: nach dem Update einmal Lugru Deals → „Jetzt nachtragen“ drücken (Deal-Eingang, eigene Käufe,
    Deal-Wert in einem Schritt); danach läuft alles im Hintergrund. Voraussetzung: sellerboard-Abgleich aktiv (Produkte,
    Bestand, Sendungen).
56. **BQool je Land**: Anbindungen → BQool → Bearbeiten: FR/IT/ES sind aus der DE-Adresse vorbelegt – einmal mit den echten
    BQool-Upload-Seiten vergleichen, speichern, dann „Verbindung testen“ (meldet je Land „Upload-Seite erreichbar“).
57. **Kaufen mit einem Tap am iPhone testen**: nächsten Kauf-Push antippen → öffnet sich die Amazon-App mit dem Warenkorb?
    Falls die Seite nur im Browser bzw. leer aufgeht: Detailseite „Produktseite öffnen“ nutzen und Bescheid geben (dann
    stellen wir unter Einstellungen → Shop-Profile Amazon auf „Produktseite“). Watch: Kurzbefehl „Kaufen“ nach der Anleitung
    im Wissen einrichten (Handy-Schlüssel unter Schnellerfassung).
58. **Payback**: Eine feste Verknüpfung im Amazon-Konto gibt es laut Recherche (01.11.) nicht mehr – Punkte nur mit Start in
    der PAYBACK-App, Gewerbe-/Großmengenkäufe ausgenommen. Wenn du es trotzdem nutzt: Einstellungen → Shop-Profile →
    „Payback eingerichtet ✅“, dann verschwindet der Hinweis im Push. Shops mit Payback (z. B. dm, Alternate) dort eintragen.
59. **Monatsrahmen prüfen**: Deal-Eingang → „diesen Monat eingekauft“ mit deiner eigenen Zahl vergleichen; Rahmen bei Bedarf
    im Formular ändern (Standard 150.000 €). SKUs ohne Menge (noch nicht versendet) zählen erst mit der FBA-Sendung.
60. **Neues Menü**: Gruppen „eBay & Temu“ und „Marken & Content“ standen nicht im Bauauftrag – sie sind geblieben, damit
    keine Seite verschwindet. „Anrufe“ öffnet den Tagesplan (eine eigene Anrufe-Seite gibt es nicht). Sag Bescheid, wenn
    etwas anders einsortiert werden soll. Mehr als 6 alte Favoriten: die ersten 6 erscheinen, der Stern ist gesperrt, bis
    du einen entfernst.
61. **ArbitrageOne verbinden**: Anbindungen → „ArbitrageOne – Exporte automatisch abholen“: E-Mail, Passwort, Export-Seite
    eintragen, dann „Verbindung testen“. Am besten ein eigenes Konto nur fürs System ohne Zwei-Faktor. Weichen die
    Kartennamen ab (z. B. „Lagerbestand (Stichtag)“ statt „Lagerbestand“), trägst du sie in den Feldern „Name der Karte“
    ein. „sellerboard-Datei weiterreichen“ steht auf „nein“. Auf „ja“ stellen, wenn die ersten Abrufe gepasst haben; dann
    lädt der Nachtlauf die sellerboard-Datei von ArbitrageOne unverändert zu sellerboard hoch.
62. **Noch offen bei ArbitrageOne**: Kapital-Ampel mit dem ArbitrageOne-Lagerbestand und Lieferant/Rechnung im
    Echtheits-Ordner sind nicht gebaut. Die Daten liegen schon im System. Sag Bescheid, wenn das als Nächstes kommen soll.
63. **Formate der Exporte „Einkäufe“, „Lagerbestand“ und „Inventory Reimbursement“**: Davon lag mir keine echte Datei vor
    (nur sellerboard- und BQool-Export). Die Erkennung ist großzügig gebaut. Passt eine Datei nicht, kommt eine Aufgabe
    mit Spaltenliste. Bitte einmal je Export eine Datei per Upload-Seite oder import_link schicken (Art `ek_liste`,
    `ao_lagerbestand`, `amazon_reimbursements`), dann prüfe ich die Spalten.
64. **Apple Watch einrichten**: Wissen → „Handy & Tesla → Apple Watch: Kurzbefehle“. Je Befehl ein Kurzbefehl mit dem
    Handy-Schlüssel, „Auf Apple Watch anzeigen“ an, Komplikation „Was ist dringend“. Einmal „Hey Siri, wie läuft's“ an der
    Watch probieren und sagen, ob das Vorlesen passt (den Teil kann der Test nicht prüfen).
65. **Bildschirmfotos für die Watch-Anleitung**: Das System hat kein iPhone und macht keine Bildschirmfotos der
    Kurzbefehle-App. Wenn du welche willst, an den Wissens-Eintrag anhängen.
66. **Neu: Push bei neuen wichtigen Aufgaben** (damit „Erledigt“ an der Watch etwas zu schließen hat): höchstens 6 je
    Stunde, nie in Discord. Sag Bescheid, wenn es zu viele werden – dann baue ich einen Schalter.
67. **VA-Nachrichten von der Watch**: Im Modus „Vorschlag“ (Standard) stehen sie unter Delegation → VA zum Freigeben.
    Erst „An die VA senden“ schickt sie. Auf „automatisch“ erst stellen, wenn B17.2 für dich erledigt ist.
68. **BQool/ArbitrageOne-Anmeldung klappt weiter nicht**: In der Fehlermeldung auf „Bildschirmfoto öffnen“ tippen. Steht
    dort eine Browser-Prüfung (Cloudflare), geht nur der Datei-Weg (ZIP). Heißt das Feld anders, in der Anbindung „Feld
    E-Mail“ (z. B. `#login-email`) eintragen, Wert per Rechtsklick → Untersuchen.

69. **Amazon-App: Rollen für die neuen Berichte**: Der USt-Transaktionsbericht braucht in der Seller-Central-App (Apps
    entwickeln → App bearbeiten) die Rolle „Steuer-Rechnungsstellung“ bzw. „Tax Remittance“, der Kontozustand die Rolle
    „Verkäuferleistung“/„Selling Partner Insights“. Ohne Rolle steht unter Anbindungen → Amazon-Berichte eine Zeile
    „abgelehnt – Rolle fehlt“. Nach dem Ergänzen die App einmal neu autorisieren und „Konto-Berichte anfordern“ drücken.
70. **USt: nicht mehr doppelt hochladen**: Sobald der Bericht von Amazon kommt, ersetzt er hochgeladene Dateien
    desselben Monats. Den Monats-Upload kannst du dann weglassen. Die Zahlen sind nur für den Steuerberater gedacht.
71. **Formate von Langzeitlager- und Inbound-Mängel-Bericht prüfen**: Davon lag mir keine echte Datei vor. Beide sind
    nach der Amazon-Doku gebaut (Spaltennamen englisch, ältere Langzeitlager-Variante mit 6-/12-Monats-Spalten).
    Stimmt eine Summe nicht mit Seller Central überein, eine Datei auf die Upload-Seite legen. Kommt die Meldung
    „unbekanntes Format“, sag Bescheid.
72. **Kleinanzeigen**: Im Kleinanzeigen-Konto als **gewerblicher Anbieter** einstellen (Pflicht für Händler). Die
    Kategorie ist nur ein Vorschlag, in der App prüfen. Versand oder Abholung und Preis-Art (Festpreis/VB) in der App
    wählen. Das System stellt nichts selbst ein.
73. **B25.1 Gewinn**: Nichts neu hochladen – nach dem Update zieht das System die Abrechnung aus dem schon importierten
    Transaktionsbericht nach (beim nächsten Zeitplan-Lauf oder beim nächsten Upload). Danach Gewinn → Oktober prüfen:
    Die Amazon-Zeile heißt „Amazon-Abrechnung/Transaktionsbericht (bis 30.10.)“.
74. **B25.8 Fahrzeit**: Unter Einstellungen → Handy & Tesla bei „zu Hause“ die Adresse **mit PLZ** eintragen. Ohne PLZ
    gilt überall die Standard-Fahrzeit.
75. **B25.12 Steuertermine**: Auf der Seite Cash Flow unten bei „Steuertermine“ die Termine eintragen
    (USt-Voranmeldung, Vorauszahlungen; Betrag darf leer sein). Die Erinnerung kommt 7 Tage vorher als Aufgabe.
76. **B25.9 Benutzer**: Nach dem ersten Login den Dialog „Privat-Zugang bereinigt“ lesen. Wer Familienzeiten sehen soll,
    bekommt „nur Familie“. Beim Konto der VA auf „Als VA-Rolle übernehmen“ tippen.
77. **B25.10 B2B**: Deal-Blatt, Sammelbestellung und Prep-Export sind da und erscheinen am Deal (Hilfe-Kasten auf der
    B2B-Seite). Zum Ausprobieren einen Test-Deal anlegen. Wenn du B2B vorerst nicht nutzt, sag Bescheid – dann führe
    ich es im Umsetzungsstand als „bewusst zurückgestellt“.
78. **Browser auf dem Server**: einfach `deploy/update.sh` ausführen – der Browser wird jetzt automatisch mitgebaut
    (das erste Update dauert ein paar Minuten länger, danach geht es wieder schnell). Danach unter Anbindungen bei
    sellerboard/BQool/ArbitrageOne „Verbindung testen“ bzw. den Lauf starten. Steht in der `.env` eine Zeile
    `MIT_BROWSER=0`, diese vorher löschen. Freier Platz auf dem Server: ca. 1 GB mehr einplanen.
79. **Apple Watch**: Einstellungen → Apple Watch öffnen und den einen Kurzbefehl „Seller“ nach der Anleitung anlegen
    (5 Minuten am iPhone). Vorher im Feld „Ausprobieren“ testen, was die Uhr antworten würde. Danach an der Watch:
    „Hey Siri, Seller“ → „Wie läuft's?“. Die alten Einzel-Kurzbefehle funktionieren weiter.
80. **Familienkalender**: Termine deiner Frau einmal antippen und auf ihren Namen stellen – oder ihr Vorname steht im
    Titel („Tom Zahnarzt“), dann erkennt das System es selbst. Gilt für die ganze Serie. In den Privat-Einstellungen
    müssen eure Vornamen und „wer bin ich“ stimmen.
81. **„To do Ludwig: …“ im Familienkalender**: Deine Frau (oder du) schreibt einfach „To do Ludwig: …“ in den Titel –
    beim nächsten Abgleich (spätestens nach 14 Minuten) steht es als wichtige Aufgabe in deiner Liste und kommt als Push.
    Geht auch „ToDo für Ludwig – …“. Für deine Frau genauso mit ihrem Vornamen, wenn sie ein eigenes Konto hat.
82. **B27 nach dem Update prüfen**: Unter Anbindungen → ArbitrageOne → Importe sollten die Einkäufe/Lagerbestand vom
    02./03.11. innerhalb einer Stunde „fertig“ sein (sonst „Erneut verarbeiten“; steht dort ein Fehler, nennt er jetzt die
    gefundenen Spaltennamen – dann kurz schicken). Am 04.11. nach 05:30 den Lauf ansehen: BQool-Vergleich und
    Reimbursement haben entweder eine Datei oder einen Fehler **mit Bildschirmfoto** – das Bild zeigt, wo ArbitrageOne
    hängt (z. B. Dialog oder „Export wird erstellt“). Reimbursement läuft nur montags, also erst am 09.11. im Nachtlauf
    (oder „Jetzt abholen“). sellerboard-Kostenimport bleibt „übersprungen“, bis die Anmeldung unter Anbindungen →
    sellerboard eingetragen ist.
83. **B28 Deal-Quellen**: Unter Deal-Eingang → „Deal-Quellen (Lieferanten, Bestellmail)“ den Lieferanten aus dem
    Anlass-Deal mit Mailadresse, Ansprechpartner, Zahlungsweg und Stichwort der Quelle eintragen. Darunter Liefer- und
    Rechnungsadresse plus USt-IdNr. prüfen. Dann bietet „Gekauft“ die Bestellmail an. Sie geht erst mit „Senden“ raus.
84. **B28 Discord-Rechte**: Der Bot im ProfitPath-Kanal braucht für die Rückfrage nach 👍 „Nachrichten senden“,
    „Öffentliche Threads erstellen“, „Nachrichten in Threads senden“ und „Reaktionen hinzufügen“.
85. **B28 Frage Ampel**: Die Ampel prüft weiter die Netto-Marge (15 % vom VK netto). Soll sie auf Brutto-Marge wie die
    Anzeige umgestellt werden (≈ 12,6 %)?
86. **B29 nach dem Update**: Nichts tun. Ist das sellerboard-Limit beim Update noch erschöpft, steht unter Anbindungen
    → sellerboard „pausiert bis 01:00 Uhr“, danach holt das System selbst nach. Am 06.11. gegen 12:00 auf der Karte den
    Zähler ansehen (Abnahme 1: höchstens 45). Am Abend prüfen, dass der Tag unter 125 bleibt (Abnahme 4).
87. **B29 Morgenbericht**: In der Claude-Routine für den Morgenbericht ergänzen: „Wenn `anbindungen_status` →
    `sellerboard_aufrufe.morgenbericht_zeile` gesetzt ist, diese Zeile ganz oben zeigen.“ Der Blick auf
    `anbindungen_status` kostet keinen sellerboard-Aufruf.
88. **B29.3 später**: Wenn B29.1/B29.2 ein paar Tage sauber laufen, in sellerboard unter Einstellungen → Reports den
    täglichen CSV-Export (Produkte & EK, Monatswerte je SKU, Produkte 30 Tage) an das Firmenpostfach einrichten und
    Bescheid geben. Dann baue ich den Import (wie bei ArbitrageOne), das spart ca. 15 Aufrufe am Tag.
89. **B29 „Jetzt abgleichen“ sparsam**: Der Knopf holt alles auf einmal (ca. 40–60 Aufrufe). Für Nachzügler reicht
    „Fällige Abrufe nachholen“.
90. **B30 nach dem Update**: Unter Anbindungen → ArbitrageOne → Importe prüfen, ob die Einkäufe vom 02.–06.11. auf
    „fertig“ stehen („n Bestellungen, m Positionen, k ohne Zuordnung“). Das passiert innerhalb einer Stunde von selbst,
    sofort mit „Jetzt abholen“. Steht dort ein Fehler, nennt er die gefundenen Spalten – diese Zeile bitte schicken.
    Danach Einkauf → Bestellungen → „ArbitrageOne“ ansehen.
91. **B30 Spalten prüfen**: Ich konnte die echte Datei nicht öffnen (sie liegt nur verschlüsselt auf dem Server). Im
    Import steht unter „bestellungen → spalten“, welche Spalte wofür gelesen wurde, und unter „status_werte“, welche
    Statuswerte vorkamen (Claude: `import_status`). Bitte ansehen, ob EK netto/brutto, Menge und Status stimmen. Am
    einfachsten: die Kopfzeile der Datei schicken (nur die Spaltennamen, keine Werte).
92. **B30 EK-Vorschläge**: Sobald Positionen geliefert sind, erscheinen unter Einkauf → EK-Import Vorschläge
    „EK-Vorschlag aus ArbitrageOne-Bestellungen“. Ansehen und übernehmen oder verwerfen – nichts geht automatisch.
93. **Abholung – DHL freischalten**: developer.dhl.com → deine App → API „Parcel DE Pickup (Post & Parcel Germany)“
    hinzufügen (gleicher API-Key wie der Versand). Im Geschäftskundenportal dem System-Benutzer das Recht „Abholung
    beauftragen“ geben. Für echte Abholungen unter Einstellungen → Versand „DHL-Sandbox“ ausschalten.
94. **Abholorte eintragen**: Einstellungen → Abholung → beide Absender aus dem Bauauftrag mit Adresse,
    Ansprechpartner, Telefon, DHL-Kundennummer, Standard-Zeitfenster und Hinweis für den Fahrer; einen als Standard.
    Die Daten aus dem Bauauftrag habe ich bewusst nicht ins Programm geschrieben.
95. **UPS**: developer.ups.com → App anlegen (APIs „Authorization (OAuth)“ und „Pickup“), Kontonummer zuordnen.
    Client-ID, Secret und Kontonummer unter Anbindungen → UPS eintragen (nie im Chat), „Verbindung testen“.
96. **Erste echte Abholung**: Claude sagen „DHL-Abholung morgen 10–12 Uhr, 1 Paket, LuGru“, nach der Rückfrage
    bestätigen, im Protokoll (Versand → Abholung) die Nummer ansehen und gleich wieder stornieren.
97. **Vorschlag-Schwelle**: Einstellungen → Abholung → „Mehr als … Labels“ (Standard 5) prüfen.
98. **Rechnungsstation einrichten**: iPad/Monitor an der Werkbank, Menü Finanzen › Rechnungen → „Rechnungsstation (Kamera)“, Kamera
    erlauben. Ablage dunkel und matt, gleichmäßiges Licht. Erster Test mit 5 Belegen, dann die Prüfliste ansehen.
99. **Einzugsscanner**: Scan-Ziel auf den Server-Ordner `scan-eingang` (neben docker-compose.yml) legen, z. B. per
    Netzwerkfreigabe (SMB) oder „Scan to Folder/FTP“ des Scanners. Geht das nicht: Prüfliste → „PDF-Stapel hochladen“.
100. **Stotax**: Die Anbindung „Stotax Select“ (Mail2Select-Adresse, automatisch = ja) muss eingerichtet sein. Sonst
     bleiben die Belege liegen (Prüfliste: „an Stotax: –“).
101. **Drive-Belegordner (optional)**: Dienstkonto-Schlüssel unter Anbindungen → Google Drive, das Dienstkonto im
     Zielordner als Bearbeiter freigeben, Ordner-ID unten in der Prüfliste eintragen (nur Inhaber).
102. **Benutzerkonten bereinigen** (Menü-Umbau, vom System gemeldet): Einstellungen → Benutzer. Die zwei nie benutzten
     Inhaber-Konten deaktivieren oder ihnen die richtige Rolle geben; das VA-Konto über die Warnung „als VA“ auf die Rolle
     „VA“ stellen (dann kein Privat, kein Geld, keine Einstellungen); das Test-Konto prüfen und ggf. deaktivieren. Das
     System löscht hier nichts selbst.
103. **Persönliche Mails – Discord-DM (optional)**: Privat › Nachrichten › Einstellungen → „Discord-Direktnachricht“ an und
     die eigene Discord-Benutzer-ID eintragen (Entwicklermodus → Rechtsklick auf den Namen → „ID kopieren“). Der VA-Bot
     muss mit dir einen gemeinsamen Server haben, sonst lehnt Discord DMs ab.
104. **Postfächer neu abrufen lassen**: Beide Postfächer sind über IMAP/Gmail verbunden – nach dem Update holt der erste
     volle Abruf die letzten Stunden einmal komplett (danach nur Neues). Bei IMAP-Postfächern mit eigener Ordnerauswahl
     prüfen, ob „Gesendet“ existiert (wird automatisch erkannt). Gmail mit eigener Auswahl ohne „Alle Nachrichten“:
     „[Gmail]/Gesendet“ wird dann zusätzlich gelesen.
105. **KI ohne Speicherung**: Die Anthropic-API nutzt Eingaben nicht zum Training. Echte Null-Speicherung (Zero Data
     Retention) gibt es nur per Vertrag mit Anthropic – bei Bedarf dort anfragen; sonst „KI-Entwurf“ in den Einstellungen
     ausschalten (dann Vorlage).
106. **VA und Antworten**: Die VA kann vorbereitete Antworten an Käufer/Lieferanten nur senden, wenn ihr der Bereich
     „Posteingang“ freigegeben ist (Einstellungen → Benutzer). Persönliche Mails sieht sie nie.
107. **BQool-Export-Seite eintragen (B31)**: Anbindungen → BQool – Anmeldung → „Export-Seite DE“: in BQool die Seite mit
     „Download File → Full Template“ (Repricing Central) für Amazon DE öffnen und die Adresse einfügen (FR/IT/ES werden
     abgeleitet). Findet die Automatik den Knopf nicht, „Knopf-Text Export“ eintragen. Danach „Verbindung testen“ –
     prüft Upload- und Export-Seiten je Land. Den BQool-Benutzer ohne Zwei-Faktor anlegen.
108. **Ersten BQool-Lauf freigeben**: Nach dem Update kommt der Push „BQool-Upload freigeben“ (oder Repricer →
     BQool-Dateien → „Jetzt starten“). Warnungen ansehen, dann „Freigeben und hochladen“. Die Nachkontrolle folgt
     30 Minuten später (oder „Nachkontrolle jetzt“).
109. **Min-Verhalten in BQool prüfen (B31.3)**: Nach dem ersten Upload an einer SKU mit Margen-Regel in BQool nachsehen,
     welchen Min BQool zeigt und ob es darunter verkauft. Dann im Kasten „Täglicher BQool-Lauf“ das Häkchen „Min-Verhalten
     in BQool geprüft“ setzen. (Seit B31.6 gilt fest: Min in der Datei ≥ effektiver Min; darunter nur mit „Liquidation“.)
110. **Automatisch hochladen (optional)**: erst nach Punkt 109 einschalten (Repricer → BQool-Dateien → Einstellungen).
     Auch dann braucht ein Lauf mit Regelwechsel oder Min unter Break-even die Freigabe.
111. **BQool-Berichte (B31.5)**: Die fünf Dateien vom 07.11. nach dem Update unter Uploads noch einmal hochladen
     (Typ und Land werden erkannt; fragt das System nach dem Land, den Vorschlag prüfen und tippen). Für den täglichen
     Lauf unter Anbindungen → BQool die Adressen der Berichtsseiten „Listing Performance“ und „Daily Sales“ (DE)
     eintragen – FR/IT/ES werden abgeleitet.
112. **Deal-Eingang ROI p. a. (B28.6)**: Nach dem Update unter Deal-Eingang → Einstellungen den „Mindest-ROI p. a.“
     prüfen (Standard 100 %). Ältere Deals zeigen die Umschlagszeit sofort (auf der Seite gerechnet); gespeichert
     und in der Ampel erst nach „Neu prüfen“.
113. **Cash-to-Cash (B28.7)**: Die Phasen stimmen nur, wenn Einkäufe als „erhalten“ gebucht sind. Die neue Aufgabe
     „Einkäufe bereinigen“ listet Bestellungen, die seit über 45 Tagen offen sind – als erhalten buchen oder stornieren.
     Ohne erhaltene Einkäufe rechnet der Deal-Eingang mit den Standardwerten (7/4/10 Tage).
114. **Lernschleife (B28.8)**: Am 03.12. kommt der Push mit den November-Verlustprodukten. Die Push-Art
     „Lernschleife Verlustprodukte“ ist an (Einstellungen → Benachrichtigungen). Wer nicht warten will: Deal-Eingang →
     „Wie gut lag er?“ → „Liste für den Vormonat jetzt erstellen“.
115. **Liquidation-Test mit einer SKU (B31.6)**: Nach dem Update unter Repricer → BQool-Dateien → „Liquidation wegen Min
     unter Marge“ eine SKU wählen, „Test-Export nur für diese SKU“, die Datei hochladen („An BQool übertragen“ oder ZIP).
     Nach dem nächsten BQool-Lauf erkennt das System selbst, ob Regel und Min stehen geblieben sind (sonst in BQool
     nachsehen und „Test bestanden“ tippen). Erst dann kommen die Regelwechsel für alle in die Datei – Upload weiter nur
     mit Freigabe.
116. **„Verlust akzeptiert bis“ setzen (B31.6)**: SKUs, die schon auf Liquidation unter Break-even stehen, erscheinen
     unter „Min unter Break-even – nicht freigegeben“ und halten den automatischen Upload an. Je SKU den Betrag je Stück
     eintragen (oder den Min in BQool anheben).
117. **Gewünschte Min-Preise eintragen (B31.6)**: Für SKUs, die unter dem effektiven Min laufen sollen, unter
     „Soll-Regeln“ die bisherige Regel (z. B. ia) mit dem gewünschten Min eintragen – das System stellt dann selbst auf
     Liquidation um und schlägt die Rückkehr vor, wenn die Buy Box wieder steigt.
118. **Liquidation-Test mit der richtigen SKU (B31.6, Hinweis 08.11.)**: Für den Test eine SKU nehmen, deren Buy Box unter
     dem effektiven Min liegt (sie steht nach dem Update in der Liste „Liquidation wegen Min unter Marge“). SKUs mit Buy
     Box über dem effektiven Min bekommen keinen Regelwechsel mehr – dort reicht die Min-Korrektur.
119. **Schnelldreher in BQool (B31.8b)**: Prüfen, welche Regel 7 % hält. Wenn eine eigene Regel „Schnelldreher“ angelegt
     wird, den Namen unter Repricer → BQool-Dateien → Regel-Leiter → Einstellungen eintragen. Bis dahin bleibt die Regel,
     der Boden steht nur als Min in der Datei (wirkt erst, wenn BQool den Datei-Min hält, siehe Test To-do 115).
120. **Gebraucht-Listings in BQool (B31.7c)**: Testen, ob BQool für Used-Angebote einen Konkurrenzpreis liefert; das
     Ergebnis unter Wissen eintragen. Wenn nein: Regel „Fix/Min“ verwenden (dann im Katalog ergänzen).
121. **Zustand prüfen (B31.7a)**: Die Aufgabe „Zustand prüfen“ abarbeiten – SKUs ohne Zustand kommen nicht in die Datei.
     Im Repricer Häkchen setzen und Zustand wählen.
122. **Schwellen der Leiter und des Listing-Checks ansehen**: Repricer → BQool-Dateien → Regel-Leiter → Einstellungen und
     Repricer → Listing-Check → Einstellungen. Standard laut Nachtrag; jeder Wechsel bleibt ein Vorschlag.
123. **Rückkehr aus der Liquidation – bitte bestätigen**: Liquidationen der Leiter gehen zurück auf Stufe 2, sobald
     Stufe 2 nicht mehr über der Buy Box liegt (B31.6b). Liquidationen aus „Min unter Marge“ (von Hand gewünschter Min)
     warten wie bisher 14 Tage (B31.6a c) bzw. auf eine weitergewanderte Lageralter-Stufe. Wenn auch diese sofort
     zurück sollen, kurz Bescheid geben.
124. **Migration 0140** läuft mit dem Update-Befehl: laufende Liquidationen bekommen „Liquidation bis“ = Start + 45 Tage.
125. **ArbitrageOne-Zustand (B31.7a Quelle 2)**: Wenn der ArbitrageOne-Export der Retouren-Listings eine Zustandsspalte hat,
     eine Datei unter Uploads hochladen und Bescheid geben – dann wird die Spalte mitgelesen (bisher: SKU-Muster, Amazon,
     Retouren-Station, von Hand).
126. **Server aktualisieren** (Update-Befehl): das neue Abbild enthält `poppler-utils` (PDF-Umwandlung für Kartonlabels und
     FNSKU-Bögen). Erreicht der Arbeits-PC das Seller-System über die öffentliche Adresse, danach einmal
     `bash /opt/seller-system/deploy/claude-oeffentlich.sh aktualisieren` (neuer Pfad `/api/druckagent/*`, geschützt
     durch den Gerätetoken).
127. **Arbeits-PC einrichten**: Brother-Treiber für QL-800 und QL-1100 installieren, Einstellungen → Drucker → „Agent
     anlegen“ (Token erscheint nur einmal – direkt ins Installationsskript tippen, nicht in Chats/Mails), Paket
     herunterladen, `installieren.ps1` als Administrator. Danach Rechner neu starten und prüfen, dass der Agent ohne
     Anmeldung „online“ steht (Abnahme 0).
128. **Printer Setting Tool** an beiden Druckern: „Automatisches Ausschalten“ auf Aus (Weg 1). Nur bei Shelly zusätzlich
     „Auto Power On“; Shelly-IP in der Fritzbox fest vergeben und unter Einstellungen → Drucker eintragen (Weg 2).
129. **Medien testen**: je ein Etikett 62 × 29, 102 × 152 und 103 × 164 drucken. Sitzt das Bild versetzt, Bescheid geben
     (oder in der config.json unter „medien“ `punkteBreite`/`randRechts` anpassen).
130. **iPhone-Kurzbefehl „Etikett drucken“**: POST an `/api/mobil/drucken` mit `{"sku": "…", "anzahl": 3}` und dem
     Geräte-Schlüssel (Einstellungen → Handy); fürs Teilen-Menü (PDF aus Seller Central) die Datei als Inhalt senden.
131. **Steuerkarte** (Lager → Scannen) einmal drucken und laminieren; Handscanner auf „Enter nach jedem Scan“ stellen.
132. **Überwachter Ordner** (optional): Pfad unter Einstellungen → Drucker eintragen, z. B. den Scan-Ordner für Rechnungen.
133. **B33 Katalog prüfen**: Repricer → BQool-Dateien → „Regel-Katalog“ – Tabelle „je Land und Stufe“ einmal gegen die
     Screenshots der Regeln (ia/Abverkauf je Land) halten; stimmt sie, „Stufen je Land übernehmen“ drücken (nur wenn der
     Hinweis erscheint). Nichts davon ändert etwas in BQool.
134. **Listen-Seite eintragen**: Anbindungen → BQool → „Listen-Seite DE“ = `https://mc.bqool.com/repricing/amazonde`
     (FR/IT/ES werden abgeleitet). Ab dann holt der Lauf das Ist per „Download listings“ und liest die Processing Reports.
     Die Fehler vom 07.11. stehen danach unter Repricer → BQool-Dateien → „Upload-Fehler laut BQool“.
135. **Gebühren je Land**: Amazon-Gebührenvorschau (Fee Preview) für alle vier Marktplätze einspielen bzw. abrufen lassen;
     fehlen Gebühren eines Landes, zeigt die Vorschau „geschätzt (Gebühren DE)“.
136. **Regel „Schnelldreher“** (Variante 2, empfohlen): in BQool je Land als Kopie von ia anlegen, alle Stufen 7 %,
     Name exakt „Schnelldreher“; danach Repricer → BQool-Dateien → „In Katalog übernehmen“.
137. **Variante 3 nur testen**: eine Test-SKU mit einer ia-Kopie im Modus „Rule“ (statt „Rule + Min Price“) – nach dem
     nächsten BQool-Lauf prüfen, ob der Datei-Min stehen bleibt; Ergebnis kurz melden.
138. **AI+CR-Kontingent** vor großen Wechseln auf Liquidation prüfen (Liquidation ist AI und zählt dort mit).
139. **Margen je Altersstufe** ändert nur Ludwig in BQool (Edit Rule) – danach den Katalog im Seller-System gleichziehen.
140. **Scan-Modus aufs Handy**: `/scan` im Handy-Browser öffnen → „Zum Home-Bildschirm“. Android zeigt das Seller-System
     danach im Teilen-Menü der Amazon-App; am iPhone den Kurzbefehl „Deal prüfen“ zum Teilen nutzen. Kamera-Zugriff erlauben.
141. **Druckagent 1.1.0** auf dem Arbeits-PC einspielen; Einstellungen → Drucker → „Belege-Ordner“ (Downloads) und
     „Ablage-Ordner“ eintragen. Erst dann sortiert der Agent; gelöscht wird nur, was du unter Rechnungsstation →
     Download-Ordner freigibst.
142. **Kontoauszug** bevorzugt als MT940/CAMT/CSV hochladen, PayPal-Export (CSV) monatlich dazu; für Stotax
     Buchhaltung → „Abgleich (CSV)“. Den fehlenden Prüfauftrag zum Kontoauszug vom 09.11. bitte nachreichen.
143. **Absender für Preisliste und Brief**: Einstellungen → „B2B-Deals“ → Firma (Name, Anschrift, E-Mail, Telefon) prüfen.
144. **Vor E-Mails an Fremdkontakte rechtlich prüfen lassen** (das System ist keine Rechtsberatung); erst danach unter
     B2B → Abverkauf „Rechtlich geprüft“ einschalten. Bis dahin nur Briefe bzw. Bestandskunden.
145. **Leads**: CSV (z. B. aus Apify, eigenverantwortlich, Nutzungsbedingungen der Quelle beachten) mit Spalte
     „E-Mail-Quelle“ = Impressum; beim Import Quelle und Datum angeben. Beim ersten echten Import die erkannten Spalten prüfen.
146. **Serienbrief**: Charge freigeben → „Serienbrief-PDF“ drucken, frankieren, dann „als verschickt markieren“.
     Antworten mit Bezug „AV-…“ kommen über den Posteingang (Aufgabe); Umsatz und Marge je Antwort eintragen.
147. **Wissenseintrag „Ankaufserver“**: im Wissen den Sprecher ergänzen, falls gewünscht (der Name steht bewusst nicht im Code).
148. **Ankauf-Deals**: Menge vor dem Kauf beim Ankäufer anmelden und im Deal eintragen; nach dem Abschluss den Ausgang
     (angekauft / liegt / Verlust) setzen – „liegt“/„Verlust“ beantwortest du dann in der Lernschleife.
149. **Drive-Ablage freischalten**: unter Anbindungen → Google Drive das Dienstkonto (JSON) und die Ordner-ID eintragen,
     den Rechnungsordner in Drive für die Dienstkonto-Adresse als „Bearbeiter“ freigeben; dann unter Finanzen →
     Belegablage „Umbenennen/Verschieben erlauben“. Erste Charge klein halten und die Vorschau prüfen.
150. **Bestand im Drive-Ordner**: einmal „Vorhandene Dateien vorschlagen“ – schon früher eingelesene Rechnungen bekommen
     dann auch einen Ablage-Vorschlag.
151. **AdelPrep-Beilage**: unter B2B → Abverkauf Firmendaten, Impressum, Datenschutzhinweis und Text der Logistik-Firma
     eintragen und prüfen lassen; Angaben zu Fläche/Stellplätzen, kostenloser Zählung, NDA und Gefahrgut erst nach
     Rückfrage per Haken freigeben.
152. **Briefversand**: Anbieter wählen (Vorschlag eBrief), Zugang unter Anbindungen eintragen und testen, Preise je Brief
     laut Preisseite unter Abverkauf → Briefversand eintragen, Tageslimit und Gesamtbudget setzen.
153. **AV-Vertrag** mit dem Briefanbieter abschließen und den Haken setzen – erst dann ist Live-Versand möglich; vorher
     Testbrief an die eigene Adresse und Druckbild prüfen.
154. **Lager-Standort** (Breite/Länge) und Preis je Palette/Monat unter Abverkauf → Lager-Standort eintragen; in der
     Lead-CSV Spalten „Latitude“/„Longitude“ mitliefern (z. B. aus dem Apify-Export), sonst greift der Umkreis nicht.
155. **Kampagnen**: Kosmetik nur mit MHD und Charge je Position; Vertriebsbeschränkungen der Marken und
     Kennzeichnung/CE/GPSR vor dem Versand prüfen (keine Rechtsberatung). Lager-Kampagne: offene Punkte
     (Kapazität, Versicherung, Gefahrgut, Mindestmenge, AGB) vorher klären.
156. **B34.3c Pull Request prüfen** (Branch `b34-3c-lead-stufen`, nicht automatisch nach main): Lead-Quellen,
     Impressum-Mail nur für Antworten, Vorschläge „Zielgruppe AdelPrep“, LUCID-Sperre, „kostenlose Zählung“ gesperrt.
157. **LUCID klären**: darf das Verpackungsregister für Werbebriefe genutzt werden? Erst danach unter Abverkauf →
     Lead-Quellen „LUCID geklärt“ setzen (vorher kein Entwurf, kein Brief für LUCID-Leads).
158. **Briefanbieter festlegen**: welcher Anbieter angebunden wird (eBrief oder LetterXpress), Preis je Brief unter
     Abverkauf → Briefversand eintragen; die Zeile „Aktuell: …“ zeigt Anbieter, Zugang, Preis und Modus.
159. **Beilage-Haken setzen**: unter Abverkauf → AdelPrep-Beilage „Fläche/Stellplätze“, „NDA“ und „Gefahrgut/LQ“
     anhaken (am 11.11. bestätigt); „EAN-Prüfung bei direktem FBA-Versand inklusive“ erst, wenn geklärt.
160. **Website angleichen**: Mengenzählung auf „optional zubuchbar“ ändern (statt „Pflicht bei Einlagerung“), damit
     Brief und Seite dasselbe sagen.
161. **B35 Pull Request prüfen** (Branch `b35-lead-maschine`, baut auf B34.3c auf – erst B34.3c, dann B35 mergen).
162. **Schutzregeln eintragen** unter B2B → Leads: Konfliktbranchen (eigene Marke), Mitbewerber/Firmen, die nie
     angeschrieben werden (Sperrnamen), Großmarken mit eigener Logistik; Mindestabstand prüfen (Standard 12 Monate).
163. **Rechtliche Prüfung** (Stufe 2, Art.-14-Hinweis, Google-Places-Speicherregeln, LUCID) – danach Datum und Prüfer
     unter Leads → Quellen eintragen; vorher laufen keine automatischen Quellen.
164. **Zugänge nur bei Bedarf**: Apify-Token bzw. Google-Places-Schlüssel unter Anbindungen; in Apify zusätzlich ein
     Monatslimit setzen; Budget je Lauf/Monat und Places-Preis je Abruf unter Leads → Quellen.
165. **Lager-Standort** (Breite/Länge) unter Abverkauf eintragen – sonst keine Entfernung, kein Umkreis, keine Karte.
166. **Erste Charge**: „Charge vorbereiten“ mit kleiner Zahl, Entwürfe lesen, Testbrief, dann Freigabe.
167. **B36 Pull Request prüfen** (Branch `b36-video-pipeline`) und nach dem Mergen das Update ausführen.
168. **Server vorher**: Neustart („System restart required“) und Platte aufräumen (Stand 11.11.: 7 GB frei bei 81 %) –
     der Seller-Server speichert je Video ca. 0,5–1 GB; die Seite Video zeigt den freien Platz.
169. **Zugänge über Anbindungen** (nie im Chat): Claude (vorhanden), ElevenLabs-API-Key, OpenAI-API-Key (API-Konto mit
     Guthaben, getrennt vom ChatGPT-Abo, Monatslimit setzen); Google-App: „YouTube Data API v3“ aktivieren, Bereiche
     youtube.upload + youtube.readonly + drive.file, „Google Drive API“ aktivieren, Weiterleitungs-URI
     `<Adresse>/api/oauth/youtube/callback` (gilt für YouTube und Drive).
170. **Kanäle anlegen** unter Marken & Content → Video (Unter der Decke: Sicherheitsstufe streng; Zeitlux nach Klärung),
     Stimme (ElevenLabs-Voice-ID), Bildstil, **Zielgruppe** (z. B. „Männer ab 55“), (Länge seit 12.11. fest 1.500–1.700 Wörter),
     Freigaben; dann je Kanal „Mit YouTube verbinden“.
171. **Preise eintragen** auf der Seite Video unter „Kosten“ (ElevenLabs je 1.000 Zeichen, OpenAI je Bild). Unter
     „Modell und Ablage“ einmal **„Google Drive verbinden“** – danach landen die Videos im Ordner „Seller-System Videos“.
172. **Worker am Arbeits-PC einrichten**: auf der Seite Video „Worker anlegen“ (Token nur einmal sichtbar), dann
     `unter-der-decke/README.md` (Docker Desktop oder Python 3.12 + ffmpeg, Autostart). Mind. 5 GB frei halten.
173. **Musik** (lizenzfrei bzw. mit YouTube-Lizenz) in den Musikordner des Workers legen und den Dateinamen im Kanal
     eintragen – sonst ohne Musik.
174. **Zeitlux in vidIQ verbinden**; vidIQ-Daten bei Bedarf über Claude eintragen lassen („video_vidiq_eintragen“).
175. **Erstes Video**: Thema „Mit 60, 70 oder 80: Warum manche Männer lange können und andere nicht“ anlegen (optional
     englische Vorlage oder eigenes Skript ins Feld einfügen), Gliederung/Skript lesen und freigeben, Vorschau ansehen,
     dann „Privat hochladen“ – öffentlich stellst du es selbst in YouTube Studio.
176. **Whiteboard-Stil einstellen** (Unter der Decke): Kanalprofil → „Stil der Bilder: Whiteboard-Collage“, Freigabe
     „Szenen-Übersicht“ an, 2–4 Bildschirmfotos aus dem Referenzvideo als **Stil-Referenzbilder** hochladen,
     wiederkehrende Figuren eintragen (z. B. „blonder-mann: …“, „brille: …“), Bildqualität wählen. Unter „Kosten“ den
     Preis je Motiv eintragen (gpt-image-1, 1024×1024: niedrig ≈ 0,01 $, mittel ≈ 0,04 $; Referenzbilder kosten je
     Motiv etwas zusätzlich – 1–2 Referenzbilder reichen meist).
177. **Google-App**: im Zustimmungsbildschirm den Bereich `youtube.force-ssl` (Untertitel) ergänzen und YouTube je Kanal
     einmal **neu verbinden** – sonst wird das Video hochgeladen, aber die Untertitel nicht (Hinweis am Auftrag).
178. **Abnahme B36.9**: erstes Testvideo neben das Referenzvideo legen (Hintergrund, Schrift, Farben, Collage, Hand,
     blasser Hintergrund) und Rückmeldung geben – Größen, Abstände und Tempo lassen sich danach nachschärfen.
179. **Video aus dem Chat**: in claude.ai den Seller-Konnektor einmal neu verbinden (Änderungen erlauben), dann z. B.
     „Lege im Kanal Unter der Decke ein Video an: Thema …, hier meine englische Vorlage: …“ – Claude zeigt erst die
     Zusammenfassung mit Kostenschätzung und legt erst nach deinem Ja an.
180. **Worker am Arbeits-PC aktualisieren** (Nachtrag 12.11., Version 1.1.0): neuen Ordner `unter-der-decke` holen
     (GitHub → Code → Download ZIP, über `C:\video\unter-der-decke` kopieren), dann in PowerShell `docker stop
     video-worker; docker rm video-worker; docker build -t video-worker .` und `docker run …` wie im README („Aktualisieren“).
     Auf der Seite Video steht danach unter „Worker“ `v1.1.0`; solange ein älterer Worker läuft, zeigt die Seite oben
     „Der Worker am PC ist veraltet“. Dann beim fehlgeschlagenen Video „Schritt wiederholen“.
181. **OpenAI-Bilder** (Nachtrag 13.11.): Server aktualisieren, dann Anbindungen → OpenAI → „Verbindung testen“. Zeigt es
     „Schlüssel gültig. Bildmodell für Videos: …“, beim Video „Schritt wiederholen“. Zeigt es „Schlüssel abgelehnt“: neuen
     Schlüssel (beginnt mit „sk-“) über das Formular eintragen – nur den Schlüssel. Zeigt es „keines der Bildmodelle
     freigeschaltet“: im OpenAI-Konto unter Projekt → Limits/erlaubte Modelle freigeben bzw. Settings → Organization →
     „Verify Organization“. Preis je Bild für das gewählte Modell auf der Seite Video unter „Kosten“ eintragen
     (GPT Image 2 medium laut Liste ca. 0,04 $; die 2.5-Modelle rechnet OpenAI nach Tokens ab – Wert aus der eigenen
     Abrechnung übernehmen). Worker-Update nicht nötig.
182. **Worker auf v1.2.0 aktualisieren** (B36.10/B37, 13.11.): wie bei 180 (Ordner `unter-der-decke` neu holen, neu
     bauen). Erst dann laufen Whiteboard-Videos im neuen Takt und Instagram-Stories; die Seite Video zeigt bis dahin
     „Der Worker am PC ist veraltet“. Kanalprofil → „Tempo“ (Standard normal) für Unter der Decke prüfen.
183. **Meta-App für Instagram** (B37.6): auf developers.facebook.com eine App vom Typ „Business“ anlegen, Produkt
     „Instagram“ → „API mit Instagram-Login“ hinzufügen. Rücksprung-Adresse eintragen:
     `https://<deine Seller-Adresse>/api/oauth/instagram/callback`. App-ID und App-Secret über **Anbindungen → Instagram**
     (sicheres Formular) eintragen – nie im Chat. Für das Posten braucht die App die Berechtigung
     `instagram_business_content_publish` (App-Prüfung durch Meta, Dauer ungewiss); bis dahin Stufe 1.
184. **Öffentliche https-Adresse** (B37): Instagram holt die Story-Datei selbst ab. `APP_URL` bzw. `PUBLIC_URL` muss
     `https://…` sein und `/api/public/story/` von außen erreichbar (Caddy: wie `/api/public/…` freigeben).
185. **Instagram-Kanal anlegen** (B37): Seite Video → „Neuer Kanal“ → Plattform Instagram, Zeitplan täglich 12:00,
     Freigabe „jedes Mal“, Monatslimit (z. B. 10 $), **Bestätigte Fakten** (nur Angaben, die stimmen – Preise netto je
     Artikel, Leistungen; daraus entstehen die Texte), Hinweistext/Link fürs Story-Ende. Dann „Mit Instagram verbinden“
     (Business-Konto), Themenliste eintragen, ein paar eigene Lager-Fotos ohne Personen hochladen, „Stories aus der
     Themenliste erzeugen“. Umfrage-Sticker setzt du beim Posten in der Instagram-App (die API kann keine Sticker).
186. **Preis je Motiv** (B36.10/B37): auf der Seite Video unter „Kosten“ den Preis je Motiv eintragen, sonst fehlt er in
     der Kosten-Schätzung je Story und im Monatslimit wird nur der Claude-Anteil gezählt.
