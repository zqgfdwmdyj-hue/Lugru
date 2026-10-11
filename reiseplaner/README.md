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

**Weltkarte & öffentliches Reisetagebuch**
- Reiter „🌍 Weltkarte“: rote Stecknadeln für alle Orte, an denen ihr wart (vergangene Reisetage aus allen
  Reisen plus von Hand nachgetragene frühere Urlaube), Liste nach Ländern/Inseln – ein Klick und die Karte
  fliegt hin. Auch beim Planen und unter „Route & Häfen“ fliegt die Karte zum gewählten Ort.
- `/tagebuch` ist **ohne Anmeldung** erreichbar: Karte mit roten Stecknadeln, Länder & Inseln, je
  freigegebener Reise die besuchten Orte, gebuchten Ausflüge und Unterkünfte mit Bewertungen und Fotos,
  Tauchgänge. Freigabe je Reise durch Planer/innen („Im öffentlichen Reisetagebuch zeigen“). Es erscheinen
  nur vergangene Tage – nie Kosten, Preise, Planungen, Notizen, Nachnamen oder private Bewertungen.

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

## Auf dem Hetzner-Server (unabhängig von allem anderen)

Der Reiseplaner bekommt einen **eigenen Ordner** (`/opt/reiseplaner`), ein **eigenes
Docker-Projekt** (`reiseplaner`: eigener Container, eigenes Netz, eigenes Volume) und lauscht
standardmäßig nur auf `127.0.0.1:3030`. `/opt/seller-system`, andere Container, Ports 80/443 und die
Firewall bleiben unberührt. Der Container läuft ohne Root-Rechte mit schreibgeschütztem Dateisystem.

**1. Code holen und Bestandsaufnahme (ändert nichts an Bestehendem):**

```bash
git clone --branch reiseplaner https://github.com/zqgfdwmdyj-hue/Lugru.git /opt/reiseplaner
bash /opt/reiseplaner/reiseplaner/deploy/pruefen.sh reise.lugru.de
```

**2. Installieren und lokal testen:**

```bash
bash /opt/reiseplaner/reiseplaner/deploy/install.sh https://github.com/zqgfdwmdyj-hue/Lugru.git reiseplaner 3030
```

Das Skript klont nach `/opt/reiseplaner`, legt `reiseplaner/.env` an (Rechte 600, nicht im Git),
prüft, ob der Port frei ist, startet das Projekt und zeigt den **Einrichtungscode**. Testen ohne
etwas freizugeben: `ssh -L 3030:127.0.0.1:3030 root@<server>`, dann `http://localhost:3030`.

**3. Claude anbinden:** In `/opt/reiseplaner/reiseplaner/.env` `ANTHROPIC_API_KEY=…` eintragen,
dann `docker compose up -d` im Ordner `reiseplaner`. Der Schlüssel steht nur in dieser Datei auf
dem Server – nie im Repository.

**4. Subdomain** (nötig für Freigabe-Links an Außenstehende): DNS-Eintrag (A-Record) für z. B.
`reise.lugru.de` auf die Server-IP, in `.env` `OEFFENTLICHE_URL=https://reise.lugru.de`. Dann je nach
Ergebnis von `pruefen.sh`:

- *Ports 80/443 frei:* `REISE_DOMAIN=reise.lugru.de` in `.env`, dann
  `docker compose -f docker-compose.yml -f docker-compose.https.yml up -d` (eigener Caddy, HTTPS automatisch).
- *Caddy des Seller-Systems belegt 80/443:* Reiseplaner dessen Netz beitreten lassen
  (`docker compose -f docker-compose.yml -f docker-compose.seller-caddy.yml up -d`) und im Caddyfile
  des Seller-Systems einen Block ergänzen, danach Caddy neu laden:
  ```
  reise.lugru.de {
  	encode gzip
  	reverse_proxy reiseplaner:3030
  }
  ```
  Das ist die einzige Berührung mit dem Seller-System – vorher absprechen.
- *Caddy direkt auf dem Host (`/etc/caddy/Caddyfile`):* Block ergänzen, prüfen, ohne Unterbrechung neu laden:
  ```bash
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.vor-reiseplaner
  printf '\nreise.lugru.de {\n\tencode gzip\n\treverse_proxy 127.0.0.1:3030\n}\n' >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
  ```
  Andere Domains im Caddyfile bleiben unverändert; Caddy holt das HTTPS-Zertifikat selbst.
- *nginx o. Ä. auf dem Host:* Subdomain auf `127.0.0.1:3030` weiterleiten, `X-Forwarded-Proto` setzen.

**Update:** `cd /opt/reiseplaner && git pull && cd reiseplaner && docker compose up -d --build`
(mit denselben `-f`-Dateien wie beim Start). **Sicherung:** `bash deploy/sichern.sh` (z. B. per cron).
**Entfernen:** `docker compose down` (Daten bleiben im Volume `reiseplaner_reisedaten`).

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
- Freigabe-Seiten sind nicht für Suchmaschinen gedacht (`noindex`), Links nur `http(s)`, keine
  Einbettung in fremde Seiten. Als „privat“ markierte Bewertungen und Tauchgänge erscheinen nie in
  Freigaben; Tauchgänge teilen nur Taucher/in oder Planer/innen.
- Namen sieht man nur von Mitreisenden der eigenen Reise. Passwortwechsel meldet alle anderen
  Geräte ab, Abmelden löscht die lokalen Kopien auf dem Gerät.
- Allgemeine Einladungslinks gelten 14 Tage und für höchstens 10 Beitritte, persönliche nur einmal.
