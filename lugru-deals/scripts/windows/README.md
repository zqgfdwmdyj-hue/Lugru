# lugru-deals unter Windows

Lokale Installation und dauerhafter Betrieb ohne Drittsoftware. Alles läuft
mit Bordmitteln: PowerShell, Scheduled Tasks, optional die Windows-Firewall.

## Überblick

```
┌───────────────────────────────────────────────────────────────────┐
│  Windows-Start / Benutzer-Logon                                   │
│         │                                                         │
│         ▼                                                         │
│  Scheduled Task "LugruDeals"  (Bordmittel: taskschd.msc)          │
│         │                                                         │
│         ▼                                                         │
│  PowerShell → start.ps1  ─── Log-Datei                            │
│         │                                                         │
│         ▼                                                         │
│  lugru-deals.exe  ─── deals.db, charts/                           │
└───────────────────────────────────────────────────────────────────┘
```

Drei Rollen, sauber getrennt:

| Rolle              | Pfad                                        | Wer legt es an |
|--------------------|---------------------------------------------|----------------|
| Anwendung (EXE)    | `%LOCALAPPDATA%\Programs\LuGruDeals\` (anpassbar)          | `install.ps1`  |
| Daten             | `%LOCALAPPDATA%\LuGruDeals\` (anpassbar)    | `install.ps1`  |
| Konfiguration      | Windows-Umgebungsvariablen, User-spezifisch | Du, manuell    |

Die EXE und ihre Daten liegen bewusst getrennt — Updates der EXE fassen die
Daten nicht an, und ein Daten-Backup kann die EXE einfach auslassen.

### Drei Installationswege

Es gibt drei Wege, die du je nach Werkzeugkasten wählst:

1. **Release-ZIP** *(empfohlen, kein Go-Toolchain nötig)*: ZIP aus dem
   GitHub-Release herunterladen, nach `%LOCALAPPDATA%\Programs\LuGruDeals\` entpacken,
   `install.ps1 -StartNow` laufen lassen.

2. **Aus dem Repo** *(wenn du das Repo lokal hast)*:
   `git clone …`, `make windows`, `install.ps1 -StartNow`.

3. **Manuell** *(nur die EXE, ohne Skripte)*: `make windows` (oder Cross-
   Compile) und die EXE direkt starten. Dann fehlen die Vorteile des
   Launchers (Logfile, PID-Datei, Pfad-Validierung beim Stop).

## Schnellstart

### Aus dem Release-ZIP *(empfohlen, kein Go-Toolchain nötig)*

```powershell
# Im Browser: Release-ZIP "LugruDeals-Windows-x64.zip" (bzw. -ARM64.zip) aus
# https://github.com/zqgfdwmdyj-hue/Lugru/releases (Releases "Lugru Deals …")
# herunterladen, in einem beliebigen Ordner entpacken.
# NICHT "Source code (zip)" nehmen — darin fehlt die EXE.
# Die ZIP wirklich entpacken (Rechtsklick → "Alle extrahieren…"); install.cmd
# direkt aus der geöffneten ZIP heraus zu starten funktioniert nicht.

# Option A — CMD-Wrapper fuer Doppelklick-Freunde:
#   Doppelklick auf install.cmd im entpackten Ordner

# Option B — PowerShell, schoener Output:
Expand-Archive .\lugru-deals-windows.zip -DestinationPath "$env:LOCALAPPDATA\Programs\LuGruDeals"
& "$env:LOCALAPPDATA\Programs\LuGruDeals\install.ps1" -StartNow
```

### Update mit einem Befehl

Ist Lugru Deals einmal installiert, holt **`update-github.cmd`** im
Installationsordner (Doppelklick) die neueste Version von GitHub — passend
für x64 oder ARM64 —, sichert die Datenbank, tauscht die EXE und startet neu.
In PowerShell dasselbe:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\LuGruDeals\update-github.ps1"
```

Drei Schritte, kein Go, kein Git, kein `make`. Den Keepa-Key trägst du
danach in den Windows-Umgebungsvariablen ein (siehe unten).

### Aus dem Repo

