@echo off
REM install.cmd - CMD-Wrapper fuer Endnutzer ohne PowerShell-Kenntnisse.
REM
REM Benoetigt: PowerShell 5.1 (auf Windows 10/11 vorinstalliert) oder neuer.
REM Wirkung: ruft install.ps1 mit -StartNow auf und gibt alles 1:1 weiter.
REM
REM Besonderheiten:
REM   * %~dp0 ist der absolute Pfad dieses Skripts inklusive Backslash.
REM   * Wir quoten %~dp0 mit Anfuehrungszeichen - Pfade mit Leerzeichen
REM     (typisches Windows-Heimatverzeichnis) funktionieren so.
REM   * -ExecutionPolicy Bypass ist auf modernen Windows-Setups der
REM     Funktionsmodus; ohne ihn scheitert das Skript in der Standard-
REM     Restricted-Richtlinie des oeffentlichen Netzes.
REM   * Fehlerlevel werden mit "if errorlevel" statt "%ERRORLEVEL%" geprueft:
REM     %ERRORLEVEL% wird in Klammerbloecken schon beim Einlesen expandiert.
REM   * Bei Doppelklick schliesst sich das Fenster sonst sofort - daher pause.

setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_EXE="

REM Doppelklick direkt in der ZIP oder falsche ZIP ("Source code") erkennen.
if not exist "%SCRIPT_DIR%lugru-deals.exe" goto :fehlt_exe
if not exist "%SCRIPT_DIR%install.ps1" goto :fehlt_exe

REM PowerShell 7 (pwsh) bevorzugt, Windows PowerShell 5.1 als Fallback.
where pwsh.exe >nul 2>&1
if not errorlevel 1 set "PS_EXE=pwsh.exe"
if defined PS_EXE goto :ps_gefunden
where powershell.exe >nul 2>&1
if not errorlevel 1 set "PS_EXE=powershell.exe"
if defined PS_EXE goto :ps_gefunden
echo FEHLER: weder pwsh.exe noch powershell.exe im PATH gefunden.
set "RC=1"
goto :ende

:ps_gefunden
echo Verwende %PS_EXE%
echo Installiere nach "%SCRIPT_DIR%" ...

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1" -InstallDir "%SCRIPT_DIR%." -DataDir "%LOCALAPPDATA%\LuGruDeals" -StartNow
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
    echo.
    echo Installation abgeschlossen. Oberflaeche im Browser: http://127.0.0.1:8080
) else (
    echo.
    echo FEHLER: Installation fehlgeschlagen ^(Exit-Code %RC%^). Meldung oben lesen.
)
goto :ende

:fehlt_exe
echo FEHLER: lugru-deals.exe oder install.ps1 liegt nicht neben install.cmd.
echo.
echo  1. Auf GitHub unter "Releases" die Datei lugru-deals-windows.zip laden
echo     ^(NICHT "Source code (zip)" - darin fehlt das Programm^).
echo  2. Rechtsklick auf die ZIP - "Alle extrahieren...".
echo  3. Im entpackten Ordner install.cmd doppelklicken.
set "RC=1"

:ende
echo.
pause
endlocal & exit /b %RC%
