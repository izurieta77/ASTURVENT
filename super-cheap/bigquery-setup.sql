-- =============================================================================
-- SUPER CHEAP — Inicializacion de BigQuery
-- =============================================================================
-- Este script se ejecuta UNA SOLA VEZ para crear el dataset y las 4 tablas.
-- El esquema debe coincidir EXACTAMENTE con el de CONTRACT.md.
--
-- Como ejecutarlo:
--   Opcion A (consola web): BigQuery Studio -> nuevo "Query" -> pega y ejecuta.
--   Opcion B (bq CLI):      bq query --use_legacy_sql=false < bigquery-setup.sql
--
-- IMPORTANTE: reemplaza el placeholder `TU_PROYECTO` por el id real del proyecto
-- (el mismo valor de la env var GCP_PROJECT_ID). Si cambias el nombre del dataset,
-- usa el mismo valor en la env var BQ_DATASET (por defecto: super_cheap).
-- =============================================================================

-- Reemplaza TU_PROYECTO por el id de tu proyecto de Google Cloud.

-- Dataset principal del dashboard.
CREATE SCHEMA IF NOT EXISTS `TU_PROYECTO.super_cheap`
  OPTIONS (
    location = 'US',
    description = 'Datos de SUPER CHEAP: ventas, compras, gastos y nomina.'
  );

-- Tabla de ventas (alimentada por sc-ingest desde el bridge de SICAR).
CREATE TABLE IF NOT EXISTS `TU_PROYECTO.super_cheap.ventas` (
  id         STRING,
  fecha      DATE,
  ticket_id  STRING,
  total      NUMERIC,
  forma_pago STRING,
  items      INT64,
  fuente     STRING,
  activo     BOOL,
  ts         TIMESTAMP
);

-- Tabla de compras (capturadas a mano o via sc-ticket/sc-data).
CREATE TABLE IF NOT EXISTS `TU_PROYECTO.super_cheap.compras` (
  id                   STRING,
  fecha                DATE,
  hora                 STRING,
  proveedor            STRING,
  subtotal             NUMERIC,
  iva                  NUMERIC,
  ieps                 NUMERIC,
  total                NUMERIC,
  impuestos_estimados  BOOL,
  categoria            STRING,
  clasificacion        STRING,
  conceptos            STRING,
  foto_url             STRING,
  fotos                STRING,
  raw_ocr              STRING,
  activo               BOOL,
  ts                   TIMESTAMP
);

-- Tabla de gastos.
CREATE TABLE IF NOT EXISTS `TU_PROYECTO.super_cheap.gastos` (
  id                   STRING,
  fecha                DATE,
  hora                 STRING,
  concepto             STRING,
  categoria            STRING,
  clasificacion        STRING,
  subtotal             NUMERIC,
  iva                  NUMERIC,
  ieps                 NUMERIC,
  total                NUMERIC,
  impuestos_estimados  BOOL,
  foto_url             STRING,
  fotos                STRING,
  activo               BOOL,
  ts                   TIMESTAMP
);

-- Tabla de nomina.
CREATE TABLE IF NOT EXISTS `TU_PROYECTO.super_cheap.nomina` (
  id        STRING,
  periodo   STRING,
  fecha     DATE,
  empleado  STRING,
  monto     NUMERIC,
  tipo      STRING,
  activo    BOOL,
  ts        TIMESTAMP
);
