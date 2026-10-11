# Reiseplaner – Landausflüge auf einen Blick

Eigenständige kleine Web-App für Kreuzfahrten: alle Häfen der Route, die Ausflüge vom Schiff
(Mein Schiff) und von GetYourGuide, Viator & Co. nebeneinander, auf einer Karte mit Fahrwegen,
und mit den Kosten für genau die Personen, die mitkommen.

Läuft **getrennt vom Seller-System**: eigener Container, eigener Port, eigene Daten, kein Login
des Seller-Systems. Keine npm-Abhängigkeiten, nur Node.js.

## Was kann der Planer?

- **Route & Häfen**: Datum, Ankunft, Abfahrt, „Alle an Bord“, Seetage, Liegeplatz auf der Karte
  (Ortssuche über OpenStreetMap oder Koordinaten aus Google Maps einfügen).
- **Personen**: Erwachsene und Kinder mit Alter (Vorlage: 4 Erwachsene, 2 Kinder). Bei jedem
  Ausflug einzeln abhaken, wer mitkommt.
- **Ausflüge**: Anbieter (Mein Schiff, GetYourGuide, Viator, Tiqets, Civitatis, eigene Faust …),
  Status (Idee, Favorit, Gebucht, Verworfen), Beginn, Dauer, Preise pro Person (Erwachsene/Kinder,
  „Kinder gratis unter X Jahren“) oder pro Gruppe/Fahrzeug, Zusatzkosten (Taxi, Eintritt),
  Bewertung, Interesse (1–5), Link, Notiz.
- **Vergleich je Hafen**: Zeitplan, Fahrzeit ab Schiff (automatisch über OSRM), **Puffer bis
  „Alle an Bord“** mit Warnung (bei eigenen Ausflügen wartet das Schiff nicht), Kosten,
  €/Person/Stunde, Punktwert „sinnvollste Wahl“, Sortierung nach Preis, Puffer, Weg …
- **Karte** (OpenStreetMap/Leaflet): Schiffsroute, Häfen, Ausflugsziele nach Anbieter gefärbt,
  echte Fahrwege. Für jeden Ausflug ein Link „Route in Google Maps“.
- **Ausflüge finden**: je Hafen Such-Links zu GetYourGuide (mit Datum), Viator, Tiqets, Civitatis,
  Klook, ToursByLocals, Tripadvisor, Mein-Schiff-Ausflügen, „auf eigene Faust“, Wikivoyage,
  Sehenswürdigkeiten in Google Maps.
- **Wetter** am Hafentag (Open-Meteo, ab ca. 16 Tage vorher), Sonnenuntergang.
- **Kosten**: gebucht / gebucht + Favoriten, je Hafen, je Person, je Anbieter.
- **Import**: Mein-Schiff-Ausflüge als Text einfügen (Preise, Dauer, Beginn werden erkannt,
  mit Vorschau), CSV (Excel) rein und raus, ganze Reise als JSON sichern/laden, Drucken.
- **Offline-tauglich**: Die App und angesehene Kartenausschnitte bleiben im Browser
  gespeichert. Änderungen ohne Netz werden lokal gehalten und später gespeichert. Auf dem Handy
  „Zum Home-Bildschirm hinzufügen“.
- Mehrere Geräte/Familienmitglieder: gleiche Adresse und gleiches Passwort. Hat jemand anders
  inzwischen gespeichert, fragt die App nach, welche Fassung gelten soll.

## GetYourGuide direkt in der App

GetYourGuide gibt Angebote per Schnittstelle nur an Partner heraus
([partner.getyourguide.com](https://partner.getyourguide.com/), Freischaltung durch GetYourGuide).
Ohne Partner-Schlüssel gibt es die Such-Links (mit Datum). Mit Schlüssel `GYG_API_KEY` erscheint
je Hafen „GetYourGuide-Angebote hier anzeigen“: Touren im Umkreis von 30 km mit Preis, Dauer,
Bewertung und Kartenpunkt, mit einem Klick als Ausflug übernehmbar. Mit `GYG_PARTNER_ID` tragen
die Such-Links die Partner-ID. Für den Testzugang `GYG_API_URL=https://api.gygtest.net` setzen.

Für Mein Schiff gibt es keine öffentliche Schnittstelle – deshalb der Text-Import.

## Auf dem Server starten (neben dem Seller-System)

```bash
cd /opt/seller-system && git pull
cd reiseplaner
cp .env.example .env    # REISE_PASSWORT setzen, BIND_IP z. B. die Tailscale-IP
docker compose up -d --build
```

Danach erreichbar unter `http://<BIND_IP>:3030` (Benutzername beim Anmelden egal, Passwort aus
`.env`). Daten liegen im Docker-Volume `reiseplaner_reisedaten`. Update: `git pull` und
`docker compose up -d --build` im Ordner `reiseplaner`.

Soll der Planer von unterwegs ohne Tailscale erreichbar sein, über HTTPS (z. B. eine eigene
Subdomain im Caddy) freigeben – nicht als unverschlüsseltes HTTP ins Internet stellen.

## Lokal

```bash
cd reiseplaner
REISE_PASSWORT=geheim npm start    # http://localhost:3030
npm test
```

## Externe Dienste

| Zweck | Dienst | Schlüssel |
| --- | --- | --- |
| Karte | OpenStreetMap-Kacheln, Leaflet (unpkg) | – |
| Ortssuche | Nominatim (OpenStreetMap) | – |
| Fahrwege/-zeiten | routing.openstreetmap.de (OSRM, Auto und zu Fuß) | – |
| Wetter | Open-Meteo | – |
| Angebote | GetYourGuide Partner API | optional |

Ortssuche und Fahrwege laufen über den Server und werden zwischengespeichert (`/daten/cache.json`).
