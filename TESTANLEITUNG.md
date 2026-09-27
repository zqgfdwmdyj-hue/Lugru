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
| **Fälle, Retouren, Bewertungen** | Von Hand anlegen bzw. Feedback-Bericht importieren. |
| **Wissen & To-dos** | Einträge anlegen, suchen; eigene Aufgaben auf der Startseite. |

## 3. Was Zugangsdaten braucht (Anbindungen)

Unter **Anbindungen** steht bei jedem Dienst eine Schritt-für-Schritt-Anleitung und ein Knopf „Verbindung testen“.

| Dienst | Wofür | Hinweis |
|---|---|---|
| Amazon SP-API | Bestellungen mit Adresse, Reports automatisch, Versandbestätigung | Als „Private Developer“ in Seller Central registrieren. Für Adressen braucht die App die Rolle „Direkter Versand zum Kunden“. |
| DHL Geschäftskunden | Labels Paket/Kleinpaket | Erst mit **Sandbox** testen (Einstellungen → Versand). Abrechnungsnummern eintragen. |
| eBay | Artikel einstellen, Rechnungen, Bestellungen, Sendungsnummer | Eingerichtet wird unter **eBay → eBay-Einstellungen → Verbindung** (Client ID, Client Secret, RuName, dann „Mit eBay verbinden“). Eine übernommene Verbindung aus dem bisherigen Tool darf Bestellungen nur lesen – für das Zurückmelden der Sendungsnummer einmal neu verbinden. |
| Google / Microsoft | Postfächer | Weiterleitungs-URI muss zur Adresse der App passen (`APP_URL`). |
| Google Drive | Rechnungsordner von Invoice Fetcher | Ordner für das Dienstkonto freigeben. |

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

Der Container `backup` sichert täglich die ganze Datenbank nach `/opt/seller-system/backups` (Standard: die letzten 30). Status, „Jetzt sichern“ und die Anzahl stehen unter *eBay-Einstellungen → Datensicherung*. Zusätzlich die Server-Backups in der Hetzner-Konsole einschalten.

**Zurückspielen** (überschreibt den aktuellen Stand):
```
cd /opt/seller-system
docker compose stop app
docker compose exec -T db pg_restore -U seller -d seller --clean --if-exists < backups/sellersystem-auto-JJJJ-MM-TT_hh-mm-ss.dump
docker compose start app
```
