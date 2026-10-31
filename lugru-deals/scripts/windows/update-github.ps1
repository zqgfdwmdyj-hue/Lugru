# update-github.ps1 — holt die neueste Version von GitHub und spielt sie ein.
#
# Ein Befehl statt ZIP herunterladen und entpacken:
#   Doppelklick auf update-github.cmd im Installationsordner, oder
#   powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\LuGruDeals\update-github.ps1"
#
# Ablauf:
#   1) Neuestes Release mit Tag "lugru-deals-v…" auf GitHub suchen
#   2) Passendes Paket laden: ARM64 oder x64, je nach diesem PC
#   3) Skripte im Installationsordner auffrischen, dann update.ps1:
#      Datenbank sichern, EXE tauschen, neu starten
#
# Ist die neueste Version schon installiert, passiert nichts (-Force
# spielt sie trotzdem ein). Die Datenbank bleibt, wo sie ist.

[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$DataDir    = (Join-Path $env:LOCALAPPDATA 'LuGruDeals'),
    [string]$Repo       = 'zqgfdwmdyj-hue/Lugru',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest ist mit Fortschrittsbalken in PS 5.1 sehr langsam
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# PROCESSOR_ARCHITEW6432 ist gesetzt, wenn eine 32-Bit-PowerShell auf
# 64-Bit-Windows läuft; dann nennt sie die echte Architektur.
$Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$AssetName = if ($Arch -eq 'ARM64') { 'LugruDeals-Windows-ARM64.zip' } else { 'LugruDeals-Windows-x64.zip' }

Write-Host "1) Neueste Version auf GitHub suchen ($Repo)"
# Erst in eine Variable: Windows PowerShell 5.1 reicht ein JSON-Array sonst
# als ein einziges Objekt durch die Pipeline.
$Releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=50" -UserAgent 'lugru-deals-update' -UseBasicParsing
# GitHub liefert die neuesten zuerst. Im Repo liegen auch andere Projekte —
# darum nur Releases mit dem Tag-Präfix von Lugru Deals.
$Release = $Releases | Where-Object { $_.tag_name -like 'lugru-deals-v*' -and -not $_.draft -and -not $_.prerelease } | Select-Object -First 1
if (-not $Release) { throw "Auf GitHub gibt es noch kein Lugru-Deals-Release (Tag lugru-deals-v…)." }
$Neu = $Release.tag_name -replace '^lugru-deals-v', ''

$VersionFile = Join-Path $InstallDir 'version.txt'
$Alt = if (Test-Path -LiteralPath $VersionFile) { (Get-Content -LiteralPath $VersionFile -Raw).Trim() } else { '' }
Write-Host "   installiert: $(if ($Alt) { $Alt } else { 'unbekannt' })   neueste: $Neu   ($Arch)"
if ($Alt -eq $Neu -and -not $Force) {
    Write-Host "Schon auf dem neuesten Stand."
    return
}

$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) { throw "Im Release $($Release.tag_name) fehlt $AssetName." }

Write-Host "2) $AssetName laden"
$Temp = Join-Path ([IO.Path]::GetTempPath()) ("lugru-update-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp -Force | Out-Null
try {
    $Zip = Join-Path $Temp $AssetName
    Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Zip -UseBasicParsing -UserAgent 'lugru-deals-update'
    Expand-Archive -LiteralPath $Zip -DestinationPath (Join-Path $Temp 'paket') -Force
    $Exe = Get-ChildItem -LiteralPath (Join-Path $Temp 'paket') -Recurse -Filter 'lugru-deals.exe' | Select-Object -First 1
    if (-not $Exe) { throw "Im Paket fehlt lugru-deals.exe." }
    $Paket = $Exe.DirectoryName

    Write-Host "3) Skripte auffrischen"
    foreach ($f in (Get-ChildItem -LiteralPath $Paket -File | Where-Object { $_.Extension -in '.ps1', '.cmd' })) {
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $InstallDir $f.Name) -Force
    }

    Write-Host "4) Update einspielen"
    & (Join-Path $InstallDir 'update.ps1') -SourceDir $Paket -InstallDir $InstallDir -DataDir $DataDir
    Set-Content -LiteralPath $VersionFile -Value $Neu -Encoding ASCII
    Write-Host ""
    Write-Host "Fertig: Version $Neu läuft. Unten auf jeder Seite steht die Version zur Kontrolle."
}
finally {
    Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
