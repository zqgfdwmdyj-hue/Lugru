# Testanleitung

## 1. Starten (auf deinem PC, mit Docker)

1. **Docker Desktop** installieren (docker.com) und starten.
2. Den Code-Ordner entpacken bzw. herunterladen und darin eine Datei **`.env`** anlegen:
   ```
   APP_SECRET=hier-mindestens-32-zufaellige-zeichen-eintragen-1234567890
   APP_URL=http://localhost:3000
   ```
3. Im Ordner ein Terminal öffnen und starten:
   ```
   docker compose up -d --build
   ```
   Der erste Start dauert ein paar Minuten.
4. Benutzer anlegen (gibt ein Passwort aus, wenn du keins angibst):
   ```
   docker compose exec app npm run user:create -- --email du@firma.de --name "Dein Name" --firma "Deine Firma" --passwort "dein-passwort"
   ```
5. Im Browser **http://localhost:3000** öffnen und anmelden.

Stoppen: `docker compose down` (die Daten bleiben erhalten). Alles löschen: `docker compose down -v`.

## 2. Was du sofort testen kannst (nur mit Dateien)

| Bereich | So testest du es |
|---|---|
| **Daten importieren** | Arbitrage-One-Exporte (Vorlage „Tool“, AccountOne COG, Sellerboard) und Amazon-Reports hochladen – mehrere Dateien auf einmal. Wo es die Reports gibt, steht rechts auf der Seite. |
| **Chargen** | Nach dem Import: EK je SKU, Retouren mit geerbtem EK, Filter „Ohne EK“, „EK-Abweichung“. |
| **Ansprüche** | Nach dem Import von Bestandsprotokoll, Erstattungen, Kundenrücksendungen, Remissionen und Abrechnungen. Warteschlange, Tageslimit, Nachweis-Mappe, Text für den Amazon-Fall. |
| **Remissionen** | Eingang bestätigen → Fehlmengen werden zum Anspruch. |
| **Remissionen → Hängende Sendungen** | Grundlage: Bericht „Remissionssendungen“ (holt die Amazon-Anbindung, sonst hochladen). Pakete von Problem-Versendern (Standard **TENDRON**, änderbar unter Einstellungen → Ansprüche) werden je Auftrag + Sendungsnummer mit FNSKU × Anzahl gelistet. Ab **Tag 15** nach Auftrag (Paket mind. 10 Tage unterwegs) entsteht automatisch ein Anspruch „Remission: Sendung hängt“, Frist **Tag 75**. „Angekommen“ blendet das Paket aus und entfernt den Anspruch, „Fehlt“ macht auch andere Pakete zum Anspruch. „Liste kopieren“ = Auftrag, Versender, Sendungsnummer, FNSKUs als Tabelle. |
| **Lieferanten → Großhändler finden** | Marke eingeben (z. B. Wella), Quellen ankreuzen, „Suchen“. Gleiche Firmen aus verschiedenen Quellen werden zu einem Kontakt zusammengeführt; in der Liste stehen die Fundstellen (Register, Amazon, eBay, GPSR, Websuche), oben die letzten Suchläufe mit Ergebnis oder Fehler, darunter ein Filter „Quelle“. **Verpackungsregister (LUCID):** alle Firmen, die Ware der Marke in Deutschland in Verkehr bringen, mit Adresse, Telefon und kompletter Markenliste; Mehrmarken-Händler oben, „Wella“ nur als Wortteil (z. B. „Pawella“) ausgeblendet, Privatpersonen/Salons/Marktplätze/beendete Registrierungen markiert. **Markenlisten** werden je Firma einzeln und langsam geladen (alle 3 s). **Drosselt das Register** (HTTP 503 nach vielen Abfragen in kurzer Zeit, meist 15–60 Minuten): Das System hört sofort auf zu fragen, markiert die übrigen Firmen mit „Markenliste folgt“ und lädt sie automatisch alle 30 Minuten weiter (nach jeder Drosselung mit längerer Pause). Oben steht „N Markenlisten fehlen noch“ mit „Jetzt nachladen“ und „Über deinen Browser laden“ (öffnet das Register mit genau den fehlenden Firmen – dort das Lesezeichen klicken). Ohne Markenliste sind Score und Einstufung vorläufig. **Lehnt oder drosselt das Register den Server** (Meldung „lehnt Anfragen von diesem Server ab (HTTP 403)“ bzw. „drosselt gerade (HTTP 503)“): Kasten „Verpackungsregister über deinen Browser abfragen“ → Lesezeichen „→ Seller-System Register“ einmalig in die Lesezeichenleiste ziehen → „Herstellerregister öffnen“ (Marke wird übernommen) → dort Lesezeichen klicken → nach 1–3 Minuten „An Seller-System senden“ → die Firmen samt Markenlisten erscheinen automatisch (sonst Strg+V unter „Daten einfügen“). **Amazon-Verkäufer (Keepa, ca. 100–170 Tokens):** Produkte der Marke auf amazon.de → aktuelle Angebote → Verkäufer mit Impressum (Firma, Anschrift, E-Mail, Telefon, USt-ID, Handelsregister); amazon.de selbst und Gebrauchtware zählen nicht. **eBay-Verkäufer + GPSR (kostenlos, braucht die eBay-Verbindung):** gewerbliche Verkäufer der Marke mit Impressum (Privatverkäufer übersprungen), dazu aus den Produktsicherheitsangaben der Hersteller und der EU-Verantwortliche – Letzterer ist oft der Importeur/Distributor. **KI-Websuche nach Distributoren (ca. 10–20 Cent):** Händler-/Distributorenlisten der Marke, B2B-Shops, Großhändler. **Per Websuche prüfen** (KI, ca. 3–5 Cent je Firma): Website, Einstufung (Großhandel/Händler/Hersteller …), Einkaufs-E-Mail, B2B-Zugang, Belege mit Quellen – die Belege aus Amazon-/eBay-Impressum bleiben erhalten. **Anfrage-Entwürfe** (Deutsch für DACH, sonst Englisch) mit Absenderdaten aus Einstellungen → Versand und einem Absagesatz; senden erst nach Bestätigung, über das Standard-Postfach, höchstens 25 pro Tag, nie doppelt, nie an Privatpersonen/Salons/Marktplätze. Antworten im Posteingang (gleiche Domain) → Status „Antwort!“ + Aufgabe. „Als Lieferant anlegen“ übernimmt die Firma für den Einkauf. Hinweis: Unaufgeforderte E-Mails können auch als Einkaufsanfrage unter § 7 UWG fallen – nur geprüfte B2B-Händler einzeln anschreiben. |
| **Bestandsabgleich über alle Kanäle (gegen Überverkauf)** | Die Wawi ist führend: *verfügbar = eigenes Lager − in offenen FBM-Aufträgen reserviert*. Jedes aktive Angebot (eBay, Amazon FBM, Temu …) bekommt diese Menge, optional gedeckelt („Höchstens zeigen“). **eBay-Tool:** Beim Veröffentlichen landet das Angebot automatisch unter Listings und im Bestand – per EAN mit vorhandener Wawi-SKU verknüpft, sonst wird die eingestellte Menge als Bestand gebucht (Hinweis in der Vorschau). Ältere Angebote: Listings → „eBay-Angebote aus dem Tool übernehmen“ (Abgleich bleibt aus, bis der Bestand geprüft ist). **Amazon FBM:** „Amazon FBM verknüpfen“ übernimmt SKUs aus FBM-Bestellungen; FBA-Angebote werden erkannt und nie angefasst. **Temu/TikTok:** Angebot mit Status „Aktiv“ anlegen; ohne Schnittstelle kommt eine Aufgabe mit der Zielmenge, „Gesetzt“ bestätigt. Bestellungen von eBay/Amazon alle 5 Minuten (oder Aufträge → „Bestellungen jetzt abrufen“), danach sofort Abgleich; ebenso nach Wareneingang, Inventur, Bestandskorrektur, Retoure, Storno, CSV-Auftragsimport. Mehr bestellt als im Lager → Aufgabe „Überverkauf“. Bestand zeigt je SKU reserviert/frei und die Kanäle. eBay: in den Verkäufer-Einstellungen „Nicht vorrätig“ einschalten, damit Menge 0 das Angebot nicht beendet. |
| **eBay → Vorschau → Artikelmerkmale** | Pflicht- und empfohlene Merkmale kommen live aus der eBay-Kategorie (Taxonomy-API). Fehlende Pflichtangaben sind rot markiert, „Listing erstellen“ bleibt gesperrt, bis sie ausgefüllt sind – auch Merkmale, die eBay beim letzten Versuch als fehlend gemeldet hat („Das Artikelmerkmal Stil fehlt“). Merkmale mit fester eBay-Liste als Auswahl, sonst Textfeld mit Vorschlägen; mehrere Werte mit „;“ trennen. EAN-Feld mit Prüfziffer-Kontrolle. Eigene Merkmale unter „Weitere Merkmale“ hinzufügen oder entfernen. |
| **Remissionen → „Tendron-Pakete aus Seller Central holen“** | Ersetzt das Öffnen jedes einzelnen Auftrags: Lesezeichen „→ Seller-System Remissionen“ einmalig in die Leiste ziehen → über den Knopf den Seller-Central-Bericht „abgeschlossene Remissionen, letzte 75 Tage“ öffnen → Lesezeichen klicken. Es öffnet jeden Auftrag der Liste im Hintergrund, wählt „Alle versendeten Einheiten anzeigen“, klappt „Sendungsverfolgungsdetails anzeigen“ auf und liest Sendungsnummer + Versender (z. B. `(TENDRON_VRETURN)`), FNSKU × Stückzahl und den letzten Eintrag der Sendungsverfolgung. „Kopieren und ans Seller-System senden“ überträgt alles (sonst Strg+V). Ab Tag 15 und wenn sich die Sendung 10 Tage nicht bewegt hat, entsteht der Anspruch mit Sendungsverfolgung im Fall-Text. Das Lesezeichen klickt nur Anzeige-Schalter. Seiten ohne Paketdaten werden aufgelistet; dort Auftrag öffnen, Lesezeichen klicken oder Seite kopieren und einfügen. Erkennt das Muster nichts (Layout geändert), liest die KI die Seite. |
| **Remissionen → Stichwort Tendron** | Knopf **„Tendron“** (oder eigenes Stichwort) durchsucht alle Remissionssendungen nach Versender, Sendungsnummer, Auftrag, FNSKU – wie die Suche im Amazon-Bericht. „Treffer kopieren“ = Auftrag, Datum, Versender, Sendungsnummer, FNSKU, Anzahl. Steht „Tendron“ nicht in der Versender-Spalte, sondern irgendwo in der Zeile, wird es beim Import trotzdem erkannt (auch deutsche Spaltennamen); ältere Importe werden beim erneuten Hochladen nachgezogen. |
| **Ansprüche → Fall** | Neben der Textvorlage: „Mit KI formulieren“ (Deutsch oder Englisch), nutzt nur die hinterlegten Nachweise. |
| **Inbound** | Neue Sendung → mit dem Handscanner FNSKU/EAN/SKU scannen (Menge davor: `6*X00…`), Kartons, Prüfungen, FNSKU-Etiketten (QL-800, 62 × 29 mm), Packliste. |
| **Aufträge** | CSV-Vorlage herunterladen, ausfüllen, unter „Daten importieren“ hochladen. Amazon-FBM-Aufträge kommen über den Report „Alle Bestellungen“ (ohne Adresse) oder die SP-API (mit Adresse). |
| **Posteingang** | Mails aus Gmail/Outlook als `.eml` speichern und hochladen → Einordnung, To-dos, Fälle. |
| **Rechnungen** | PDFs hochladen → Ware/Kosten, Beträge, Zuordnung zu Chargen. Einmal einordnen, das System merkt es sich je Quelle. |
| **Gewinn / Cash Flow** | Settlement-Reports (Flat File V2) importieren, Kontostand und Planposten eintragen. |
| **Bestand & Inventur** | FBA-Bestandsbericht importieren, eigenes Lager buchen, Inventur mit Scanner. |
| **Repricer** | Gebührenvorschau + Bestand importieren → Mindest-/Maximalpreise → BQool-CSV. |
| **Lieferanten-Feeds** | Preisliste (CSV/Excel) hochladen – Spalten (EAN/GTIN, Preis, Bestand, Mindestabnahme, Link) werden erkannt, auch beim Qogita-Katalog-Export → Gewinn je Angebot. Jeder Import landet im EK-Verlauf. Abruf per Link, EAN-Abfrage und Chancen: siehe „Lieferanten-Abfrage & Chancen“ unten. |
| **Retouren-Abgleich** | Aus dem bisherigen Retouren-Tool übernommen. Transaktionsbericht, FBA-Kundenrücksendungen, Erstattungen und Retourenbericht (Händlerversand) hochladen → Retouren → Abgleich (FBA / Händlerversand) und Artikel (Retourenquote). Was Amazon zahlen muss, wird automatisch ein Anspruch mit fertigem Text. Zum Ausprobieren: `tests/fixtures/retouren/` (erfundene Daten). |
| **eBay (Listing-Tool)** | Aus dem bisherigen LuGru eBay-Tool übernommen: Menü **eBay**. Suchen → Listing wählen → Einkauf & Preis → Vorschau → veröffentlichen, dazu Artikel & Gewinn, Verlauf, Rechnungen, idealo-Preisvergleich, Keepa-Bilder. Ohne eBay-Zugang lassen sich Einstellungen, Kalkulation und die Datenübernahme testen (siehe Abschnitt 7). |
| **Themen-Recherche** | Wissen → Themen-Recherche: Themen eintragen (E-Commerce, Amazon Private Label, Immobilien, Aktien …), „Jetzt suchen“. Danach läuft sie alle 3 Tage von selbst; je Thema entsteht ein Eintrag unter Wissen → Recherche. Mit Claude-API-Schlüssel (Anbindungen → KI) steht darüber eine Zusammenfassung. |
| **Fälle, Retouren, Bewertungen** | Von Hand anlegen bzw. Feedback-Bericht importieren. |
| **Wissen & To-dos** | Einträge anlegen, suchen; eigene Aufgaben auf der Startseite. |

