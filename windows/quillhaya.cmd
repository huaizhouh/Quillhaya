@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0.tools\node-v24.22.1-win-x64\node.exe" (
  set "PATH=%~dp0.tools\node-v24.22.1-win-x64;%PATH%"
  call "%~dp0.tools\node-v24.22.1-win-x64\npm.cmd" %*
) else (
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo Install Node.js 22.12 or newer, then run this command again.
    exit /b 1
  )
  call npm.cmd %*
)
exit /b %errorlevel%
