# Reiseplaner – planen, vergleichen, erleben, teilen

Eigenständige Web-App für Kreuzfahrten, Hotel- und Rundreisen: alle Tage und Häfen, die
Ausflüge vom Schiff (Mein Schiff) und von GetYourGuide, Viator & Co., Hotels zum Vergleichen,
eine Karte mit Fahrwegen, Kosten für genau die Personen, die mitkommen – und hinterher
Bewertungen mit Fotos, ein Tauchlogbuch und Freigabe-Links für Freunde und Social Media.

Läuft **getrennt vom Seller-System**: eigener Container, eigener Port, eigene Daten, eigene Konten.

## Funktionen

**Planen**
- Reisearten: Kreuzfahrt (Häfen mit Ankunft, Abfahrt, „Alle an Bord“, Seetage), Hotel-/Strandurlaub
  und Rundreise (Tage an Land; Startpunkt der Ausflüge ist das gebuchte Hotel).
- Ausflüge mit Anbieter, Art (Tauchen, Schnorcheln, Bootstour …), Status (Idee, Favorit, Gebucht,
  Verworfen), Beginn, Dauer, Preisen pro Person (Erwachsene/Kinder, „Kinder gratis unter X Jahren“)
  oder pro Gruppe, Zusatzkosten, Interesse (1–5), Link, Notiz.
- Vergleich je Tag: Zeitplan, Fahrzeit ab Schiff/Hotel (OSRM), **Puffer bis „Alle an Bord“** mit
  Warnung, Kosten, €/Person/Stunde, Punktwert „sinnvollste Wahl“, Sortierung.
- Suche je Tag: GetYourGuide (mit Datum), Viator, Tiqets, Civitatis, Klook, ToursByLocals,
  Tripadvisor, Mein-Schiff-Ausflüge, „auf eigene Faust“, Tauchbasen, Wikivoyage, Sehenswertes.
- **Unterkünfte**: Hotels sammeln und vergleichen (Gesamtpreis, pro Nacht, pro Person/Nacht,
  Verpflegung, Gästebewertung, Strand/Zentrum, Pool, Kinderclub, Tauchbasis, Hausriff), Suche bei
  Booking.com, HolidayCheck, Tripadvisor, Google Hotels, Expedia, Check24, Airbnb. „Tage anlegen“
  erzeugt aus dem Aufenthalt die Reisetage.
- **Karte** (OpenStreetMap): Route, Häfen/Orte, Hotels, Ausflugsziele, Tauchplätze, echte Fahrwege;
  Links „Route in Google Maps“.
- **Kosten**: gebucht / mit Favoriten, Ausflüge, Unterkünfte, weitere Posten (Flug, Mietwagen …),
  je Tag, je Person, je Anbieter.
- Wetter am Tag (Open-Meteo), Offline-Betrieb (Änderungen werden später gespeichert).

**Für alle Mitreisenden**
- Jede/r bekommt ein **eigenes Konto** über einen Einladungslink (per WhatsApp/E-Mail verschickbar).
  Rollen: *Planer/in* (lädt ein, verwaltet Zugang, darf löschen) und *Mitreisend* (plant mit,
  bewertet, führt das eigene Tauchlog).
- Die Teilnehmer je Ausflug sind frei wählbar (z. B. 4 Erwachsene und 2 Kinder, aber nicht alle bei jedem Ausflug).

**Erlebnisse**
- **Bewertungen** für Ausflüge und Unterkünfte: Sterne, Überschrift, Kommentar, Fotos (werden im
  Browser verkleinert – spart Datenvolumen an Bord).
- **Tauchlog**: Tauchplatz, Basis, Einstieg, Tiefe max./Ø, Tauchzeit, Wasser-/Lufttemperatur, Sicht,
  Strömung, Anzug, Blei, Flasche, Gas/Nitrox, Druck, Buddy, Guide, Sichtungen, Fotos, Kartenpunkt.
  „Mein Logbuch“ zählt fortlaufend über alle Reisen (Startnummer im Konto einstellbar).

**Teilen**
- Freigabe-Link für **genau einen Beitrag**: Bewertungen eines Ausflugs/Hotels, einen Tauchgang
  oder den Reisebericht. Die übrige Reise, Kosten und Mitreisende bleiben privat; nur Vornamen
  erscheinen. Freigaben lassen sich jederzeit beenden. Mit Vorschaubild für WhatsApp & Co.
- Knöpfe für WhatsApp, Facebook, X, Pinterest, Telegram, E-Mail, „Teilen …“ (Handy).
- **Story-Bild** (1080 × 1920) für Instagram/TikTok aus dem ersten Foto mit Titel, Ort, Sternen und
  Creator-Name; am Handy direkt an die App senden.