```powershell
git clone https://github.com/trinkfreunde/lugru-deal-discord.git
cd lugru-deal-discord
make windows   # ergebnis: dist\lugru-deals.exe
.\scripts\windows\install.ps1 -StartNow
```

### Keepa-Key setzen

Windows-Einstellungen → System → Info → Erweiterte Systemeinstellungen →
Umgebungsvariablen → **Benutzer**: Variable `KEEPA_API_KEY` hinzufügen,
Wert aus deinem Keepa-Account. Beim nächsten Start der EXE greift der
Wert (siehe oben: Env-Änderungen greifen erst nach Restart).

## Installation im Detail

### Voraussetzungen

- Windows 10 oder neuer (64-Bit)
- PowerShell 5.1 (auf Windows mitgeliefert) oder neuer — die Skripte
  vermeiden bewusst Sprachelemente, die nur in PowerShell 7 laufen.
- Eine gebaute `lugru-deals.exe` (Schritt 1 oben).
- Ein Konto, das den Scheduled Task anlegen darf. Standardmäßig braucht es
  dafür keinen Administrator.

### `install.ps1`

```powershell
.\scripts\windows\install.ps1 `
    [-InstallDir '%LOCALAPPDATA%\Programs\LuGruDeals'] `
    [-DataDir    "$env:LOCALAPPDATA\LuGruDeals"] `
    [-OpenFirewall]       # nur nötig bei LUGRU_ADRESSE != 127.0.0.1
    [-StartNow]           # führt einen ersten Lauf direkt aus
