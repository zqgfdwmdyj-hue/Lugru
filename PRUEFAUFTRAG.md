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
kam nichts an. **Gewählt: Weg B** (das Seller-System liest die Deal-Kanäle selbst über einen Bot mit Leserechten) als
Hauptweg; Weg A (Push aus dem Programm) bleibt als Ergänzung und wird über die Discord-Nachrichten-ID zusammengeführt.

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

## Neue Claude-Werkzeuge (49) und `notifications/tools/list_changed`

Neu am 31.10. (Lugru-Bauauftrag, lesend): `lugru_deals(seit?, bis?, kanal?, ampel?, gekauft?, min_wert?, suche?, limit?)`,
`lugru_deal(id)`, `lugru_statistik(von?, bis?)`. Geändert am 31.10.: `deal_quellen` (Quelle „Lugru Deals“ mit
Gruppen-Käufen), `anruf_aufgaben` (`telefon_vorschlag`, `rueckfrage`, optional `websuche`), `aufgabe_anlegen` (`telefon`,
Rückfrage bei Anruf ohne Nummer), `aufgabe_aendern` (`telefon`), `anbindungen_status` (`postfaecher_uebersicht`,
`postfaecher_hinweis`), `bqool_export_vorschau` (Soll aus BQool-Ist, Warnung „Min aus Upload blockiert Buy Box“),
`amazon_faelle`/`amazon_fall` (Routine-Mails nie ein Fall, Marktplatz aus Inhalt).


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
    - Bestand → „Prep-Center-Fehlbuchungen“ ansehen und nur passende zurückbuchen.
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
29. **Lugru Deals über Discord (neu)**:
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
