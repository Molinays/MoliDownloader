@echo off
title MoliDownloader
cd /d "%~dp0"
echo.
echo Online.
echo.
python "%~dp0server.py"
if errorlevel 1 (
    echo.
    echo  ERRORE: controlla che Python sia installato.
    pause
)
