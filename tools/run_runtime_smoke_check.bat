@echo off
setlocal
cd /d "%~dp0.."
echo AI Patcher Runtime Smoke Check
echo.
node tools\runtime_smoke_check.js
echo.
pause
