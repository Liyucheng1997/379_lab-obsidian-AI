@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 18 及以上版本：https://nodejs.org
  pause
  exit /b 1
)
if not exist "sample-vault" node scripts\seed.js
node server.js %*
pause
