# Video-Worker am PC auf die Version des Seller-Systems bringen (Docker).
#
# Aufruf in PowerShell (Docker Desktop muss laufen):
#   powershell -ExecutionPolicy Bypass -File C:\video\unter-der-decke\update-worker.ps1
#
# Ablauf: Zugangsdaten aus C:\video\worker.env lesen -> Worker-Paket beim Seller-System holen (mit dem Worker-Token,
# kein Git/GitHub noetig) -> alten Ordner sichern -> neues Image bauen -> Container mit denselben Ordnern neu starten
# -> Protokoll pruefen. Schlaegt der Build fehl, bleibt der alte Worker unveraendert weiter in Betrieb.
#
# Optionen: -Basis C:\video  -Name video-worker  -Cpus 2  -Speicher 3g  -Erzwingen (auch bei gleicher Version)

param(
  [string]$Basis = "C:\video",
  [string]$Name = "video-worker",
  [string]$Cpus = "2",
  [string]$Speicher = "3g",
  [switch]$Erzwingen
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Schritt([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Abbruch([string]$Text) { Write-Host "`nABBRUCH: $Text" -ForegroundColor Red; exit 1 }

$Ordner = Join-Path $Basis "unter-der-decke"
$EnvDatei = Join-Path $Basis "worker.env"

# ---- 1. Voraussetzungen ---------------------------------------------------------------------------------------------
Schritt "Voraussetzungen pruefen"
if (-not (Test-Path $EnvDatei)) { Abbruch "$EnvDatei fehlt (SELLER_URL=... und WORKER_TOKEN=vw_...)." }
$werte = @{}
foreach ($zeile in Get-Content $EnvDatei) {
  if ($zeile -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $werte[$Matches[1]] = $Matches[2].Trim('"') }
}
$SellerUrl = ($werte["SELLER_URL"] -replace '/+$', '')
$Token = $werte["WORKER_TOKEN"]
if (-not $SellerUrl -or -not $Token) { Abbruch "SELLER_URL oder WORKER_TOKEN fehlt in $EnvDatei." }

docker info *> $null
if ($LASTEXITCODE -ne 0) { Abbruch "Docker laeuft nicht - Docker Desktop starten und das Skript erneut aufrufen." }

$alteVersion = "unbekannt"
$init = Join-Path $Ordner "udd\__init__.py"
if (Test-Path $init) {
  $m = Select-String -Path $init -Pattern 'VERSION\s*=\s*"([^"]+)"' | Select-Object -First 1
  if ($m) { $alteVersion = $m.Matches[0].Groups[1].Value }
}
Write-Host "Seller-System: $SellerUrl"
Write-Host "Version am PC: $alteVersion"

# ---- 2. Worker-Paket holen -----------------------------------------------------------------------------------------
Schritt "Worker-Paket beim Seller-System holen"
$tmp = Join-Path $env:TEMP ("video-worker-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp "worker.zip"
try {
  $antwort = Invoke-WebRequest -UseBasicParsing -Uri "$SellerUrl/api/video-worker/paket" -Headers @{ Authorization = "Bearer $Token" } -OutFile $zip -PassThru
} catch {
  Abbruch "Download fehlgeschlagen: $($_.Exception.Message) - Token in worker.env pruefen (Seller-System -> Video -> Worker)."
}
$neueVersion = $antwort.Headers["X-Worker-Version"]
if ($neueVersion -is [array]) { $neueVersion = $neueVersion[0] }
if (-not $neueVersion) { $neueVersion = "unbekannt" }
Write-Host "Version im Seller-System: $neueVersion"
if ($neueVersion -eq $alteVersion -and -not $Erzwingen) {
  Write-Host "`nSchon aktuell (v$alteVersion) - nichts zu tun. Mit -Erzwingen trotzdem neu bauen." -ForegroundColor Green
  Remove-Item $tmp -Recurse -Force
  exit 0
}
$neu = Join-Path $tmp "unter-der-decke"
Expand-Archive -Path $zip -DestinationPath $neu -Force
if (-not (Test-Path (Join-Path $neu "Dockerfile"))) { Abbruch "Paket unvollstaendig (Dockerfile fehlt)." }

# ---- 3. Neues Image bauen (der laufende Worker bleibt so lange in Betrieb) -------------------------------------------
Schritt "Image bauen (dauert beim ersten Mal einige Minuten)"
docker build -t $Name $neu
if ($LASTEXITCODE -ne 0) { Abbruch "docker build fehlgeschlagen - der bisherige Worker laeuft unveraendert weiter." }

# ---- 4. Ordner tauschen (alter Stand wird gesichert) -----------------------------------------------------------------
Schritt "Ordner tauschen"
if (Test-Path $Ordner) {
  $sicherung = "$Ordner.alt-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Move-Item $Ordner $sicherung
  Write-Host "Alter Stand gesichert: $sicherung"
  # nur die zwei letzten Sicherungen behalten
  Get-ChildItem -Path $Basis -Directory -Filter "unter-der-decke.alt-*" | Sort-Object Name -Descending | Select-Object -Skip 2 | Remove-Item -Recurse -Force
}
Copy-Item $neu $Ordner -Recurse
foreach ($u in "arbeit", "musik", "clips") { New-Item -ItemType Directory -Force -Path (Join-Path $Basis $u) | Out-Null }

# ---- 5. Container neu starten mit denselben Ordnern ------------------------------------------------------------------
Schritt "Container neu starten"
docker stop $Name *> $null
docker rm $Name *> $null
docker run -d --name $Name --restart unless-stopped --env-file $EnvDatei `
  -v "$(Join-Path $Basis 'arbeit'):/arbeit" -v "$(Join-Path $Basis 'musik'):/musik" -v "$(Join-Path $Basis 'clips'):/clips" `
  --cpus $Cpus --memory $Speicher $Name | Out-Null
if ($LASTEXITCODE -ne 0) { Abbruch "docker run fehlgeschlagen - Protokoll: docker logs $Name" }

# ---- 6. Pruefen --------------------------------------------------------------------------------------------------------
Schritt "Protokoll pruefen"
Start-Sleep -Seconds 20
$log = (docker logs --tail 40 $Name 2>&1) -join "`n"
Write-Host $log
Remove-Item $tmp -Recurse -Force
if ($log -match "Video-Worker $([regex]::Escape($neueVersion))") {
  Write-Host "`nFertig: Video-Worker $neueVersion laeuft (vorher $alteVersion)." -ForegroundColor Green
  if ($log -match "nicht mit dem PC verbunden") { Write-Host "Hinweis: Clip-Ordner nicht verbunden - $Basis\clips pruefen." -ForegroundColor Yellow }
  Write-Host "Im Seller-System unter Video -> Worker steht jetzt v$neueVersion."
} else {
  Write-Host "`nDer Container laeuft, aber die Startzeile 'Video-Worker $neueVersion' fehlt noch im Protokoll - in einer Minute erneut ansehen: docker logs -f $Name" -ForegroundColor Yellow
}
