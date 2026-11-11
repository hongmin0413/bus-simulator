@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 手排公車模擬器

where node >nul 2>nul
if errorlevel 1 goto nonode

rem 伺服器啟動後會自己確認連得上 8765 埠，確定拿得到首頁才開瀏覽器
node server.js --open
goto fail

:nonode
echo 找不到 Node.js，請先到 https://nodejs.org/ 下載安裝後再執行。

:fail
echo.
pause