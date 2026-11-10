@echo off
chcp 65001 >nul
title Курс по сетям
cd /d "%~dp0"

where git >nul 2>nul && (
  echo Проверяю обновления...
  git pull --ff-only -q >nul 2>nul
)

where node >nul 2>nul
if %errorlevel%==0 (
  node serve.mjs
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Нужен Node.js или Python: https://nodejs.org
    pause
    exit /b 1
  )
  start "" "http://localhost:8765/"
  python -m http.server 8765 --bind 127.0.0.1 --directory docs
)
if errorlevel 1 pause
