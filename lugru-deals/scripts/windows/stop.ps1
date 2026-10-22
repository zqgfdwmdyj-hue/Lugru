# stop.ps1 — beendet eine laufende lugru-deals.EXE.
#
# Strategie:
#   * "Graceful" ist hier *kein* Mechanismus, sondern eine ehrliche
#     Beschreibung: Stop-Process ruft unter Windows immer TerminateProcess
#     auf. Es gibt kein CTRL_C_EVENT, kein WM_CLOSE, keinen Shutdown-
#     Endpoint. Der Begriff bleibt nur für die Beschreibung der Strategie
#     stehen.
#   * Vor jedem Kill prüfen wir den *tatsächlichen* Pfad des unter der
#     PID laufenden Prozesses gegen den erwarteten Installationspfad.
#     Eine PID allein reicht nicht — Windows recycelt PIDs.
#   * Wirksam wird nur, wenn der Pfad zum InstallDir passt. Sonst: Skip +
#     Warnung.
[CmdletBinding()]
param(
    [string]$InstallDir      = $PSScriptRoot,
    [string]$DataDir         = (Join-Path $env:LOCALAPPDATA 'LuGruDeals'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Erwarteter Installationspfad. Wir beenden ausschliesslich Prozesse,
# deren Binary unter diesem Pfad liegt — ein globaler Name-Kill auf
# "lugru-deals" würde auch eine völlig fremde EXE treffen.
$ExpectedPath = $null
if ($InstallDir) {
    $ExpectedExe = Join-Path $InstallDir 'lugru-deals.exe'
    if (Test-Path -LiteralPath $ExpectedExe) {
        $ExpectedPath = (Resolve-Path -LiteralPath $ExpectedExe).ProviderPath
    } else {
        Write-Warning "InstallDir angegeben, aber $ExpectedExe fehlt. Es wird nichts beendet."
        exit 0
    }
}

function Test-PfadGehoert {
    param([string]$ProcPath)
    if (-not $ProcPath) { return $false }
    if (-not $ExpectedPath) { return $false }
    return [string]::Equals($ProcPath, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase)
}

# --- 1) PID-Datei (JSON mit Pfad)
# Zur Laufzeit verifizieren wir den Pfad des Prozesses — der in der Datei
# gespeicherte Pfad dient nur als Hinweis, ob wir überhaupt die richtige
# Instanz meinen.
$TargetPids = New-Object System.Collections.Generic.List[int]
$PidFile = Join-Path $DataDir 'lugru.pid'
if (Test-Path -LiteralPath $PidFile) {
    $SavedId = $null
    try {
        $Info = Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue |
                ConvertFrom-Json -ErrorAction Stop
        $SavedId = $Info.Id
    } catch {
        Write-Warning "PID-Datei nicht lesbar: $($_.Exception.Message) — wird ignoriert."
    }

    if ($SavedId) {
        $proc = Get-Process -Id $SavedId -ErrorAction SilentlyContinue
        if (-not $proc) {
            Write-Host "PID $SavedId aus der PID-Datei läuft nicht mehr. Räume Datei auf."
        } elseif (Test-PfadGehoert $proc.Path) {
            $TargetPids.Add($SavedId)
        } else {
            Write-Warning "PID-Datei zeigt auf PID $SavedId, aber Pfad '$($proc.Path)' gehört nicht zum InstallDir. Überspringe."
        }
    }
}

# --- 2) Name-Fallback (nur wenn $ExpectedPath gesetzt und PIDs leer)
if ($ExpectedPath -and $TargetPids.Count -eq 0) {
    foreach ($p in (Get-Process -Name 'lugru-deals' -ErrorAction SilentlyContinue)) {
        if (Test-PfadGehoert $p.Path) {
            $TargetPids.Add($p.Id)
        } else {
            Write-Warning "Fremder Prozess $($p.Id) unter $($p.Path) — wird nicht beendet."
        }
    }
}

if ($TargetPids.Count -eq 0) {
    Write-Host "Kein passender lugru-deals-Prozess gefunden."
    exit 0
}

Write-Host "Zu beendende Prozesse: $($TargetPids -join ', ')"

# --- 3) Beenden
# Stop-Process ist TerminateProcess auf Windows. Es gibt keinen echten
# graceful-Mechanismus in diesem Skript; SQLite WAL repariert beim
# nächsten Start. -Force ist hier nur ein Marker für "sofort, ohne Wartezeit".
foreach ($procId in $TargetPids) {
    # Letzte Pfad-Verifikation — eine Sekunde zwischen PID-Lesen und Stop
    # kann schon eine PID-Reuse verursachen, also noch einmal nachschauen.
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "PID $procId nicht mehr aktiv — überspringe."
        continue
    }
    if (-not (Test-PfadGehoert $proc.Path)) {
        Write-Warning "PID $procId inzwischen recycelt (Pfad '$($proc.Path)' passt nicht). Überspringe."
        continue
    }

    Stop-Process -Id $procId -Force
    Write-Host "PID $procId terminiert."
}

# PID-Datei aufräumen
if (Test-Path -LiteralPath $PidFile) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
