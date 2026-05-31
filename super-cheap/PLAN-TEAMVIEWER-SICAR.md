# Plan TeamViewer - SICAR a SUPER CHEAP

Este plan es para la PC servidor de SICAR. No se reinicia MySQL ni SICAR sin
confirmacion explicita del usuario.

## Objetivo

Terminar la sincronizacion de ventas SICAR hacia SUPER CHEAP con cambios
reversibles y sin exponer secretos.

## Antes de tocar MySQL

1. Confirmar que la tienda este cerrada o que el usuario autorice una ventana de trabajo.
2. Copiar la carpeta actual `C:\super-cheap` a `C:\super-cheap-backup-YYYYMMDD-HHMM`.
3. Guardar una copia local de `sicar-bridge\config.json` si existe.
4. Confirmar que Node.js funciona con:
   ```bat
   node --version
   npm --version
   ```
5. Instalar dependencias en `C:\super-cheap\sicar-bridge`:
   ```bat
   npm install
   ```

## Ruta segura sin MySQL

1. Exportar ventas de SICAR a Excel/CSV.
2. Probar lectura sin enviar:
   ```bat
   node sync.js --excel ventas-sicar.xlsx --dry-run
   ```
3. Si el conteo se ve correcto, enviar:
   ```bat
   node sync.js --excel ventas-sicar.xlsx
   ```
4. Revisar el dashboard y el log local en `sicar-bridge\logs`.

## Ruta MySQL de solo lectura

1. Ejecutar solo lectura:
   ```bat
   node descubrir.js
   ```
2. Con el reporte, ajustar `sqlVentas` para que devuelva:
   - `fecha`
   - `ticket_id`
   - `total`
   - `forma_pago`
   - opcional: `venta_key`, `caja`, `producto`, `cantidad`, `importe`
3. Probar sin enviar con un Excel si MySQL no esta listo; si MySQL ya esta listo,
   usar una fecha antigua y validar conteos.
4. Crear usuario MySQL de solo lectura solo con confirmacion explicita y con la
   tienda cerrada. No usar usuario administrador para tarea programada.
5. Programar `node sync.js` al cierre del dia en el Programador de tareas.

## Reversion

- Restaurar `C:\super-cheap` desde la carpeta backup.
- Eliminar o desactivar la tarea programada.
- En BigQuery no se borran datos automaticamente; si se importo un Excel equivocado,
  se corrige con consulta controlada por `ticket_id`/fecha y confirmacion del usuario.

## Notas de seguridad

- No imprimir ni pegar tokens, contrasenas, service account JSON ni `.env`.
- No subir `config.json`, logs ni archivos Excel reales a git.
- El importador del dashboard usa sesion del PIN; el token de ingesta SICAR queda solo
  en Netlify/bridge local.
