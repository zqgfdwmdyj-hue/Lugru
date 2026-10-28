# Abnahme: Server-Absicherung, Adressen, Formulare, Sendungen, Rechte, Fragefeld

Stand 28.10.2026. Zwei Teile:

- **A** – was automatisch getestet wurde, mit Ergebnis.
- **B** – Schritte zum Nachprüfen auf dem echten Server.

Alle Tests liefen nur mit **erfundenen Daten**. Die Konten sind Testkonten:

| Konto | Rolle |
|---|---|
| anna | Inhaberin |
| lager | Mitarbeiter, nur Palettenlager |
| pruefer | nur ansehen; Palettenlager + WaWi |

## A. Automatische Tests (129 Prüfungen, alle bestanden)

**Umgebung: wie auf dem Server.**

- Die App lief hinter dem Webserver Caddy mit echtem https:
  - `https://seller.test` (APP_URL, ganzes System);
  - `https://claude.test` (PUBLIC_URL). Hier lässt Caddy nur Anmeldung, Freigabe-Seite, Konnektor und Kunden-Links durch, wie bei `deploy/claude-oeffentlich.sh`.
- Der Browser (Chromium) vertraut der Test-Zertifizierungsstelle von Caddy. Es wurde keine Zertifikatsprüfung abgeschaltet.
- Nachbauten statt echter Dienste:
  - Claude-API: antwortet auf Befehl auch mit Werkzeugen, die **nicht** angeboten wurden;
  - SMTP: nimmt Mails an und schreibt sie in eine Datei;
  - Deutsche Post / DHL.

| # | Bereich | Ergebnis |
|---|---|---|
| 1 | `deploy/absichern.sh` in einer nachgebauten Server-Umgebung (Caddy, Port 3020, .env, docker compose) | 12/12 |
| 2 | Adressen-Check warnt beim Aufruf direkt über den Port | 2/2 |
| 3 | Formulare behalten Eingaben (Lieferschein/Labels, Uploads, Import, Sammelbearbeitung) | 20/20 |
| 3b | Regression Uhren-Deals (gleicher Formular-Baustein) | 24/24 |
| 4 | Sendungs-Ablauf über https | 24/24 |
| 5 | Rechte: Claude-Konnektor + Fragefeld mit 3 Konten | 32/32 |
| 6 | Altes Gespräch fortsetzen (400-Fehler) + Prep-Center-Antwort | 15/15 |
| – | Unit-Tests (`npx vitest run`) | 1246/1246 |

### 1 · Port schließen + APP_URL (`deploy/absichern.sh`)

**Prüfen** (ändert nichts) meldet:

- App-Port auf 0.0.0.0 offen;
- `http://<Server-IP>:3020` antwortet;
- APP_URL ohne https bzw. als interne 100.x-Adresse;
- interne Adresse in der laufenden App;
- lokale Port-Änderung in `docker-compose.yml` (blockiert Updates).

Danach schlägt es den Befehl „anwenden https://…“ vor. Es gibt weder Passwörter noch Schlüssel aus.

**Anwenden**:

- vorher Prüfung, dass `https://<domain>/login` schon antwortet und Caddy auf `127.0.0.1:<Port>` weiterleitet;
- Sicherung der .env;
- `BIND_IP=127.0.0.1`, `APP_URL=https://…`;
- App neu starten.

Danach war:

- Port nur noch auf 127.0.0.1;
- `http://<IP>:3020` antwortet nicht mehr;
- `https://…/login` 200;
- Claude-Metadaten korrekt;
- `/auftraege` unter der Claude-Adresse 404;
- Port-Änderung in docker-compose.yml zurückgesetzt und gesichert.

**Fehlerfälle**:

- Caddy leitet an die öffentliche IP weiter → Abbruch, nichts geändert.
- https antwortet noch nicht → Abbruch.
- https geht nach der Umstellung nicht → **automatische Rücknahme**.
- „zurueck“ stellt den alten Stand her.

### 2 · Adressen-Check

Zu finden unter Einstellungen → „Adressen & Sicherheit“. Er zeigt die Links, die das System baut:

- Meldung;
- Kunden-Link;
- Google- und Microsoft-Weiterleitung;
- Claude-Konnektor.

Mit APP_URL `https://seller.test` und PUBLIC_URL `https://claude.test`:

- alles „in Ordnung“;
- keine interne Adresse in einem Link;
- Anmelde-Cookie mit „Secure“.

Beim Aufruf über `http://localhost:3100` ist der Check aufgeklappt und warnt: „Du rufst das System gerade unter … auf, Links zeigen auf …“.

### 3 · Formulare

Diese Fälle wurden geprüft, jeweils mit dem Ergebnis:

| Fall | Ergebnis |
|---|---|
| Lieferschein-Upload mit Nicht-PDF | Fehler; die Datei und der Haken „gleich erstellen“ bleiben |
| „Offene Aufträge“ | Kanal „alle“ und „vorher abrufen: aus“ bleiben |
| Vorschau: alle Bestellungen auf „bitte prüfen“ | „Keine Sendung ausgewählt“; alle 5 Auswahlfelder bleiben |
| Gewichte mit unklarer Eingabe „abc“ | „abc“ bleibt zum Korrigieren stehen; die gültige Zeile zeigt sofort die gespeicherten Werte |
| Gewichte nach Erfolg | die Zeile „neuer Artikel“ ist leer |
| Import einer unbekannten Datei | Fehler; die Datei bleibt ausgewählt |
| .eml- und Rechnungs-Upload nach Erfolg | die Auswahl ist leer |
| Sammelbearbeitung Rechnungen ohne Treffer | Meldung; die Auswahl bleibt |
| Sammelbearbeitung: Rückfrage abgelehnt | nichts passiert |
| Sammelbearbeitung nach Erfolg | die Auswahl ist leer |

Dabei wurde ein Fehler gefunden und behoben: Bei einer eigenen Erfolgsprüfung leerte sich das Formular schon beim Absenden.

Scanner-Felder (Inbound, Inventur) leeren sich bewusst weiter nach jedem Scan. Die Karton-Auswahl ist gesteuert und bleibt.

### 4 · Sendungs-Ablauf (https)

1. Anlieferung anlegen.
2. Termin mit Grund verschieben → Status „verzögert“, Verlauf „Meldung an alle“.
3. **E-Mail-Meldung**:
   - geht an alle mit Palettenlager-Zugriff (lager, ben, oma), nicht an die Person, die verschoben hat;
   - enthält den Grund und `https://seller.test/paletten/sendungen/<id>`;
   - enthält keine interne Adresse.
4. Mitarbeiter „lager“ sieht den Hinweis mit Grund.
5. **Kunden-Link**:
   - liegt auf `https://claude.test/sendung/…`;
   - der Kunde sieht am Handy ohne Anmeldung Titel, „verzögert“ und den Grund, aber keine Namen und keine internen Einträge;
   - unter der Claude-Adresse ist die interne Seite gesperrt (404).
6. **Abgelaufener Link**: zweiter Link, Ablaufdatum in der Datenbank auf gestern gesetzt (Zeit vorgespult) → „abgelaufen oder zurückgezogen“. Der erste Link geht weiter.
7. **Zurückgezogener Link** → „abgelaufen oder zurückgezogen“. Dateien darüber → 404. Intern sind keine aktiven Links mehr gelistet.

### 5 · Rechte

**Claude-Konnektor (MCP, OAuth):**

- Mitarbeiter „lager“ → „Claude verbinden kann nur der Inhaber“, kein Zugang.
- Inhaberin nur „lesen“:
  - es werden nur lesende Werkzeuge angeboten, keine Privat-Werkzeuge;
  - **direkte Aufrufe** von `sendung_anlegen`, `privat_kalender` und einem unbekannten Werkzeug → „nicht freigegeben“, nichts angelegt.
- „lesen + ändern“ ohne Privat:
  - eine Notiz wird ausgeführt;
  - `privat_termin` → abgewiesen.
- Ungültiges Token → 401. Nach „Trennen“ → 401.

**Fragefeld:**

- **lager**:
  - Angeboten werden nur 10 Werkzeuge (Allgemein + Palettenlager), kein Umsatz, keine Aufträge, kein Privat.
  - Die Test-KI ruft trotzdem `umsatz` auf → abgewiesen.
  - Eine Änderung erscheint als Vorschlag:
    - „Ablehnen“ → nichts geändert;
    - „Ausführen“ → Notiz gespeichert.
- **pruefer** (nur ansehen):
  - Lesen geht, es wird kein einziges Änderungs-Werkzeug angeboten.
  - Ein direkter Änderungs-Aufruf → abgewiesen, ohne Vorschlag.
- **Inhaberin**:
  - alle Geschäftsbereiche, nie Privat;
  - `privat_kalender` direkt → abgewiesen.

**Protokoll** (Einstellungen → Claude): Jeder Fall steht mit Zeit, Person und Weg darin:

- abgewiesene Aufrufe (Claude und Fragefeld);
- abgelehnter Vorschlag;
- ausgeführte Änderungen.

**Übersicht „Wer darf was“** zeigt:

- den Vergleich Konnektor ↔ Fragefeld;
- je Konto die Anzahl Werkzeuge zum Lesen und Ändern, jeweils mit Liste.

### 6 · Altes Gespräch + Prep Center

**Altes Gespräch:**

- Jede Anfrage verlangt `block_binding.prefix_mismatch_behavior = "drop_block"` mit dem Beta-Kopf `thinking-binding-controls-2026-08-01`.
- Ablauf:
  1. Gespräch beginnen.
  2. „Änderungen erlauben“ ausschalten. Dadurch ändert sich die Werkzeugliste, wie nach einem Update.
  3. Das Gespräch in einem neuen Tab aus „Verlauf“ fortsetzen.