## 3. Was Zugangsdaten braucht (Anbindungen)

Unter **Anbindungen** steht bei jedem Dienst eine Schritt-für-Schritt-Anleitung und ein Knopf „Verbindung testen“.

| Dienst | Wofür | Hinweis |
|---|---|---|
| Amazon SP-API | Bestellungen mit Adresse, Reports automatisch, Versandbestätigung | Als „Private Developer“ in Seller Central registrieren. Für Adressen braucht die App die Rolle „Direkter Versand zum Kunden“. |
| DHL Geschäftskunden | Labels Paket/Kleinpaket | Erst mit **Sandbox** testen (Einstellungen → Versand). Abrechnungsnummern eintragen. |
| eBay | Artikel einstellen, Rechnungen, Bestellungen, Sendungsnummer | Eingerichtet wird unter **eBay → eBay-Einstellungen → Verbindung** (Client ID, Client Secret, RuName, dann „Mit eBay verbinden“). Eine übernommene Verbindung aus dem bisherigen Tool darf Bestellungen nur lesen – für das Zurückmelden der Sendungsnummer einmal neu verbinden. |
| Postfächer | Mails abrufen **und** senden (z. B. eBay-Rechnungen) | **Posteingang → Postfach verbinden.** Am einfachsten mit E-Mail + Passwort; die Server werden automatisch erkannt. Google/Workspace (auch lugru.de) und iCloud brauchen ein **App-Passwort**. Danach „Test-Mail“ und ggf. „Als Absender“. Alternativ „Mit Google/Microsoft anmelden“: App unter Anbindungen eintragen (Weiterleitungs-URI `http://localhost`), anmelden, die nicht ladende localhost-Adresse kopieren und einfügen – wie bei eBay. |
| Kalender (iCloud, Google, Outlook) | Fälligkeiten in den Kalender, eigene Termine auf Startseite und unter **Kalender** | Termine aus Google-/Outlook-Kalendern (auf dem iPhone unter einem anderen Account als iCloud) per iCal-Link unter „Weitere Kalender per Link“ eintragen; „Verbindung testen“ zeigt je Kalender die Anzahl gelesener Termine. |
| Apple-Kalender (Details) | | Apple-ID + **app-spezifisches Passwort** (appleid.apple.com → Anmelden und Sicherheit). Es entsteht der Kalender „Seller-System“. Im Kalender verschieben = neues Fälligkeitsdatum, löschen = erledigt, neuer Termin dort = neue Aufgabe. |
| Google Drive | Rechnungsordner von Invoice Fetcher | Freigabelink des Ordners eintragen (Jeder mit dem Link → Betrachter); Unterordner werden mitgelesen. |

