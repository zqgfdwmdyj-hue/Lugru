# Video-Worker „unter-der-decke“ (B36)

Der Worker macht aus einem Thema ein fertiges YouTube-Video (Länge je Kanal, Standard 16–20 Min., 1920×1080) mit Untertiteln, Thumbnail,
5 Titeln, Beschreibung mit Kapiteln und Tags. Er läuft **auf dem Arbeits-PC**, nicht auf dem Seller-Server.

- Er **holt sich die Aufträge selbst** beim Seller-System ab (alle ~30 s, mit Token). Keine offenen Ports am PC,
  keine Weiterleitung am Router.
- Claude, ElevenLabs und OpenAI ruft er **über das Seller-System** auf. Die Schlüssel bleiben dort (Anbindungen),
  und die Kosten werden dort je Video gezählt. Auf dem PC liegt nur das Worker-Token.
- Der Upload auf YouTube ist **immer privat**. Öffentlich stellst du das Video selbst in YouTube Studio.
- Ein Abbruch (PC aus, Container gestoppt) schadet nicht: Beim Neustart macht er an derselben Stelle weiter.
  Bereits bezahlte Sprache und Bilder werden nicht neu erzeugt (`state.json` im Projektordner).

## Schritte

| Schritt | Was passiert | Kosten |
|---|---|---|
| research | Erst die Gliederung (kleine Websuche), dann je Punkt ein Aufruf für die Quellen | Claude + Websuche |
| script | Skript abschnittsweise: Hook, Fear Activation, jeder Punkt (5–7) einzeln, Zusammenfassung, CTA – je Abschnitt ein kurzer Aufruf; zusammen fest 1.500–1.700 Wörter (≈ 10–12 Min.), JSON je Szene; Endprüfung (Wörter, 5–7 Punkte, jede Studie in der Quellenliste) mit Nachbesserung nur der betroffenen Abschnitte | Claude |
| voice | Sprache je Szene (ElevenLabs) | ElevenLabs |
| visuals | Vollbild: Symbolbild je Szene (gpt-image-1, 1536×1024). Whiteboard: 3–5 Einzelmotive je Szene (1024×1024, transparent, Bibliothek) + Szenen-Übersicht; bei Ablehnung Ersatzmotiv | OpenAI |
| render | ffmpeg + Pillow: Vollbild mit eingebrannten Untertiteln; Whiteboard mit Aufdeck-Animation, Hand und blassem Vorgänger, ohne eingebrannte Untertitel; optional Musik | – |
| package | Thumbnail 1280×720 (max. 4 Wörter), 5 Titel, Beschreibung mit Kapiteln + Quellen, Tags; Dateien ins Seller-System | Claude |
| upload | YouTube, **privat** (nur mit Schalter „Privat hochladen“ und freigegebener Vorschau) | – |

Die Zielgruppe steht im Kanalprofil (Seller-System) und fließt in jeden Prompt; die Skriptlänge ist für alle Kanäle fest
(1.500–1.700 Wörter). Beim Anlegen eines Videos
kann eine **Vorlage** eingefügt werden (z. B. englisches Transkript eines erfolgreichen Videos – Claude übernimmt nur
Aufbau, Hook und Spannungsbogen, schreibt eigenen Text und belegt alles neu) oder ein **eigenes Skript** (wird
möglichst wörtlich übernommen und in Szenen geteilt; es wird nie verlängert, nur über 1.700 Wörter auf 1.500–1.700 gekürzt).

Freigaben (je Kanal einstellbar) gibt es nach research (Gliederung + Quellen), script (Skript) und package
(Vorschau-Video + Thumbnail + Titel). Weiter geht es erst nach der Freigabe auf der Seite **Video**.

## Robustheit: Abschnitte, Wiederaufnahme, Wiederholung

- Fertige Abschnitte von Recherche und Skript liegen sofort im Projektordner (`recherche/…`, `skript/…`). Bricht ein
  Lauf ab, holt „Schritt wiederholen“ nur die fehlenden Abschnitte. „Skript neu schreiben“ / „Neu recherchieren“
  beginnt dagegen neu.
- Jeder Aufruf an Claude, ElevenLabs und OpenAI wird gestreamt und hat ein Zeitlimit (`KI_TIMEOUT_S`, Standard 120 s;
  Claude mit Websuche doppelt so lang, Bilder 180 s).
- Verbindungsabbruch, Zeitüberschreitung, 429 und 5xx werden bis zu 4-mal wiederholt (Wartezeit 2, 4, 8, 16 s). Erst
  danach meldet der Worker den Schritt als Fehler – mit dem Namen des Abschnitts, z. B. „Skript – Punkt 3: nach 5
  Versuchen nicht geklappt (…)“. Andere Fehler (falsche Anfrage, abgelehnt) werden nicht wiederholt.

