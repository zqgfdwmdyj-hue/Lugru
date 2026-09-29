# Seller-System

Ein System für Einkauf, Bestand, FBA, Ansprüche und To-dos – statt vieler Einzeltools.
Grundsatz: **gebaut für viele, genutzt erst mal von einem.** Jeder Datensatz gehört einem
Mandanten (Firma); heute gibt es nur einen.

## Module

- **Start**: To-dos (eigene + automatisch erkannte), Schnellzugriff, Fristen, Suche über alles
- **Posteingang**: Gmail/Outlook per OAuth, Einordnung von Marktplatz-Mails, To-dos und Fälle
- **Wissen**: Anleitungen und Textbausteine mit Volltextsuche
- **WaWi**: Aufträge aller Kanäle mit DHL-Labels und Sendungsnummer-Meldung, Chargen, Bestand &
  Inventur, Listings (eBay-Veröffentlichung), Lieferanten-Feeds
- **Amazon FBA**: Inbound mit Scan-Ablauf und FNSKU-Etiketten, Ansprüche (7 Erkennungsregeln,
  Warteschlange mit Tageslimit, Nachweis-Mappe), Remissionen
- **Einkauf & Buchhaltung**: Rechnungen (Google Drive, PDF-Auslesen, Zuordnung), COG-Export
  für AccountOne, Repricer-Export für BQool
- **Service**: Fälle & A-bis-Z, Retouren, Bewertungen
- **Geld**: Gewinn je SKU/Kanal, Cash-Flow-Vorschau
- **System**: Import aller Dateien, Einstellungen, Anbindungen (verschlüsselt), Hintergrund-Abrufe

Schnittstellen: Amazon SP-API, eBay, DHL Parcel DE, Gmail, Microsoft Graph, Google Drive.
TikTok Shop und Temu sind vorbereitet (bis dahin CSV-Import).

**Testen:** siehe [TESTANLEITUNG.md](TESTANLEITUNG.md) – Start mit `docker compose up -d --build`.

## Technik

Next.js 16 (App Router, Server Actions) · TypeScript · PostgreSQL · Drizzle ORM · Vitest

```
src/db/schema.ts          Datenmodell (mandantenfähig)
src/lib/sku/parse.ts      SKU-Schemata aus Arbitrage One
src/lib/imports/          Datei lesen (arbitrageone.ts) und übernehmen (apply.ts)
src/lib/costs/returns.ts  EK-Vererbung für Retouren
src/lib/exports/          AccountOne-COG-Export
src/app/(app)/            Seiten nach dem Login
drizzle/                  Datenbank-Migrationen
```

## Lokal starten

Voraussetzungen: Node.js 20.9+, PostgreSQL 14+.

```bash
cp .env.example .env          # DATABASE_URL und APP_SECRET eintragen
npm install
npm run db:migrate
npm run user:create -- --email du@firma.de --name "Dein Name" --firma "Deine Firma"
npm run dev                   # http://localhost:3000
```

`user:create` legt die Firma beim ersten Mal an (mit Startinhalten für die Wissensdatenbank)
und gibt ein Passwort aus, wenn keins angegeben ist.

## Prüfen

```bash
npm test            # Unit-Tests
npm run typecheck
npm run build
```

Echte Geschäftsdaten (Exporte, Rechnungen) gehören nicht ins Repository – die Tests nutzen
nachgebaute Beispiel-SKUs.

## Schema ändern

`src/db/schema.ts` anpassen, dann `npm run db:generate` (erzeugt eine Migration in `drizzle/`)
und `npm run db:migrate`.
