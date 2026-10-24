# Reiseplaner – planen, vergleichen, erleben, teilen

Eigenständige Web-App für Kreuzfahrten, Hotel- und Rundreisen: alle Tage und Häfen, die
Ausflüge vom Schiff (Mein Schiff) und von GetYourGuide, Viator & Co., Hotels zum Vergleichen,
eine Karte mit Fahrwegen, Kosten für genau die Personen, die mitkommen – und hinterher
Bewertungen mit Fotos, ein Tauchlogbuch und Freigabe-Links für Freunde und Social Media.

Läuft **getrennt vom Seller-System**: eigener Container, eigener Port, eigene Daten, eigene Konten.

## Funktionen

**Aufbau**
- Sechs Bereiche je Reise: **Übersicht** (Status, nächste Termine, offene Aufgaben), **Reiseplan**
  (Tage & Ausflüge, Route, Unterkünfte, Flug), **Vorbereitung**, **Unterwegs**, **Kosten**
  (Reisekosten & Zahlungen, Urlaubskasse/Bordkonto & Abrechnung) und **Erinnerungen**.
- **⚙️ Reise verwalten**: Reisende & Zugänge, Import & Sicherung, Name/Art/Freigabe – Löschen nur im
  eingeklappten Gefahrenbereich mit Namensbestätigung.
- **🌍 Weltkarte** oben für das ganze Konto; **🧒 Kindermodus** als eigene Oberfläche ohne
  Erwachsenen-Navigation und Karte.
- Die Karte erscheint nur im Reiseplan – umschaltbar *Liste / Geteilt / Karte*, je Gerät gemerkt.
- Prüfungen: leere Preise sind **„Preis offen“** (eine 0 ist kostenlos) und Summen weisen darauf hin;
  **mögliche Dubletten** und **Buchungskonflikte** (zeitgleich gebucht, beide Alternativen gebucht)
  werden angezeigt, aber nie automatisch zusammengeführt; Puffer zeigen ihren Rechenweg und
  kennzeichnen Annahmen (z. B. fehlendes „Alle an Bord“).

**Planen**
- Reisearten: Kreuzfahrt (Häfen mit Ankunft, Abfahrt, „Alle an Bord“, Seetage), Hotel-/Strandurlaub
  und Rundreise (Tage an Land; Startpunkt der Ausflüge ist das gebuchte Hotel).
- Seetage: Aktivitäten an Bord (Spa, Friseur, Show, Kurse …) mit Kosten wie Ausflüge.
- Fehlen Kartenpunkte (z. B. nach einem Import), sucht die App die Häfen beim Öffnen selbst.
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

**Für jede Art von Reise**
- Reisearten: Kreuzfahrt, Hotel-/Strandurlaub, Rundreise, Städtereise, Roadtrip/Wohnmobil, Ferienwohnung,
  Camping, Skiurlaub, Tagesausflug – mit passenden Packlisten, Tieren für die Kinder und Texten.
- **Feste Zeiten** je Tag statt nur „Alle an Bord“: Check-out, eigene Zeiten (z. B. Abholung) und Abfahrten
  von Verbindungen (minus Vorlauf, z. B. 2 Std. beim Flug). Die früheste gilt – für Wecker, Rückweg-Prüfung,
  Puffer der Ausflüge und KI-Check.
- **Anreise & Verbindungen**: Flug, Zug, Fähre, Bus, Mietwagen, Transfer mit Buchungsnummer, Terminal, Sitz,
  Gepäck, Preis und Mitreisenden; im Tagesbriefing und als Kalendertermine mit Erinnerung.
- **Etappen** (Roadtrip, Rundreise, Tagesausflug): Strecken ab „Zuhause“ mit Kilometern und Fahrzeit,
  Spritkostenrechner. **Reservierungen** (Restaurant, Tickets) mit Uhrzeit und Erinnerung, Öffnungszeiten.
- **Zimmer & Kabinen**: Nummer, Deck/Etage, Kategorie, Preis und wer wo schläft – im Briefing, bei den Kindern;
  Zimmerpreise werden den Bewohnern zugerechnet.
- **Infos vor Ort** (nur für Mitreisende, nie in Freigaben oder an die KI): Check-in/-out, Adresse, Telefon,
  WLAN und Passwort, Schlüsselbox/Code, Hausregeln.
