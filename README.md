# Seller-System

Ein System für Einkauf, Bestand, FBA, Ansprüche und To-dos – statt vieler Einzeltools.
Grundsatz: **gebaut für viele, genutzt erst mal von einem.** Jeder Datensatz gehört einem
Mandanten (Firma); heute gibt es nur einen.

## Was schon geht (Ausbaustufe 1: Fundament)

- **Login** mit Sitzungen (Passwörter mit bcrypt, Sitzungs-Token nur als Hash gespeichert)
- **Hauptseite** mit To-dos: eigene Aufgaben plus vom System erkannte Aufgaben
  (z. B. Erinnerung an den Arbitrage-One-Import, Retouren ohne EK, EK-Abweichungen)
- **Wissensdatenbank** mit Bereichen, Textbausteinen, Schlagwörtern und Volltextsuche
- **Import aus Arbitrage One**: Sellerboard-Export (.xls), AccountOne COG (.csv) und die
  eigene Vorlage „Tool“ (.csv) – doppelte Zeilen sind egal
- **SKU-Parser** für alle Schemata (A, B, C, Retouren inkl. älterer Retouren-SKUs)
- **Chargen**: eine SKU = ein Einkauf; genau ein gültiger EK je Charge
  (Vorrang: manuell › Vorlage › AccountOne › Sellerboard)
- **Retouren erben den EK** der passenden Einkaufs-Charge statt 0,01 €/0,10 € Platzhalter
- **COG-Export für AccountOne** im Originalformat – vollständig inkl. Retouren
- **Suche** über Chargen, Wissen und Aufgaben

Noch nicht gebaut (im Menü als „bald“): Posteingang/Amazon-Mails, Aufträge & DHL-Versand,
FBA-Inbound mit Scan, Ansprüche, Bestand/Listings, Service, Gewinn & Cash Flow.

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
