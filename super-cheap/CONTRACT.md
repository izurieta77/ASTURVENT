# Contrato de API — SUPER CHEAP (fuente única de verdad)

Este documento es el "arnés": define el contrato exacto entre frontend, backend,
BigQuery y el bridge de SICAR. **Cualquier cambio de forma de datos se hace aquí
primero** para que nadie diverja.

## Autenticación
- Login: `POST /.netlify/functions/auth`  body `{ pin: "1234" }`
  - OK → `{ ok:true, token:"<b64>.<hmac>", session:{ tipo:"sc", exp:<ms> } }`
  - Mal PIN → 401 `{ ok:false, error:"PIN incorrecto" }`
- Todas las llamadas a `sc-data` van con header `Authorization: Bearer <token>`.
- El token se firma/verifica con HMAC usando `AUTH_SECRET` (helpers en `_lib.js`:
  `signToken`, `verifyToken`, `bearer`).

## sc-data  (`/.netlify/functions/sc-data`)
Toda respuesta tiene forma `{ ok:boolean, ... }`. Requiere Bearer token válido.

### GET `?action=resumen&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
Devuelve KPIs agregados del rango:
```
{ ok:true, kpis:{
    ventas:Number, compras:Number, gastos:Number, nomina:Number,
    utilidad:Number,        // ventas - compras - gastos - nomina
    margen:Number,          // utilidad / ventas * 100  (0 si ventas=0)
    iva_compras:Number, ieps_compras:Number
  },
  serie_ventas:[ { fecha:"YYYY-MM-DD", total:Number } ],   // por día
  gastos_por_categoria:[ { categoria:String, total:Number } ]
}
```

### GET `?action=lista&tabla=ventas|compras|gastos|nomina&desde=&hasta=`
Devuelve `{ ok:true, filas:[ {...} ] }` con las columnas de la tabla (ver Esquema).

### POST  body `{ action:"insertar", tabla:"compras|gastos|nomina", fila:{...} }`
Inserta una fila. Valida campos requeridos. Devuelve `{ ok:true, insertados:1 }`.
(`ventas` NO se inserta por aquí; entra por `sc-ingest`.)

## sc-ticket  (`/.netlify/functions/sc-ticket`)
Lee un ticket con IA. Requiere Bearer token válido.
- `POST` body `{ imagen_base64:"<data sin encabezado data:>", tipo:"compra|gasto" }`
- Respuesta:
```
{ ok:true, datos:{
    fecha:"YYYY-MM-DD"|null, proveedor:String|null, categoria:String|null,
    subtotal:Number, iva:Number, ieps:Number, total:Number,
    conceptos:[ { descripcion:String, importe:Number } ],
    impuestos_estimados:Boolean,   // true si IVA/IEPS se calcularon (no venían en el ticket)
    revisar:Boolean,               // true si subtotal+iva+ieps NO cuadra con total
    nota:String                    // explicación corta para el usuario
} }
```
- Reglas de impuestos:
  1. Si el ticket desglosa IVA/IEPS → se usan tal cual, `impuestos_estimados=false`.
  2. Si NO los desglosa → el `total` ya los incluye; se estima IVA 16% y IEPS solo si
     aplica; `impuestos_estimados=true`.
  3. Validar `|subtotal+iva+ieps - total| <= 0.50` → si no, `revisar=true`.
- El frontend SIEMPRE muestra estos datos en un formulario editable antes de guardar.

## sc-ingest  (`/.netlify/functions/sc-ingest`)  — lo usa el bridge de SICAR
- Auth por token compartido: header `X-Ingest-Token: <SICAR_INGEST_TOKEN>`.
- `POST` body `{ ventas:[ { fecha, ticket_id, total, forma_pago, items } ] }`
- Idempotente por `ticket_id` (no duplica si se reenvía).
- Respuesta `{ ok:true, recibidos:N, insertados:M }`.