- **Mehrere Familien**: Personen je Familie, Kosten je Familie (gemeinsame Kosten nach Köpfen oder je
  Familie), Abrechnung zwischen Familien, Packliste/Dokumente je Familie, Abstimmungen je Familie.
  Rolle *Familien-Planer/in*: lädt die Personen der eigenen Familie ein (nur als Mitreisende).

**Vorbereitung**
- **Packliste** für alle gemeinsam (abhaken, je Person filtern) mit Vorlagen: Grundausstattung,
  Sonne & Strand, Kreuzfahrt, Tauchen, Kinder – passende Vorlagen sind markiert.
- **Dokumente & Fristen**: Pässe (Warnung, wenn sie vor oder weniger als 6 Monate nach Reiseende
  ablaufen), ESTA/eTA, Impfungen, Versicherung, Online-Check-in – mit Datei (PDF/Foto, nur für
  Mitreisende) und Frist; Fristen auch als Kalendertermine.

**Unterwegs**
- **Tagesbriefing**: Ablauf, Wetter, spätestens zurück am Schiff, was mitnehmen, was zu erledigen ist;
  mit KI zusätzlich aktuelle Tipps zum Ort (Websuche). Einmal erstellt, sehen es alle Mitreisenden.
- **Alle-an-Bord-Wecker**: Kalenderdatei (`.ics`) mit Erinnerungen vor „Alle an Bord“ und vor gebuchten
  Ausflügen – klingelt auch offline auf See und bei geschlossener App. Zusätzlich Hinweise in der App.
- **Rückweg prüfen**: Standort (GPS) → Weg zum Schiff → „spätestens um … losfahren“ (mit Reserve,
  ohne Netz als Schätzung über die Luftlinie).
- **Tickets & Treffpunkte** des Tages: Buchungsnummern, Treffpunkt mit Wegbeschreibung, Sitz/Terminal.
- Unter **Kosten**: **Bordkonto/Urlaubskasse** mit Budget (je Tag, je Kategorie) und **Kosten teilen** –
  wer hat bezahlt, für wen, wer schuldet wem (Kinder zahlen nicht mit, Dollar werden umgerechnet).
  Reisekosten zeigen *gebucht / bezahlt / noch offen*; Ausgaben lassen sich mit einer Buchung
  verknüpfen und zählen dann als bezahlt statt doppelt.
- **Abstimmen** an jedem Ausflug: 👍/👎 je Person, Sortierung „Beliebteste“.
- **KI-Ausflug-Check** („✨ Rechtzeitig zurück?“): Claude liest die Angebotsseite, prüft Dauer, Treffpunkt
  und Rückweg gegen „Alle an Bord“ und meldet 🟢/🟡/🔴 mit Risiken und Quellen.
- **🧒 Kinder-Bereich** (je Kind auswählbar, alles ohne Internet nutzbar):
  - *Heute*: großer Countdown, Vorfreude-Kalender mit 24 Türchen vor der Reise, heutiger Ort mit Flagge,
    Programm des Kindes, feste Zeit, eigene Kabine/Zimmer, „Wo sind wir?“-Karte mit Schiff und Entfernung.
  - *Pass & Abzeichen*: Reisepass mit Stempel je besuchtem Ort (druckbar), Abzeichen – automatisch
    (Orte, Länder, Seetag, Tiere, Schatzsuche, Quiz, Tagebuch) oder von den Eltern verliehen.
  - *Entdecken*: Insel-/Länder-Steckbrief (Flagge, Hauptstadt, Sprache, Hallo/Danke, Geld, Essen, Fakt)
    und Wörterbuch mit Lautschrift und Vorlesen.
  - *Spiele*: Quiz zum Tag, Schatzsuche je Hafen mit Foto-Beweis, Tiere-Bingo mit eigenen Fotos,
    Spiele für Wartezeiten (Ich sehe was, Flaggen raten, Wer findet zuerst, Pantomime, Rätsel, Witze).
  - *Tagebuch*: Stimmung, „Das Beste heute war …“ und ein Bild zum Malen mit dem Finger.
  - *Meine Sachen*: Packliste mit Bildern zum Selbst-Abhaken, Sparschwein fürs Taschengeld.
  - *Für Eltern*: Sicherheitskarte (Drucken oder als Sperrbildschirm-Bild), Kids-Club-Gruppe und
    Armband-Nr., Kinderprogramm mit Erinnerung zum Abholen, Abzeichen verleihen.
  - Im Reisebuch erscheint ein Kinder-Kapitel (Stempel, Abzeichen, Tagebuch mit Bildern).
  - Kinder-Bilder und -Fotos bleiben privat (nicht im Fotoalbum, nicht im öffentlichen Tagebuch).

