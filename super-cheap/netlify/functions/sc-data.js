// API del dashboard SUPER CHEAP.
//
// Toda llamada requiere un Bearer token valido (firmado por auth.js).
// Responde con la forma exacta definida en CONTRACT.md.
//
//   GET  ?action=resumen&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   GET  ?action=lista&tabla=ventas|compras|gastos|nomina&desde=&hasta=
//   POST  { action:"insertar", tabla:"compras|gastos|nomina", fila:{...} }
//
// Todas las consultas a BigQuery son PARAMETRIZADAS (nunca se concatena input).

const { corsHeaders, json, verifyToken, bearer } = require('./_lib');
const bq = require('./_bq');

// Tablas validas para lectura/listado.
const TABLAS_LISTA    = ['ventas', 'compras', 'gastos', 'nomina'];
// Tablas validas para insercion manual (ventas NO: entra por sc-ingest).
const TABLAS_INSERTAR = ['compras', 'gastos', 'nomina'];

// Campos requeridos por tabla al insertar (segun esquema del CONTRACT).
const REQUERIDOS = {
  compras: ['fecha', 'proveedor', 'total'],
  gastos:  ['fecha', 'concepto', 'categoria', 'total'],
  nomina:  ['periodo', 'fecha', 'empleado', 'monto'],
};

// Columnas permitidas por tabla al insertar (lista blanca = mismo esquema de
// bigquery-setup.sql, sin `ts` que lo pone el servidor). Cualquier campo que
// mande el frontend y NO este aqui se descarta: asi un campo de mas no revienta
// el streaming insert de BigQuery ("no such field") y no se inyectan columnas.
const COLUMNAS = {
  compras: ['fecha', 'proveedor', 'subtotal', 'iva', 'ieps', 'total',
            'impuestos_estimados', 'categoria', 'conceptos', 'foto_url', 'raw_ocr'],
  gastos:  ['fecha', 'concepto', 'categoria', 'subtotal', 'iva', 'ieps', 'total',
            'impuestos_estimados', 'foto_url'],
  nomina:  ['periodo', 'fecha', 'empleado', 'monto', 'tipo'],
};

// Columnas NUMERIC en BigQuery: se castean a Number JS al insertar.
const COLS_NUMERIC = new Set(['subtotal', 'iva', 'ieps', 'total', 'monto']);
// Columnas BOOL en BigQuery.
const COLS_BOOL = new Set(['impuestos_estimados']);
// Columnas que en el esquema son STRING (incluye `conceptos`, que viaja como
// JSON.stringify desde el frontend y se guarda tal cual, sin re-serializar).
const COLS_STRING = new Set(['proveedor', 'concepto', 'categoria', 'conceptos',
                             'foto_url', 'raw_ocr', 'periodo', 'empleado', 'tipo']);

// Valida formato YYYY-MM-DD (no valida que la fecha exista en el calendario,
// pero BigQuery rechazaria un DATE invalido).
function fechaValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  // --- Autenticacion: SIEMPRE se exige Bearer token valido. ---
  const secret = process.env.AUTH_SECRET;
  if (!secret) return json(500, cors, { ok: false, error: 'AUTH_SECRET no configurada en Netlify' });

  const session = verifyToken(bearer(event), secret);
  if (!session) return json(401, cors, { ok: false, error: 'No autorizado' });

  try {
    if (event.httpMethod === 'GET') {
      const q      = event.queryStringParameters || {};
      const action = String(q.action || '');

      if (action === 'resumen') return await resumen(cors, q);
      if (action === 'lista')   return await lista(cors, q);
      return json(400, cors, { ok: false, error: 'action invalida (resumen|lista)' });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

      if (String(body.action || '') === 'insertar') return await insertar(cors, body);
      return json(400, cors, { ok: false, error: 'action invalida (insertar)' });
    }

    return json(405, cors, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    // Errores de BigQuery o env vars faltantes terminan aqui.
    return json(502, cors, { ok: false, error: 'Error de datos: ' + (e.message || String(e)) });
  }
};

