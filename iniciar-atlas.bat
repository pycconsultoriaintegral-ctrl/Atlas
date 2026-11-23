@echo off
chcp 65001 >nul
title ATLAS - cerebro central
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Descargalo desde https://nodejs.org ^(version LTS^), instalalo y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando componentes por primera vez ^(puede tardar unos minutos^)...
  call npm install
  if errorlevel 1 goto error
)

if not exist .env call npm run setup

echo Preparando ATLAS...
call npm run build
if errorlevel 1 goto error

start "" http://localhost:8787
call npm start
pause
exit /b 0

:error
echo.
echo  Algo salio mal. Revisa los mensajes de arriba o consulta docs\INSTALACION-WINDOWS.md
pause
exit /b 1
