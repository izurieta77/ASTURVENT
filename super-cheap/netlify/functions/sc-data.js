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
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const ds = bq.DATASET;
  // `tabla` ya esta validada contra una lista blanca, asi que es seguro
  // interpolarla en el nombre de la tabla (BigQuery no parametriza identificadores).
  const filas = await bq.query(
    `SELECT *
       FROM \`${ds}.${tabla}\`
      WHERE fecha BETWEEN @desde AND @hasta
      ORDER BY fecha DESC`,
    { desde, hasta });

  return json(200, cors, { ok: true, filas });
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

  // Agrega timestamp de ingestion en formato compatible con BigQuery TIMESTAMP.
  const registro = { ...fila, ts: new Date().toISOString() };

  await bq.insertRows(tabla, [registro]);
  return json(200, cors, { ok: true, insertados: 1 });
}
