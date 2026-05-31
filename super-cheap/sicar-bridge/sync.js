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
const zlib = require('zlib');
const mysql = require('mysql2/promise');

const DEFAULT_SITE = 'https://supercheapp.netlify.app';
const LOG_DIR = path.join(__dirname, 'logs');
const DEFAULT_HTTP_TIMEOUT_SECONDS = 45;

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
  clave: ['clave', 'codigo', 'sku', 'codigo producto', 'codigo_producto'],
  precio: ['precio', 'precio unitario', 'precio_unitario'],
  departamento: ['departamento', 'depto'],
  categoria: ['categoria'],
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

function numberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
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
  const out = { modo: 'mysql', fecha: null, excelPath: null, dryRun: false, replaceDate: true };
  while (args.length) {
    const a = args.shift();
    if (a === '--excel') {
      out.modo = 'excel';
      out.excelPath = args.shift();
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--no-replace-date') {
      out.replaceDate = false;
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
  let m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
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
  const caja = texto(raw.caja);
  const producto = texto(raw.producto);
  const clave = texto(raw.clave || raw.codigo || raw.sku);
  const precio = numero(raw.precio);
  const cantidad = numero(raw.cantidad);
  const importe = numero(raw.importe);
  const total = numero(raw.total);
  const forma_pago = texto(raw.forma_pago) || 'desconocido';
  let ticket = texto(raw.ticket_id);

  // Los reportes de SICAR "Articulos/Paquetes Vendidos" son agregados por
  // articulo y no traen folio. Generamos una llave estable por dia/articulo.
  if (!ticket && producto && (importe !== null || total !== null)) {
    const articulo = clave || producto;
    const precioKey = precio !== null ? `p${precio.toFixed(2)}` : '';
    ticket = makeKey(`${prefix}:articulo`, fecha, [articulo, precioKey].filter(Boolean).join(':'), caja || raw.departamento || raw.categoria);
  }

  if (!esFechaValida(fecha) || !ticket) return null;

  const venta = {
    fecha,
    venta_key: texto(raw.venta_key) || (ticket.includes(':') ? ticket : makeKey(prefix, fecha, ticket, caja)),
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
    clave: valor(out, 'clave'),
    precio: valor(out, 'precio'),
    departamento: valor(out, 'departamento'),
    categoria: valor(out, 'categoria'),
  };
}

function valorCelda(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v !== 'object') return v;
  return String(v);
}

function decodeXml(s) {
  return String(s || '').replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const n = e[0].toLowerCase() === 'x' ? parseInt(e.slice(1), 16) : parseInt(e, 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

function attrsXml(tag) {
  const attrs = {};
  String(tag || '').replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, v1, v2) => {
    attrs[k] = decodeXml(v1 ?? v2 ?? '');
    return '';
  });
  return attrs;
}

function richText(xml) {
  let out = '';
  String(xml || '').replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (_, t) => {
    out += decodeXml(t);
    return '';
  });
  return out || decodeXml(String(xml || '').replace(/<[^>]+>/g, ''));
}

function colIndexFromRef(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i)?.[0] || 'A';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function unzipEntries(buffer) {
  const entries = new Map();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('XLSX invalido: no encontre directorio ZIP.');

  const total = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('XLSX invalido: entrada ZIP corrupta.');
    const method = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('XLSX invalido: encabezado ZIP corrupto.');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`XLSX no soportado: metodo ZIP ${method}.`);
    entries.set(name.replace(/\\/g, '/'), data);

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function normalizarZipPath(base, target) {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function firstSheetPath(entries) {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbook || !rels) return 'xl/worksheets/sheet1.xml';
  const sheetTag = workbook.match(/<sheet\b[^>]*>/i)?.[0] || '';
  const rid = attrsXml(sheetTag)['r:id'];
  if (!rid) return 'xl/worksheets/sheet1.xml';
  const relRe = /<Relationship\b[^>]*>/gi;
  let m;
  while ((m = relRe.exec(rels))) {
    const a = attrsXml(m[0]);
    if (a.Id === rid) return normalizarZipPath('xl/workbook.xml', a.Target);
  }
  return 'xl/worksheets/sheet1.xml';
}

