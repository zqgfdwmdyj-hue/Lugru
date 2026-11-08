# lugru-druckagent – Installation als Windows-Dienst (als Administrator ausführen:
# Rechtsklick auf PowerShell → „Als Administrator ausführen“, dann:  powershell -ExecutionPolicy Bypass -File .\installieren.ps1)
# Der Gerätetoken wird nur abgefragt und lokal in config.json gespeichert – nie in einen Chat kopieren.
$ErrorActionPreference = "Stop"
$Ziel = "$env:ProgramData\lugru-druckagent"
$Quelle = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Bitte PowerShell als Administrator starten."
}

# 1) Node.js (LTS) – falls nicht vorhanden, über winget installieren
if (-not (Test-Path "$env:ProgramFiles\nodejs\node.exe")) {
  Write-Host "Node.js fehlt – Installation über winget …"
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
}

# 2) Dateien kopieren
New-Item -ItemType Directory -Force -Path $Ziel | Out-Null
Copy-Item "$Quelle\..\lugru-druckagent.mjs" "$Ziel\lugru-druckagent.mjs" -Force
Copy-Item "$Quelle\lugru-druckagent.xml" "$Ziel\lugru-druckagent.xml" -Force

# 3) config.json (Server und Token) – nur beim ersten Mal bzw. bei Umzug/neuem Token
if (-not (Test-Path "$Ziel\config.json") -or (Read-Host "config.json neu schreiben (neuer Token)? j/n") -eq "j") {
  $server = Read-Host "Adresse des Seller-Systems (z. B. https://seller.example.com)"
  $token = Read-Host "Gerätetoken (Einstellungen → Drucker → Agent anlegen; beginnt mit da_)"
  $cfg = [ordered]@{ server = $server.TrimEnd("/"); token = $token.Trim(); drucker = @(); leerlaufAusMin = 10; ordner = $null; medien = @() }
  $cfg | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 "$Ziel\config.json"
  icacls "$Ziel\config.json" /inheritance:r /grant:r "SYSTEM:(R)" "Administratoren:(F)" "Administrators:(F)" 2>$null | Out-Null
}

# 4) WinSW holen (Dienst-Hülle) und Dienst einrichten
$winsw = "$Ziel\lugru-druckagent.exe"
if (-not (Test-Path $winsw)) {
  Invoke-WebRequest -Uri "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe" -OutFile $winsw
}
& $winsw stop 2>$null | Out-Null
& $winsw uninstall 2>$null | Out-Null
& $winsw install
sc.exe failure lugru-druckagent reset= 3600 actions= restart/10000/restart/20000/restart/60000 | Out-Null
& $winsw start

# 5) PC wach halten (Energiesparen/Ruhezustand aus) und Windows-Update-Neustarts nur nachts (Nutzungszeit 06–23 Uhr)
if ((Read-Host "Energiesparmodus und Ruhezustand ausschalten, Update-Nutzungszeit 06–23 Uhr setzen? j/n") -eq "j") {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /hibernate off
  New-Item -Path "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -Force | Out-Null
  Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -Name ActiveHoursStart -Value 6 -Type DWord
  Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -Name ActiveHoursEnd -Value 23 -Type DWord
}

Write-Host ""
Write-Host "Fertig. Gefundene Drucker:"
& "$env:ProgramFiles\nodejs\node.exe" "$Ziel\lugru-druckagent.mjs" --drucker
Write-Host "Im Seller-System unter Einstellungen → Drucker sollte der Agent in spätestens einer Minute „online“ stehen."
