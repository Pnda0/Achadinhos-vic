@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ml-afiliados - relatorio
rem So le os dados e gera o relatorio (data\analytics\relatorio.html). Nao mexe no bot nem na fila.
call npm run analytics --silent -- 7d
if exist "data\analytics\relatorio.html" start "" "data\analytics\relatorio.html"
echo.
pause
