@echo off
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js non trovato nel PATH. Installa Node.js e riprova.
    pause
    exit /b 1
)
node "%~dp0rewrite-public-repo.mjs"
pause
