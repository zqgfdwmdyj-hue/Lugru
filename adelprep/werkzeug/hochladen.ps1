# AdelPrep-Website per FTPS in den konsoleH-Webspace hochladen (Windows).
# Wird über Hochladen.bat, Testlauf.bat oder Zugangsdaten-aendern.bat gestartet.
#
# - Lädt nur neue oder geänderte Dateien aus dem Ordner "public" hoch.
# - Löscht auf dem Server nie etwas.
# - Sichert vor dem ersten Upload den kompletten Server-Ordner auf diesen PC.
# - Zugangsdaten liegen verschlüsselt (Windows-DPAPI, nur für dein Benutzerkonto lesbar)
#   unter %APPDATA%\AdelPrep, also weder im Projekt noch auf dem Webspace.
param([switch]$Testlauf, [switch]$ZugangNeu)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Projekt   = Split-Path -Parent $PSScriptRoot
$Lokal     = Join-Path $Projekt 'public'
$Daten     = Join-Path $env:APPDATA 'AdelPrep'
$ZugangDat = Join-Path $Daten 'zugang.xml'
$Log       = Join-Path $Daten 'upload.log'
New-Item -ItemType Directory -Force -Path $Daten | Out-Null

function Info($t)   { Write-Host $t -ForegroundColor Cyan }
function Gut($t)    { Write-Host $t -ForegroundColor Green }
function Fehler($t) { Write-Host $t -ForegroundColor Red }

if (-not (Test-Path (Join-Path $Lokal 'index.html'))) { Fehler "Ordner '$Lokal' mit index.html nicht gefunden."; exit 1 }

# --- WinSCP suchen -----------------------------------------------------------
$Kandidaten = @(
  (Join-Path $PSScriptRoot 'WinSCP.com'),
  (Join-Path ${env:ProgramFiles(x86)} 'WinSCP\WinSCP.com'),
  (Join-Path $env:ProgramFiles 'WinSCP\WinSCP.com'),
  (Join-Path $env:LOCALAPPDATA 'Programs\WinSCP\WinSCP.com')
)
$WinSCP = $Kandidaten | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $WinSCP) {
  Fehler 'WinSCP ist nicht installiert. Es wird für den sicheren FTPS-Upload gebraucht (kostenlos).'
  $a = Read-Host 'Jetzt automatisch installieren? (j/n)'
  if ($a -eq 'j') {
    winget install --id WinSCP.WinSCP -e --accept-source-agreements --accept-package-agreements
    $WinSCP = $Kandidaten | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  }
  if (-not $WinSCP) { Fehler 'Bitte WinSCP von https://winscp.net installieren und das Skript erneut starten.'; exit 1 }
}

function Starte-WinSCP([string[]]$Befehle) {
  $ErrorActionPreference = 'Continue'   # Meldungen von WinSCP nicht als Abbruch werten
  # Befehle als Skriptdatei im geschützten Benutzerordner übergeben, danach sofort löschen
  $skript = Join-Path $Daten ('lauf-' + [guid]::NewGuid().ToString('N') + '.txt')
  $alle = @('option batch abort', 'option confirm off') + $Befehle + @('exit')
  [IO.File]::WriteAllLines($skript, $alle, (New-Object Text.UTF8Encoding($false)))
  try {
    $out = & $WinSCP '/ini=nul' "/log=$Log" '/loglevel=0' "/script=$skript" 2>&1
    $code = $LASTEXITCODE
  } finally { Remove-Item $skript -Force -ErrorAction SilentlyContinue }
  return @{ Code = $code; Text = ($out -join "`n") }
}

function Zeige-Ausgabe($text) {
  $text -split "`n" | Where-Object {
    $_.Trim() -and $_ -notmatch '^(Searching for host|Connecting to host|Authenticating|Using username|Authenticated|Starting the session|Session started|Active session|Verbindung|Suche Host|Authentifiz|Sitzung)'
  } | ForEach-Object { Write-Host "  $_" }
}

function Oeffnen-Befehl($z) {
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($z.Passwort))
  $u  = [uri]::EscapeDataString($z.Benutzer); $p = [uri]::EscapeDataString($pw)
  return "open ftpes://${u}:${p}@$($z.Server)/ -passive=on -timeout=30"
}

