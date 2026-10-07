# Spenden-Tool

Eigenständige Web-App für die Lebensmittelverteilung (Foodsharing). Sie ist unabhängig vom
Seller-Tool und hat eigene Datenbank, eigenen Login und eigenen Start.

## Was es kann

- **Produktdatenbank:** wiederkehrende Spendenprodukte mit Foto, Kategorie und dem zuletzt verwendeten
  Preis, dazu der Verlauf, wann ein Produkt zu welchem Preis dabei war.
- **Verteilungen:** Datum und Uhrzeit, viele Handyfotos auf einmal hochladen (jedes Foto wird ein
  Produkt), frühere Verteilung übernehmen, Preise direkt in der Liste eintragen.
- **Doppelte Fotos:** Jedes Foto bekommt einen Fingerabdruck. Dasselbe Foto wird wiedererkannt – auch verkleinert,
  neu gespeichert, per WhatsApp verschickt oder als PNG/HEIC – und weder doppelt angelegt noch doppelt von der KI
  ausgewertet. Nur ähnliche Fotos werden nicht automatisch zusammengelegt, sondern unter Produkte → „Mögliche
  Doppelte“ zum Prüfen und Zusammenführen angezeigt (dort auch Doppelte aus der Zeit vor dieser Funktion).
- **KI-Preisrecherche (Claude):** erkennt das Produkt auf dem Foto, trägt fehlende Namen ein und sucht
  den günstigsten aktuellen Preis bei deutschen Händlern, mit Links. Daraus wird ein Spendenpreis
  vorgeschlagen (Standard: 25 % vom günstigsten Preis). Das läuft im Hintergrund.
- **Collage:** Bilder zum Teilen im Messenger. Das Raster passt sich an, die Anzahl pro Bild ist
  einstellbar (4 bis 20), in den Formaten 4:5, 9:16, 1:1 oder A4. Der Preis steht auf dem Foto.
- **Aushang:** A4 „Unsere Spendenempfehlungen“, die Schrift passt sich automatisch der Seite an.
- **Messenger-Text:** dieselbe Liste als Text zum Kopieren.
- **MHD-Foto:** pro Produkt ein Foto vom aufgedruckten Datum – die KI liest es ab und trägt es ein
  (Claude Haiku, ohne Websuche, Bruchteil eines Cents). Das Foto wird getrennt gespeichert und erscheint
  nie auf Collage oder Social Media.
- **Alte Fotos mit Preis darauf** (z. B. aus früheren Collagen): Wird bei jedem neuen Foto automatisch geprüft, ebenso
  beim Start der KI-Preissuche; für schon vorhandene Fotos zeigt die Verteilungsseite „Preise aus Fotos lesen“. Die KI (Claude Haiku, ca. 0,2 Cent je Foto)
  liest den Preis ab und trägt ihn ein, wo noch keiner steht. Collage und Social Media zeichnen über solche Fotos
  nie etwas – kein zweiter Preis, nichts verdeckt das Produkt. Weicht der eingetragene Preis ab, gibt es nur einen
  Hinweis mit „Preise vom Foto übernehmen“. Falsch erkannt? In der Produktzeile auf „falsch erkannt“ tippen.
- **Social Media:** Story (9:16), Feed-Titelbild (4:5), Karussell (ein Produkt pro Bild), Story-Serie,
  Preisliste als Bild, Video/Reel für TikTok & Instagram (MP4) und fertige Texte mit Hashtags –
  automatisch aus der Verteilung, direkt im Browser, ohne KI-Kosten.

## Starten (Docker)

```bash
cd spenden-tool
cp .env.example .env     # APP_PASSWORD, APP_SECRET und ggf. ANTHROPIC_API_KEY eintragen
docker compose up -d --build
```

Danach ist die App unter http://localhost:3100 erreichbar. Die Anmeldung erfolgt mit dem Team-Passwort.
Eine tägliche Datensicherung mit allen Fotos landet in `./backups`.

## Als App aufs iPhone (und Android)

Das Tool ist eine installierbare Web-App: eigenes Symbol, Vollbild ohne Browserleiste, Updates automatisch.
- **iPhone/iPad:** in Safari öffnen → Teilen → „Zum Home-Bildschirm“ (die Seite zeigt diesen Hinweis selbst an)
- **Android:** in Chrome „App installieren“

Voraussetzung: eigene Domain mit HTTPS, z. B. https://lugrspende.de (Einrichtung siehe deploy/README.md).

## Auf dem Server (Hetzner)

Siehe [deploy/README.md](deploy/README.md): eigener Ordner, eigene Container und Datenbank, Test auf Port 3021.

## KI-Preisrecherche einrichten

1. Auf https://platform.claude.com einen API-Schlüssel anlegen und Guthaben aufladen.
2. Den Schlüssel in der `.env` als `ANTHROPIC_API_KEY=` eintragen und mit
   `docker compose up -d` neu starten.

Drei Stufen, jeweils beim Start wählbar:

| Stufe | Was passiert | Kosten je Produkt (Schätzung) |
|---|---|---|
| Nur Namen erkennen | Claude Haiku liest das Foto, keine Websuche | deutlich unter 1 Cent |
| Preis suchen – minimal | Claude Haiku, genau 1 Websuche | etwa 2–3 Cent |
| Preis suchen – sparsam (Standard) | Claude Haiku, höchstens 2 Websuchen | etwa 3–6 Cent |
| Preis suchen – genau | Claude Sonnet, bis zu 4 Websuchen | etwa 10–20 Cent |

Die tatsächlichen Kosten jeder Recherche stehen auf der Produktseite, die Summe je Verteilung auf der
Verteilungsseite. Produkte mit einem Ergebnis aus den letzten 60 Tagen werden beim Sammelstart übersprungen –
wiederkehrende Produkte kosten also nur einmal. Die Standard-Stufe lässt sich mit `KI_MODUS` in der `.env` ändern.
Kostenlos geht es auch ohne KI: Neben jedem Preisfeld öffnen die Links „idealo“ und „Google“ den Preisvergleich
mit dem Produktnamen. Günstigster Ablauf: erst „Nur Namen erkennen“, dann Preise selbst nachschauen oder nur für
unklare Produkte die KI suchen lassen.

Ohne Schlüssel funktioniert alles andere normal, nur die KI-Knöpfe sind dann aus.

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
