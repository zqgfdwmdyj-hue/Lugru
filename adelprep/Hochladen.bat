@echo off
chcp 65001 >nul
title AdelPrep Website hochladen
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0werkzeug\hochladen.ps1"
echo.
pause