- **KI-Beitragstext** für Instagram, TikTok, Facebook, YouTube oder X (Deutsch/Englisch).

**KI (Claude)**
- **Plan einlesen**: Text aus ChatGPT einfügen oder PDF, Word, Text, Screenshots hochladen – die KI
  erkennt Tage/Häfen, Hotels, Ausflüge, Preise, Zeiten und weitere Kosten. Vorschau vor dem
  Übernehmen; erneutes Einlesen ergänzt die Reise, statt sie zu verdoppeln.
- **Assistent** (unten rechts „✨ KI“, an jedem Ausflug „KI fragen“): kennt die Reisedaten,
  kann im Web suchen, hinterfragt Puffer/Kosten/Kinder-Tauglichkeit und schlägt Ausflüge,
  Änderungen, Tage und Hotels vor, die man mit einem Klick übernimmt.
- Modell: `claude-opus-5-5`. Lehnt das Modell eine Anfrage ab, beantwortet sie automatisch ein Ausweichmodell
  (`fallbacks: "default"`). Der Gesprächsverlauf liegt auf dem Server.

Ohne `ANTHROPIC_API_KEY` funktioniert alles außer den KI-Teilen. Für Mein Schiff gibt es keine
öffentliche Schnittstelle – deshalb KI- oder Text-Import.

### GetYourGuide direkt in der App

Angebote gibt GetYourGuide per Schnittstelle nur an Partner heraus
([partner.getyourguide.com](https://partner.getyourguide.com/)). Ohne Schlüssel gibt es Such-Links
(mit Datum). Mit `GYG_API_KEY` erscheinen je Tag die Touren im Umkreis mit Preis, Dauer, Bewertung
und Kartenpunkt; `GYG_PARTNER_ID` hängt die Partner-ID an die Such-Links.

## Auf dem Server starten (neben dem Seller-System)

```bash
cd /opt/seller-system && git pull
cd reiseplaner
cp .env.example .env              # BIND_IP, ANTHROPIC_API_KEY, OEFFENTLICHE_URL … eintragen
docker compose up -d --build
docker compose logs reiseplaner   # zeigt beim ersten Start den Einrichtungscode
```

Dann `http://<BIND_IP>:3030` öffnen, mit dem Einrichtungscode das erste Konto (Verwaltung) anlegen
und eine Reise erstellen. Alle anderen bekommen ihren Zugang über **Reisende → Einladen**.

**Freigabe-Links für Außenstehende** funktionieren nur, wenn der Planer aus dem Internet erreichbar
ist. Dafür eine Domain (z. B. `reise.lugru.de`) auf den Server zeigen lassen und – wenn die Ports
80/443 frei sind – mit HTTPS starten:

```bash
# in .env: REISE_DOMAIN=reise.lugru.de und OEFFENTLICHE_URL=https://reise.lugru.de
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Läuft auf dem Server schon ein Webserver auf 80/443, dort stattdessen die Domain an Port 3030
weiterleiten. Nur über Tailscale/intern erreichbar heißt: Familie ja, Freigabe-Links für andere nein.

Daten (Reisen, Konten, Fotos) liegen im Docker-Volume `reiseplaner_reisedaten`.
Update: `git pull` und `docker compose up -d --build` im Ordner `reiseplaner`.

## Lokal

```bash
cd reiseplaner
npm install
npm start          # http://localhost:3030 – Einrichtungscode steht in der Ausgabe
npm test
```

## Externe Dienste

| Zweck | Dienst | Schlüssel |
| --- | --- | --- |
| Karte | OpenStreetMap-Kacheln, Leaflet (unpkg) | – |
| Ortssuche | Nominatim (OpenStreetMap) | – |
| Fahrwege/-zeiten | routing.openstreetmap.de (OSRM, Auto und zu Fuß) | – |
| Wetter | Open-Meteo | – |
| KI | Claude (Anthropic) | `ANTHROPIC_API_KEY` |
| Angebote | GetYourGuide Partner API | optional |

## Sicherheit

- Passwörter mit scrypt, Sitzungen als HttpOnly-Cookie, Schutz gegen fremde Seiten (CSRF) über
  einen App-eigenen Kopf, Anmelde-Sperre nach mehreren Fehlversuchen.
- Jede Abfrage prüft die Mitgliedschaft in der Reise; Fotos gibt es nur für Mitglieder oder über
  eine Freigabe, die genau dieses Foto enthält.
- Freigabe-Seiten sind nicht für Suchmaschinen gedacht (`noindex`), Links nur `http(s)`.