```

Das Skript

- sucht die EXE im entpackten ZIP oder im Repo-Layout unter `dist\lugru-deals.exe`
- legt den Installationsordner und Datenordner an
- kopiert die EXE und die mitgelieferten Skripte (`start.ps1`, `install.ps1`, `install.cmd`, `uninstall.cmd`, `uninstall.ps1`,
  `stop.ps1`, `update.ps1`) in den Installationsordner
    - registriert einen Scheduled Task, der `start.ps1` aus dem InstallDir bei jedem Logon ausführt
  ausführt
- räumt einen vorhandenen Task gleichen Namens vorher ab (idempotent)
- bei `-StartNow` startet die Anwendung direkt, damit das Logfile
  sofort existiert

Wahl des Triggers:

| Trigger   | Wann läuft die EXE?                          | Env-Variablen  | Berechtigung      | Bemerkung |
|-----------|----------------------------------------------|----------------|-------------------|-----------|
| `AtLogon` | Bei jeder Anmeldung des angemeldeten Users   | **User-Ebene** | normaler Benutzer | Default und der einzige Trigger — `install.ps1` kennt nur diesen. |

### Umgebungsvariablen — bewusst via Windows-Einstellungen

Die EXE liest `LUGRU_ADRESSE`, `LUGRU_DB`, `LUGRU_CHARTS`, `LUGRU_BROWSER`
und `KEEPA_API_KEY` aus der Umgebung des laufenden Prozesses. Der Scheduled Task erbt diese Umgebung vom angemeldeten Benutzer.
Die Skripte setzen nichts eigenes; `start.ps1` ergänzt aus der Registry.

Pflege der Variablen:

- **Dauerhaft (empfohlen)**: Windows-Einstellungen → System → Info →
  Erweiterte Systemeinstellungen → Umgebungsvariablen → Benutzer:
  `KEEPA_API_KEY` (oder `LUGRU_*`) hinzufügen.
- **Aus PowerShell (nur für die aktuelle Sitzung)**:

  ```powershell
  $env:KEEPA_API_KEY = '…'   # gilt nur in dieser Shell
  ```

  Eine in `$env:` gesetzte Variable erreicht *nicht* den bereits laufenden
  Prozess und *nicht* einen Scheduled Task, der davon erbt. Dauerhaft wird
  sie erst nach einem Neustart der PowerShell-Sitzung bzw. des Tasks
  sichtbar.

**Wie `start.ps1` die Variablen lädt**: das Skript prüft jede benannte
Variable (`KEEPA_API_KEY`, `LUGRU_ADRESSE`, `LUGRU_DB`, `LUGRU_CHARTS`,
`LUGRU_BROWSER`) zuerst im aktuellen Prozess-Context. Fehlt sie dort,
wird sie via `[Environment]::GetEnvironmentVariable($Name, 'User')` aus
der persistenten User-Variable der Windows-Registry gelesen und auf den
zu startenden Prozess übertragen. Damit greifen Änderungen in der
Windows-Umgebungsvariablen-Tabelle auch dann, wenn die aufrufende
Shell sie noch nicht neu eingelesen hat. Die Werte werden *nie*
geloggt — nur das Vorhandensein.

**Wichtig bei Änderungen**: das Programm liest die Umgebung einmal beim
Start ein. Eine spätere Änderung in den Windows-Umgebungsvariablen greift
erst, wenn die EXE neu gestartet wird. Aus dem Browser der Oberfläche
gibt es keinen Reload-Knopf — dafür gibt es `stop.ps1` und `start.ps1`:

```powershell
& '%LOCALAPPDATA%\Programs\LuGruDeals\stop.ps1'
& '%LOCALAPPDATA%\Programs\LuGruDeals\start.ps1'
```

### LUGRU_DB und LUGRU_CHARTS vs. PowerShell-DataDir

Die EXE selbst kennt zwei getrennte Schalter für die Datenhaltung:

| Variable / Flag | Zweck |
|-----------------|-------|
| `LUGRU_DB` / `-db <datei>` | Pfad zur SQLite-Datei `deals.db` |
| `LUGRU_CHARTS` / `-charts <ordner>` | Ordner für Chart-Bilder |

Das Install-Skript setzt diese beiden Flags aus dem `-DataDir`-Parameter
zusammen — `DataDir\deals.db` und `DataDir\charts`. Das ist eine reine
Konvention des Installers; die EXE kennt kein "DataDir"-Konzept.
Wer die EXE direkt aufruft und einen anderen `-db`-Pfad übergibt,
ignoriert die Installer-Konvention. In der Praxis heißt das: einmal mit
dem Installer installieren, danach nicht mehr an den Flags drehen.

### Erster Start prüfen

```powershell
# Direkt aus dem InstallDir, ohne Scheduled Task — Vordergrund, mit Ausgabe
& '%LOCALAPPDATA%\Programs\LuGruDeals\start.ps1' -Wait
```

Erwartete Ausgabe:

```
Lugru Deals läuft auf http://127.0.0.1:8080
```

Beendet wird mit **STRG+C** im Fenster — die EXE bekommt dann `CTRL_C_EVENT` und
läuft ihre shutdown-Reihenfolge (Datenbank schließen, WAL gecheckt).
Das funktioniert nur im Vordergrund-Modus, weil dort ein Konsolenfenster
existiert.

Im Scheduled-Task-Modus (`WindowStyle=Hidden`) hat die EXE kein
Konsolenfenster; ein CTRL_C_EVENT scheidet damit aus. `stop.ps1` nutzt
`Stop-Process`, das unter Windows immer `TerminateProcess` aufruft —
die EXE wird also *immer* hart beendet, unabhängig von `-Force`. SQLite
repariert beim nächsten Start. Ein HTTP-basierter Graceful-Mechanismus
wäre eine Code-Änderung und bleibt außerhalb dieses Doku-Pakets.

## Update

```powershell
# Im Repo: neue EXE bauen
make windows

