@echo off
setlocal

set "ROOT=%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%STARTUP%\SUPER CHEAP ventas.vbs"

if not exist "%ROOT%daemon.js" (
  echo No encuentro "%ROOT%daemon.js".
  exit /b 1
)

if not exist "%ROOT%start-hidden.vbs" (
  echo No encuentro "%ROOT%start-hidden.vbs".
  exit /b 1
)

if not exist "%STARTUP%" mkdir "%STARTUP%"
copy /Y "%ROOT%start-hidden.vbs" "%TARGET%" >nul

echo Instalado: "%TARGET%"
echo Al iniciar sesion, SUPER CHEAP sincronizara ventas en segundo plano.
echo Tambien puedes iniciarlo ahora ejecutando: wscript "%TARGET%"
