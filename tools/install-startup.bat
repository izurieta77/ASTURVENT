@echo off
set "SCRIPT=%~dp0antena-auto-reconnect.ahk"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\AntenaAutoReconnect.lnk');" ^
  "$s.TargetPath='%SCRIPT%'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo Listo. Reinicia Windows o ejecuta el .ahk a mano la primera vez.
pause