// --- GET action=resumen ---------------------------------------------------
async function resumen(cors, q) {
  const desde = q.desde;
  const hasta = q.hasta;
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const ds = bq.DATASET;
  const params = { desde, hasta };

  // KPIs agregados. Se calculan los totales por tabla en una sola consulta
  // por tabla; los montos NUMERIC de BigQuery llegan como string, por eso se
  // castean con CAST(... AS FLOAT64) para devolver Number en el JSON.
  const [ventasRows, comprasRows, gastosRows, nominaRows] = await Promise.all([
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
         FROM \`${ds}.ventas\`
        WHERE fecha BETWEEN @desde AND @hasta`, params),
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total,
              IFNULL(SUM(CAST(iva   AS FLOAT64)), 0) AS iva,
              IFNULL(SUM(CAST(ieps  AS FLOAT64)), 0) AS ieps
         FROM \`${ds}.compras\`
        WHERE fecha BETWEEN @desde AND @hasta`, params),
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
         FROM \`${ds}.gastos\`
        WHERE fecha BETWEEN @desde AND @hasta`, params),
    bq.query(
      `SELECT IFNULL(SUM(CAST(monto AS FLOAT64)), 0) AS total
         FROM \`${ds}.nomina\`
        WHERE fecha BETWEEN @desde AND @hasta`, params),
  ]);

  const ventas      = Number(ventasRows[0]?.total || 0);
  const compras     = Number(comprasRows[0]?.total || 0);
  const gastos      = Number(gastosRows[0]?.total || 0);
  const nomina      = Number(nominaRows[0]?.total || 0);
  const iva_compras = Number(comprasRows[0]?.iva || 0);
  const ieps_compras = Number(comprasRows[0]?.ieps || 0);

  const utilidad = ventas - compras - gastos - nomina;
  // Guard: margen 0 si no hubo ventas (evita division por cero).
  const margen = ventas > 0 ? (utilidad / ventas) * 100 : 0;

  // Serie de ventas por dia (ordenada ascendente para graficar).
  const serieRows = await bq.query(
    `SELECT FORMAT_DATE('%Y-%m-%d', fecha) AS fecha,
            IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
       FROM \`${ds}.ventas\`
      WHERE fecha BETWEEN @desde AND @hasta
      GROUP BY fecha
      ORDER BY fecha ASC`, params);

  // Gastos agrupados por categoria (descendente por monto).
  const gastosCatRows = await bq.query(
    `SELECT IFNULL(categoria, 'Sin categoria') AS categoria,
            IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
       FROM \`${ds}.gastos\`
      WHERE fecha BETWEEN @desde AND @hasta
      GROUP BY categoria
      ORDER BY total DESC`, params);

  return json(200, cors, {
    ok: true,
    kpis: {
      ventas, compras, gastos, nomina,
      utilidad, margen,
      iva_compras, ieps_compras,
    },
    serie_ventas: serieRows.map(r => ({ fecha: r.fecha, total: Number(r.total || 0) })),
    gastos_por_categoria: gastosCatRows.map(r => ({ categoria: r.categoria, total: Number(r.total || 0) })),
  });
}

// --- GET action=lista -----------------------------------------------------
async function lista(cors, q) {
  const tabla = String(q.tabla || '');
  const desde = q.desde;
  const hasta = q.hasta;

  if (!TABLAS_LISTA.includes(tabla)) {
    return json(400, cors, { ok: false, error: 'tabla invalida (ventas|compras|gastos|nomina)' });
  }
  // desde/hasta son OPCIONALES en el listado (el frontend muestra todo). Si
  // vienen, deben tener formato valido y se aplican como filtro de rango.
  const tieneDesde = desde !== undefined && desde !== '';
  const tieneHasta = hasta !== undefined && hasta !== '';
  if ((tieneDesde && !fechaValida(desde)) || (tieneHasta && !fechaValida(hasta))) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const ds = bq.DATASET;
  const params = {};
  const filtros = [];
  if (tieneDesde) { filtros.push('fecha >= @desde'); params.desde = desde; }
  if (tieneHasta) { filtros.push('fecha <= @hasta'); params.hasta = hasta; }
  const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';

  // `tabla` ya esta validada contra una lista blanca, asi que es seguro
  // interpolarla en el nombre de la tabla (BigQuery no parametriza identificadores).
  // Limite defensivo para no traer tablas enormes al navegador.
  const filas = await bq.query(
    `SELECT *
       FROM \`${ds}.${tabla}\`
      ${where}
      ORDER BY fecha DESC
      LIMIT 1000`,
    params);

  return json(200, cors, { ok: true, filas: filas.map(normalizarFila) });
}

