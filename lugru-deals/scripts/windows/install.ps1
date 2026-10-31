# install.ps1 — richtet lugru-deals unter Windows ein.
#
# Standardpfade (anpassbar):
#   InstallDir = %LOCALAPPDATA%\Programs\LuGruDeals\
#   DataDir    = %LOCALAPPDATA%\LuGruDeals\
#   TaskName   = LugruDeals
#   Trigger    = AtLogon   (AtStartup gibt es bewusst nicht — siehe unten)
#
# Aufrufe:
#   .\install.ps1 -StartNow
#   .\install.ps1 -InstallDir 'D:\Tools\LuGruDeals' -DataDir 'D:\Daten\LuGruDeals'
#
# Kein Administrator erforderlich — Default-Pfade liegen beide unter
# %LOCALAPPDATA% und sind für den ausführenden Benutzer beschreibbar.

[CmdletBinding()]
param(
    [string]$InstallDir  = (Join-Path $env:LOCALAPPDATA 'Programs\LuGruDeals'),
    [string]$DataDir     = (Join-Path $env:LOCALAPPDATA 'LuGruDeals'),
    [string]$TaskName    = 'LugruDeals',
    [switch]$OpenFirewall,
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

# ---- PowerShell-Host ermitteln (pwsh bevorzugt, powershell.exe Fallback)
$PowerShell = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $PowerShell) { $PowerShell = (Get-Command powershell.exe).Source }

# ---- Quelle(n) auflösen
# Zwei Layouts sind gültig:
#   (a) Release-ZIP — $PSScriptRoot enthält EXE + Skripte nebeneinander
#   (b) Repo-Layout  — Skripte unter scripts/windows/, EXE unter dist/
# Wir nehmen an, dass der Aufruf aus scripts/windows/ oder aus dem ZIP-Root
# erfolgt. Andere Pfade scheitern mit klarer Fehlermeldung.
$SourceRoot = $null
$SourceLayout = $null
$candidates = @(
    @{ Path = $PSScriptRoot;                                Layout = 'zip' }
    @{ Path = (Join-Path $PSScriptRoot '..\..');            Layout = 'repo' }
)
foreach ($c in $candidates) {
    $resolved = (Resolve-Path -LiteralPath $c.Path -ErrorAction SilentlyContinue).ProviderPath
    if (-not $resolved) { continue }
    # ZIP-Layout: EXE und start.ps1 liegen direkt im Root.
    if ($c.Layout -eq 'zip' -and
        (Test-Path -LiteralPath (Join-Path $resolved 'lugru-deals.exe')) -and
        (Test-Path -LiteralPath (Join-Path $resolved 'start.ps1'))) {
        $SourceRoot = $resolved
        $SourceLayout = 'zip'
        break
    }
    if ($c.Layout -eq 'repo' -and
        (Test-Path -LiteralPath (Join-Path $resolved 'scripts\windows\start.ps1')) -and
        (Test-Path -LiteralPath (Join-Path $resolved 'dist\lugru-deals.exe'))) {
        $SourceRoot = $resolved
        $SourceLayout = 'repo'
        break
    }
}

# EXE-Pfad je nach Layout
$ExeSource = $null
if ($SourceLayout -eq 'zip')  { $ExeSource = Join-Path $SourceRoot 'lugru-deals.exe' }
if ($SourceLayout -eq 'repo') { $ExeSource = Join-Path $SourceRoot 'dist\lugru-deals.exe' }

if (-not $ExeSource -or -not (Test-Path -LiteralPath $ExeSource)) {
    throw ("lugru-deals.exe nicht gefunden.`n" +
        "Bitte 'lugru-deals-windows.zip' vom GitHub-Release verwenden (nicht 'Source code (zip)'), " +
        "die ZIP vollstaendig entpacken und install.cmd im entpackten Ordner starten.`n" +
        "Im Repo: vorher 'make windows' ausfuehren.")
}

Write-Host "Quelle:       $SourceRoot  ($SourceLayout)"
Write-Host "EXE-Quelle:   $ExeSource"

# ---- Zielpfade vorbereiten, sauber wenn nicht existent
if (-not (Test-Path -LiteralPath $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Host "InstallDir:   $InstallDir"
Write-Host "DataDir:      $DataDir"

# ---- EXE und Skripte kopieren — mit Schutz vor Selbst-Kopie
# Wenn $InstallDir == $SourceRoot (Aufruf aus dem InstallDir heraus),
# ist jede Copy-Item-Operation source==destination für die gleiche Datei.
# Wir vergleichen vorher und melden den Skip.
$FilesToCopy = @(
    @{ Src = $ExeSource;                  Dest = 'lugru-deals.exe' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\start.ps1');     Dest = 'start.ps1' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\stop.ps1');      Dest = 'stop.ps1' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\update.ps1');    Dest = 'update.ps1' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\uninstall.ps1'); Dest = 'uninstall.ps1' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\install.ps1');   Dest = 'install.ps1' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\install.cmd');   Dest = 'install.cmd' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\uninstall.cmd'); Dest = 'uninstall.cmd' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\update-github.ps1'); Dest = 'update-github.ps1' }
    @{ Src = (Join-Path $SourceRoot 'scripts\windows\update-github.cmd'); Dest = 'update-github.cmd' }
)
# Wenn ZIP-Layout: Skripte liegen direkt nebeneinander, nicht unter scripts\windows\
if ($SourceLayout -eq 'zip') {
    $FilesToCopy[1].Src = Join-Path $SourceRoot 'start.ps1'
    $FilesToCopy[2].Src = Join-Path $SourceRoot 'stop.ps1'
    $FilesToCopy[3].Src = Join-Path $SourceRoot 'update.ps1'
    $FilesToCopy[4].Src = Join-Path $SourceRoot 'uninstall.ps1'
    $FilesToCopy[5].Src = Join-Path $SourceRoot 'install.ps1'
    $FilesToCopy[6].Src = Join-Path $SourceRoot 'install.cmd'
    $FilesToCopy[7].Src = Join-Path $SourceRoot 'uninstall.cmd'
    $FilesToCopy[8].Src = Join-Path $SourceRoot 'update-github.ps1'
    $FilesToCopy[9].Src = Join-Path $SourceRoot 'update-github.cmd'
}

