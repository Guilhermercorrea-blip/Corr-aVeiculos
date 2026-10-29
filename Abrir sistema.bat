@echo off
chcp 65001 >nul
title Correa Veiculos - nao feche esta janela
cd /d "%~dp0"

rem Se o sistema ja estiver aberto, so abre o navegador
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:3000
  exit /b
)

rem Espera 2 segundos o sistema ligar antes de abrir o navegador
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node --disable-warning=ExperimentalWarning server.js
pause
