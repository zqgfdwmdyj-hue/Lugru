# update.ps1 — ersetzt die laufende EXE durch eine neue Version.
#
# Schritte:
#   1) Laufenden Prozess sauber stoppen
#   2) Bestehende EXE zu *.old.backup umbenennen (eine Generation)
#   3) Neue lugru-deals.exe aus -SourceDir nach InstallDir kopieren
#   4) EXE wieder starten
#
# Aufruf:
#   .\update.ps1 -SourceDir 'C:\Pfad\zum\repo\dist'                  # EXE liegt in dist/
#   .\update.ps1 -SourceDir 'C:\Pfad\zum\repo\dist' -InstallDir 'E:\Tools\LugruDeals'
#
# Voraussetzung: buildartefakt lugru-deals.exe liegt unter -SourceDir.

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceDir,
    [string]$InstallDir = '',
    [string]$DataDir    = (Join-Path $env:LOCALAPPDATA 'LuGruDeals')
)

$ErrorActionPreference = 'Stop'

# Ohne -InstallDir: der Ordner von install.ps1 (%LOCALAPPDATA%\Programs\LuGruDeals),
# sonst der frühere Standard C:\Tools\LuGruDeals.
if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\LuGruDeals'
    if (-not (Test-Path -LiteralPath $InstallDir) -and (Test-Path -LiteralPath 'C:\Tools\LuGruDeals')) {
        $InstallDir = 'C:\Tools\LuGruDeals'
    }
}

$SourceExe = Join-Path $SourceDir 'lugru-deals.exe'
if (-not (Test-Path -LiteralPath $SourceExe)) {
    throw "Quelle nicht gefunden: $SourceExe"
}
if (-not (Test-Path -LiteralPath $InstallDir)) {
    throw "Installationsordner fehlt: $InstallDir — ist lugru-deals überhaupt installiert?"
}

Write-Host "1) EXE stoppen"
& (Join-Path $PSScriptRoot 'stop.ps1') -InstallDir $InstallDir -DataDir $DataDir

Write-Host "2) Datenbank-Sidecars kurz sichern"
# SQLite im WAL-Mode legt deals.db-wal und deals.db-shm daneben ab. Für
# eine konsistente Sicherung der Historie müssen alle drei Dateien
# gemeinsam behandelt werden — eine gesicherte deals.db ohne die Sidecars
# restauriert keine offenen Transaktionen.
$DbFile  = Join-Path $DataDir 'deals.db'
$WalFile = Join-Path $DataDir 'deals.db-wal'
$ShmFile = Join-Path $DataDir 'deals.db-shm'
$BackupRoot = Join-Path $DataDir 'backup'
$Stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $BackupRoot "before-update-$Stamp"
if (Test-Path -LiteralPath $DbFile) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    foreach ($src in @($DbFile, $WalFile, $ShmFile)) {
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $BackupDir -Force
        }
    }
    Write-Host "   $DbFile (+ -wal, -shm) -> $BackupDir"
}

Write-Host "3) Bestehende EXE sichern (überschreibt die vorherige Sicherung)"
$TargetExe = Join-Path $InstallDir 'lugru-deals.exe'
$BackupExe = Join-Path $InstallDir 'lugru-deals.exe.previous'
if (Test-Path -LiteralPath $TargetExe) {
    if (Test-Path -LiteralPath $BackupExe) {
        Remove-Item -LiteralPath $BackupExe -Force
    }
    Move-Item -LiteralPath $TargetExe -Destination $BackupExe -Force
    Write-Host "   $TargetExe  →  $BackupExe"
}

Write-Host "4) Neue EXE kopieren"
Copy-Item -LiteralPath $SourceExe -Destination $TargetExe -Force
$Version = (Get-Item -LiteralPath $TargetExe).LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mm') + ' UTC'
Write-Host "   $TargetExe  ($Version)"

Write-Host "5) EXE starten"
& (Join-Path $PSScriptRoot 'start.ps1') -InstallDir $InstallDir -DataDir $DataDir

Write-Host ""
Write-Host "Hinweis: bei einer fehlgeschlagenen Version lässt sich die vorherige wiederherstellen mit:"
Write-Host "  Move-Item '$BackupExe' '$TargetExe' -Force"
Write-Host "  & '$InstallDir\start.ps1' -InstallDir '$InstallDir' -DataDir '$DataDir'"

Write-Host ""
Write-Host "Datenbanksicherung diesmal: $BackupDir"
Write-Host "Drei Dateien gemeinsam gehoeren zusammen: deals.db, deals.db-wal, deals.db-shm."