## Esquema BigQuery  (dataset `super_cheap`, proyecto = `GCP_PROJECT_ID`)
- **ventas**:  `fecha DATE, ticket_id STRING, total NUMERIC, forma_pago STRING, items INT64, fuente STRING, ts TIMESTAMP`
- **compras**: `fecha DATE, proveedor STRING, subtotal NUMERIC, iva NUMERIC, ieps NUMERIC, total NUMERIC, impuestos_estimados BOOL, categoria STRING, conceptos STRING, foto_url STRING, raw_ocr STRING, ts TIMESTAMP`
- **gastos**:  `fecha DATE, concepto STRING, categoria STRING, subtotal NUMERIC, iva NUMERIC, ieps NUMERIC, total NUMERIC, impuestos_estimados BOOL, foto_url STRING, ts TIMESTAMP`
- **nomina**:  `periodo STRING, fecha DATE, empleado STRING, monto NUMERIC, tipo STRING, ts TIMESTAMP`

## Variables de entorno (Netlify)
`SC_PIN, AUTH_SECRET, GCP_PROJECT_ID, BQ_DATASET(=super_cheap), GCP_SA_KEY, OPENAI_API_KEY, SICAR_INGEST_TOKEN`

## Convenciones de código
- Funciones CommonJS (`exports.handler`), Node 18+. Reusar `_lib.js` para CORS/token.
- Cliente BigQuery centralizado en `_bq.js` (no instanciar en cada función).
- Sin secretos en el frontend. Montos en MXN, números con 2 decimales en la UI.

---

# CONTRATO v2 — Mejoras "Skills de Dirección"

## Esquema (columnas nuevas; ver bigquery-migracion-v2.sql)
- TODAS las tablas: `id STRING` (UUID generado en backend), `activo BOOL` (soft delete).
- `compras`/`gastos`: además `hora STRING` (HH:MM o null) y `fotos STRING` (JSON array de URLs).
- Las consultas de lectura/agregado SIEMPRE filtran `activo = TRUE` (o `activo IS NULL` para
  compatibilidad con filas viejas → usar `COALESCE(activo, TRUE)`).

## `_bq.js` (interfaz que deben respetar las funciones)
- `query(sql, params)` — igual que antes.
- `insertRows(tabla, filas)` — ahora usa **DML `INSERT INTO`** parametrizado (no streaming),
  para permitir editar/borrar de inmediato. Aplica CAST por nombre de columna:
  `fecha`→`DATE(@x)`, `total|subtotal|iva|ieps|monto`→`CAST(@x AS NUMERIC)`,
  `items`→`CAST(@x AS INT64)`, `impuestos_estimados|activo`→`CAST(@x AS BOOL)`,
  `ts`→`CURRENT_TIMESTAMP()` (no param), resto STRING. Valida que los nombres de columna
  sean `[a-z_]+`.
- `actualizar(tabla, id, campos)` — `UPDATE ... SET ... WHERE id=@id` (DML parametrizado).
- `softDelete(tabla, id)` — `UPDATE ... SET activo=FALSE WHERE id=@id`.

## sc-data — acciones nuevas
### GET `?action=analitica&desde&hasta`
```
{ ok:true,
  comparativo:{
    actual:{ventas,compras,gastos,nomina,utilidad},
    anterior:{...}, cambio_pct:{ventas,compras,gastos,nomina,utilidad} },
  top_proveedores:[ {proveedor, total, conteo} ],   // de compras
  top_categorias_gasto:[ {categoria, total} ],
  proyeccion_mes:{ ventas_proy:Number, utilidad_proy:Number, dias_transcurridos:Int, dias_mes:Int }
}
```
### GET `?action=alertas`
```
{ ok:true, alertas:[ { nivel:"info|warn|alto", tipo:String, mensaje:String } ] }
```
Reglas: margen < META_MARGEN (default 20); gasto/compra del día > 2× promedio diario del
mes; ventas de ayer < 60% del mismo día de la semana pasada; salud SICAR (sin ventas
`fuente='sicar'` ayer/hoy).
### POST `{action:"insertar", tabla, fila, imagenes_base64?:[...] }`
- `fila` puede incluir `hora`. El backend SIEMPRE genera `id` (UUID) y pone `activo:true`.
- Si vienen `imagenes_base64`, el backend las sube a GCS (Skill 5) y llena `fotos`/`foto_url`.
  Si GCS no está configurado o falla, se guarda igual SIN fotos (no bloquea).
