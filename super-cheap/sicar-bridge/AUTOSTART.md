# SUPER CHEAP - arranque automatico del puente SICAR

Estos archivos dejan el puente corriendo oculto en la computadora de SICAR:

- `daemon.js`: ejecuta `sync.js` cada 15 minutos para hoy y ayer.
- `start-hidden.vbs`: inicia `daemon.js` sin ventana visible.
- `install-startup.cmd`: instala el arranque en el usuario actual de Windows.

Instalacion manual:

```bat
cd C:\super-cheap
install-startup.cmd
```

Despues de instalarlo, cada vez que ese usuario inicie sesion, el puente se levantara
oculto y mandara ventas a la app. Los logs quedan en `C:\super-cheap\logs`.

Variables opcionales:

- `SC_SYNC_INTERVAL_MINUTES`: minutos entre sincronizaciones. Default: `15`.
- `SC_SYNC_DAYS_BACK`: dias hacia atras que tambien se re-sincronizan. Default: `1`.
- `SC_SYNC_START_DELAY_SECONDS`: espera inicial despues del arranque. Default: `20`.

No pongas claves en estos scripts. Las credenciales locales viven en `config.json` o
en Windows, y ese archivo no debe subirse a Git.
