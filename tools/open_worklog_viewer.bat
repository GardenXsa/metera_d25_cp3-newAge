@echo off
setlocal
cd /d "%~dp0.."
echo AI Patcher Worklog Viewer
echo.
echo Opening local viewer for docs\AI_PATCHER_WORKLOG.md
echo Close this window to stop the viewer.
echo.
node tools\worklog_viewer_server.js
pause
