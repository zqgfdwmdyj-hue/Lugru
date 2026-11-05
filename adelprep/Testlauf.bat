@echo off
chcp 65001 >nul
title AdelPrep Website - Testlauf (laedt nichts hoch)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0werkzeug\hochladen.ps1" -Testlauf
echo.
pause
