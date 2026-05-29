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
