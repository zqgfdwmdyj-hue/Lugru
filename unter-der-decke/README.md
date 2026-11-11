# Video-Worker „unter-der-decke“ (B36)

Der Worker macht aus einem Thema ein fertiges YouTube-Video (10–12 Min., 1920×1080) mit Untertiteln, Thumbnail,
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
| research | Websuche, Gliederung + Quellen | Claude + Websuche |
| script | Skript (Hook → Fear Activation → 5–7 Punkte mit Studie → Zusammenfassung → CTA), 1.500–1.700 Wörter, JSON je Szene | Claude |
| voice | Sprache je Szene (ElevenLabs) | ElevenLabs |
| visuals | Symbolbild je Szene (OpenAI gpt-image-1, 1536×1024, medium); bei Ablehnung Ersatzbild | OpenAI |
| render | ffmpeg + Pillow: Clips mit eingebrannten Untertiteln, optional Musik | – |
| package | Thumbnail 1280×720 (max. 4 Wörter), 5 Titel, Beschreibung mit Kapiteln + Quellen, Tags; Dateien ins Seller-System | Claude |
| upload | YouTube, **privat** (nur mit Schalter „Privat hochladen“ und freigegebener Vorschau) | – |

Freigaben (je Kanal einstellbar) gibt es nach research (Gliederung + Quellen), script (Skript) und package
(Vorschau-Video + Thumbnail + Titel). Weiter geht es erst nach der Freigabe auf der Seite **Video**.

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
| `CLAUDE_MODELL` | Claude-Modell | `claude-sonnet-5-5` |
| `AUFBEWAHREN_TAGE` | Projekte spätestens nach … Tagen löschen | `14` |
| `FFMPEG` / `FFPROBE` | Pfad, falls nicht im PATH | `ffmpeg` / `ffprobe` |

## Platz und Aufräumen

- Unter 3 GB frei startet kein neuer Lauf. Das Seller-System zeigt den freien Platz und warnt.
- Nach dem Render werden die Zwischenclips gelöscht. Fertiges MP4, Thumbnail, Skript, Quellen und Untertitel gehen
  zuerst ins Seller-System.
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