**Kalender** (Menü links): Monatsansicht wie auf dem iPhone – eigene Termine in der Farbe ihres Apple-Kalenders plus alles mit Datum aus dem System (Aufgaben, Fristen, Versand, Ansprüche, geplante Zahlungen). Tag antippen → Liste des Tages und neue Aufgabe für diesen Tag. Funktioniert auch ohne Apple-Verbindung (dann nur Systemtermine).

**Einkauf** (WaWi → Einkauf, nach JTL-Vorbild): Neue Bestellung mit Shop-Kürzel (z. B. KAUFL) und Shop-Bestellnummer → Positionen mit ASIN, Menge, EK brutto, geplantem VK → „Als bestellt markieren“ (erscheint am erwarteten Liefertag als Aufgabe und im Kalender) → „Wareneingang buchen“ (auch Teillieferungen). Dabei entsteht je Artikel eine Charge mit SKU `SHOP_TTMONJJ_ASIN_EK_VK` und der Bestand im eigenen Lager steigt. Eine Rechnung mit derselben Bestellnummer wird automatisch zugeordnet. **Bestellvorschläge**: Abverkauf 30/90 Tage gegen Bestand (FBA, unterwegs, Lager, bestellt) – ankreuzen → Bestellentwurf je Lieferant.

**Amazon-ToDos** (Amazon FBA → Amazon-ToDos, nur Inhaber; aus dem Retouren-Tool übernommen): Amazon-Systemmails aus allen verbundenen Postfächern werden nach jedem Abruf (alle 15 Minuten) vorgefiltert und eingestuft – mit Claude-Schlüssel (Anbindungen → KI) per KI, sonst nach Regeln. Kacheln, Filter, Sortierung, Suche, Frist-Countdown, ASIN-Links ins Seller Central, Notizfeld. Freigabe-Mails zur selben ASIN erledigen ältere Aufgaben automatisch. Offene Fristen stehen im Kalender, auf der Startseite gibt es eine Sammelaufgabe, hohe Prioritäten optional nach Discord (Anbindungen → Discord).

