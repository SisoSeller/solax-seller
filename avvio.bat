@echo off
title Solax Shop
cd /d "%~dp0"

if not exist node_modules (
  echo Installo le dipendenze...
  call npm install
)

echo Avvio Solax...
start "" "http://localhost:5173/"
call npm run dev
pause
