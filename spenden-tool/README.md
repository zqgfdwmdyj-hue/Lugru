# Spenden-Tool

Eigenständige Web-App für die Lebensmittelverteilung (Foodsharing). Sie ist unabhängig vom
Seller-Tool und hat eigene Datenbank, eigenen Login und eigenen Start.

## Was es kann

- **Produktdatenbank:** wiederkehrende Spendenprodukte mit Foto, Kategorie und dem zuletzt verwendeten
  Preis, dazu der Verlauf, wann ein Produkt zu welchem Preis dabei war.
- **Verteilungen:** Datum und Uhrzeit, viele Handyfotos auf einmal hochladen (jedes Foto wird ein
  Produkt), frühere Verteilung übernehmen, Preise direkt in der Liste eintragen.
- **KI-Preisrecherche (Claude):** erkennt das Produkt auf dem Foto, trägt fehlende Namen ein und sucht
  den günstigsten aktuellen Preis bei deutschen Händlern, mit Links. Daraus wird ein Spendenpreis
  vorgeschlagen (Standard: 25 % vom günstigsten Preis). Das läuft im Hintergrund.
- **Collage:** Bilder zum Teilen im Messenger. Das Raster passt sich an, die Anzahl pro Bild ist
  einstellbar (4 bis 20), in den Formaten 4:5, 9:16, 1:1 oder A4. Der Preis steht auf dem Foto.
- **Aushang:** A4 „Unsere Spendenempfehlungen“, die Schrift passt sich automatisch der Seite an.
- **Messenger-Text:** dieselbe Liste als Text zum Kopieren.

## Starten (Docker)

```bash
cd spenden-tool
cp .env.example .env     # APP_PASSWORD, APP_SECRET und ggf. ANTHROPIC_API_KEY eintragen
docker compose up -d --build
```

Danach ist die App unter http://localhost:3100 erreichbar. Die Anmeldung erfolgt mit dem Team-Passwort.
Eine tägliche Datensicherung mit allen Fotos landet in `./backups`.

## KI-Preisrecherche einrichten

1. Auf https://platform.claude.com einen API-Schlüssel anlegen und Guthaben aufladen.
2. Den Schlüssel in der `.env` als `ANTHROPIC_API_KEY=` eintragen und mit
   `docker compose up -d` neu starten.

Kosten: je Produkt grob 10 bis 25 Cent, je nach Anzahl der Suchen (Modell Claude Opus 5.5 mit Websuche). Die ungefähren Kosten
jeder Recherche stehen auf der Produktseite. Ohne Schlüssel funktioniert alles andere normal, nur die
KI-Knöpfe sind dann aus.

## Entwicklung

Voraussetzungen: Node.js 22, PostgreSQL 14+.

```bash
npm install
npm run db:migrate
npm run dev          # http://localhost:3100
npm test
npm run typecheck
```

Schema ändern: `src/db/schema.ts` anpassen, dann `npm run db:generate` und `npm run db:migrate`.

```
src/db/schema.ts            Datenmodell
src/lib/layout.ts           Raster, Preisformat, Aushang-Gruppierung, Messenger-Text
src/lib/price-research.ts   KI-Preisrecherche (Claude + Websuche)
src/app/(app)/              Seiten nach dem Login
src/app/aushang/            Druckansicht
```
