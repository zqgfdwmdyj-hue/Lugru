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
| **Inbound** | Neue Sendung → mit dem Handscanner FNSKU/EAN/SKU scannen (Menge davor: `6*X00…`), Kartons, Prüfungen, FNSKU-Etiketten (QL-800, 62 × 29 mm), Packliste. |
| **Aufträge** | CSV-Vorlage herunterladen, ausfüllen, unter „Daten importieren“ hochladen. Amazon-FBM-Aufträge kommen über den Report „Alle Bestellungen“ (ohne Adresse) oder die SP-API (mit Adresse). |
| **Posteingang** | Mails aus Gmail/Outlook als `.eml` speichern und hochladen → Einordnung, To-dos, Fälle. |
| **Rechnungen** | PDFs hochladen → Ware/Kosten, Beträge, Zuordnung zu Chargen. Einmal einordnen, das System merkt es sich je Quelle. |
| **Gewinn / Cash Flow** | Settlement-Reports (Flat File V2) importieren, Kontostand und Planposten eintragen. |
| **Bestand & Inventur** | FBA-Bestandsbericht importieren, eigenes Lager buchen, Inventur mit Scanner. |
| **Repricer** | Gebührenvorschau + Bestand importieren → Mindest-/Maximalpreise → BQool-CSV. |
| **Lieferanten-Feeds** | Preisliste (CSV/Excel) hochladen, Spalten zuordnen → Gewinn je Angebot. |
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
