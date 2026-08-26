@echo off
title SX - Metti in vendita
cd /d "%~dp0"
set GITHUB_PAGES=

if not exist node_modules (
  echo Installo le dipendenze...
  call npm install
)

echo.
echo Avvio vendita. NON chiudere le finestre nere.
echo Il form si apre nel BROWSER, non nel terminale.
echo.

start "SX vendita" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo Attendo che seller e sito locale partano...
node scripts\wait-sell.mjs
if errorlevel 1 (
  echo Non e partito. Chiudi le altre finestre SX / Vite e rilancia sell-item.bat.
  pause
  exit /b 1
)

if not exist "data\sell-token.txt" (
  echo Token vendita non creato. Chiudi e riprova.
  pause
  exit /b 1
)

set /p TOKEN=<"data\sell-token.txt"
start "" "http://127.0.0.1:5173/sell.html?key=%TOKEN%"
echo.
echo Pronto: vendi dal browser.
echo Quando pubblichi, l'arma compare su:
echo https://sisoseller.github.io/solax-seller/
echo.
pause
