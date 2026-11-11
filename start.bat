@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 手排公車模擬器

where node >nul 2>nul
if errorlevel 1 goto nonode

start "" "http://localhost:8765/"
node server.js
goto fail

:nonode
echo 找不到 Node.js，請先到 https://nodejs.org/ 下載安裝後再執行。

:fail
echo.
pause