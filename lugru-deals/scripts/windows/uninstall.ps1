# uninstall.ps1 — entfernt eine lugru-deals-Installation sauber.
#
# Reihenfolge:
#   1) Laufende EXE stoppen
#   2) Scheduled Task entfernen
#   3) Firewall-Ausnahme entfernen (falls vorhanden)
#   4) Optional: Datenordner mit Bestätigung löschen
#   5) Optional: Installationsordner löschen
#
# Aufruf:
#   .\uninstall.ps1                                 # EXE + Task weg, Daten + InstallDir behalten
#   .\uninstall.ps1 -RemoveData                     # Datenordner ebenfalls löschen (mit Bestaetigung)
#   .\uninstall.ps1 -Yes                            # keine Rückfragen

[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\LuGruDeals'),
    [string]$DataDir    = (Join-Path $env:LOCALAPPDATA 'LuGruDeals'),
    [string]$TaskName   = 'LugruDeals',
    [switch]$RemoveData,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

function Confirm([string]$Prompt) {
    if ($Yes) { return $true }
    $ans = Read-Host "$Prompt [j/N]"
    return ($ans -eq 'j' -or $ans -eq 'J' -or $ans -eq 'yes' -or $ans -eq 'Y')
}

Write-Host "Deinstallation lugru-deals"
Write-Host "  InstallDir: $InstallDir"
Write-Host "  DataDir:    $DataDir"
Write-Host "  TaskName:   $TaskName"
Write-Host ''

# 1) EXE stoppen — InstallDir angeben, damit stop.ps1 nur die echte
# Instanz killt und keine fremde lugru-deals.EXE.
& (Join-Path $PSScriptRoot 'stop.ps1') -InstallDir $InstallDir -DataDir $DataDir

# 2) Task entfernen
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled Task '$TaskName' entfernt."
} else {
    Write-Host "Scheduled Task '$TaskName' war nicht registriert."
}

# 3) Firewall-Ausnahme entfernen
$rule = Get-NetFirewallRule -DisplayName 'lugru-deals' -ErrorAction SilentlyContinue
if ($rule) {
    Remove-NetFirewallRule -InputObject $rule
    Write-Host "Firewall-Ausnahme 'lugru-deals' entfernt."
}

# 4) Datenordner
if (Test-Path -LiteralPath $DataDir) {
    if ($RemoveData) {
        Remove-Item -LiteralPath $DataDir -Recurse -Force
        Write-Host "Datenordner gelöscht."
    } elseif (-not $Yes -and (Confirm "Datenordner $DataDir unwiderruflich löschen?")) {
        Remove-Item -LiteralPath $DataDir -Recurse -Force
        Write-Host "Datenordner gelöscht."
    } else {
        Write-Host "Datenordner behalten (Sicherung selbst anlegen)."
    }
} else {
    Write-Host "Datenordner nicht vorhanden."
}

# 5) Installationsordner
if (Test-Path -LiteralPath $InstallDir) {
    if ($Yes -or (Confirm "Installationsordner $InstallDir löschen?")) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Host "Installationsordner gelöscht."
    } else {
        Write-Host "Installationsordner behalten."
    }
}

Write-Host ''
Write-Host "Fertig. Hinweise:"
Write-Host "  - benutzerspezifische Umgebungsvariablen (z. B. KEEPA_API_KEY)"
Write-Host "    müssen in Windows-Einstellungen → System → Info → Erweiterte"
Write-Host "    Systemeinstellungen → Umgebungsvariablen von Hand entfernt werden."
Write-Host "  - die EXE selbst hat keinen Installer-Eintrag — keine Registry-Spuren,"
Write-Host "    kein MSI-Hook, kein globaler Hook."
