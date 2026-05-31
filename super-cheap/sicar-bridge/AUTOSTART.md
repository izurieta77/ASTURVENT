# SUPER CHEAP - arranque automatico del puente SICAR

Estos archivos dejan el puente corriendo oculto en la computadora de SICAR:

- `daemon.js`: ejecuta `sync.js` cada 15 minutos para hoy y ayer.
- `start-hidden.vbs`: inicia `daemon.js` sin ventana visible.
- `install-startup.cmd`: instala el arranque en el usuario actual de Windows.
- `backfill.js`: sube un historico dia por dia y guarda avance en `backfill-state.json`.

Instalacion manual:

```bat
cd C:\super-cheap
install-startup.cmd
```

Despues de instalarlo, cada vez que ese usuario inicie sesion, el puente se levantara
oculto y mandara ventas a la app. No depende de una hora fija: mantiene una cola
local de fechas pendientes en `sync-state.json`, reintenta automaticamente cuando
falle internet, MySQL o Netlify, y sube la informacion en cuanto el envio vuelva a
funcionar. Los logs quedan en `C:\super-cheap\logs`.

Variables opcionales:

- `SC_SYNC_INTERVAL_MINUTES`: minutos entre sincronizaciones. Default: `15`.
- `SC_SYNC_DAYS_BACK`: dias hacia atras que tambien se re-sincronizan. Default: `7`.
- `SC_SYNC_RETRY_SECONDS`: segundos para reintentar una fecha fallida. Default: `60`.
- `SC_SYNC_START_DELAY_SECONDS`: espera inicial despues del arranque. Default: `20`.
- `SC_SYNC_HTTP_TIMEOUT_SECONDS`: timeout del envio a Netlify. Default: `45`.
- `SC_SYNC_CHILD_TIMEOUT_MINUTES`: maximo permitido por ejecucion de `sync.js`. Default: `10`.

Backfill historico:

```bat
cd C:\super-cheap
node backfill.js 2024-05-01 2026-05-30
```

Para dejar ese historico corriendo oculto en la PC de SICAR, abre
`start-backfill-2024-05-to-2026-05-30.vbs`. Si falla internet, MySQL o Netlify,
el proceso se queda en la misma fecha y reintenta. Si la PC se apaga, vuelve a
ejecutar el mismo VBS y continuara desde `backfill-state.json`.

No pongas claves en estos scripts. Las credenciales locales viven en `config.json` o
en Windows, y ese archivo no debe subirse a Git.