- Ergebnis: Der alte Denk-Schritt wird verworfen. Es kommt **kein 400**, die Antwort erscheint.
- Gegenprobe ohne `drop_block`: Der Nachbau antwortet wie die echte API mit 400 „bound to a different conversation“.

**Prep Center:**

- Die Frage löst das Werkzeug `prep_center` mit 3 Monaten aus.
- Mit erfundenen Aufträgen und 2,50 € je Sendung + 0,50 € je weiteres Stück sind die Zahlen exakt:

  | Monat | Sendungen | Stück | Kosten |
  |---|---|---|---|
  | Oktober | 2 | 4 | 6,00 € |
  | September | 1 | 2 | 3,00 € |
  | August | 0 | 0 | 0,00 € |

- Dazu kommt eine feste Erklärung:
  - wie „verschickt von“ entsteht (je Artikel, sonst Standard; ein eigener Artikel → ganzer Auftrag „ich“);
  - die Abrechnung;
  - die Abgrenzung zum Palettenlager.

## B. Nachprüfen auf dem echten Server

Reihenfolge einhalten. Nach jedem Schritt das Erwartete vergleichen.

1. **Prüfen (ändert nichts):** `sudo bash /opt/seller-system/deploy/absichern.sh`

   Erwartet heute:

   - ✘ Port 3020 auf 0.0.0.0;
   - ✘ APP_URL http/intern;
   - ggf. ✘ docker-compose.yml lokal geändert.

   Am Ende steht der Befehl zum Beheben.
2. **Absichern:** `sudo bash /opt/seller-system/deploy/absichern.sh anwenden https://<deine-domain>`

   Erwartet: „Ergebnis: alles in Ordnung“. Geht etwas schief, nimmt das Skript die Änderung selbst zurück. Manuell zurück: `… absichern.sh zurueck`.
3. **Von außen (Handy, mobile Daten, nicht WLAN):**
   - `http://<Server-IP>:3020` lädt **nicht** mehr;
   - `https://<deine-domain>` lädt;
   - Anmeldung geht.

   Danach Lesezeichen und App-Symbol mit `:3020` löschen und die App von der https-Adresse neu zum Startbildschirm hinzufügen.
4. **Hetzner Cloud Console:** eine Firewall nur mit 22, 80, 443 eingehend. Das Skript listet weitere offene Dienste anderer Tools. Prüfen, ob die offen sein sollen.
5. **Einstellungen → „Adressen & Sicherheit“:**
   - „in Ordnung“;
   - alle Beispiel-Links mit `https://<deine-domain>` bzw. der Claude-Adresse;
   - keine 100.x-Adresse.
6. **Sendung (erfundene Daten):**
   1. Palettenlager → Sendungen → Neue Sendung „TEST Abnahme“ anlegen.
   2. Termin verschieben mit Grund „Test“.
   3. Zweites Konto mit Palettenlager-Zugriff: Hinweis sichtbar. Ist die Mail-Meldung eingeschaltet, enthält die Mail einen Link mit `https://<deine-domain>/paletten/sendungen/…`.
   4. „Link für Kunden erstellen“ → Link beginnt mit der Claude-Adresse → im privaten Fenster: nur diese Sendung, keine Namen.
   5. „Zurückziehen“ → der Link zeigt „abgelaufen oder zurückgezogen“.
   6. Abgelaufen live: Link mit 3 Tagen erstellen und nach 3 Tagen öffnen.
   7. Danach die Testsendung auf „angekommen“ setzen.
7. **Rechte live:**
   1. Mitarbeiterkonto mit nur Palettenlager anmelden.
   2. Im Fragefeld „Wie hoch war der Umsatz?“ fragen → keine Umsatzdaten.
   3. „Schreib eine Notiz an Sendung TEST Abnahme: Test“ → Vorschlag → „Ablehnen“ → nichts passiert.
   4. Nochmal → „Ausführen“ → Notiz da.
   5. Als Inhaber unter Einstellungen → Claude → Protokoll: „abgelehnt“ und die ausgeführte Notiz mit Name und „Fragefeld“.
   6. Dort bei „Wer darf was“: Das Mitarbeiterkonto hat „Claude: kann nicht verbinden“.
8. **Altes Gespräch:**
   1. Im Fragefeld „Verlauf“ öffnen.
   2. Ein Gespräch von **vor** dem Update anklicken und eine Frage stellen.

   Erwartet: Antwort, kein „400 … bound to a different conversation“.
9. **Prep Center:** im Fragefeld oder in Claude „Was hat das Prep Center die letzten 3 Monate gekostet?“ fragen.

   Erwartet:
   - je Monat Sendungen, Stück und Kosten (wenn Gebühren unter Einstellungen → Prep Center eingetragen sind);
   - eine Erklärung, wie „verschickt von“ festgelegt wird.

   Stimmt eine Zahl nicht, ist der erste Prüfort Aufträge → Prep Center → „noch nicht zugeordnet“.
