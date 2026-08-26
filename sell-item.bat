@echo off
title SX - Metti in vendita
cd /d "%~dp0"

if not exist node_modules (
  echo Installo le dipendenze...
  call npm install
)

start "SX seller" cmd /k "cd /d ""%~dp0"" && node scripts\seller.mjs"
timeout /t 3 /nobreak >nul

if not exist "data\sell-token.txt" (
  echo Token vendita non creato. Chiudi e riprova.
  pause
  exit /b 1
)

set /p TOKEN=<"data\sell-token.txt"
start "SX vite" cmd /k "cd /d ""%~dp0"" && npm run web"
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173/sell.html?key=%TOKEN%"
echo Quando pubblichi, l'arma compare su:
echo https://sisoseller.github.io/solax-seller/
pause