## Stil „Whiteboard-Collage“ (B36.9)

Im Kanalprofil (Seller-System → Video) „Stil der Bilder: Whiteboard-Collage“ wählen. Dann gilt:
- **Motive einzeln:** je Szene 3–5 Cartoon-Motive (gpt-image-1, 1024×1024, transparenter Hintergrund). Sind im
  Kanalprofil **Stil-Referenzbilder** hinterlegt (bis 4, z. B. Bildschirmfotos aus dem Kanal), bekommt das Bildmodell
  sie bei jedem neuen Motiv als Vorlage mit. Die Pipeline ordnet die Motive nach festen Vorlagen an: 3er, 4er, 5er,
  Figur links + Liste, Gegenüberstellung.
- **Bibliothek:** jedes Motiv liegt danach im Kanalordner unter `motive/` (mit `index.json`) und wird in späteren
  Szenen und Videos wiederverwendet, ohne neu zu kosten. Wiederkehrende Figuren stehen im Kanalprofil („kurzname:
  Beschreibung“) und werden einmal gezeichnet. Die Hand mit Stift wird einmal je Kanal erzeugt.
- **Texte setzt die Pipeline selbst** in der Schrift Anton (`schriften/`, mit Umlauten): Überschrift schwarz,
  Aussagesatz im roten Balken, Kernaussage rot, „Schritt N: …“ im schwarzen Kasten, Stichpunkte mit orangem Punkt.
  Das Bildmodell zeichnet nie Schrift.
- **Animation:** Elemente werden nacheinander von links nach rechts „aufgezeichnet“, die Hand folgt der Kante. Die
  vorige Szene bleibt mit 15 % als blasser Hintergrund stehen.
- **Untertitel** werden nicht eingebrannt, sondern beim privaten Upload als YouTube-Untertitel („Deutsch“)
  mitgeschickt. Dafür braucht der YouTube-Zugang das Recht „Untertitel“ (bei bestehender Verbindung einmal neu
  verbinden).
- **Freigabe Szenen-Übersicht** (im Kanal einschaltbar): vor dem Render alle Szenen als Raster auf der Seite Video.
  Einzelne Motive antippen → „Ausgewählte Motive neu erzeugen“. Nur die kosten erneut.

## Einrichten unter Windows

### 1. Token anlegen

Seller-System → **Marken & Content → Video** → Abschnitt „Worker“ → „Worker anlegen“. Das Token (`vw_…`) wird
**nur einmal** angezeigt. Trage es nur am PC ein und schick es nie per Chat oder Mail.

### 2a. Mit Docker Desktop (empfohlen)

1. Docker Desktop installieren (docker.com → Docker Desktop for Windows) und starten.
2. Diesen Ordner `unter-der-decke` auf den PC kopieren, z. B. nach `C:\video\unter-der-decke`.
3. Daneben eine Datei `C:\video\worker.env` anlegen (mit dem Editor):
   ```
   SELLER_URL=https://deine-seller-adresse
   WORKER_TOKEN=vw_…
   ```
4. In PowerShell:
   ```powershell
   cd C:\video\unter-der-decke
   docker build -t video-worker .
   docker run -d --name video-worker --restart unless-stopped --env-file ..\worker.env `
     -v C:\video\arbeit:/arbeit -v C:\video\musik:/musik --cpus 2 --memory 3g video-worker
   ```
   `--restart unless-stopped` startet den Worker nach einem Neustart des PCs von selbst wieder, sobald Docker Desktop
   läuft (Docker Desktop → Settings → „Start Docker Desktop when you sign in“).
5. Protokoll ansehen: `docker logs -f video-worker`. Stoppen: `docker stop video-worker`. Danach läuft er mit
   `docker start video-worker` an derselben Stelle weiter.

### 2b. Ohne Docker (Python direkt)

1. Python 3.12 installieren (python.org, Haken bei „Add python.exe to PATH“).
2. ffmpeg installieren: PowerShell `winget install Gyan.FFmpeg`, danach ein neues Fenster öffnen und
   `ffmpeg -version` prüfen.
3. Im Ordner `unter-der-decke`:
   ```powershell
   py -3.12 -m venv .venv
   .venv\Scripts\pip install -r requirements.txt
   $env:SELLER_URL="https://deine-seller-adresse"; $env:WORKER_TOKEN="vw_…"
   .venv\Scripts\python worker.py
   ```
4. Autostart: Aufgabenplanung → „Einfache Aufgabe erstellen“ → Trigger „Beim Anmelden“ → Programm
   `C:\video\unter-der-decke\.venv\Scripts\pythonw.exe`, Argument `worker.py`, „Starten in“ = der Ordner.
   Die beiden Variablen dauerhaft setzen: Systemsteuerung → „Umgebungsvariablen für dieses Konto bearbeiten“.

## Aktualisieren (neue Version)

Welche Version läuft, steht auf der Seite **Video** unter „Worker“ (z. B. `v1.1.0`). Ist der Worker älter als das
Seller-System erwartet, zeigt die Seite oben „Der Worker am PC ist veraltet“.

**Mit Docker Desktop** (Ordner wurde nach `C:\video\unter-der-decke` kopiert):

1. Neuen Stand holen: GitHub → Repository → **Code → Download ZIP**, entpacken und den Ordner `unter-der-decke`
   über `C:\video\unter-der-decke` kopieren (alles ersetzen). `worker.env`, `arbeit` und `musik` liegen daneben und
   bleiben unverändert. Wer `git` nutzt: im Repository-Ordner `git pull`.
2. In PowerShell neu bauen und den Container ersetzen:
   ```powershell
   cd C:\video\unter-der-decke
   docker stop video-worker; docker rm video-worker
   docker build -t video-worker .
   docker run -d --name video-worker --restart unless-stopped --env-file ..\worker.env `
     -v C:\video\arbeit:/arbeit -v C:\video\musik:/musik --cpus 2 --memory 3g video-worker
   ```
