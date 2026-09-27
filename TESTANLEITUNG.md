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
| **Fälle, Retouren, Bewertungen** | Von Hand anlegen bzw. Feedback-Bericht importieren. |
| **Wissen & To-dos** | Einträge anlegen, suchen; eigene Aufgaben auf der Startseite. |

## 3. Was Zugangsdaten braucht (Anbindungen)

Unter **Anbindungen** steht bei jedem Dienst eine Schritt-für-Schritt-Anleitung und ein Knopf „Verbindung testen“.

| Dienst | Wofür | Hinweis |
|---|---|---|
| Amazon SP-API | Bestellungen mit Adresse, Reports automatisch, Versandbestätigung | Als „Private Developer“ in Seller Central registrieren. Für Adressen braucht die App die Rolle „Direkter Versand zum Kunden“. |
| DHL Geschäftskunden | Labels Paket/Kleinpaket | Erst mit **Sandbox** testen (Einstellungen → Versand). Abrechnungsnummern eintragen. |
| eBay | Bestellungen, Sendungsnummer, Artikel einstellen | Zum Einstellen: Richtlinien-IDs und Artikelstandort, je Listing Kategorie-ID und Bild-Links. |
| Google / Microsoft | Postfächer | Weiterleitungs-URI muss zur Adresse der App passen (`APP_URL`). |
| Google Drive | Rechnungsordner von Invoice Fetcher | Ordner für das Dienstkonto freigeben. |

## 4. Bekannte Platzhalter – bitte prüfen

- **Fristen für Ansprüche** (Einstellungen → Ansprüche): Standard 60 Tage – mit den aktuellen Amazon-Richtlinien abgleichen.
- **Tageslimit** für Fälle: Standard 15, Reset 14 Uhr – an eure Erfahrung anpassen.
- **BQool-CSV**: Spalten „SKU, Min Price, Max Price“ – bitte mit der BQool-Importvorlage vergleichen.
- **DHL-Kleinpaket**: Produktcode `V62KP` – bei Fehlern im Label `V62WP` probieren.
- **Amazon-Reports**: Getestet mit den englischen Spaltennamen. Falls ein Report „nicht erkannt“ wird, zeigt der Import die gefundenen Spalten – dann bitte die Datei (ohne vertrauliche Daten) schicken.
- **Gewinn**: Umsatz netto mit Standard-MwSt; erstattete Einheiten gelten als wieder im Bestand.

## 5. Drucken

- **FNSKU-Etiketten** (QL-800): Papier 62 × 29 mm, Ränder „keine“, Skalierung 100 %.
- **DHL-Labels** (QL-1100): Labelformat 910-300-700 (103 × 199 mm).
- Der Browser zeigt vor dem Druck einen Dialog. Für Druck ganz ohne Dialog ist ein kleines Druckprogramm auf dem PC nötig (z. B. QZ Tray) – kommt in einer späteren Ausbaustufe.