foreach ($f in $FilesToCopy) {
    if (-not (Test-Path -LiteralPath $f.Src)) {
        Write-Host "  fehlt in Quelle: $($f.Src) — überspringe."
        continue
    }
    $destPath = Join-Path $InstallDir $f.Dest
    # Schutz vor Selbst-Kopie (source == destination)
    $resolvedSrc = (Resolve-Path -LiteralPath $f.Src -ErrorAction SilentlyContinue).ProviderPath
    $resolvedDst = $null
    if (Test-Path -LiteralPath $destPath) {
        $resolvedDst = (Resolve-Path -LiteralPath $destPath).ProviderPath
    }
    if ($resolvedSrc -and $resolvedDst -and
        [string]::Equals($resolvedSrc, $resolvedDst, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "  $($f.Dest) bereits am Ziel — überspringe."
        continue
    }
    Copy-Item -LiteralPath $f.Src -Destination $destPath -Force
    Write-Host "  $($f.Dest) kopiert."
}

# ---- User-Identifier: voll qualifiziert (DOMAIN\User bzw. PC\User).
# Ein nackter Name wie "dreo" wird vom Task Scheduler teils nicht aufgelöst
# (HRESULT 0x80070057 "Falscher Parameter", z. B. bei Microsoft-Konten
# oder wenn PC- und Benutzername gleich sind). Der Name aus dem
# Windows-Token ist immer auflösbar.
$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not $UserId) {
    $UserId = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
}

# ---- Trigger und Action
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId

$Action = New-ScheduledTaskAction `
    -Execute $PowerShell `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\start.ps1`" -InstallDir `"$InstallDir`" -DataDir `"$DataDir`"" `
    -WorkingDirectory $InstallDir

# ---- Principal: voll qualifizierter User-Identifier, kein RunLevel=Highest
# Höchste Berechtigung (Highest) erfordert Admin und wird von Windows
# abgelehnt, wenn der User nicht zur Administratorengruppe gehört. Für
# AtLogon reicht der Default-RunLevel (= 1 = geringste Berechtigung),
# was der typischen User-Installation entspricht.
$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive
# RunLevel weglassen — Default = LeastPrivilege für nicht-Admin-Konten

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$TaskArgs = @{
    TaskName    = $TaskName
    Action      = $Action
    Principal   = $Principal
    Description = "lugru-deals — Discord-Poster für Amazon-Arbitrage-Deals (Pascal)"
}
try {
    Register-ScheduledTask @TaskArgs -Trigger $Trigger -ErrorAction Stop | Out-Null
} catch {
    # Fallback: Logon-Trigger ohne User-Bindung. Der Task läuft trotzdem nur
    # als $UserId (Principal, LogonType Interactive), also nur in dessen Sitzung.
    Write-Warning "Task-Registrierung mit User-Trigger fehlgeschlagen ($($_.Exception.Message)). Versuche Trigger ohne User."
    $Trigger = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask @TaskArgs -Trigger $Trigger -ErrorAction Stop | Out-Null
}

Write-Host "Scheduled Task '$TaskName' registriert (Trigger: AtLogon, Principal: $UserId)."

# ---- Optional: Firewall-Ausnahme
if ($OpenFirewall) {
    Write-Warning "Firewall-Ausnahme nur nötig, wenn LUGRU_ADRESSE != 127.0.0.1."
    $ruleDisplay = 'lugru-deals'
    $ruleExists  = Get-NetFirewallRule -DisplayName $ruleDisplay -ErrorAction SilentlyContinue
    if (-not $ruleExists) {
        try {
            New-NetFirewallRule -DisplayName $ruleDisplay -Direction Inbound `
                -Program "$InstallDir\lugru-deals.exe" -Action Allow -Profile Private |
                Out-Null
            Write-Host "Firewall-Ausnahme für $ruleDisplay hinzugefügt (Profil: Private)."
        } catch {
            Write-Warning "Firewall-Ausnahme fehlgeschlagen ($($_.Exception.Message)). Bitte manuell anlegen oder -OpenFirewall weglassen."
        }
    } else {
        Write-Host "Firewall-Ausnahme '$ruleDisplay' existiert bereits."
    }
}

if ($StartNow) {
    & (Join-Path $InstallDir 'start.ps1') -InstallDir $InstallDir -DataDir $DataDir
}
