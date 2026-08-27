@echo off
title Jinius - ZIP per Discloud
cd /d "%~dp0bot"

if not exist .env (
  copy /Y .env.example .env >nul
  echo Incolla il token del bot dopo DISCORD_TOKEN=
  echo Lo trovi qui:
  echo https://discord.com/developers/applications/1542254767521145003/bot
  echo.
  notepad .env
  echo Salva il file, poi rilancia questo .bat
  pause
  exit /b 1
)

if exist "%~dp0jinius-discloud.zip" del /f "%~dp0jinius-discloud.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'index.js','paypal-orders.mjs','package.json','discloud.config','.env','.discloudignore' -DestinationPath '%~dp0jinius-discloud.zip' -Force"
echo.
echo ZIP pronto: jinius-discloud.zip
echo Nel .env del bot metti PAYPAL_CLIENT_ID e PAYPAL_CLIENT_SECRET Live
echo Su Discloud crea il sottodominio jinius - poi: Applications - Upload ZIP
echo.
start "" "https://discloud.app/"
pause
