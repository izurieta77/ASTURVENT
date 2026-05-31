// Normalizacion e insercion de ventas para SUPER CHEAP.
//
// Lo usan:
// - sc-ingest: puente local de SICAR con X-Ingest-Token.
// - sc-data action=importar_ventas: Plan B desde Excel con sesion del dashboard.
//
// La tabla `ventas` se conserva en nivel ticket para no romper KPIs existentes.
// Si llegan lineas de producto, se agrupan por `venta_key`/`source_key`/`ticket_id`.

const crypto = require('crypto');

let bqClient = null;
function getBq() {
  if (!bqClient) bqClient = require('./_bq');
  return bqClient;
}

const MAX_RECIBIDOS = 5000;
const EXISTING_CHUNK = 500;

function fechaValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function texto(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function primero(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function numero(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  // Soporta "$1,234.50", "1 234,50" y valores negativos con parentesis.
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

function entero(v) {
  const n = numero(v);
  if (n === null) return null;
  return Math.max(0, Math.round(n));
}

function normalizarFecha(v) {
  const s = texto(v);
  if (!s) return '';
  if (fechaValida(s)) return s;

  // Fechas comunes: DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD.
  let m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  m = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(s);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return '';
}

function esLineaProducto(v) {
  return Boolean(
    primero(v, ['producto', 'descripcion', 'articulo', 'codigo_producto', 'sku']) ||
    primero(v, ['cantidad', 'cant', 'qty']) ||
    primero(v, ['importe', 'importe_linea', 'total_linea'])
  );
}

function llaveDesdeCampos(v, fecha) {
  const explicita = primero(v, [
    'venta_key', 'source_key', 'llave', 'llave_venta', 'ticket_key', 'dedupe_key', 'id_unico',
  ]);
  if (explicita) return texto(explicita);

  // Compatibilidad: si solo llega ticket_id, se conserva tal cual para no duplicar
  // datos historicos ya enviados por versiones anteriores del bridge.
  const ticket = primero(v, ['ticket_id', 'ticket', 'folio', 'folio_ticket', 'id_venta', 'venta_id']);
  if (!ticket) return '';
  return texto(ticket);
}

function normalizarVentas(ventas) {
  const recibidos = Array.isArray(ventas) ? ventas.length : 0;
  if (!Array.isArray(ventas)) return { recibidos: 0, validos: 0, descartados: 0, filas: [] };

  const grupos = new Map();
  let descartados = 0;

  ventas.slice(0, MAX_RECIBIDOS).forEach((raw) => {
    const v = raw && typeof raw === 'object' ? raw : {};
    const fecha = normalizarFecha(primero(v, ['fecha', 'date', 'dia']));
    const ticket_id = llaveDesdeCampos(v, fecha);
    if (!fechaValida(fecha) || !ticket_id) {
      descartados += 1;
      return;
    }

    const linea = esLineaProducto(v);
    const totalTicket = numero(primero(v, ['total', 'total_ticket', 'monto']));
    const totalLinea = numero(primero(v, ['importe', 'importe_linea', 'total_linea']));
    const total = linea ? (totalLinea ?? totalTicket) : totalTicket;
    if (total === null || total <= 0) {
      descartados += 1;
      return;
    }

    const items = entero(primero(v, ['items', 'articulos', 'cantidad', 'cant', 'qty']));
    const forma_pago = texto(primero(v, ['forma_pago', 'metodo_pago', 'pago', 'payment_method'])) || 'desconocido';

    if (!grupos.has(ticket_id)) {
      grupos.set(ticket_id, {
        fecha,
        ticket_id,
        total: 0,
        forma_pago,
        items: 0,
        _lineas: 0,
        _ticketRow: false,
      });
    }

    const g = grupos.get(ticket_id);
    if (linea) {
      g.total += total;
      g.items += items || 1;
      g._lineas += 1;
    } else if (!g._ticketRow) {
      g.total += total;
      g.items = items || g.items || 0;
      g._ticketRow = true;
    }
    if ((!g.forma_pago || g.forma_pago === 'desconocido') && forma_pago) g.forma_pago = forma_pago;
  });

  if (recibidos > MAX_RECIBIDOS) descartados += recibidos - MAX_RECIBIDOS;

  const filas = Array.from(grupos.values()).map((g) => ({
    fecha: g.fecha,
    ticket_id: g.ticket_id,
    total: Number(g.total.toFixed(2)),
    forma_pago: g.forma_pago || 'desconocido',
    items: g.items || g._lineas || null,
  })).filter((g) => g.total > 0);

  return {
    recibidos,
    validos: filas.length,
    descartados,
    filas,
  };
}

async function ticketIdsExistentes(ids) {
  const bq = getBq();
  const ds = bq.DATASET;
  const out = new Set();
  for (let i = 0; i < ids.length; i += EXISTING_CHUNK) {
    const chunk = ids.slice(i, i + EXISTING_CHUNK);
    const rows = await bq.query(
      `SELECT ticket_id
         FROM \`${ds}.ventas\`
        WHERE ticket_id IN UNNEST(@ids)`,
      { ids: chunk }
    );
    rows.forEach((r) => out.add(String(r.ticket_id)));
  }
  return out;
}

async function insertarVentas(ventas, opts = {}) {
  const bq = getBq();
  const fuente = texto(opts.fuente) || 'sicar';
  const replaceFecha = texto(opts.replaceFecha || opts.replaceDate);
  const normalizadas = normalizarVentas(ventas);
  if (normalizadas.filas.length === 0) {
    return { ok: true, ...normalizadas, insertados: 0, duplicados: 0 };
  }

  if (replaceFecha && fechaValida(replaceFecha)) {
    await bq.query(
      `DELETE FROM \`${bq.DATASET}.ventas\`
        WHERE fecha=DATE(@fecha)
          AND fuente IN UNNEST(@fuentes)`,
      { fecha: replaceFecha, fuentes: ['sicar', 'excel'] }
    );
  }

  const existentes = await ticketIdsExistentes(normalizadas.filas.map((f) => f.ticket_id));
  const nuevas = [];
  for (const fila of normalizadas.filas) {
    if (existentes.has(fila.ticket_id)) continue;
    nuevas.push({
      ...fila,
      id: crypto.randomUUID(),
      fuente,
      activo: true,
    });
  }

  if (nuevas.length) await bq.insertRows('ventas', nuevas);

  return {
    ok: true,
    ...normalizadas,
    insertados: nuevas.length,
    duplicados: normalizadas.filas.length - nuevas.length,
  };
}

module.exports = {
  normalizarVentas,
  insertarVentas,
};