**KI-Kosten** (Anbindungen → KI (Claude) → „Kosten / Qualität“): *Ausgewogen* (Vorgabe) nimmt das günstige Haiku für Mails und Recherche und Sonnet für Ideen, Skripte und Listings; *Sparsam* überall Haiku, *Qualität* überall Sonnet. Ein „eigenes Modell“ überschreibt die Auswahl – leer lassen, sonst greift die Stufe nicht. Monatslimit zusätzlich in console.anthropic.com → Settings → Limits setzen.

**Lieferanten scannen** (WaWi → Lieferanten-Feeds → Feed anlegen/öffnen): neben CSV/Excel gibt es „Seite oder Liste scannen“:
- *Einfügen*: Lesezeichen „→ Seller-System“ in die Lesezeichenleiste ziehen, im Shop (z. B. CandyHero) eine Kategorie- oder Produktseite öffnen, Lesezeichen anklicken → Meldung „… Produkte erfasst und kopiert“ → im Feld einfügen → „Scannen und übernehmen“. Funktioniert auch bei Bot-Schutz, weil es im eigenen Browser läuft. Alternativ Seitentext (Strg+A, Strg+C) einfügen – dann liest die KI.
- *Link*: Shops ohne Bot-Schutz direkt; Shopify-Shops liefern den ganzen Katalog mit Barcodes. Bei Bot-Schutz kommt der Hinweis aufs Lesezeichen.
- *Foto / PDF*: Preisliste, Rechnung oder Screenshot – die KI liest Artikel, UPC/EAN und Preise (braucht den KI-Schlüssel).
- Dollar-Preise werden mit dem EZB-Tageskurs umgerechnet (änderbar), UPC-12 wird zu EAN-13.
- *Lohnt sich das auf Amazon?*: sucht Artikel mit EAN bei Keepa (1 Token je Artikel), optional ohne EAN per Titel (ca. 10 Tokens, Treffer mit „per Titel – prüfen“ markiert). *Kalkulation*: Nebenkosten-Aufschlag (Fracht/Zoll) und USt (Süßigkeiten 7 %). Gewinn/Stk und Marge in der Tabelle, Filter „Auf Amazon“ und „Mit Gewinn“.
- *Einzelpreis*: Kartongrößen werden aus Titel/Link gelesen („(24 x 9g)“, „box-of-24“, „case-of-12“, „24ct“) – „5 Pack“ ist der Inhalt einer Einheit. Tabelle: EK Karton, EK Einheit (÷ Kartongröße) und Gewinn je Einheit.
- *Boxen daraus bauen*: Marke, Anlass, Wunsch, Anzahl, Verpackungs- und FBA-Kosten wählen → die KI stellt Themenboxen nur aus den gescannten Artikeln zusammen (mit TikTok-Bestsellern aus der Shop-Analyse als Orientierung). Einkauf und Gewinn rechnet das System exakt aus den Einzelpreisen; jede Box landet als Idee im Marken-Board (Inhalt mit Mengen, VK, Einkauf, Kalkulation in den Notizen, TikTok-Hook).
- *Box-Kalkulation mit Amazon-Vergleich*: je Box sucht Keepa vergleichbare Produkte auf amazon.de (Suchbegriff von der KI, ca. 10 Tokens). VK wird in die Marktspanne geholt, FBA-Gebühr und Provision kommen aus den Vergleichsprodukten (sonst geschätzt). Boxen unter 20 % Marge bekommen eine zweite Runde mit festem Warenbudget; gespeichert werden nur Boxen mit Gewinn. Die Idee enthält die Vergleichsprodukte (Kalkulation auf der Ideenseite) und die komplette Rechnung in den Notizen.
- *Im Ideen-Board*: Kasten „Boxen aus Lieferanten-Artikeln“ (alle Feeds). *Automatisch*: Markenprofil → „Boxen selbstständig vorschlagen“ – einmal pro Woche, nur wenn neue Lieferanten-Artikel da sind; Anlass = der nächste in Planung; es entsteht eine Aufgabe auf der Startseite.
- *Kalkulation wie ProfitGo* (Ideenseite): in der Vergleichstabelle ein Produkt als „Referenz“ wählen → FBA-Gebühr und Provision von genau diesem Produkt statt Median. Zeilen: Lagerkosten (Einstellungen → Preise, Standard 0,10 €), Break-even-VK, Max. EK (Mindest-ROI, Standard 20 %); USt kommt aus dem Markenprofil (Süßigkeiten 7 %).
- *Einkauf für eine Box* (Ideenseite, bei Boxen aus Lieferanten-Artikeln): Tabelle mit Links zu jeder Produktseite, Menge je Box, benötigte Stückzahl, ganze Kartons und Summe für „Boxen = N“; „Alle Produktseiten öffnen“ (ggf. Pop-ups erlauben), „Einkaufsliste kopieren“, „Als Einkauf anlegen“ → Lieferantenbestellung(en) je Feed im Einkauf (Bestandteile ohne ASIN, US-Ware ohne USt). Wareneingang bucht sie als Lagerbestand „KOMP-…“. Ältere Box-Ideen werden über die Artikelnamen den Lieferanten-Artikeln zugeordnet.