**Erlebnisse**
- **Bewertungen** für Ausflüge und Unterkünfte: Sterne, Überschrift, Kommentar, Fotos (werden im
  Browser verkleinert – spart Datenvolumen an Bord).
- **Tauchlog**: Tauchplatz, Basis, Einstieg, Tiefe max./Ø, Tauchzeit, Wasser-/Lufttemperatur, Sicht,
  Strömung, Anzug, Blei, Flasche, Gas/Nitrox, Druck, Buddy, Guide, Sichtungen, Fotos, Kartenpunkt.
  „Mein Logbuch“ zählt fortlaufend über alle Reisen (Startnummer im Konto einstellbar) – mit Statistik
  (tiefster, längster, Gesamtzeit, Wassertemperaturen, Tauchplätze) und Artenliste. Sichtungen per Antippen.
- **Import vom Tauchcomputer**: UDDF, Subsurface-Logbuch (.ssrf/.xml) oder CSV (z. B. Shearwater Cloud,
  Suunto, Garmin über Subsurface) – mit Vorschau, doppelte Tauchgänge werden erkannt.
- **Fotoalbum**: viele Fotos auf einmal; Aufnahmezeit und Ort (EXIF) ordnen sie automatisch dem Tag und
  Ausflug zu. Neue Fotos sind 🔒, mit 🌍 erscheinen sie im Reisetagebuch. Die Fotos werden im Browser neu
  gespeichert – GPS-Daten im Bild gehen nicht mit hinaus.
- **Reisebuch & Jahresrückblick**: druckfertig (→ „Als PDF speichern“) mit Routenkarte, Tagen, Fotos,
  Bewertungen und Tauchgängen – als Vorlage fürs Fotobuch.
- **„Heute vor … Jahren“**: Erinnerung an frühere Reisetage mit Fotos.

**Weltkarte & öffentliches Reisetagebuch**
- „🌍 Weltkarte“ (oben, für das ganze Konto): rote Stecknadeln für alle Orte, an denen ihr wart (vergangene Reisetage aus allen
  Reisen plus von Hand nachgetragene frühere Urlaube), Liste nach Ländern/Inseln – ein Klick und die Karte
  fliegt hin. Auch beim Planen und unter „Route & Häfen“ fliegt die Karte zum gewählten Ort.
- **Vorschau vor dem Teilen** (Reise verwalten → Reise & Freigabe): zeigt genau, was im öffentlichen
  Tagebuch erscheinen würde – nur für Planer/innen sichtbar.
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
  Übernehmen mit neuen Einträgen, ergänzten Feldern und Posten ohne Preis; ähnliche Einträge werden
  gegenübergestellt (aktualisieren / zusätzlich anlegen / überspringen) – nie still zusammengeführt.
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
  Freigaben; Tauchgänge teilen nur Taucher/in oder Planer/innen. Jedes Foto lässt sich einzeln
  auf 🔒 (nur Mitreisende) oder 🌍 (teilbar) stellen – neue Fotos sind erst einmal privat.
  Bewertungen und Tauchgänge haben einen teilbaren Kommentar und eine private Notiz.
- Namen sieht man nur von Mitreisenden der eigenen Reise. Passwortwechsel meldet alle anderen
  Geräte ab, Abmelden löscht die lokalen Kopien auf dem Gerät.
- Dateien zu Dokumenten nur als PDF/JPEG/PNG mit passendem Inhalt, nur für Mitglieder, ausgeliefert
  in einer Sandbox (`content-security-policy: sandbox`, `nosniff`).
- Allgemeine Einladungslinks gelten 14 Tage und für höchstens 10 Beitritte, persönliche nur einmal.
