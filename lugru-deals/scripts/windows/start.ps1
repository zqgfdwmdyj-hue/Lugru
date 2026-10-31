# start.ps1 — startet lugru-deals.EXE und leitet Meldungen in eine Logdatei um.
#
# Aufrufarten:
#   .\start.ps1                                  # Vordergrund, mit Konsole
#   .\start.ps1 -Wait                            # wartet bis die EXE endet
#   .\start.ps1 -DataDir 'D:\Daten\LuGruDeals'   # eigenes Datenverzeichnis
#
# Vorgesehen für zwei Einsätze:
#   1) Scheduled Task    — startet ohne -Wait, ohne Fenster, mit Logdatei
#   2) Doppelklick / CLI — startet mit -Wait, mit Konsolenfenster
#
# Idempotenz:
#   Vor dem Start prüft das Skript, ob die EXE bereits läuft. Dazu wird
#   das aktuelle Prozess-Pfad mit dem erwarteten Installationspfad
#   verglichen — eine PID allein reicht nicht, weil PIDs recycelt werden.
#
# Env-Auflösung:
#   KEEPA_API_KEY, LUGRU_ADRESSE, LUGRU_DB, LUGRU_CHARTS, LUGRU_BROWSER,
#   LUGRU_BENUTZER, LUGRU_PASSWORT, LUGRU_ZEITZONE
#   werden aus der *persistenten* User-Variable in der Windows-Registry
#   gelesen und an den gestarteten Prozess weitergereicht. Damit greifen
#   Änderungen an den Windows-Umgebungsvariablen auch dann, wenn die
#   aufrufende Shell die Variablen noch nicht neu eingelesen hat. Die
#   Werte landen nie im Output.

[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$DataDir    = (Join-Path $env:LOCALAPPDATA 'LuGruDeals'),
    [switch]$Wait
)

$ErrorActionPreference = 'Stop'

