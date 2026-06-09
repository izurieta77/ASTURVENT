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
- **ventas_articulos**: `fecha DATE, ticket_id STRING, linea_key STRING, caja STRING, hora STRING, producto STRING, clave STRING, cantidad NUMERIC, precio NUMERIC, importe NUMERIC, forma_pago STRING, departamento STRING, categoria STRING, fuente STRING, activo BOOL, ts TIMESTAMP`
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
- Las mismas lineas tambien se guardan en `ventas_articulos` cuando existe la tabla,
  para alimentar top articulos, cajas, horas, filtros y respaldo historico por producto.
- Respuesta `{ ok:true, recibidos, validos, insertados, duplicados, descartados }`.

### GET `?action=ventas_panel&desde&hasta&caja=&pago=`
Devuelve datos ya agregados para el Panel Operativo:
```
{ ok:true,
  detalle_disponible:Boolean,
  kpis:{ventas, compras, gastos, nomina, utilidad, margen, tickets, items, ticket_promedio},
  serie_ventas:[{fecha,total,tickets,items}],
  top_articulos:[{producto, clave, cantidad, importe, tickets}],
  formas_pago:[{forma_pago,total,tickets,pct}],
  por_hora:[{hora,total,tickets}],
  cajas:[String], pagos:[String],
  ultima_venta:String|null
}
```

### GET `?action=tendencia_compras_ventas&desde=&hasta=&agrupar=mes|dia`
Devuelve la serie agregada para auditar si compras rebasa ventas. Si `desde` no se manda, usa el primer dia con ventas o compras.
```
{ ok:true,
  filtros:{desde,hasta,agrupar},
  resumen:{
    total_ventas,total_compras,total_brecha,compras_pct_ventas,
    periodos,periodos_compras_mayores_ventas,
    compras_manual,compras_inventario_sicar,compras_ajuste_olvidado,
    compras_existencia_negativa,compras_otras_sicar,
    peor_periodo:{periodo,ventas,compras,brecha}
  },
  periodos:[{
    periodo,ventas,compras,brecha,compras_pct_ventas,
    compras_mayores_ventas,
    compras_manual,compras_inventario_sicar,compras_ajuste_olvidado,
    compras_existencia_negativa,compras_otras_sicar
  }]
}
```

### GET `?action=plan_compras_semanal&desde=&hasta=&limite=`
Devuelve una guia de compra semanal por producto, calculada desde `ventas_articulos`.
Si `desde/hasta` no se mandan, usa el anio actual hasta hoy.
`limite` se fuerza entre 50 y 3000 productos. Antes de sumar ventas se deduplican
lineas por `fecha + ticket_id + linea_key` para reducir riesgo de reingestas.
La categoria usa la categoria/departamento de SICAR cuando existe; si viene vacia,
se infiere de palabras del producto para separar bebidas, botanas, pan, abarrotes,
limpieza, cuidado personal, comida preparada, cigarros, papeleria/varios y vinos/licores.
Regla operativa: `ceil(piezas vendidas por semana)` y colchon maximo de `+2`
piezas solo si el precio promedio vendido es mayor a 0, no excede $100 y el
producto rota. Si rota menos de 1 pieza/semana no recibe colchon; de 1 a menos
de 2 recibe +1; desde 2 piezas/semana recibe +2.
El costo semanal usa el ultimo `costo_unitario` disponible en `compras.conceptos`.
Matching de costo: primero por clave normalizada; solo usa producto normalizado si
no hay clave y el nombre no parece ambiguo. Si falta costo, se devuelve `null` y la
UI lo marca como pendiente.
```
{ ok:true,
  detalle_disponible:Boolean,
  filtros:{desde,hasta,limite},
  regla:{base:String,colchon:String},
  resumen:{
    total_productos,productos_sugeridos,categorias,semanas_periodo,
    piezas_semana_total,compra_sugerida_total,productos_colchon,
    costo_estimado_semana,productos_con_costo,productos_sin_costo
  },
  categorias:[{
    categoria,productos,piezas_semana,compra_sugerida_semana,importe_anio,
    costo_estimado_semana,productos_sin_costo
  }],
  productos:[{
    categoria,producto,clave,
    unidades_anio,importe_anio,semanas_con_venta,dias_con_venta,tickets,
    piezas_semana,precio_promedio,
    compra_base_semana,colchon_piezas,compra_sugerida_semana,
    costo_unitario,costo_semana,costo_fecha,costo_origen,costo_proveedor,
    costo_metodo,costo_confianza,
    prioridad
  }]
}
```

Exportacion del plan semanal:
- Hoja `Plan semanal` con `Costo unitario` por producto e `Importe compra semanal`.
- Hoja `Flujo de caja` con venta semanal estimada, reserva de gastos, disponible
  para compras, tope de compra hoy y compra autorizada.
- Hojas operativas `Comprar hoy`, `Esta semana` y `Ventas buenas`, calculadas
  contra el presupuesto editable de flujo de caja para evitar autorizar el plan
  completo de golpe.
- Hoja `Pendientes costo` cuando existan productos sin costo unitario registrado.
- Las columnas de costo se exportan como moneda cuando SheetJS esta disponible.

## sc-ingest v2 compatible
- Sigue aceptando el contrato original `{ ventas:[ { fecha, ticket_id, total, forma_pago, items } ] }`.
- Para evitar duplicados mas robustos, el bridge nuevo manda `venta_key` estable
  (`sicar:fecha:caja:ticket` o `excel:fecha:caja:ticket`); esa llave se guarda en
  `ventas.ticket_id`.
- Si no viene `venta_key`, se conserva el `ticket_id` recibido para no duplicar datos
  historicos enviados por versiones anteriores.

## sc-inventory-ingest
- Endpoint: `/.netlify/functions/sc-inventory-ingest`.
- Lo llama `sicar-bridge` con `X-Ingest-Token`, igual que `sc-ingest`.
- Entrada: `{ movimientos:[ { fecha, hora?, movimiento_id?, movimiento_key?, producto, clave?, cantidad_delta|cantidad|entrada|existencia_anterior+existencia_nueva, costo_unitario|costo|precio_compra|precio|total|importe, proveedor?, departamento?, categoria? } ] }`.
- Solo procesa aumentos positivos de inventario. Salidas, mermas, ventas, bajas o deltas negativos se descartan.
- Inserta cada aumento como fila en `compras` con `raw_ocr='sicar_inventory:*'`, para que reenviar el mismo movimiento no lo duplique.
- Si no hay proveedor, usa `Inventario SICAR`; si no hay categoria/departamento, usa `inventario`.

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