# Dann auf der Maschine, auf der lugru-deals läuft:
.\scripts\windows\update.ps1 -SourceDir 'C:\Pfad\zum\repo\dist'
```

Das Skript

1. stoppt die laufende EXE
2. sichert `deals.db`, `deals.db-wal` und `deals.db-shm` als Dreiergespann
   in einen Zeitstempel-Ordner unter `DataDir\backup\before-update-*`
   (SQLite-WAL-Mode, siehe unten — die Sidecars gehören zur Datenbank dazu)
3. benennt die alte EXE zu `lugru-deals.exe.previous` um
4. kopiert die neue EXE in den InstallDir
5. startet die EXE wieder

Datenordner und InstallDir-Skripte bleiben unangetastet.

## Deinstallation

```powershell
.\scripts\windows\uninstall.ps1
```

Das Skript

1. stoppt die laufende EXE
2. entfernt den Scheduled Task
3. entfernt eine eventuell angelegte Firewall-Ausnahme
4. fragt, ob der Datenordner gelöscht werden soll (Default: behalten)
5. fragt, ob der Installationsordner gelöscht werden soll (Default: behalten)

`uninstall.ps1 -RemoveData -Yes` löscht ohne Rückfragen.

Nach der Deinstallation bleibt nur die benutzerspezifische Variable
`KEEPA_API_KEY` (und ggf. `LUGRU_*`) — diese in den Windows-Umgebungsvariablen
von Hand entfernen.

## Wie Start und Stop funktionieren

### Start

`start.ps1` läuft in zwei Modi:

- **Vordergrund (`-Wait`, manueller Aufruf):** die EXE bekommt ein
  sichtbares Konsolenfenster; du siehst Meldungen direkt und beendest mit
  `STRG+C`. SQLite WAL wird sauber gecheckt.
- **Hintergrund (Default, Scheduled Task):** `WindowStyle Hidden`, keine
  Konsole, stdout/stderr wandern in
  `%LOCALAPPDATA%\LuGruDeals\logs\lugru-deals-<timestamp>.log{,.err}`.
  Eine PID-Datei (`lugru.pid`) hält die Prozess-ID für den späteren Stop
  fest.

Beide Modi erben die Umgebung des aufrufenden Prozesses.

### Stop

`stop.ps1` ruft `Stop-Process` auf. Unter Windows bedeutet das immer
einen `TerminateProcess`-Aufruf; ein echter "graceful"-Mechanismus über
die EXE wird in diesem Doku-Paket nicht implementiert (Code wäre nötig,
wäre aber außerhalb des Scope — siehe PR-Body).

Vor jedem Kill prüft das Skript:

1. **PID aus `lugru.pid`** — aber nur, wenn der *tatsächlich laufende*
   Prozess unter dieser PID auch wirklich unter dem erwarteten Pfad
   (`$InstallDir\lugru-deals.exe`) gestartet wurde. Eine PID allein
   reicht nicht; Windows recycelt sie. Stimmt der Pfad nicht → Warnung
   + Skip.
2. **Name-Fallback**: `Get-Process -Name lugru-deals`, ebenfalls mit
   Pfad-Validierung. Fremde Prozesse mit gleichem Namen werden gemeldet
   und *nicht* beendet.

Dadurch killt das Skript niemals einen fremden Prozess, der zufällig
`lugru-deals` heißt. Was im Terminate-Fall mit `deals.db` passiert,
erklärt der nächste Abschnitt.

## Was zu SQLite WAL gesagt werden muss

`internal/store/store.go:22` setzt `PRAGMA journal_mode = WAL` beim Start.
Das ist genau der Modus, der Crash- und Kill-Resilienz bringt:

| Szenario                          | Verhalten der Datenbank                          |
|-----------------------------------|--------------------------------------------------|
| `STRG+C` im Vordergrund-Modus     | Sauber: WAL wird gecheckt, keine Reste.          |
| `Stop-Process` ohne `-Force`, EXE mit Konsole | Sauber: gleicher Pfad wie STRG+C. |
| `Stop-Process` ohne `-Force`, EXE ohne Konsole | Wie `Stop-Process -Force`: harter Kill. |
| `Stop-Process -Force` / `taskkill /F` | Harter Kill. SQLite repariert beim nächsten Start. |
| Stromausfall                     | Wie Force-Kill. SQLite repariert beim nächsten Start. |

Die Reparatur beim nächsten Start umfasst:

- alle committeten Schreibvorgänge werden aus dem WAL in die Hauptdatenbank
  übernommen
- unvollständige Schreibvorgänge werden verworfen
- die Begleitdateien `deals.db-shm` und `deals.db-wal` werden geräumt

Es geht **keine jemals committete Zeile verloren** und die Datenbank ist
nach dem Neustart in einem konsistenten Zustand. Das ist die exakte
Eigenschaft, für die WAL entwickelt wurde.

**Wichtig zum Backup**: ein Backup von `deals.db` ohne die
beiden Sidecars `deals.db-wal` und `deals.db-shm` ist im
WAL-Mode unvollständig. Beim Restore fehlen sonst committete
Schreibvorgänge, die noch nicht in die Hauptdatei zurückgeschrieben
waren. Die drei Dateien gehören zusammen — Kopie und Backup immer als
Dreiergespann behandeln. `update.ps1` macht das automatisch in
`DataDir\backup\before-update-*`. SQLite selbst räumt liegengebliebene
Sidecars beim nächsten Start auf, ein manuelles Eingreifen ist weder
nötig noch sinnvoll.

## Fehlersuche

**„Adresse wird bereits verwendet" (address already in use).**
Ein anderes Programm lauscht schon auf Port 8080. Entweder beenden oder die
Variable `LUGRU_ADRESSE` auf einen freien Port setzen, z. B.
`127.0.0.1:8090`.

**Browser öffnet sich nicht.**
Im Scheduled-Task-Modus ist `LUGRU_BROWSER=0` per Default gesetzt (im
Launcher hartkodiert). Doppelklick auf `start.ps1` öffnet den Browser nicht —
direkt die EXE aus PowerShell starten, dann öffnet `oeffneBrowser()` aus
`cmd/lugru-deals/main.go` den Standardbrowser via
`rundll32 url.dll,FileProtocolHandler`.

**Datenbank nicht schreibbar unter `C:\Program Files\…`.**
Diesen Pfad als InstallDir vermeiden. Daten via `-DataDir` (oder Env
`LUGRU_DB`, `LUGRU_CHARTS`) auslagern.

**Scheduled Task startet nicht.**
Mit `Get-ScheduledTaskInfo -TaskName LugruDeals` und `Get-ScheduledTask`
prüfen, ob der Task überhaupt registriert ist und wann er zuletzt gelaufen
ist. Im Aufgabenplaner (`taskschd.msc`) das Resultat der letzten Ausführung
ansehen.

**EXE bleibt nach `stop.ps1` hängen.**
Mit `Stop-Process -Name lugru-deals -Force` nachhelfen. WAL repariert sich
beim nächsten Start.

**`KEEPA_API_KEY` wirkt nicht.**
Variable ist gesetzt, aber `start.ps1` wurde noch nicht neu gestartet. Im
laufenden Prozess wird der Key nicht neu gelesen — neuen Lauf erzwingen:

```powershell
& '%LOCALAPPDATA%\Programs\LuGruDeals\stop.ps1'
& '%LOCALAPPDATA%\Programs\LuGruDeals\start.ps1'
```

**Windows-Defender SmartScreen meldet „Windows hat Ihren Computer geschützt".**
Die EXE ist nicht signiert. Klick auf **Weitere Informationen** →
**Trotzdem ausführen**. Für dauerhafte Lösung siehe den Abschnitt zur
Signatur weiter unten.

## Code-Signatur (optional, Roadmap)

`lugru-deals.exe` ist derzeit nicht signiert. Windows Defender SmartScreen
verlangt beim ersten Start je nach Reputation der EXE den „Trotzdem
ausführen"-Klick. Dauerhaft abstellen lässt sich das nur durch eine
Code-Signatur (Authenticode-Zertifikat,OV oder EV) — beides ist kommerziell
und jährlich kostenpflichtig. Diese Anleitung geht davon aus, dass SmartScreen
akzeptiert wird; eine kostenfreie Alternative gibt es auf Windows nicht.

## Release-Artefakte (Vorschlag)

Damit Endnutzer nicht selbst `make windows` aufrufen müssen, lässt sich das
Binary in einer GitHub-Release-Anlage bauen und mit den Skripten bündeln:

```yaml
# .github/workflows/release.yml — Vorschlag, nicht Teil dieses Pakets
name: Release
on:
  push:
    tags: ['v*']
jobs:
  bauen:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.25'
      - shell: pwsh
        run: make windows
      - uses: actions/upload-artifact@v4
        with:
          name: lugru-deals-windows
          path: |
            dist/lugru-deals.exe
            scripts/windows/*.ps1
            scripts/windows/README.md
```

Der Nutzer lädt dann das ZIP-Archiv aus dem Release, entpackt es nach
`%LOCALAPPDATA%\Programs\LuGruDeals\`, und führt `.\install.ps1 -StartNow` aus. Repo und
Go-Toolchain auf der Zielmaschine sind nicht nötig.
