// Endpoint de ingestion de aumentos de inventario desde el bridge local de SICAR.
//
// Convierte SOLO movimientos positivos de inventario (entradas/aumentos de stock)
// en filas de `compras`, para reflejar costo aunque el personal no capture el
// ticket en la app. Usa el mismo X-Ingest-Token que sc-ingest.
//
//   POST { movimientos:[{
//     fecha, hora, movimiento_id|movimiento_key, producto, clave,
//     cantidad_delta|cantidad|entrada|existencia_anterior+existencia_nueva,
//     costo|costo_unitario|precio_compra|precio, total|importe|monto,
//     proveedor, departamento, categoria
//   }] }

const crypto = require('crypto');
const { corsHeaders, json, safeEqual } = require('./_lib');
const bq = require('./_bq');

const MAX_MOVIMIENTOS = 500;
const ACTIVO = 'COALESCE(activo, TRUE) = TRUE';

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

function r2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function fechaValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function valor(raw, keys) {
  for (const key of keys) {
    if (raw && raw[key] !== undefined && raw[key] !== null && texto(raw[key]) !== '') return raw[key];
  }
  return null;
}

function normalizarTipo(v) {
  return texto(v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esTipoDescartable(v) {
  const t = normalizarTipo(v);
  if (!t) return false;
  const palabras = new Set(t.split(' '));
  if (['salida', 'salidas', 'venta', 'ventas', 'merma', 'mermas', 'baja', 'bajas', 'resta', 'restas', 'decremento', 'decrementos'].some(p => palabras.has(p))) {
    return true;
  }
  return /(^|\s)devolucion(\s+(a|al))?\s+proveedor(\s|$)/.test(t);
}

function cantidadPositiva(raw) {
  const anterior = numero(valor(raw, ['existencia_anterior', 'stock_anterior', 'inventario_anterior']));
  const nueva = numero(valor(raw, ['existencia_nueva', 'stock_nuevo', 'inventario_nuevo']));
  if (anterior !== null && nueva !== null) return nueva - anterior;

  const delta = numero(valor(raw, [
    'cantidad_delta', 'delta', 'cambio', 'diferencia', 'entrada', 'entradas',
    'cantidad', 'unidades', 'piezas',
  ]));
  return delta === null ? 0 : delta;
}

function costoUnitario(raw, cantidad, totalExplicito) {
  const costo = numero(valor(raw, [
    'costo_unitario', 'costo', 'precio_compra', 'ultimo_costo', 'costo_promedio',
    'precio_unitario', 'precio',
  ]));
  if (costo !== null) return costo;
  if (totalExplicito !== null && cantidad > 0) return totalExplicito / cantidad;
  return 0;
}

function huellaMovimiento(raw, fecha, producto, clave, cantidad, costo, total) {
  const explicita = texto(valor(raw, ['movimiento_key', 'movimiento_id', 'id_movimiento', 'id', 'folio', 'documento']));
  if (explicita) return explicita;
  const base = [
    fecha,
    texto(raw.hora),
    clave || producto,
    cantidad,
    r2(costo),
    r2(total),
    texto(valor(raw, ['existencia_anterior', 'stock_anterior'])),
    texto(valor(raw, ['existencia_nueva', 'stock_nuevo'])),
  ].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

function normalizarMovimiento(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fecha = texto(raw.fecha);
  if (!fechaValida(fecha)) return null;

  const cantidad = r2(cantidadPositiva(raw));
  if (!(cantidad > 0)) return null;

  const tipo = valor(raw, ['tipo', 'movimiento', 'motivo', 'concepto']);
  if (esTipoDescartable(tipo)) return null;

  const producto = texto(valor(raw, ['producto', 'descripcion', 'articulo', 'nombre']));
  const clave = texto(valor(raw, ['clave', 'codigo', 'sku', 'codigo_producto']));
  if (!producto && !clave) return null;

  const totalExplicito = numero(valor(raw, ['total', 'importe', 'monto', 'costo_total']));
  const costo = r2(costoUnitario(raw, cantidad, totalExplicito));
  const total = r2(totalExplicito !== null ? totalExplicito : cantidad * costo);
  const subtotal = r2(total / 1.16);
  const iva = r2(total - subtotal);
  const proveedor = texto(valor(raw, ['proveedor', 'supplier'])) || 'Inventario SICAR';
  const categoria = texto(valor(raw, ['categoria', 'departamento', 'depto'])) || 'inventario';
  const hora = texto(raw.hora);
  const desc = [cantidad + ' unidad(es)', producto || clave, clave ? '(' + clave + ')' : ''].filter(Boolean).join(' ');
  const nota = total > 0
    ? 'Compra automatica creada por aumento de inventario en SICAR.'
    : 'Compra automatica creada por aumento de inventario en SICAR; sin costo legible.';
  const key = huellaMovimiento(raw, fecha, producto, clave, cantidad, costo, total);

  return {
    fecha,
    ...(hora ? { hora } : {}),
    proveedor,
    subtotal,
    iva,
    ieps: 0,
    total,
    impuestos_estimados: true,
    categoria,
    clasificacion: texto(raw.clasificacion) || 'reventa',
    conceptos: JSON.stringify([{
      descripcion: desc,
      importe: total,
      uso: 'reventa',
      ingrediente: null,
      cantidad,
      costo_unitario: costo,
      nota,
    }]),
    raw_ocr: 'sicar_inventory:' + key,
    activo: true,
  };
}

async function existentesPorHuella(rawOcrs) {
  const llaves = Array.from(new Set((rawOcrs || []).filter(Boolean)));
  if (!llaves.length) return new Set();
  const rows = await bq.query(
    `SELECT raw_ocr
       FROM \`${bq.DATASET}.compras\`
      WHERE raw_ocr IN UNNEST(@raw_ocrs)
        AND ${ACTIVO}`,
    { raw_ocrs: llaves },
  );
  return new Set(rows.map(r => String(r.raw_ocr || '')).filter(Boolean));
}

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, cors, { ok: false, error: 'Method not allowed' });

  const expected = process.env.SICAR_INGEST_TOKEN;
  if (!expected) return json(500, cors, { ok: false, error: 'SICAR_INGEST_TOKEN no configurada en Netlify' });

  const token = event.headers?.['x-ingest-token'] || event.headers?.['X-Ingest-Token'] || '';
  if (!safeEqual(token, expected)) {
    return json(401, cors, { ok: false, error: 'Token de ingestion invalido' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

  const recibidos = Array.isArray(body.movimientos) ? body.movimientos.slice(0, MAX_MOVIMIENTOS) : null;
  if (!recibidos) return json(400, cors, { ok: false, error: 'Falta movimientos (arreglo)' });

  try {
    const normalizados = recibidos.map(normalizarMovimiento).filter(Boolean);
    const existentes = await existentesPorHuella(normalizados.map(r => r.raw_ocr));
    const nuevos = normalizados
      .filter(r => !existentes.has(r.raw_ocr))
      .map(r => ({ id: crypto.randomUUID(), ...r }));

    if (nuevos.length) await bq.insertRows('compras', nuevos);

    return json(200, cors, {
      ok: true,
      recibidos: recibidos.length,
      validos: normalizados.length,
      positivos: normalizados.length,
      insertados: nuevos.length,
      duplicados: normalizados.length - nuevos.length,
      descartados: recibidos.length - normalizados.length,
    });
  } catch (e) {
    return json(502, cors, { ok: false, error: 'Error de datos: ' + (e.message || String(e)) });
  }
};

module.exports._test = {
  normalizarMovimiento,
  cantidadPositiva,
  numero,
  esTipoDescartable,
};
