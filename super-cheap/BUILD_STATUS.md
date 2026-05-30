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

## v2 — Skills de Dirección (DESPLEGADO Y VERIFICADO)
- [x] Inserción DML + columnas `id/activo/hora/fotos` (migración aplicada en BigQuery)
- [x] Skill 1 — Analítica: comparativos, top proveedores/categorías, proyección de mes ✅ probado
- [x] Skill 2 — Alertas inteligentes (margen, egreso anómalo, caída ventas, salud SICAR) ✅ probado
- [x] Skill 3 — Asistente IA "pregúntale a tu negocio" ✅ probado
- [x] Skill 6 — Editar / borrar (soft delete) + búsqueda/filtros ✅ CRUD probado
- [x] Skill 7 — Exportar Excel/PDF (frontend)
- [x] Skill 8 — Captura multi-foto + fecha/hora auto + notas a mano (sc-ticket)
- [~] Skill 4 — Resumen diario por correo: CÓDIGO listo; falta `RESEND_API_KEY` (Resend) para activar
- [~] Skill 5 — Guardar fotos en GCS: CÓDIGO listo (graceful); falta crear bucket + permiso Storage
- Construido con arnés de 3 agentes (2 constructores + 1 revisor) sobre `CONTRACT.md` v2.
