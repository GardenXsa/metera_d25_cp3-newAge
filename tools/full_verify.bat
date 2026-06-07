@echo off
setlocal
cd /d "%~dp0.."
node tools\full_verify.js
exit /b %ERRORLEVEL%
