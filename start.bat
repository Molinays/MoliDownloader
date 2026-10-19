@echo off
title MoliDowloader
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo Installazione dipendenze in corso...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo ERRORE: installazione fallita. Controlla che Node.js e npm siano installati.
        pause
        exit /b 1
    )
)

echo.
echo Avvio MoliDowloader...
echo.
call npm start
if errorlevel 1 (
    echo.
    echo ERRORE durante l'avvio. Esegui "npm install" e riprova.
    pause
)