**Lieferanten-Abfrage & Chancen** (WaWi → Lieferanten-Abfrage / Chancen): alle Großhändler-Listen an einem Ort, mit Preis-Gedächtnis.
- *Täglich automatisch*: Feed öffnen → „Automatischer Abruf“ → Download-Link der Preisliste (B2B-Shop-Export, Qogita-Katalog-Export als CSV/Excel) und ggf. Zugang („Benutzer:Passwort“, „Bearer …“ oder Kopfzeile „X-Api-Key: …“; wird verschlüsselt gespeichert und nie wieder angezeigt) → „automatisch alle 24 Std.“ → „Speichern & jetzt abrufen“. Der Link ist immer die vollständige Liste: was fehlt, wird als „nicht mehr gelistet“ markiert (Bestand 0). Fehler (z. B. Zugang abgelehnt, Link liefert eine Login-Seite) stehen am Feed und in der Feed-Übersicht. „Preise sind brutto“ ankreuzen, wenn die Liste Bruttopreise hat.
- *Qogita*: Eine öffentlich dokumentierte Qogita-Schnittstelle ließ sich nicht bestätigen. Deshalb läuft Qogita über den Katalog-Export (Datei hochladen oder Download-Link eintragen); Spalten wie GTIN, Lowest Price, Inventory, MOQ werden automatisch erkannt.
- *EK-Verlauf*: Jeder Import/Abruf/Scan speichert Preis und Bestand je Angebot und Tag. Daraus: „günstigster Stand seit 26 Tagen“ bzw. „27 % über deinem Tief (13,76 €)“ und eine kleine Verlaufskurve.
- *Keepa mit Token-Budget*: stündlich, eine Abfrage je EAN (egal in wie vielen Listen), Reihenfolge: neue EANs → EANs mit geändertem EK → alles, was älter als 2 Tage ist; höchstens 300 je Lauf, Pause unter 20 Tokens. Neue Angebote einer schon geprüften EAN übernehmen die Amazon-Daten ohne Token. Amazon-VK, Verkäufe/Monat, Rang und Verkäuferzahl werden ebenfalls als Verlauf gespeichert (VK-Trend 30 Tage). Mehr Echtzeit = größerer Keepa-Tarif.
- *Lieferanten-Abfrage*: EAN, ASIN oder Titel eingeben → je Großhändler Preis (netto, bei Kartons je Stück), Bestand, Mindestabnahme, Gewinn/Stk, ROI, Verlauf, „geprüft vor …“, günstigster zuerst. Darüber Amazon-VK, Verkäufe/Monat, VK-Trend; darunter „Deine Einkäufe“ aus dem Einkauf (Datum, Bestellung, Menge, EK netto). Filter je Lieferant (z. B. nur Qogita) über die Knöpfe. „Keepa jetzt prüfen“ holt die Amazon-Daten sofort (1 Token).
- *Chancen*: alle profitablen Artikel über alle Listen, je EAN der günstigste Großhändler (+ Anzahl weiterer). Filter ROI ab %, Gewinn ab €, Verkäufe/Monat, „EK gefallen“ (mind. 3 % unter dem 30-Tage-Hoch), „neu gelistet“ (7 Tage), Lieferanten-Knöpfe, Sortierung. „Alle Listen jetzt abrufen“ und „Keepa jetzt abgleichen“ starten die Läufe sofort.

