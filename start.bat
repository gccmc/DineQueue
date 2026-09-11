@echo off
title DHD Booking System - Launcher
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
    echo [ERROR] Node.js not found.
    echo Please install Node.js first.
    pause
    exit /b 1
)

echo ==========================================
echo   DHD Booking System - Launcher
echo ==========================================
echo Starting backend server...
start "DHD-Backend" /min cmd /c ""%NODE_EXE%" server.js"

echo Waiting for server...
timeout /t 2 /nobreak >nul

start "" "http://localhost:3000/index.html"
echo.
echo [OK] Server started. Browser opened automatically.
echo.
echo   Booking Platform : http://localhost:3000/index.html
echo   Kiosk Machine    : http://localhost:3000/kiosk.html
echo   Display Screen   : http://localhost:3000/display.html
echo   Admin Console    : http://localhost:3000/admin.html
echo.
pause