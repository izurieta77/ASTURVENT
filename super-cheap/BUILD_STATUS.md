# Estado de construcción — SUPER CHEAP

Arnés de seguimiento para no perder nada ni repetir pasos. Se actualiza tras cada hito.

## Hecho
- [x] Estructura de carpetas `super-cheap/`
- [x] `netlify.toml`, `package.json`, `.env.example`, `.gitignore`
- [x] `netlify/functions/_lib.js` (CORS + tokens HMAC)
- [x] `CONTRACT.md` (contrato de API — fuente única de verdad)

## Construcción (3 agentes: 2 builders + 1 revisor) — COMPLETA
- [x] **Agente A — Backend & Datos**: `_bq.js`, `auth.js`, `sc-data.js`, `sc-ingest.js`, `bigquery-setup.sql`
- [x] **Agente B — Frontend & Bridge**: `index.html`, `sicar-bridge/*`
- [x] **Agente C — Revisor**: auditoría extremo-a-extremo + correcciones
  - Detectó y creó el faltante `sc-ticket.js` (lectura de tickets con IA, IVA/IEPS)
  - Endureció `sc-data.js` (serialización de `conceptos`) y documentó CORS en `_lib.js`
  - Confirmó: nombres de campos alineados FE↔BE↔esquema, auth en todas las rutas,
    consultas parametrizadas, NUMERIC→Number en KPIs. Todos los .js pasan `node --check`.

## Pendiente de datos del usuario (no bloquea el código)
- [ ] `GCP_PROJECT_ID` + Service Account JSON (BigQuery)
- [ ] Credenciales MySQL de SICAR + esquema real de la tabla de ventas
- [ ] Crear el sitio Netlify (base dir = `super-cheap/`) y poner env vars
- [ ] Agregar el dominio del sitio a `ALLOWED_ORIGINS` en `_lib.js`

## Fases
1. Base funcional (login + resumen + carga manual)
2. IA en tickets (OCR de compras/gastos)
3. Sincronización SICAR (bridge + ingest)