function sharedStrings(entries) {
  const xml = entries.get('xl/sharedStrings.xml')?.toString('utf8');
  if (!xml) return [];
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(richText(m[1]));
  return out;
}

function parseXlsx(full) {
  const entries = unzipEntries(fs.readFileSync(full));
  const sheet = entries.get(firstSheetPath(entries));
  if (!sheet) throw new Error('XLSX invalido: no encontre la primera hoja.');
  const strings = sharedStrings(entries);
  const xml = sheet.toString('utf8');
  const matrix = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  let fallbackRow = 0;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowXml = rowMatch[0];
    const rowAttrs = attrsXml(rowXml.match(/<row\b[^>]*>/i)?.[0] || '');
    const rowIdx = Math.max(0, Number(rowAttrs.r || fallbackRow + 1) - 1);
    fallbackRow = rowIdx + 1;
    const row = matrix[rowIdx] || [];
    const cellRe = /<c\b[^>]*>([\s\S]*?)<\/c>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowXml))) {
      const cellTag = cellMatch[0].match(/<c\b[^>]*>/i)?.[0] || '';
      const a = attrsXml(cellTag);
      const col = colIndexFromRef(a.r);
      const inner = cellMatch[1] || '';
      const vRaw = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1];
      let value = '';
      if (a.t === 's') value = strings[Number(vRaw)] ?? '';
      else if (a.t === 'inlineStr') value = richText(inner);
      else if (a.t === 'b') value = String(vRaw || '').trim() === '1';
      else if (a.t === 'str') value = decodeXml(vRaw || '');
      else if (vRaw !== undefined) {
        const s = decodeXml(vRaw);
        value = /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : s;
      } else {
        value = richText(inner);
      }
      row[col] = value;
    }
    matrix[rowIdx] = row;
  }
  return matrix.filter((r) => r && r.some((v) => texto(valorCelda(v)) !== ''));
}

function keyHeader(label) {
  const n = normalizarHeader(label);
  if (!n) return '';
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => normalizarHeader(a) === n)) return key;
  }
  if (n === 'descripcion') return 'producto';
  if (n === 'cant') return 'cantidad';
  return '';
}

function detectarEncabezado(matrix) {
  let mejor = null;
  matrix.slice(0, 80).forEach((row, rowIndex) => {
    const columns = {};
    row.forEach((cell, col) => {
      const key = keyHeader(valorCelda(cell));
      if (key && columns[key] === undefined) columns[key] = col;
    });
    const score =
      (columns.fecha !== undefined ? 2 : 0) +
      (columns.ticket_id !== undefined ? 2 : 0) +
      (columns.producto !== undefined ? 3 : 0) +
      (columns.cantidad !== undefined ? 2 : 0) +
      (columns.importe !== undefined ? 2 : 0) +
      (columns.total !== undefined ? 2 : 0) +
      (columns.clave !== undefined ? 1 : 0) +
      (columns.precio !== undefined ? 1 : 0);
    if (score >= 5 && (!mejor || score > mejor.score)) mejor = { rowIndex, columns, score };
  });
  return mejor;
}

function fechaReporte(matrix, fallback) {
  for (const row of matrix.slice(0, 12)) {
    for (const cell of row) {
      const s = texto(valorCelda(cell));
      const m = s.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/);
      if (m) return fechaExcel(m[0], fallback);
    }
  }
  return fallback;
}

function filasDesdeMatriz(matrix, fecha) {
  const header = detectarEncabezado(matrix);
  if (!header) throw new Error('No pude detectar encabezados de venta en el Excel/CSV.');
  const rows = [];
  for (const r of matrix.slice(header.rowIndex + 1)) {
    const obj = {};
    for (const [key, idx] of Object.entries(header.columns)) {
      const v = valorCelda(r[idx]);
      if (texto(v) !== '') obj[key] = v;
    }
    if (!Object.keys(obj).length) continue;
    if (obj.fecha === undefined) obj.fecha = fecha;
    rows.push(obj);
  }
  log(`Encabezado detectado en fila ${header.rowIndex + 1}. Filas de datos candidatas: ${rows.length}.`);
  return rows;
}

