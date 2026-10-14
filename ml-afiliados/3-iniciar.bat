@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ml-afiliados - rodando (feche esta janela para parar)
if not exist "node_modules" (
  echo Rode primeiro o "1-instalar.bat" e depois o "2-configurar.bat".
  pause
  exit /b 1
)
rem Pega as mudancas que foram para o GitHub (feitas de outro PC). Sem internet ou sem git, segue com a versao atual.
where git >nul 2>nul || goto :ligar
echo Atualizando o bot pelo GitHub...
git pull --ff-only --quiet || echo Nao consegui atualizar - seguindo com a versao que ja esta aqui.
call npm install --no-audit --no-fund --silent >nul 2>nul
:ligar
echo O bot fica rodando enquanto esta janela estiver aberta.
echo Para parar: feche a janela ou aperte Ctrl+C.
echo.
call npm start --silent
echo.
echo O bot parou. Veja a mensagem acima.
pause