# --- Zugangsdaten ------------------------------------------------------------
$Zugang = $null
if ((Test-Path $ZugangDat) -and -not $ZugangNeu) { $Zugang = Import-Clixml $ZugangDat }
if (-not $Zugang) {
  Info 'Einmalige Einrichtung. Die Daten stehen in konsoleH unter adelprep.de -> Zugangsdaten -> FTP.'
  Info 'Wichtig: Als Server den Namen wie wwwXXX.your-server.de eintragen, nicht adelprep.de.'
  $Zugang = [pscustomobject]@{
    Server   = (Read-Host 'FTP-Server (z. B. www123.your-server.de)').Trim()
    Benutzer = (Read-Host 'FTP-Benutzername').Trim()
    Passwort = (Read-Host 'FTP-Passwort' -AsSecureString)
    Ordner   = (Read-Host 'Zielordner auf dem Server [Enter = /public_html]').Trim()
    Adresse  = (Read-Host 'Adresse der Website [Enter = https://adelprep.de]').Trim()
  }
  if (-not $Zugang.Ordner)  { $Zugang.Ordner  = '/public_html' }
  if (-not $Zugang.Adresse) { $Zugang.Adresse = 'https://adelprep.de' }
  Info 'Teste die Verbindung ...'
  $r = Starte-WinSCP @((Oeffnen-Befehl $Zugang), "ls `"$($Zugang.Ordner)`"")
  if ($r.Code -ne 0) { Fehler "Verbindung fehlgeschlagen. Nichts gespeichert.`n$($r.Text)"; exit 1 }
  $Zugang | Export-Clixml $ZugangDat
  Gut "Verbindung klappt. Zugangsdaten verschlüsselt gespeichert: $ZugangDat"
}
$Open = Oeffnen-Befehl $Zugang
$Ziel = $Zugang.Ordner

# --- Sicherung vor dem ersten Upload ------------------------------------------
$Marker = Join-Path $Daten 'sicherung-erledigt.txt'
if (-not (Test-Path $Marker)) {
  $Sich = Join-Path $Daten ('Sicherung_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm'))
  New-Item -ItemType Directory -Force -Path $Sich | Out-Null
  Info "Erster Start: sichere den kompletten Server-Ordner $Ziel nach $Sich ..."
  $r = Starte-WinSCP @($Open, "synchronize local `"$Sich`" `"$Ziel`"")
  if ($r.Code -ne 0) { Fehler "Sicherung fehlgeschlagen, es wird nichts hochgeladen.`n$($r.Text)"; exit 1 }
  Set-Content $Marker "Sicherung: $Sich" -Encoding UTF8
  Gut "Sicherung fertig: $Sich"
}

# --- Versionsdatei für die Prüfung -------------------------------------------
$Kennung = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + [guid]::NewGuid().ToString('N').Substring(0,8)
if (-not $Testlauf) { Set-Content (Join-Path $Lokal 'version.txt') $Kennung -Encoding ASCII -NoNewline }

# --- Vorschau ----------------------------------------------------------------
Info 'Prüfe, welche Dateien neu oder geändert sind ...'
$Krit = 'time,size'
$r = Starte-WinSCP @($Open, "synchronize remote -mirror -preview -criteria=$Krit `"$Lokal`" `"$Ziel`"")
if ($r.Code -ne 0 -and $r.Text -match 'criteria') {
  $Krit = 'either'   # ältere WinSCP-Versionen
  $r = Starte-WinSCP @($Open, "synchronize remote -mirror -preview -criteria=$Krit `"$Lokal`" `"$Ziel`"")
}
if ($r.Code -ne 0) { Fehler "Vergleich fehlgeschlagen.`n$($r.Text)"; exit 1 }
Zeige-Ausgabe $r.Text
if ($Testlauf) { Gut 'Testlauf beendet. Es wurde nichts hochgeladen.'; exit 0 }

$a = Read-Host 'Diese Dateien jetzt hochladen? Auf dem Server wird nichts gelöscht. (j/n)'
if ($a -ne 'j') { Info 'Abgebrochen. Nichts hochgeladen.'; exit 0 }

# --- Upload ------------------------------------------------------------------
$r = Starte-WinSCP @($Open, "synchronize remote -mirror -criteria=$Krit `"$Lokal`" `"$Ziel`"")
if ($r.Code -ne 0) { Fehler "Upload fehlgeschlagen. Details: $Log`n$($r.Text)"; exit 1 }
Zeige-Ausgabe $r.Text
Gut 'Upload abgeschlossen.'

# --- Prüfung -----------------------------------------------------------------
Info "Prüfe $($Zugang.Adresse) ..."
$ok = $false
$Adressen = @($Zugang.Adresse, ($Zugang.Adresse -replace '^https:', 'http:')) | Select-Object -Unique
foreach ($basis in $Adressen) {
  try {
    $v = (Invoke-WebRequest "$basis/version.txt?t=$(Get-Random)" -UseBasicParsing -TimeoutSec 20).Content
    if ($v -is [byte[]]) { $v = [Text.Encoding]::ASCII.GetString($v) }
    $s = Invoke-WebRequest "$basis/?t=$(Get-Random)" -UseBasicParsing -TimeoutSec 20
    if ($v.Trim() -eq $Kennung -and $s.StatusCode -eq 200 -and $s.Content -match 'AdelPrep') {
      Gut "Geprüft: $basis zeigt den neuen Stand ($Kennung)."
      if ($basis -like 'http:*') { Fehler 'Hinweis: Über https klappt es noch nicht. SSL-Zertifikat in konsoleH aktivieren.' }
      $ok = $true; break
    }
  } catch { }
}
if (-not $ok) { Fehler "Die Website zeigt den neuen Stand noch nicht. Upload-Protokoll: $Log"; exit 1 }