**Großhändler anschreiben, Board, Messen** (WaWi → Großhändler finden, Menü → Board):
- *Schreibfenster*: Firma in der Liste anklicken → oben „E-Mail an …“. Ist eine E-Mail bekannt, schreibt die KI den Entwurf beim Öffnen sofort (alle gesuchten Marken, bei Messe-Funden „Aussteller auf der IAW …“). Gegenlesen, ggf. ändern → „Gelesen – jetzt senden“. „Neu formulieren (KI)“ und „Speichern“ daneben. Ohne Absenderfirma (Einstellungen → Versand) oder KI-Schlüssel steht der Grund im Fenster.
- *E-Mail-Adresse finden*: Fehlt die Adresse, sucht das System beim Öffnen selbst (einmal; „Erneut suchen“ im Schreibfenster, für mehrere Firmen „E-Mail-Adressen suchen“ in der Liste): Website aus Websuche/Messe/eBay oder aus dem Firmennamen („AllesfurHaare.DE …“ → allesfurhaare.de, auch Umlaut-Schreibweise allesfuerhaare.de; nur wenn die Seite zur Firma passt, geparkte Domains zählen nicht), sonst kurze KI-Websuche nach der Website (ca. 1–3 Cent). Dann werden Startseite, Impressum, Kontakt- und Händlerseiten gelesen (höchstens 8 Seiten) – auch verschleierte Adressen („info [at] firma [dot] de“, „info(at)…“, HTML-Codes, Cloudflare-Schutz). Bevorzugt: Einkauf/B2B/Vertrieb vor info@, Adressen der eigenen Domain; Datenschutz, Jobs, noreply nie. Unter „An“ steht, wo die Adresse gefunden wurde (mit Link). Findet sich keine: Meldung mit den geprüften Seiten und Link zur Kontakt-/Impressumsseite (Kontaktformular). „Per Websuche prüfen“ liest danach ebenfalls die Website.
- *Nie doppelt*: Eine Firma gilt als schon angeschrieben, wenn ein anderer Kontakt mit gleicher E-Mail, gleicher Firmen-Domain (nicht Gmail & Co.), gleicher Website oder gleichem Firmennamen schon eine Anfrage bekommen hat – auch über eine andere Marke oder Quelle – oder wenn sie schon als Lieferant angelegt ist. Dann kein Entwurf, kein Senden; in Liste und Detailseite steht „schon angeschrieben am … als …“. Findet das Verpackungsregister eine schon bekannte Firma (z. B. von Amazon oder einer Messe), wird sie zusammengeführt statt doppelt gelistet.
- *Board*: Reiter „Großhändler“ mit Spalten Zu kontaktieren · Angeschrieben · Antwort erhalten · Follow-up · Preisliste erhalten · Abgeschlossen · GH ist nix. Karten ziehen (Handy: unten an der Karte „→ Spalte“ wählen). Nach 7 Tagen ohne Antwort wandert eine Anfrage automatisch nach „Follow-up“ (mit Aufgabe); auf der Detailseite ist die Nachfass-Mail fertig vorbereitet („AW: …“ mit der ersten Anfrage als Zitat) – zählt zum Tageslimit. Antworten im Posteingang → „Antwort erhalten“. „Preisliste erhalten“ → Knopf „Preisliste hochladen“ legt Lieferant + Feed an. „Abgeschlossen“ legt die Firma als Lieferant an. Weitere Firmen in der Liste per „Aufs Board“. Reiter „Meine To-dos“: Offen · In Arbeit · Warten auf … · Erledigt, neue Aufgabe direkt in „Offen“; „alle Aufgaben zeigen“ nimmt die System-Aufgaben dazu.
- *Messe-Ausstellerliste*: Kasten „Messe-Ausstellerliste auslesen“ → Link zur Liste (z. B. https://iaw-messe.de/besucher/ausstellerverzeichnis/) → „Auslesen“. Die IAW wird direkt gelesen (alle Seiten, mit „Detailseiten laden“ auch Anschrift, Website, Kontakt-E-Mail, Kategorien; ca. 1 Sek. je Aussteller, kostenlos). Optional nur bestimmte Kategorien (z. B. „Drogerie, Lebensmittel“). Importeure/Großhändler werden höher eingestuft, Dienstleister niedriger. Andere Messen liest die KI (wenige Cent je Liste). Lädt eine Messeseite ihre Aussteller erst im Browser: Lesezeichen „→ Seller-System Messe“ in die Leiste ziehen, auf der Ausstellerliste klicken (scrollt, klickt „Mehr laden“, folgt „Weiter“) → „An Seller-System senden“ → im Seller-System „Aussteller übernehmen“. Oder Liste markieren, kopieren und einfügen.

**Profitable Produkte nach dem Scan + Verkaufsfreigabe** (Lieferanten-Feed): Nach „Scannen und übernehmen“ bzw. Upload (mit „Danach … mit Keepa prüfen“) läuft im Hintergrund: Keepa für die EANs → Gewinn/ROI je Stück → für alle profitablen (Gewinn ≥ 1 €, ROI ≥ 20 %) prüft das System über Amazon (Listings Restrictions), ob dein Konto sie ohne Freischaltung anbieten darf. Oben auf der Feed-Seite: Karte „Profitable Produkte“ mit EK/Stk, Amazon-Preis, Gewinn, ROI, Verkäufe/Monat, „verkaufbar“ bzw. „Freischaltung erforderlich“ (Link zum Antrag), „Amazon verkauft selbst“ und Anzahl Anbieter. „Verkaufsfreigabe prüfen“ prüft neu, „In „Chancen“ öffnen“ zeigt die Liste dort (dort stehen die Hinweise ebenfalls). Braucht Anbindungen → Amazon Seller Central mit Händler-ID und App-Rolle „Produktlisting“.

**Shop-Analyse – Buy Box und Bewertungen**: Keepa wird für eigene Produkte mit Buy-Box- und Bewertungsdaten abgefragt (ca. 3 Tokens mehr je Produkt und Tag). Die Preis-Kachel zeigt, wer die Buy Box hält (Name per Keepa). Im Markenprofil „Verkäuferkonto auf Amazon“ und „Händlerkennung“ eintragen (Grulu ist mit „Wittmann und Kulu GmbH“ vorbelegt) – oder in der Shop-Analyse „Ja, das sind wir“ klicken. Dann: „Buy Box bei euch“ bzw. Warnung, wenn ein anderer Verkäufer oder Amazon sie hält. Nach dem Update einmal „Keepa-Daten jetzt aktualisieren“.

**eBay-Angebote nur noch im eBay-Tool**: „→ eBay“ im Lieferanten-Feed und „Im eBay-Tool einstellen“ bei eBay-Entwürfen unter WaWi → Listings öffnen „Neues Angebot“ im eBay-Tool mit Vorbelegung (EAN bzw. Titel – die Suche startet sofort –, EK je Einheit inkl. Nebenkosten, Einkaufsmenge = Kartongröße, Lieferant als Quelle). Das Formular „Neues Listing“ unter Listings gilt nur noch für andere Kanäle.

**Rechte – Lieferanten-Feeds**: eigener Bereich in Einstellungen → Benutzer (bisher Teil der WaWi; wer WaWi hat, behält den Zugriff). Beispiel Grulu-Mitarbeiter: „Marken“ + „Lieferanten-Feeds“ (+ ggf. „eBay“ für den „→ eBay“-Knopf).

**Artikelstamm** (WaWi → Artikelstamm): eigene Produkte an einem Ort.
- Aus dem Ideen-Board: Idee auf „Umsetzen“ oder „Live“ setzen → Artikel entsteht automatisch (oder „In Artikelstamm übernehmen“). Titel, Inhalt/Stückliste, VK, EK, Konzept, Hersteller aus dem Markenprofil kommen mit; Idee und Artikel sind verlinkt.
- Artikelseite: Stammdaten (SKU, EAN oder GTIN-Befreiung, ASIN, VK/EK, Gewicht, Maße, USt), Bilder (Hauptbild wählen), Listing-Texte (5 Stichpunkte, Beschreibung, Suchbegriffe; „KI: … schreiben“), Merkmale, Lebensmittel-Pflichtangaben, Hersteller/Verantwortlicher (GPSR), Vollständigkeit je Kanal, „Alles als ZIP“ (Bilder + Texte).
- Amazon: Konto (Hauptkonto oder „Amazon – zweites Verkäuferkonto“, im Markenprofil vorbelegbar), Produkttyp suchen, „Mit Amazon prüfen“ (legt nichts an, zeigt Amazons Hinweise), „An Amazon senden“, „Status abrufen“ → ASIN; der Artikel wird dann als Produkt in der WaWi verknüpft (Chargen, Bestand, Gewinn). Bilder gehen nur mit, wenn unter Anbindungen → Amazon eine öffentliche Bild-Adresse eingetragen ist – sonst ZIP laden und in Seller Central hochladen. Die App-Rolle „Produktlisting“ muss in Seller Central freigegeben sein.
- eBay: Kategorie suchen → „Als Entwurf ins eBay-Tool“: Bilder werden zu eBay hochgeladen, Titel (80 Zeichen), HTML-Beschreibung, Merkmale, GPSR, EK/VK kommen mit → Vorschau im eBay-Tool, dort veröffentlichen.
- Rechte: eigener Bereich „Artikelstamm“ (WaWi sieht ihn mit), Marken-Freigaben gelten auch hier.
Umzug: rechts „Aus dem Retouren-Tool übernehmen“ → aus `backend\data` des Retouren-Tools `app.db` **und, falls vorhanden, `app.db-wal`** zusammen auswählen (Strg gedrückt halten) und hochladen – alle Aufgaben mit Status und Notiz sowie die Liste verworfener Mails kommen mit, Doppelte werden übersprungen. Danach im Retouren-Tool den stündlichen Lauf abschalten, sonst laufen zwei Systeme parallel (doppelte KI-Kosten und Discord-Meldungen).
Bei Google-Postfächern wird „Alle Nachrichten“ gelesen, damit auch archivierte oder per Filter einsortierte Amazon-Mails ankommen.

**Mitarbeiter-Rechte** (Einstellungen → Benutzer): Mitarbeiter anlegen, dann in seiner Zeile „Mitarbeiter · …“ aufklappen → „nur diese“ Bereiche ankreuzen (z. B. Marken, Kalender) und bei Bedarf nur bestimmte Marken (z. B. Zeitlux). Der Mitarbeiter sieht dann nur diese Menüpunkte; andere Seiten leiten auf seine Startseite um, Aktionen und die eBay-Schnittstelle antworten mit „keine Freigabe“. Im Kalender sieht er keine privaten Termine, nur Fälligkeiten seiner Bereiche/Marken; die globale Suche ist für ihn gesperrt. Änderungen gelten nach spätestens 30 Sekunden.

**Marken & Ideen** (Menü „Marken“): Grulu und Zeitlux sind vorbelegt (Markenprofile anpassen, Links eintragen).
- *Ideen & Saison*: Anlässe mit Planungsvorlauf je Marke (Halloween, Adventskalender, Weihnachten, Einschulung/Schultüten, Ostern, Valentinstag, Super Bowl, 4th of July, Black Friday …). Beginnt die Planungszeit, entsteht eine Aufgabe (auch im Kalender) und – mit Claude-Schlüssel – einmalig fünf Ideen inkl. Inhalt, VK, EK-Schätzung, Beschaffung. „KI-Ideen“ und „Ideen auf Zuruf“ jederzeit.
- *Ideen-Board*: Idee → Prüfen → Geplant → In Umsetzung → Live. Jede Idee mit Checkliste bis zum Launch, grober Kalkulation und Launch-Datum (im Kalender).
- *Markt & Kalkulation* (auf jeder Idee): „Ähnliche Produkte (Keepa)“ holt vergleichbare Amazon-Produkte mit Preis, FBA-Gebühr, Provision, Verkäufen/Monat, Rang und Bewertungen; daraus Kalkulation FBA und FBM mit Marge und ROI. Keepa-Schlüssel unter Anbindungen → Keepa (oder der aus dem eBay-Tool). Helium 10 hat keine offene Schnittstelle – dort in Xray „Export“ klicken und die CSV hier hochladen.
- *Shop-Analyse*: eigene Amazon-Produkte (ASIN oder Link, auch amzn.eu) werden täglich per Keepa aktualisiert – Preis, Buy Box, Rang, Verkäufe/Monat, Sterne, Bewertungen, FBA-Gebühr, Verlauf –, dazu Hinweise (z. B. wenig Bewertungen, Titel zu kurz, Rang verschlechtert) und „KI: Listing verbessern“ (Titel, Stichpunkte, Suchbegriffe). TikTok Shop: Export der Helium-10-Chrome-Erweiterung hochladen; die Bestseller fließen in KI-Ideen und Listing-Vorschläge ein.
- *Content-Plan*: KI schreibt Video-Ideen (Hook, Ablauf, Szenen, Caption, Hashtags, Sound) für TikTok, YouTube/Shorts, Instagram; Status und Datum pflegen, Caption mit einem Klick kopieren.
- *Automatisch auf TikTok hochladen*: noch nicht. TikTok erlaubt das nur über eine eigene Entwickler-App mit „Content Posting API“; öffentliches Posten erst nach Prüfung durch TikTok (vorher nur privat bzw. als Entwurf im Postfach der TikTok-App).

**eBay-Rechnungen per E-Mail:** Der eigene SMTP-Zugang im eBay-Tool ist entfallen. Rechnungen gehen über ein verbundenes Postfach raus (eBay-Einstellungen → Rechnungen → Absender-Postfach); eine Kopie liegt im Ordner „Gesendet“.

## 4. Bekannte Platzhalter – bitte prüfen

- **Fristen für Ansprüche** (Einstellungen → Ansprüche): Standard 60 Tage – mit den aktuellen Amazon-Richtlinien abgleichen.
- **Tageslimit** für Fälle: Standard 15, Reset 14 Uhr – an eure Erfahrung anpassen.
- **BQool-CSV**: Spalten „SKU, Min Price, Max Price“ – bitte mit der BQool-Importvorlage vergleichen.
- **DHL-Kleinpaket**: Produktcode `V62KP` – bei Fehlern im Label `V62WP` probieren.
- **Amazon-Reports**: Getestet mit den englischen Spaltennamen. Falls ein Report „nicht erkannt“ wird, zeigt der Import die gefundenen Spalten – dann bitte die Datei (ohne vertrauliche Daten) schicken.
- **Retouren-Abgleich**: Rücksendefrist FBA 45 Tage, Amazon-Zahlung bis Tag 60, Händlerversand 21 Tage – wie im bisherigen Tool, einstellbar unter Einstellungen → Retouren-Abgleich.
- **Gewinn**: Umsatz netto mit Standard-MwSt; erstattete Einheiten gelten als wieder im Bestand.

## 5. Drucken

- **FNSKU-Etiketten** (QL-800): Papier 62 × 29 mm, Ränder „keine“, Skalierung 100 %.
- **DHL-Labels** (QL-1100): Labelformat 910-300-700 (103 × 199 mm).
- Der Browser zeigt vor dem Druck einen Dialog. Für Druck ganz ohne Dialog ist ein kleines Druckprogramm auf dem PC nötig (z. B. QZ Tray) – kommt in einer späteren Ausbaustufe.

## 6. Online auf Hetzner

1. **console.hetzner.cloud** → Projekt anlegen → **Server hinzufügen**: Standort Falkenstein/Nürnberg, Image **Ubuntu 24.04**, Typ **CX22** (2 vCPU, 4 GB RAM, ca. 4–5 €/Monat), unter „Backups“ die tägliche Sicherung aktivieren. SSH-Schlüssel hinterlegen oder das Root-Passwort per Mail nutzen.
2. Mit dem Server verbinden: `ssh root@<IP-Adresse>`
3. Einrichten (bei privatem Repository mit Lese-Token von github.com → Settings → Developer settings → Fine-grained tokens):
   ```
   curl -fsSL https://raw.githubusercontent.com/zqgfdwmdyj-hue/Lugru/main/deploy/install.sh -o install.sh
   bash install.sh https://<TOKEN>@github.com/zqgfdwmdyj-hue/Lugru.git
   ```
   Ohne eigene Domain gibt es automatisch eine Adresse der Form `https://1-2-3-4.sslip.io` mit HTTPS. Mit eigener Domain: DNS-A-Eintrag auf die Server-IP setzen und die Domain als zweiten Parameter angeben.
4. Benutzer anlegen (Befehl steht am Ende der Ausgabe).
5. Updates später: `bash /opt/seller-system/deploy/update.sh`

Bei privatem Repository ist die `install.sh` nicht per `raw.githubusercontent.com` abrufbar – dann den Inhalt der Datei kopieren oder zuerst `git clone` mit Token ausführen und `bash deploy/install.sh <url>` starten.

## 7. eBay-Tool übernehmen (bisher Port 3017)

Das bisherige LuGru eBay-Tool ist komplett im Seller-System enthalten. Die Daten ziehen einmalig um:

1. **Bisheriges Tool beenden** – dann ist die Datei in sich stimmig, und es vergibt keine Rechnungsnummern mehr:
   ```
   docker stop lugru-ebay-tool
   ```
2. **Daten übernehmen** – entweder im Browser unter *eBay → eBay-Einstellungen → Datensicherung → „Daten aus dem bisherigen eBay-Tool übernehmen“* die Datei `data/lugru.db` wählen, oder direkt auf dem Server (Pfad anpassen; der Ordner des bisherigen Tools ist der mit der `compose.yml` darin):
   ```
   cd /opt/seller-system
   docker compose cp /PFAD/ZUM/EBAY-TOOL/data/lugru.db app:/tmp/lugru.db
   docker compose exec app npm run ebay:import -- --datei /tmp/lugru.db
   ```
   Übernommen werden Zugangsdaten und eBay-Verbindung, alle Angebote mit Einkaufsdaten, alle Rechnungen mit ihren Nummern (neue zählen lückenlos weiter) und der idealo-Preisverlauf. Die Übernahme geht nur einmal in einen leeren eBay-Bereich.
3. **Prüfen**: Verlauf, Artikel und Rechnungen ansehen, eine Rechnung als PDF öffnen.
4. **Rechnungs-Automatik wieder einschalten** (*eBay-Einstellungen → Rechnungen*) – sie ist nach der Übernahme bewusst aus.
5. **Einmal neu mit eBay verbinden** (*eBay-Einstellungen → Verbindung*), damit auch Bestellungen abgeholt und Sendungsnummern zurückgemeldet werden können.
6. Das bisherige Tool erst löschen, wenn alles passt. Die Datei `lugru.db` aufheben – sie enthält die Rechnungen.

## 8. Datensicherung

**Updates behalten alle Daten und Anbindungen.** Alles liegt in der Datenbank (Docker-Volume `seller-system_dbdata`); ein Update tauscht nur das Programm aus, neue Tabellen/Felder werden beim Start ergänzt. Die gespeicherten Zugangsdaten sind mit `APP_SECRET` aus `/opt/seller-system/.env` verschlüsselt. `update.sh` sichert deshalb vor jedem Update:
- die Datenbank nach `backups/sellersystem-vor-update-….dump` (die letzten 5 bleiben),
- die `.env` nach `backups/env-sicherung`,
- und bricht ab, wenn `.env` fehlt oder sich `APP_SECRET` geändert hat.

Nicht machen: `docker compose down -v` (das `-v` löscht die Datenbank), den Ordner `/opt/seller-system` samt `backups` löschen oder `APP_SECRET` ändern. `docker compose down` / `restart` ohne `-v` sind unbedenklich.


Der Container `backup` sichert täglich die ganze Datenbank nach `/opt/seller-system/backups` (Standard: die letzten 30). Status, „Jetzt sichern“ und die Anzahl stehen unter *eBay-Einstellungen → Datensicherung*. Zusätzlich die Server-Backups in der Hetzner-Konsole einschalten.

**Zurückspielen** (überschreibt den aktuellen Stand):
```
cd /opt/seller-system
docker compose stop app
docker compose exec -T db pg_restore -U seller -d seller --clean --if-exists < backups/sellersystem-auto-JJJJ-MM-TT_hh-mm-ss.dump
docker compose start app
```
