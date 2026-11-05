@echo off
chcp 65001 >nul
title AdelPrep Website - Zugangsdaten aendern
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0werkzeug\hochladen.ps1" -ZugangNeu -Testlauf
echo.
pause
