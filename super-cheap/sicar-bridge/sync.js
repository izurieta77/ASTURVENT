#!/usr/bin/env node
/* ============================================================
   SUPER CHEAP — Bridge de SICAR (sync.js)
   ------------------------------------------------------------
   Este script corre en la PC donde está instalado SICAR.
   1. Lee config.json (al lado de este archivo).
   2. Se conecta a la base MySQL local de SICAR.
   3. Ejecuta la consulta de ventas del día (configurable).
   4. Mapea los resultados al formato del contrato.
   5. Los envía a sc-ingest del sitio (header X-Ingest-Token).

   Requiere Node 18+ (usa fetch nativo) y el paquete "mysql2".

   Uso:
     node sync.js              -> sincroniza las ventas de HOY
     node sync.js 2026-05-28   -> sincroniza las ventas de esa fecha
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/* ---------- Utilidades ---------- */

// Fecha de hoy en formato YYYY-MM-DD (hora local de la PC)
function hoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Valida que un texto sea una fecha YYYY-MM-DD
function esFechaValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Lee y valida config.json
function cargarConfig() {
  const ruta = path.join(__dirname, 'config.json');
  if (!fs.existsSync(ruta)) {
    throw new Error(
      'No encontré el archivo config.json.\n' +
      '   Copia config.example.json a config.json y llénalo con tus datos.'
    );
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error('config.json tiene un error de formato (JSON inválido): ' + e.message);
  }
  if (!cfg.mysql || !cfg.mysql.host || !cfg.mysql.database) {
    throw new Error('Falta la sección "mysql" (host, user, password, database) en config.json.');
  }
  if (!cfg.siteUrl) {
    throw new Error('Falta "siteUrl" en config.json (la dirección de tu sitio en Netlify).');
  }
  if (!cfg.ingestToken) {
    throw new Error('Falta "ingestToken" en config.json (debe coincidir con SICAR_INGEST_TOKEN en Netlify).');
  }
  if (!cfg.sqlVentas) {
    throw new Error('Falta "sqlVentas" en config.json (la consulta SQL de ventas).');
  }
  return cfg;
}

/* ---------- Mapeo de filas de SICAR al contrato ---------- */
// El contrato espera: { fecha, ticket_id, total, forma_pago, items }
// La consulta SQL debe devolver columnas con esos nombres (alias).
function mapearVenta(fila, fecha) {
  return {
    fecha: fila.fecha ? String(fila.fecha).slice(0, 10) : fecha,
    ticket_id: String(fila.ticket_id != null ? fila.ticket_id : ''),
    total: Number(fila.total) || 0,
    forma_pago: fila.forma_pago != null ? String(fila.forma_pago) : 'desconocido',
    items: Number(fila.items) || 0,
  };
}

/* ---------- Programa principal ---------- */
async function main() {
  console.log('====================================');
  console.log(' SUPER CHEAP — Sincronización SICAR');
  console.log('====================================');

  // 1) Fecha objetivo (argumento o hoy)
  const argFecha = process.argv[2];
  const fecha = argFecha ? argFecha : hoyISO();
  if (argFecha && !esFechaValida(argFecha)) {
    console.error(`[ERROR] La fecha "${argFecha}" no es válida. Usa el formato AAAA-MM-DD (ej. 2026-05-28).`);
    process.exit(1);
  }
  console.log(`[INFO] Fecha a sincronizar: ${fecha}`);

  // 2) Configuración
  let cfg;
  try {
    cfg = cargarConfig();
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(1);
  }

  // 3) Conexión a MySQL de SICAR
  let conn;
  try {
    console.log(`[INFO] Conectando a MySQL ${cfg.mysql.host}:${cfg.mysql.port || 3306} / base "${cfg.mysql.database}"...`);
    conn = await mysql.createConnection({
      host: cfg.mysql.host,
      port: cfg.mysql.port || 3306,
      user: cfg.mysql.user,
      password: cfg.mysql.password,
      database: cfg.mysql.database,
    });
    console.log('[OK] Conexión a la base de SICAR establecida.');
  } catch (e) {
    console.error('[ERROR] No pude conectar a MySQL: ' + e.message);
    console.error('        Revisa host/usuario/contraseña/base en config.json y que SICAR/MySQL estén encendidos.');
    process.exit(1);
  }

  // 4) Consulta de ventas. El placeholder :fecha se reemplaza por un parámetro seguro.
  let filas;
  try {
    const sql = cfg.sqlVentas.replace(/:fecha/g, '?');
    // Contamos cuántos placeholders hay para pasar la fecha tantas veces como aparezca.
    const cuantos = (cfg.sqlVentas.match(/:fecha/g) || []).length;
    const params = new Array(cuantos).fill(fecha);
    console.log('[INFO] Ejecutando consulta de ventas...');
    const [rows] = await conn.query(sql, params);
    filas = rows || [];
    console.log(`[OK] La consulta devolvió ${filas.length} fila(s).`);
  } catch (e) {
    console.error('[ERROR] La consulta SQL falló: ' + e.message);
    console.error('        Es muy probable que "sqlVentas" en config.json deba ajustarse al esquema real de tu SICAR.');
    console.error('        Revisa los nombres de tablas y columnas (ver README.md).');
    await conn.end().catch(() => {});
    process.exit(1);
  }

  await conn.end().catch(() => {});

  // 5) Mapeo
  const ventas = filas.map((f) => mapearVenta(f, fecha));
  if (ventas.length === 0) {
    console.log('[INFO] No hay ventas para esa fecha. Nada que enviar.');
    process.exit(0);
  }

  // 6) Envío a sc-ingest
  const url = cfg.siteUrl.replace(/\/+$/, '') + '/.netlify/functions/sc-ingest';
  console.log(`[INFO] Enviando ${ventas.length} venta(s) a ${url} ...`);

  let res, data;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Token': cfg.ingestToken,
      },
      body: JSON.stringify({ ventas }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    console.error('[ERROR] No pude conectar con el sitio: ' + e.message);
    console.error('        Revisa "siteUrl" en config.json y tu conexión a internet.');
    process.exit(1);
  }

  if (!res.ok || data.ok === false) {
    console.error(`[ERROR] El servidor rechazó el envío (HTTP ${res.status}): ${data.error || 'sin detalle'}`);
    if (res.status === 401 || res.status === 403) {
      console.error('        Token incorrecto: "ingestToken" debe ser IGUAL a SICAR_INGEST_TOKEN en Netlify.');
    }
    process.exit(1);
  }

  console.log(`[OK] Listo. Recibidos: ${data.recibidos ?? '?'}, insertados (nuevos): ${data.insertados ?? '?'}.`);
  console.log('[OK] Sincronización terminada correctamente.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[ERROR] Error inesperado: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