async function leerDesdeExcel(excelPath, fecha) {
  if (!excelPath) throw new Error('Falta la ruta del archivo despues de --excel.');
  const full = path.resolve(process.cwd(), excelPath);
  if (!fs.existsSync(full)) throw new Error('No existe el archivo: ' + full);

  log(`Leyendo archivo Excel/CSV: ${full}`);
  const ext = path.extname(full).toLowerCase();
  const matrix = ext === '.csv'
    ? parseCsv(fs.readFileSync(full, 'utf8'))
    : parseXlsx(full);
  if (!matrix.length) throw new Error('El archivo no tiene filas.');

  const fechaDefault = fechaReporte(matrix, fecha);
  const rows = filasDesdeMatriz(matrix, fechaDefault);
  log(`Excel/CSV devolvio ${rows.length} fila(s).`);

  return rows.map((r) => mapearFila(normalizarRowExcel(r), fechaDefault, 'excel')).filter(Boolean);
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

async function enviar(cfg, ventas, dryRun, opts = {}) {
  const siteUrl = (cfg.siteUrl || DEFAULT_SITE).replace(/\/+$/, '');

  log(`Ventas normalizadas listas: ${ventas.length}.`);
  if (ventas.length) {
    const totalVentas = ventas.reduce((sum, venta) => sum + (numero(venta.importe) ?? numero(venta.total) ?? 0), 0);
    log(`Total a sincronizar: $${totalVentas.toFixed(2)}.`);
  }
  if (ventas.length === 0) return { ok: true, recibidos: 0, insertados: 0 };
  if (dryRun) {
    log('Dry-run activo: no se envio nada a Netlify.');
    if (opts.replaceFecha) log(`Modo reemplazo por fecha preparado para: ${opts.replaceFecha}.`);
    log('Muestra: ' + JSON.stringify(ventas.slice(0, 3)));
    return { ok: true, dryRun: true, recibidos: ventas.length, validos: ventas.length, insertados: 0 };
  }
  if (!cfg.ingestToken) throw new Error('Falta ingestToken en config.json.');

  const url = siteUrl + '/.netlify/functions/sc-ingest';
  const timeoutSeconds = numberEnv('SC_SYNC_HTTP_TIMEOUT_SECONDS', DEFAULT_HTTP_TIMEOUT_SECONDS, 10, 300);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  log(`Enviando ventas a ${url}`);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Token': cfg.ingestToken,
      },
      body: JSON.stringify({ ventas, replaceFecha: opts.replaceFecha || undefined }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Tiempo agotado enviando a Netlify despues de ${timeoutSeconds}s. Se reintentara.`);
    }
    throw new Error(`No pude conectar con Netlify: ${err.message || String(err)}. Se reintentara.`);
  } finally {
    clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Netlify rechazo el envio (HTTP ${res.status}): ${data.error || 'sin detalle'}. Se reintentara.`);
  }
  return data;
}

function fechaUnica(ventas) {
  const fechas = Array.from(new Set((ventas || []).map((v) => v.fecha).filter(esFechaValida)));
  return fechas.length === 1 ? fechas[0] : null;
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
    const replaceFecha = args.modo === 'excel' && args.replaceDate ? fechaUnica(ventas) : null;
    const resultado = await enviar(cfg, ventas, args.dryRun, { replaceFecha });
    log(`OK. Recibidos: ${resultado.recibidos ?? '?'}, validos: ${resultado.validos ?? '?'}, insertados: ${resultado.insertados ?? '?'}, duplicados: ${resultado.duplicados ?? 0}, descartados: ${resultado.descartados ?? 0}.`);
    log('Sincronizacion terminada correctamente.');
  } catch (e) {
    fail(e.message || String(e));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  leerDesdeExcel,
  mapearFila,
  normalizarRowExcel,
  numero,
  fechaExcel,
  fechaUnica,
};
