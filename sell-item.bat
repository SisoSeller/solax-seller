@echo off
title Solax - Metti in vendita
cd /d "%~dp0"

if not exist node_modules (
  echo Installo le dipendenze...
  call npm install
)

if not exist "data\sell-token.txt" (
  echo Avvio il server per creare il token vendita...
  start "Solax Shop" cmd /k "cd /d ""%~dp0"" && npm run dev"
  timeout /t 5 /nobreak >nul
)

if not exist "data\sell-token.txt" (
  echo Non trovo il token. Avvia prima avvio.bat e riprova.
  pause
  exit /b 1
)

set /p TOKEN=<"data\sell-token.txt"
start "" "http://localhost:5173/sell?key=%TOKEN%"
echo Finestra vendita aperta. Devi essere loggato con Discord.
echo Se lo shop non e' acceso, avvia avvio.bat.
pause