3. Prüfen: `docker logs -f video-worker` – oben steht die Version; auf der Seite Video erscheint sie nach ~30 s.

**Ohne Docker:** Ordner wie oben ersetzen, dann `.venv\Scripts\pip install -r requirements.txt` und den Worker neu
starten (Aufgabenplanung: Aufgabe beenden und erneut ausführen).

Halb fertige Aufträge laufen danach mit „Schritt wiederholen“ auf der Seite Video weiter.

## Einstellungen (Umgebungsvariablen)

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `SELLER_URL` | Adresse des Seller-Systems | – (Pflicht) |
| `WORKER_TOKEN` | Worker-Token `vw_…` | – (Pflicht) |
| `ARBEITSORDNER` | Projektordner (Zwischendateien) | `./arbeit` |
| `MUSIKORDNER` | Hintergrundmusik (MP3) | `./musik` |
| `VIDEO_POLL_S` | Abfrage-Takt in Sekunden | `30` |
| `MIN_FREI_GB` / `WARN_FREI_GB` | unter 3 GB frei kein Lauf, unter 5 GB Warnung | `3` / `5` |
| `VIDEO_FPS` | Bilder je Sekunde im Video | `25` |
| `KI_TIMEOUT_S` | Zeitlimit je Aufruf an Claude/ElevenLabs (Sekunden); mit Websuche doppelt, Bilder mind. 180 | `120` |
| `CLAUDE_MODELL` | Claude-Modell nur zum Übersteuern (sonst gilt die Wahl auf der Seite Video, Standard Opus 5.5) | leer |
| `AUFBEWAHREN_TAGE` | Projekte spätestens nach … Tagen löschen | `14` |
| `FFMPEG` / `FFPROBE` | Pfad, falls nicht im PATH | `ffmpeg` / `ffprobe` |

## Ablage der fertigen Videos

Auf der Seite Video unter „Modell und Ablage“ wählst du die Ablage:
- **Google Drive** (empfohlen): Der Worker lädt MP4, Thumbnail, Skript, Quellen und Untertitel direkt in deinen
  Drive-Ordner „Seller-System Videos/<Kanal>/<Datum Thema>“. Der Seller-Server bekommt nur die kleinen Dateien.
  Das Seller-System sieht in Drive nur Dateien, die es selbst angelegt hat (Bereich `drive.file`).
- **Seller-Server**: Alles liegt in der Medienablage des Seller-Systems (ca. 0,5–1 GB je Video).

Für den späteren YouTube-Upload holt sich der Worker das Video bei Bedarf wieder aus Drive.

## Platz und Aufräumen

- Unter 3 GB frei startet kein neuer Lauf. Das Seller-System zeigt den freien Platz und warnt.
- Nach dem Render werden die Zwischenclips gelöscht. Fertiges MP4, Thumbnail, Skript, Quellen und Untertitel werden
  zuerst gesichert (Google Drive bzw. Seller-System).
- Das ganze Projekt wird gelöscht, sobald das Seller-System es freigibt (fertig/abgebrochen), spätestens nach
  14 Tagen.
- Im Kanalordner liegt `kanal.json` mit dem Kanalprofil (nur zum Nachsehen; bearbeitet wird es im Seller-System).

## Später auf einen Server umziehen

Den Container auf einem anderen Rechner mit demselben Token starten (oder ein neues Token anlegen und das alte
deaktivieren). Mehr ist nicht nötig, weil der Worker keine eingehenden Verbindungen braucht.

## Tests

```bash
pip install -r requirements.txt pytest
python -m pytest tests
```