// Aplana los tipos especiales que devuelve el cliente de BigQuery para que el
// JSON que recibe el frontend sea "plano": DATE/TIMESTAMP llegan como objetos
// { value:"..." } y NUMERIC como string; aqui se convierten a string/Number
// JS reales para que la UI los muestre y formatee bien.
function normalizarValor(v) {
  if (v === null || v === undefined) return v;
  // BigQueryDate / BigQueryTimestamp / BigQueryDatetime exponen .value (string).
  if (typeof v === 'object' && v !== null && typeof v.value === 'string') return v.value;
  return v;
}
function normalizarFila(fila) {
  const out = {};
  for (const k of Object.keys(fila)) {
    let v = normalizarValor(fila[k]);
    // Columnas NUMERIC llegan como string: a Number para que la UI las formatee.
    if (typeof v === 'string' && COLS_NUMERIC.has(k) && v !== '' && !isNaN(Number(v))) {
      v = Number(v);
    }
    out[k] = v;
  }
  return out;
}

// --- POST action=insertar -------------------------------------------------
async function insertar(cors, body) {
  const tabla = String(body.tabla || '');
  const fila  = body.fila;

  if (!TABLAS_INSERTAR.includes(tabla)) {
    return json(400, cors, { ok: false, error: 'tabla invalida (compras|gastos|nomina)' });
  }
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) {
    return json(400, cors, { ok: false, error: 'Falta fila (objeto)' });
  }

  // La fecha siempre debe venir y tener formato valido.
  if (!fechaValida(fila.fecha)) {
    return json(400, cors, { ok: false, error: 'fila.fecha debe ser YYYY-MM-DD' });
  }

  // Valida campos requeridos segun la tabla.
  const faltan = REQUERIDOS[tabla].filter(c => {
    const v = fila[c];
    return v === undefined || v === null || v === '';
  });
  if (faltan.length) {
    return json(400, cors, { ok: false, error: 'Faltan campos requeridos: ' + faltan.join(', ') });
  }

  // Construye el registro SOLO con columnas de la lista blanca, casteando cada
  // valor al tipo del esquema. Los campos opcionales ausentes simplemente no se
  // incluyen (BigQuery los deja NULL); los campos extra se ignoran.
  const registro = {};
  for (const col of COLUMNAS[tabla]) {
    if (!(col in fila)) continue;
    const v = fila[col];
    if (v === undefined || v === null) continue;
    if (COLS_NUMERIC.has(col)) {
      const n = Number(v);
      registro[col] = Number.isFinite(n) ? n : 0;
    } else if (COLS_BOOL.has(col)) {
      registro[col] = Boolean(v);
    } else if (COLS_STRING.has(col)) {
      // `conceptos` ya llega como string (JSON.stringify del frontend); no se
      // re-serializa para no doble-codificar. Si por alguna razon llega un
      // objeto/arreglo (no string), se serializa a JSON en vez de producir
      // "[object Object]"; el resto de STRING simples se castean con String().
      if (typeof v === 'string') registro[col] = v;
      else if (col === 'conceptos' && typeof v === 'object') registro[col] = JSON.stringify(v);
      else registro[col] = String(v);
    } else {
      // fecha y cualquier otra columna DATE/STRING simple.
      registro[col] = v;
    }
  }

  // Agrega timestamp de ingestion en formato compatible con BigQuery TIMESTAMP.
  registro.ts = new Date().toISOString();

  await bq.insertRows(tabla, [registro]);
  return json(200, cors, { ok: true, insertados: 1 });
}
