@echo off
REM update-github.cmd - Doppelklick holt die neueste Version von GitHub.
REM Ruft update-github.ps1 aus demselben Ordner auf; Daten bleiben erhalten.

setlocal
set "SCRIPT_DIR=%~dp0"
set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>&1
if not errorlevel 1 set "PS_EXE=pwsh.exe"

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%update-github.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo FEHLER: Update fehlgeschlagen ^(Exit-Code %RC%^). Meldung oben lesen.
)
echo.
pause
endlocal & exit /b %RC%
