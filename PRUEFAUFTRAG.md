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

## Neue Claude-Werkzeuge (40) und `notifications/tools/list_changed`

Lesend: `amazon_faelle`, `amazon_fall`, `anruf_aufgaben`, `auto_status`, `bqool_export_vorschau`, `buchhaltung_status`,
`deal_eingang`, `deal_eingang_detail`, `deal_pruefen`, `deal_quellen`, `erstattungen_abgleich`, `fahrt_briefing`,
`feierabend`, `freischaltungen`, `fristen`, `rechtsfaelle`, `rechtsfall`, `rechtsfristen`, `scan_pruefen`, `tagesplan`,
`va_aufgaben`, `va_nachrichten`, `verkaeufe_je_asin`.

Ändernd (nur auf ausdrücklichen Wunsch, im Fragefeld mit Vorschau und Stufe): `amazon_fall_an_va`, `amazon_fall_status`,
`amazon_todo_erledigen`, `anruf_erledigt`, `aufgabe_verschieben`, `aufgabe_zuweisen`, `auftrag_status`, `auto_klima`,
`auto_navi`, `bqool_export_erzeugen`, `deal_eingang_pruefen`, `deal_eingang_status`, `mail_markieren`,
`privat_eintrag_anlegen`, `rechtsfall_mail_entwurf`, `va_nachricht`, `verlust_ausnahme`.

Geändert: `wissen` und `calls_durchsuchen` (Herkunft `chat|call`), `ueberblick` (Rechtsfristen in 7 Tagen, privat nur
Anzahl), `kalender` (privat nur „Termin außer Haus“), `posteingang` (Vorschlag, Termin-Mails), `anbindungen_status`,
`keepa_produkt` (Alter), `kapital_ampel`, `liquiditaet` (B15: Ø Wareneinkauf, Kontostand-Alter), `verlust_stopp`,
`bestellvorschlaege` (B15: gemeinsame Rechnung, Feld `definition`, schon angelegte Einkäufe), `repricer` (B15: Filter
`regel`, Übersicht `je_regel`), `deal_pruefen` (B15: Prozentformat, eine Verkaufszahl).

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
