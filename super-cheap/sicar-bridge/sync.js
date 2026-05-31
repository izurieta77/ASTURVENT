#!/usr/bin/env node
/*
   SUPER CHEAP - Bridge SICAR

   Modos:
     node sync.js                         Sincroniza MySQL para hoy.
     node sync.js 2026-05-28              Sincroniza MySQL para una fecha.
     node sync.js --excel ventas.xlsx     Importa Excel/CSV exportado de SICAR.
     node sync.js --excel ventas.xlsx --dry-run

   Este programa no modifica SICAR. Solo lee MySQL o un archivo Excel/CSV y envia
   ventas normalizadas a sc-ingest.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DEFAULT_SITE = 'https://supercheapp.netlify.app';
const LOG_DIR = path.join(__dirname, 'logs');

const ALIASES = {
  fecha: ['fecha', 'date', 'dia', 'fecha venta', 'fecha de venta'],
  hora: ['hora', 'time', 'hora venta', 'hora de venta'],
  ticket_id: ['ticket', 'ticket id', 'ticket_id', 'folio', 'folio venta', 'folio_ticket', 'id venta', 'id_venta', 'venta_id'],
  caja: ['caja', 'terminal', 'pos', 'sucursal', 'estacion'],
  producto: ['producto', 'descripcion', 'descripcion producto', 'articulo', 'nombre articulo', 'sku', 'codigo'],
  cantidad: ['cantidad', 'cant', 'qty', 'unidades', 'piezas'],
  importe: ['importe', 'total linea', 'total_linea', 'subtotal linea', 'precio total'],
  total: ['total', 'total ticket', 'total_ticket', 'monto', 'importe total'],
  forma_pago: ['forma pago', 'forma_pago', 'metodo pago', 'metodo_pago', 'pago', 'payment'],
};

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function log(message, level = 'INFO') {
  ensureLogDir();
  const line = `[${nowStamp()}] [${level}] ${message}`;
  console.log(line);
  const file = path.join(LOG_DIR, `sync-${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(file, line + '\n', 'utf8');
}

function fail(message, code = 1) {
  log(message, 'ERROR');
  process.exit(code);
}

function hoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function esFechaValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function normalizarHeader(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leerArgs(argv) {
  const args = [...argv];
  const out = { modo: 'mysql', fecha: null, excelPath: null, dryRun: false };
  while (args.length) {
    const a = args.shift();
    if (a === '--excel') {
      out.modo = 'excel';
      out.excelPath = args.shift();
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (!out.fecha) {
      out.fecha = a;
    }
  }
  out.fecha = out.fecha || hoyISO();
  return out;
}

function cargarConfig() {
  const ruta = path.join(__dirname, 'config.json');
  if (!fs.existsSync(ruta)) {
    throw new Error('No encontre config.json. Copia config.example.json a config.json y llenalo.');
  }
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error('config.json tiene JSON invalido: ' + e.message);
  }
}

function texto(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function numero(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s);
  s = s.replace(/[()$]/g, '').replace(/\s+/g, '');
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

function fechaExcel(v, fallback) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Serial de Excel: dias desde 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30));
    d.setUTCDate(d.getUTCDate() + Math.floor(v));
    return d.toISOString().slice(0, 10);
  }
  const s = texto(v);
  if (!s) return fallback;
  if (esFechaValida(s)) return s;
  let m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return fallback;
}

function valor(row, key) {
  for (const alias of ALIASES[key] || []) {
    const v = row[normalizarHeader(alias)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function makeKey(prefix, fecha, ticket, caja) {
  const base = [prefix, fecha, texto(caja) || 'sin-caja', texto(ticket)].join(':');
  return base.replace(/\s+/g, '-').toLowerCase();
}

function mapearFila(raw, fechaDefault, prefix) {
  const fecha = fechaExcel(raw.fecha, fechaDefault);
  const ticket = texto(raw.ticket_id);
  const caja = texto(raw.caja);
  if (!esFechaValida(fecha) || !ticket) return null;

  const producto = texto(raw.producto);
  const cantidad = numero(raw.cantidad);
  const importe = numero(raw.importe);
  const total = numero(raw.total);
  const forma_pago = texto(raw.forma_pago) || 'desconocido';

  const venta = {
    fecha,
    venta_key: texto(raw.venta_key) || makeKey(prefix, fecha, ticket, caja),
    ticket_id: ticket,
    forma_pago,
  };

  if (producto) venta.producto = producto;
  if (cantidad !== null) venta.cantidad = cantidad;
  if (importe !== null) venta.importe = importe;
  if (total !== null) venta.total = total;

  return venta;
}

async function leerDesdeMysql(cfg, fecha) {
  if (!cfg.mysql || !cfg.mysql.host || !cfg.mysql.database || !cfg.mysql.user) {
    throw new Error('Falta mysql.host/user/database en config.json.');
  }
  if (String(cfg.mysql.database).toLowerCase() === 'auto') {
    throw new Error('mysql.database sigue en "auto". Corre node descubrir.js y configura la base real antes de sincronizar.');
  }
  if (!cfg.sqlVentas) throw new Error('Falta sqlVentas en config.json.');

  log(`Conectando a MySQL ${cfg.mysql.host}:${cfg.mysql.port || 3306} / base "${cfg.mysql.database}"`);
  const conn = await mysql.createConnection({
    host: cfg.mysql.host,
    port: cfg.mysql.port || 3306,
    user: cfg.mysql.user,
    password: cfg.mysql.password,
    database: cfg.mysql.database,
  });

  try {
    const sql = cfg.sqlVentas.replace(/:fecha/g, '?');
    const params = new Array((cfg.sqlVentas.match(/:fecha/g) || []).length).fill(fecha);
    log('Ejecutando consulta de ventas.');
    const [rows] = await conn.query(sql, params);
    log(`MySQL devolvio ${rows.length} fila(s).`);
    return rows.map((r) => mapearFila({
      fecha: r.fecha,
      hora: r.hora,
      ticket_id: r.ticket_id,
      venta_key: r.venta_key,
      caja: r.caja || r.terminal || r.sucursal,
      producto: r.producto,
      cantidad: r.cantidad,
      importe: r.importe,
      total: r.total,
      forma_pago: r.forma_pago || r.metodo_pago,
    }, fecha, 'sicar')).filter(Boolean);
  } finally {
    await conn.end().catch(() => {});
  }
}

function normalizarRowExcel(row) {
  const out = {};
  Object.keys(row || {}).forEach((k) => {
    out[normalizarHeader(k)] = row[k];
  });
  return {
    fecha: valor(out, 'fecha'),
    hora: valor(out, 'hora'),
    ticket_id: valor(out, 'ticket_id'),
    caja: valor(out, 'caja'),
    producto: valor(out, 'producto'),
    cantidad: valor(out, 'cantidad'),
    importe: valor(out, 'importe'),
    total: valor(out, 'total'),
    forma_pago: valor(out, 'forma_pago'),
  };
}

function valorCelda(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v !== 'object') return v;
  return String(v);
}

async function leerDesdeExcel(excelPath, fecha) {
  if (!excelPath) throw new Error('Falta la ruta del archivo despues de --excel.');
  const full = path.resolve(process.cwd(), excelPath);
  if (!fs.existsSync(full)) throw new Error('No existe el archivo: ' + full);

  log(`Leyendo archivo Excel/CSV: ${full}`);
  const ext = path.extname(full).toLowerCase();
  const matrix = ext === '.csv'
    ? parseCsv(fs.readFileSync(full, 'utf8'))
    : await require('read-excel-file/node')(full);
  if (!matrix.length) throw new Error('El archivo no tiene filas.');

  const headers = matrix[0].map((h) => texto(valorCelda(h)));
  const rows = matrix.slice(1).filter((r) => r.some((v) => texto(valorCelda(v)) !== '')).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = valorCelda(r[idx]);
    });
    return obj;
  });
  log(`Excel/CSV devolvio ${rows.length} fila(s).`);

  return rows.map((r) => mapearFila(normalizarRowExcel(r), fecha, 'excel')).filter(Boolean);
}

function parseCsv(txt) {
  const first = (txt.split(/\r?\n/).find((l) => l.trim()) || '');
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < txt.length; i += 1) {
    const ch = txt[i];
    const next = txt[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((v) => String(v).trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => String(v).trim() !== '')) rows.push(row);
  return rows;
}

async function enviar(cfg, ventas, dryRun) {
  const siteUrl = (cfg.siteUrl || DEFAULT_SITE).replace(/\/+$/, '');

  log(`Ventas normalizadas listas: ${ventas.length}.`);
  if (ventas.length === 0) return { ok: true, recibidos: 0, insertados: 0 };
  if (dryRun) {
    log('Dry-run activo: no se envio nada a Netlify.');
    log('Muestra: ' + JSON.stringify(ventas.slice(0, 3)));
    return { ok: true, dryRun: true, recibidos: ventas.length, validos: ventas.length, insertados: 0 };
  }
  if (!cfg.ingestToken) throw new Error('Falta ingestToken en config.json.');

  const url = siteUrl + '/.netlify/functions/sc-ingest';
  log(`Enviando ventas a ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Token': cfg.ingestToken,
    },
    body: JSON.stringify({ ventas }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Netlify rechazo el envio (HTTP ${res.status}): ${data.error || 'sin detalle'}`);
  }
  return data;
}

async function main() {
  log('====================================');
  log('SUPER CHEAP - Sincronizacion SICAR');
  log('====================================');

  const args = leerArgs(process.argv.slice(2));
  if (args.fecha && !esFechaValida(args.fecha)) {
    fail(`Fecha invalida "${args.fecha}". Usa YYYY-MM-DD.`);
  }
  log(`Modo: ${args.modo}. Fecha objetivo: ${args.fecha}.`);

  let cfg;
  try {
    cfg = cargarConfig();
  } catch (e) {
    if (args.dryRun) {
      cfg = {};
      log(e.message + ' Continuo porque --dry-run no envia datos.', 'WARN');
    } else {
      fail(e.message);
    }
  }

  try {
    const ventas = args.modo === 'excel'
      ? await leerDesdeExcel(args.excelPath, args.fecha)
      : await leerDesdeMysql(cfg, args.fecha);
    const resultado = await enviar(cfg, ventas, args.dryRun);
    log(`OK. Recibidos: ${resultado.recibidos ?? '?'}, validos: ${resultado.validos ?? '?'}, insertados: ${resultado.insertados ?? '?'}, duplicados: ${resultado.duplicados ?? 0}, descartados: ${resultado.descartados ?? 0}.`);
    log('Sincronizacion terminada correctamente.');
  } catch (e) {
    fail(e.message || String(e));
  }
}

main();
