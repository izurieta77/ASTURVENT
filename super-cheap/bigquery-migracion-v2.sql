-- =============================================================================
-- SUPER CHEAP — Migración v2 (mejoras "Skills de Dirección")
-- =============================================================================
-- Agrega columnas necesarias para: editar/borrar registros (id, activo),
-- hora de compra leída del ticket (hora) y múltiples fotos por ticket (fotos).
--
-- Ejecútalo UNA vez en BigQuery (proyecto supercheap-app). Es seguro: usa
-- ADD COLUMN IF NOT EXISTS, así que no rompe nada si ya existe.
-- =============================================================================

-- 1) Columna id (UUID por fila) en las 4 tablas.
ALTER TABLE `supercheap-app.super_cheap.ventas`  ADD COLUMN IF NOT EXISTS id STRING;
ALTER TABLE `supercheap-app.super_cheap.compras` ADD COLUMN IF NOT EXISTS id STRING;
ALTER TABLE `supercheap-app.super_cheap.gastos`  ADD COLUMN IF NOT EXISTS id STRING;
ALTER TABLE `supercheap-app.super_cheap.nomina`  ADD COLUMN IF NOT EXISTS id STRING;

-- 2) Columna activo (borrado suave). Default TRUE para filas nuevas.
ALTER TABLE `supercheap-app.super_cheap.ventas`  ADD COLUMN IF NOT EXISTS activo BOOL;
ALTER TABLE `supercheap-app.super_cheap.compras` ADD COLUMN IF NOT EXISTS activo BOOL;
ALTER TABLE `supercheap-app.super_cheap.gastos`  ADD COLUMN IF NOT EXISTS activo BOOL;
ALTER TABLE `supercheap-app.super_cheap.nomina`  ADD COLUMN IF NOT EXISTS activo BOOL;

-- 3) Hora de compra (HH:MM) y lista de fotos (JSON) en compras y gastos.
ALTER TABLE `supercheap-app.super_cheap.compras` ADD COLUMN IF NOT EXISTS hora STRING;
ALTER TABLE `supercheap-app.super_cheap.compras` ADD COLUMN IF NOT EXISTS fotos STRING;
ALTER TABLE `supercheap-app.super_cheap.gastos`  ADD COLUMN IF NOT EXISTS hora STRING;
ALTER TABLE `supercheap-app.super_cheap.gastos`  ADD COLUMN IF NOT EXISTS fotos STRING;

-- 3b) Clasificacion inteligente del ticket (maquila|reventa|mixto|otro).
--     El detalle por concepto (uso/ingrediente) viaja dentro de `conceptos` (JSON).
ALTER TABLE `supercheap-app.super_cheap.compras` ADD COLUMN IF NOT EXISTS clasificacion STRING;
ALTER TABLE `supercheap-app.super_cheap.gastos`  ADD COLUMN IF NOT EXISTS clasificacion STRING;

-- 4) Backfill: marcar como activas las filas existentes y darles un id.
--    (Si alguna fila fue insertada hace < ~90 min puede fallar por el streaming
--    buffer; en ese caso vuelve a correr este bloque más tarde.)
UPDATE `supercheap-app.super_cheap.ventas`  SET activo = TRUE WHERE activo IS NULL;
UPDATE `supercheap-app.super_cheap.compras` SET activo = TRUE WHERE activo IS NULL;
UPDATE `supercheap-app.super_cheap.gastos`  SET activo = TRUE WHERE activo IS NULL;
UPDATE `supercheap-app.super_cheap.nomina`  SET activo = TRUE WHERE activo IS NULL;

UPDATE `supercheap-app.super_cheap.ventas`  SET id = GENERATE_UUID() WHERE id IS NULL;
UPDATE `supercheap-app.super_cheap.compras` SET id = GENERATE_UUID() WHERE id IS NULL;
UPDATE `supercheap-app.super_cheap.gastos`  SET id = GENERATE_UUID() WHERE id IS NULL;
UPDATE `supercheap-app.super_cheap.nomina`  SET id = GENERATE_UUID() WHERE id IS NULL;

-- 5) Detalle por articulo de SICAR para dashboards de producto/caja/hora.
--    Es una tabla nueva: no modifica la tabla `ventas` existente.
CREATE TABLE IF NOT EXISTS `supercheap-app.super_cheap.ventas_articulos` (
  id           STRING,
  fecha        DATE,
  ticket_id    STRING,
  linea_key    STRING,
  caja         STRING,
  hora         STRING,
  producto     STRING,
  clave        STRING,
  cantidad     NUMERIC,
  precio       NUMERIC,
  importe      NUMERIC,
  forma_pago   STRING,
  departamento STRING,
  categoria    STRING,
  fuente       STRING,
  activo       BOOL,
  ts           TIMESTAMP
);
