@echo off
REM uninstall.cmd - CMD-Wrapper fuer die saubere Deinstallation.
REM
REM Benoetigt: PowerShell 5.1+ (pwsh oder Windows PowerShell).
REM Wirkung: ruft uninstall.ps1 auf und gibt alles 1:1 weiter.
REM Fehlerlevel via "if errorlevel" - siehe install.cmd.

setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_EXE="

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
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%uninstall.ps1" -InstallDir "%SCRIPT_DIR%."
set "RC=%ERRORLEVEL%"

:ende
echo.
pause
endlocal & exit /b %RC%