### POST `{action:"actualizar", tabla, id, fila}` → `{ ok:true, actualizados:1 }`
### POST `{action:"eliminar", tabla, id}` → `{ ok:true, eliminados:1 }` (soft delete)
### POST `{action:"importar_ventas", ventas:[...]}` → Plan B Excel SICAR
- Requiere Bearer token del dashboard; NO expone `SICAR_INGEST_TOKEN` en el navegador.
- Usa el mismo normalizador que `sc-ingest`.
- Campos aceptados por fila: `fecha`, `ticket_id`, `venta_key|source_key`, `total`,
  `forma_pago|metodo_pago`, y opcionalmente `producto`, `cantidad`, `importe`, `caja`.
- Si llegan lineas de producto, se agrupan por `venta_key` para insertar un solo ticket
  en BigQuery y mantener KPIs compatibles.
- Respuesta `{ ok:true, recibidos, validos, insertados, duplicados, descartados }`.

## sc-ingest v2 compatible
- Sigue aceptando el contrato original `{ ventas:[ { fecha, ticket_id, total, forma_pago, items } ] }`.
- Para evitar duplicados mas robustos, el bridge nuevo manda `venta_key` estable
  (`sicar:fecha:caja:ticket` o `excel:fecha:caja:ticket`); esa llave se guarda en
  `ventas.ticket_id`.
- Si no viene `venta_key`, se conserva el `ticket_id` recibido para no duplicar datos
  historicos enviados por versiones anteriores.

## sc-ticket — multi-foto + fecha/hora + manuscritos (Skill 8)
- Entrada: `{ imagenes_base64:[...], tipo:"compra|gasto" }` (acepta también `imagen_base64`).
- Manda TODAS las imágenes en una sola llamada de visión; son **partes del MISMO** ticket/nota
  → fusiona conceptos/totales sin duplicar. Lee documentos **impresos o a mano**.
- Respuesta `datos` ahora incluye **`hora`** (HH:MM|null) además de `fecha`. Si la fecha no es
  legible → `revisar:true`. Resto igual (subtotal/iva/ieps/total/conceptos/impuestos_estimados/nota).

## sc-chat (nuevo) — `/.netlify/functions/sc-chat`
- `POST { pregunta }` + Bearer. Arma contexto acotado desde BigQuery (KPIs mes actual y
  anterior, serie de ventas, top proveedores/categorías, alertas) y pregunta a OpenAI.
- Respuesta `{ ok:true, respuesta:String }`. NO ejecuta SQL arbitrario del modelo.

## sc-resumen-diario (nuevo, programada) — Netlify Scheduled Function
- `export const config = { schedule: "0 14 * * *" }`. Calcula resumen del día anterior +
  alertas, redacta con OpenAI y envía correo vía Resend (`RESEND_API_KEY`, `MAIL_TO`,
  `MAIL_FROM`). Si falta `RESEND_API_KEY`, no envía (log y salir OK).

## _gcs.js (nuevo)
- `subirImagenes(base64Array, prefijo)` → sube a `GCS_BUCKET` y devuelve `[url,...]`.
- Si `GCS_BUCKET`/credenciales no están, devuelve `[]` sin lanzar error (graceful).

## Frontend (index.html) v2
- Reusa el helper `apiFetch` (Bearer). Nuevas vistas/zonas: Análisis (comparativos,
  proyección, tops), Asistente (chat a sc-chat), banner de Alertas en Resumen,
  editar/borrar + buscador/filtros en listas, botones Exportar Excel (SheetJS por CDN) y
  PDF (print), y captura **multi-foto** (varias imágenes → sc-ticket → formulario con
  fecha/hora rellenadas).