# ---- Installationspfad auflösen
$InstallDir = (Resolve-Path -LiteralPath $InstallDir -ErrorAction SilentlyContinue).ProviderPath.TrimEnd('\','/')
$Exe = Join-Path $InstallDir 'lugru-deals.exe'

if (-not (Test-Path -LiteralPath $Exe)) {
    throw "lugru-deals.exe nicht gefunden: $Exe`nBitte zuerst die EXE in den Installationsordner legen."
}
$ExpectedPath = (Resolve-Path -LiteralPath $Exe).ProviderPath
Write-Host "Erwarteter EXE-Pfad: $ExpectedPath"

# ---- Datenverzeichnis vorbereiten
if (-not (Test-Path -LiteralPath $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# ---- Log-Verzeichnis (Best-Effort-Rotation der Logs > 30 Tage)
$LogDir = Join-Path $DataDir 'logs'
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
try {
    Get-ChildItem -LiteralPath $LogDir -Filter 'lugru-deals-*.log*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch { }

$Stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $LogDir "lugru-deals-$Stamp.log"
$ErrFile = Join-Path $LogDir "lugru-deals-$Stamp.err.log"

# ---- Bricht ab, wenn die EXE schon läuft (Idempotenz)
# Wir prüfen:
#   1) PID-Datei (JSON) — Pfad muss zu unserem InstallDir passen,
#      UND der unter dieser PID laufende Prozess muss heute noch da sein
#      UND muss genau unsere EXE unter $ExpectedPath sein.
#   2) Get-Process -Name 'lugru-deals' mit Pfad-Validierung — backup falls
#      die PID-Datei fehlt, aber nicht verlässlich (fängt mehrere
#      lugru-deals-Instanzen nicht ab).
function Get-LivePidForThisInstall {
    $PidFile = Join-Path $DataDir 'lugru.pid'
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    try {
        $Info = Get-Content -LiteralPath $PidFile -Raw -ErrorAction Stop |
                ConvertFrom-Json -ErrorAction Stop
    } catch { return $null }
    if (-not $Info.Id) { return $null }
    $proc = Get-Process -Id $Info.Id -ErrorAction SilentlyContinue
    if (-not $proc) { return $null }
    # Pfad-Vergleich: case-insensitive, exakt
    if ($proc.Path -and ([string]::Equals($proc.Path, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase))) {
        return $proc.Id
    }
    # PID-Datei zeigt auf einen anderen Prozess — möglicherweise recycled.
    return $null
}

function Get-PidByNameForThisInstall {
    $hit = $null
    foreach ($p in (Get-Process -Name 'lugru-deals' -ErrorAction SilentlyContinue)) {
        if ($p.Path -and ([string]::Equals($p.Path, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase))) {
            $hit = $p.Id
            break
        }
    }
    return $hit
}

$Existing = Get-LivePidForThisInstall
if (-not $Existing) { $Existing = Get-PidByNameForThisInstall }

if ($Existing) {
    Write-Host "lugru-deals läuft bereits (PID $Existing, Pfad verifiziert) — kein Neustart."
    exit 0
}

# ---- Argumente für die EXE (Array, später zu EINEM korrekt gequoteten
# String gebaut — Start-Process -ArgumentList mit Array splittet intern
# falsch bei Pfaden mit Leerzeichen).
$ExeArgs = @(
    '-browser=false'
    '-db',     (Join-Path $DataDir 'deals.db')
    '-charts', (Join-Path $DataDir 'charts')
)

# Format-CmdLine baut einen einzigen Command-Line-String nach Windows-
# Standard. Pfade mit Whitespace oder Sonderzeichen werden in doppelte
# Anführungszeichen eingeschlossen; innere Anführungszeichen werden
# verdoppelt.
function Format-CmdLine([string[]]$Values) {
    $sb = ''
    for ($i = 0; $i -lt $Values.Count; $i++) {
        if ($i -gt 0) { $sb += ' ' }
        $v = $Values[$i]
        if ($v -match '[\s"&<>]') {
            $sb += '"' + ($v -replace '"', '""') + '"'
        } else {
            $sb += $v
        }
    }
    return $sb
}
$ArgLine = Format-CmdLine $ExeArgs

# ---- Env-Auflösung: aktuelle Shell-Variablen lesen, fehlende aus der
# persistenten User-Registry nachladen. Wir loggen nie Werte — nur das
# *Vorhandensein* der Variablen wird gemeldet.
$EnvVarsToCarry = @('KEEPA_API_KEY','LUGRU_ADRESSE','LUGRU_DB','LUGRU_CHARTS','LUGRU_BROWSER','LUGRU_BENUTZER','LUGRU_PASSWORT','LUGRU_ZEITZONE')
foreach ($name in $EnvVarsToCarry) {
    # Wenn im aktuellen Prozess vorhanden → bevorzugen (manueller Start)
    $cur = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($cur) { continue }
    # Sonst aus der persistenten User-Variable ziehen
    $usr = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($usr) {
        Write-Host "ENV $name aus der persistenten User-Variable geladen (Wert nicht ausgegeben)."
        [Environment]::SetEnvironmentVariable($name, $usr, 'Process')
    }
}

# ---- Start
if ($Wait) {
    # Manueller Modus: Konsolenfenster bleibt offen. Aufruf über & +
    # ArgumentList sorgt für korrekte argv-Übergabe.
    Write-Host "Starte $Exe (Vordergrund, Daten unter $DataDir)"
    Write-Host "Argumente: $ArgLine"
    & $Exe --% $ArgLine
} else {
    # Hintergrund-Modus (Scheduled Task): Fenster verborgen, Logs in Datei.
    Write-Host "Starte $Exe (Hintergrund, Daten unter $DataDir)"
    Write-Host "Logdateien: $LogFile  /  $ErrFile"
    $Proc = Start-Process -FilePath $Exe -ArgumentList $ArgLine `
                           -WorkingDirectory $InstallDir `
                           -WindowStyle Hidden `
                           -RedirectStandardOutput $LogFile `
                           -RedirectStandardError  $ErrFile `
                           -PassThru

    # PID-Datei als JSON mit Pfad-Information
    $PidFile = Join-Path $DataDir 'lugru.pid'
    $PidInfo = @{
        Id        = $Proc.Id
        Path      = (Resolve-Path -LiteralPath $Exe).ProviderPath
        StartedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Compress
    Set-Content -LiteralPath $PidFile -Value $PidInfo -Encoding UTF8 -NoNewline

    Write-Host "PID $($Proc.Id) (Pfad: $ExpectedPath) geschrieben nach $PidFile"
}
