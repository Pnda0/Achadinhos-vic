@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ml-afiliados - rodando (feche esta janela para parar)
if not exist "node_modules" (
  echo Rode primeiro o "1-instalar.bat" e depois o "2-configurar.bat".
  pause
  exit /b 1
)
:inicio
rem Pega as mudancas que foram para o GitHub (feitas de outro PC). Sem internet ou sem git, segue com a versao atual.
rem O "git pull" pode trocar ESTE arquivo enquanto ele roda: por isso o pull e o salto ficam na mesma linha,
rem e o "goto" acha o rotulo :depois_pull de novo no arquivo novo. Nao mude o nome dos rotulos.
where git >nul 2>nul || goto :ligar
echo Atualizando o bot pelo GitHub...
git checkout -- package-lock.json 2>nul
git pull --ff-only --quiet || echo Nao consegui atualizar - seguindo com a versao que ja esta aqui.& goto :depois_pull
:depois_pull
rem Reinstala se o codigo mudou desde a ultima instalacao QUE DEU CERTO (marcador em node_modules\.instalado-em).
rem Se uma instalacao falhar, o marcador nao muda e a proxima vez tenta de novo.
set HEADATUAL=
for /f %%h in ('git rev-parse HEAD 2^>nul') do set HEADATUAL=%%h
set INSTALADO=
if exist "node_modules\.instalado-em" set /p INSTALADO=<"node_modules\.instalado-em"
if not "%INSTALADO%"=="%HEADATUAL%" (
  echo Instalando o que mudou...
  call npm install --no-audit --no-fund --silent && (git rev-parse HEAD>"node_modules\.instalado-em") || echo Falha no npm install - veja acima.
)
:ligar
echo O bot fica rodando enquanto esta janela estiver aberta.
echo Para parar: feche a janela ou aperte Ctrl+C.
echo.
call npm start --silent
rem Reinicio pedido (npm run reiniciar): o bot saiu deixando data\.reiniciar - liga de novo nesta janela, com git pull.
if exist "data\.reiniciar" (
  del "data\.reiniciar"
  echo.
  echo Reiniciando o bot...
  goto :inicio
)
echo.
echo O bot parou. Veja a mensagem acima.
pause
