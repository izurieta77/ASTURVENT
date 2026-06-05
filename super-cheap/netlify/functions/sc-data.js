// API del dashboard SUPER CHEAP (v2).
//
// Toda llamada requiere un Bearer token valido (firmado por auth.js).
// Responde con la forma exacta definida en CONTRACT.md (seccion CONTRATO v2).
//
//   GET  ?action=resumen&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   GET  ?action=lista&tabla=ventas|compras|gastos|nomina&desde=&hasta=
//   GET  ?action=resumen_inventario_sicar&desde=&hasta=&agrupar=mes|dia
//   GET  ?action=analitica&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   GET  ?action=alertas
//   POST { action:"insertar",   tabla:"compras|gastos|nomina", fila:{...}, imagenes_base64?:[...] }
//   POST { action:"actualizar", tabla, id, fila }
//   POST { action:"eliminar",   tabla, id }
//   POST { action:"importar_ventas", ventas:[...] }  // Plan B Excel SICAR
//   POST { action:"eliminar_inventario_sicar", desde, hasta } // admin: soft delete bulk
//
// Todas las consultas a BigQuery son PARAMETRIZADAS (nunca se concatena input).
// Todas las lecturas/agregados filtran COALESCE(activo, TRUE) = TRUE (soft delete v2).

const crypto = require('crypto');
const { corsHeaders, json, verifyToken, bearer } = require('./_lib');
const bq = require('./_bq');
const gcs = require('./_gcs');
const ventasIngest = require('./_ventas_ingest');

// Tablas validas para lectura/listado.
const TABLAS_LISTA    = ['ventas', 'ventas_articulos', 'compras', 'gastos', 'nomina'];
// Tablas validas para insercion/edicion manual (ventas NO: entra por sc-ingest).
const TABLAS_INSERTAR = ['compras', 'gastos', 'nomina'];

// Campos requeridos por tabla al insertar (segun esquema del CONTRACT).
const REQUERIDOS = {
  compras: ['fecha', 'proveedor', 'total'],
  gastos:  ['fecha', 'concepto', 'categoria', 'total'],
  nomina:  ['periodo', 'fecha', 'empleado', 'monto'],
};

// Columnas permitidas por tabla al insertar/actualizar (lista blanca = esquema
// v2 de bigquery-setup.sql, incluye id/activo/hora/fotos; sin `ts` que lo pone el
// servidor). Cualquier campo extra del frontend se descarta para no inyectar
// columnas ni romper el INSERT/UPDATE de BigQuery.
const COLUMNAS = {
  compras: ['id', 'fecha', 'hora', 'proveedor', 'subtotal', 'iva', 'ieps', 'total',
            'impuestos_estimados', 'categoria', 'clasificacion', 'conceptos', 'foto_url', 'fotos',
            'raw_ocr', 'activo'],
  gastos:  ['id', 'fecha', 'hora', 'concepto', 'categoria', 'clasificacion', 'subtotal', 'iva', 'ieps',
            'total', 'impuestos_estimados', 'foto_url', 'fotos', 'activo'],
  nomina:  ['id', 'periodo', 'fecha', 'empleado', 'monto', 'tipo', 'activo'],
};

// Columnas NUMERIC en BigQuery: se castean a Number JS al normalizar/leer.
const COLS_NUMERIC = new Set(['subtotal', 'iva', 'ieps', 'total', 'monto', 'cantidad', 'precio', 'importe']);

// Margen meta por defecto (%); configurable via env META_MARGEN.
const META_MARGEN = Number(process.env.META_MARGEN) || 20;

// Valida formato YYYY-MM-DD.
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

      if (action === 'resumen')   return await resumen(cors, q);
      if (action === 'ventas_panel') return await ventasPanel(cors, q);
      if (action === 'lista')     return await lista(cors, q);
      if (action === 'resumen_inventario_sicar') return await resumenInventarioSicar(cors, q);
      if (action === 'analitica') return await analitica(cors, q);
      if (action === 'alertas')   return await alertas(cors, q);
      if (action === 'foto') {
        // Devuelve un enlace firmado temporal para ver una foto privada (gs://...).
        const url = await gcs.firmarUrl(String(q.ref || ''), 60);
        return json(url ? 200 : 404, cors, url ? { ok: true, url } : { ok: false, error: 'Foto no disponible' });
      }
      return json(400, cors, { ok: false, error: 'action invalida (resumen|ventas_panel|lista|resumen_inventario_sicar|analitica|alertas|foto)' });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

      const action = String(body.action || '');
      if (action === 'insertar')   return await insertar(cors, body);
      if (action === 'actualizar') return await actualizar(cors, body);
      if (action === 'eliminar')   return await eliminar(cors, body);
      if (action === 'eliminar_inventario_sicar') return await eliminarInventarioSicar(cors, body);
      if (action === 'importar_ventas') return await importarVentas(cors, body);
      return json(400, cors, { ok: false, error: 'action invalida (insertar|actualizar|eliminar|eliminar_inventario_sicar|importar_ventas)' });
    }

    return json(405, cors, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    // Errores de BigQuery o env vars faltantes terminan aqui.
    return json(502, cors, { ok: false, error: 'Error de datos: ' + (e.message || String(e)) });
  }
};

// =============================================================================
// POST action=importar_ventas
// =============================================================================
async function importarVentas(cors, body) {
  const ventas = Array.isArray(body.ventas) ? body.ventas : null;
  if (!ventas) {
    return json(400, cors, { ok: false, error: 'Falta ventas (arreglo)' });
  }
  const replaceFecha = String(body.replaceFecha || body.replaceDate || '').trim();
  const resultado = await ventasIngest.insertarVentas(ventas, { fuente: 'excel', replaceFecha });
  return json(200, cors, resultado);
}

// =============================================================================
// Helpers de consulta reutilizables (los reusa tambien sc-chat / sc-resumen).
// =============================================================================

// Filtro de soft delete: solo filas activas (o viejas con activo IS NULL).
const ACTIVO = 'COALESCE(activo, TRUE) = TRUE';

const GASTOS_FIJOS_MENSUALES = [
  { key: 'luz', concepto: 'Luz mensual', categoria: 'servicios', total: 15000 },
  { key: 'mantenimiento_equipo', concepto: 'Mantenimiento de equipo mensual', categoria: 'mantenimiento', total: 2000 },
  { key: 'limpieza', concepto: 'Productos de limpieza mensual', categoria: 'limpieza', total: 1200 },
];

const NOMINA_AUTOMATICA = [
  { key: 'encargada_tienda_extra', empleado: 'Encargada de tienda extra', tipo: 'sueldo_extra_encargada', meses: 28, mensual: 13000 },
  { key: 'ayudante_adicional', empleado: 'Ayudante adicional', tipo: 'ayudante_adicional', meses: 27, semanal: 2300 },
];

function r2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// Calcula los KPIs agregados de un rango [desde, hasta] (ambos YYYY-MM-DD).
// Devuelve { ventas, compras, gastos, nomina, utilidad, margen, iva_compras, ieps_compras }.
async function kpisRango(desde, hasta) {
  const ds = bq.DATASET;
  const params = { desde, hasta };

  const [ventasRows, comprasRows, gastosRows, nominaRows, gastosFijos, nominaAuto] = await Promise.all([
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
         FROM \`${ds}.ventas\`
        WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}`, params),
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total,
              IFNULL(SUM(CAST(iva   AS FLOAT64)), 0) AS iva,
              IFNULL(SUM(CAST(ieps  AS FLOAT64)), 0) AS ieps
         FROM \`${ds}.compras\`
        WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}`, params),
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
         FROM \`${ds}.gastos\`
        WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}`, params),
    bq.query(
      `SELECT IFNULL(SUM(CAST(monto AS FLOAT64)), 0) AS total
         FROM \`${ds}.nomina\`
         WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}`, params),
    gastosFijosRango(desde, hasta),
    nominaAutomaticaRango(desde, hasta),
  ]);

  const ventas      = Number(ventasRows[0]?.total || 0);
  const compras     = Number(comprasRows[0]?.total || 0);
  const gastos      = Number(gastosRows[0]?.total || 0) + gastosFijos.total;
  const nomina      = Number(nominaRows[0]?.total || 0) + nominaAuto.total;
  const iva_compras = Number(comprasRows[0]?.iva || 0);
  const ieps_compras = Number(comprasRows[0]?.ieps || 0);
  const utilidad = ventas - compras - gastos - nomina;
  const margen = ventas > 0 ? (utilidad / ventas) * 100 : 0;

  return { ventas, compras, gastos, nomina, utilidad, margen, iva_compras, ieps_compras };
}

// Serie de ventas por dia en un rango (ascendente).
async function serieVentas(desde, hasta) {
  const ds = bq.DATASET;
  const rows = await bq.query(
    `SELECT FORMAT_DATE('%Y-%m-%d', fecha) AS fecha,
            IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
       FROM \`${ds}.ventas\`
      WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}
      GROUP BY fecha
      ORDER BY fecha ASC`, { desde, hasta });
  return rows.map(r => ({ fecha: r.fecha, total: Number(r.total || 0) }));
}

function errorTablaNoExiste(err, tabla) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  return msg.includes(String(tabla).toLowerCase()) && (
    msg.includes('not found') ||
    msg.includes('notfound') ||
    msg.includes('no such') ||
    msg.includes('not found: table')
  );
}

async function queryDetalleArticulos(sql, params = {}) {
  try {
    return await bq.query(sql, params);
  } catch (err) {
    if (errorTablaNoExiste(err, 'ventas_articulos')) return null;
    throw err;
  }
}

function filtroDetalle(params, opts = {}) {
  const filtros = ['fecha BETWEEN @desde AND @hasta', ACTIVO];
  if (opts.caja) {
    filtros.push('caja = @caja');
    params.caja = opts.caja;
  }
  if (opts.pago) {
    filtros.push('forma_pago = @pago');
    params.pago = opts.pago;
  }
  return 'WHERE ' + filtros.join(' AND ');
}

// Top proveedores (desde compras) por monto en un rango.
async function topProveedores(desde, hasta, limite = 10) {
  const ds = bq.DATASET;
  const rows = await bq.query(
    `SELECT IFNULL(proveedor, 'Sin proveedor') AS proveedor,
            IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total,
            COUNT(*) AS conteo
       FROM \`${ds}.compras\`
      WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}
      GROUP BY proveedor
      ORDER BY total DESC
      LIMIT @lim`, { desde, hasta, lim: limite });
  return rows.map(r => ({ proveedor: r.proveedor, total: Number(r.total || 0), conteo: Number(r.conteo || 0) }));
}

// Top categorias de gasto por monto en un rango.
async function topCategoriasGasto(desde, hasta, limite = 10) {
  const ds = bq.DATASET;
  const [rows, gastosFijos] = await Promise.all([
    bq.query(
    `SELECT IFNULL(categoria, 'Sin categoria') AS categoria,
            IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total
       FROM \`${ds}.gastos\`
      WHERE fecha BETWEEN @desde AND @hasta AND ${ACTIVO}
      GROUP BY categoria
      ORDER BY total DESC
      LIMIT @lim`, { desde, hasta, lim: Math.max(limite, 20) }),
    gastosFijosRango(desde, hasta),
  ]);
  const porCategoria = new Map();
  rows.forEach(r => {
    const categoria = r.categoria || 'Sin categoria';
    porCategoria.set(categoria, r2((porCategoria.get(categoria) || 0) + Number(r.total || 0)));
  });
  gastosFijos.categorias.forEach(r => {
    porCategoria.set(r.categoria, r2((porCategoria.get(r.categoria) || 0) + Number(r.total || 0)));
  });
  return Array.from(porCategoria, ([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limite);
}

// --- Utilidades de fecha (hora de Mexico, sin libs externas) ---
// La tienda opera en America/Mexico_City (UTC-6, sin horario de verano desde
// 2022). Calcular "hoy"/"ayer" en UTC desfasaba el dia cerca de medianoche
// (las funciones corren en servidores UTC). Restamos el offset para obtener el
// dia civil correcto en Mexico.
const MX_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC-6

// "Ahora" en hora de Mexico, como objeto Date cuyos componentes UTC ya
// representan la fecha/hora local mexicana.
function ahoraMX() {
  return new Date(Date.now() - MX_OFFSET_MS);
}
function hoyISO() {
  return ahoraMX().toISOString().slice(0, 10);
}
function ayerISO() {
  const d = ahoraMX();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function restarDiasISO(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function diasEntre(desdeISO, hastaISO) {
  const a = new Date(desdeISO + 'T00:00:00Z');
  const b = new Date(hastaISO + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1; // inclusivo
}
function inicioMesISO(iso) {
  return String(iso || '').slice(0, 7) + '-01';
}
function sumarMesISO(inicioMes, n = 1) {
  const d = new Date(inicioMes + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
function finMesISO(inicioMes) {
  const siguiente = new Date(sumarMesISO(inicioMes, 1) + 'T00:00:00Z');
  siguiente.setUTCDate(siguiente.getUTCDate() - 1);
  return siguiente.toISOString().slice(0, 10);
}
function diasDelMesISO(inicioMes) {
  return Number(finMesISO(inicioMes).slice(8, 10));
}
function maxISO(a, b) {
  return String(a) > String(b) ? String(a) : String(b);
}
function minISO(a, b) {
  return String(a) < String(b) ? String(a) : String(b);
}

async function primerMesConVentas() {
  const ds = bq.DATASET;
  const rows = await bq.query(
    `SELECT FORMAT_DATE('%Y-%m-01', MIN(fecha)) AS mes
       FROM \`${ds}.ventas\`
      WHERE ${ACTIVO}`,
  );
  const mes = rows[0]?.mes;
  return typeof mes === 'string' && fechaValida(mes) ? mes : null;
}

async function gastosFijosRango(desde, hasta) {
  const primerMes = await primerMesConVentas();
  if (!primerMes || !fechaValida(desde) || !fechaValida(hasta)) {
    return { total: 0, categorias: [], filas: [] };
  }

  const inicio = maxISO(desde, primerMes);
  if (inicio > hasta) return { total: 0, categorias: [], filas: [] };

  const categorias = new Map();
  const filas = [];
  let total = 0;

  for (let mes = inicioMesISO(inicio); mes <= hasta; mes = sumarMesISO(mes, 1)) {
    const mesFin = finMesISO(mes);
    const overlapDesde = maxISO(inicio, mes);
    const overlapHasta = minISO(hasta, mesFin);
    if (overlapDesde > overlapHasta) continue;

    const factor = diasEntre(overlapDesde, overlapHasta) / diasDelMesISO(mes);
    for (const gasto of GASTOS_FIJOS_MENSUALES) {
      const monto = r2(gasto.total * factor);
      if (!monto) continue;
      total = r2(total + monto);
      categorias.set(gasto.categoria, r2((categorias.get(gasto.categoria) || 0) + monto));
      filas.push({
        id: `auto:${gasto.key}:${mes}`,
        fecha: overlapDesde,
        hora: null,
        concepto: gasto.concepto,
        categoria: gasto.categoria,
        clasificacion: 'gasto_fijo',
        subtotal: monto,
        iva: 0,
        ieps: 0,
        total: monto,
        impuestos_estimados: false,
        foto_url: '',
        fotos: '[]',
        activo: true,
        virtual: true,
      });
    }
  }

  return {
    total: r2(total),
    categorias: Array.from(categorias, ([categoria, total]) => ({ categoria, total })),
    filas,
  };
}

function finRangoMeses(primerMes, meses) {
  return finMesISO(sumarMesISO(primerMes, Math.max(1, Number(meses) || 1) - 1));
}

async function nominaAutomaticaRango(desde, hasta) {
  const primerMes = await primerMesConVentas();
  if (!primerMes || !fechaValida(desde) || !fechaValida(hasta)) {
    return { total: 0, filas: [] };
  }

  const filas = [];
  let total = 0;

  for (const regla of NOMINA_AUTOMATICA) {
    const inicio = maxISO(desde, primerMes);
    const fin = minISO(hasta, finRangoMeses(primerMes, regla.meses));
    if (inicio > fin) continue;

    if (regla.mensual) {
      for (let mes = inicioMesISO(inicio); mes <= fin; mes = sumarMesISO(mes, 1)) {
        const mesFin = finMesISO(mes);
        const overlapDesde = maxISO(inicio, mes);
        const overlapHasta = minISO(fin, mesFin);
        if (overlapDesde > overlapHasta) continue;
        const factor = diasEntre(overlapDesde, overlapHasta) / diasDelMesISO(mes);
        const monto = r2(regla.mensual * factor);
        if (!monto) continue;
        total = r2(total + monto);
        filas.push({
          id: `auto:${regla.key}:${mes}`,
          periodo: mes.slice(0, 7),
          fecha: overlapDesde,
          empleado: regla.empleado,
          monto,
          tipo: regla.tipo,
          activo: true,
          virtual: true,
        });
      }
    } else if (regla.semanal) {
      for (let mes = inicioMesISO(inicio); mes <= fin; mes = sumarMesISO(mes, 1)) {
        const mesFin = finMesISO(mes);
        const overlapDesde = maxISO(inicio, mes);
        const overlapHasta = minISO(fin, mesFin);
        if (overlapDesde > overlapHasta) continue;
        const monto = r2((regla.semanal / 7) * diasEntre(overlapDesde, overlapHasta));
        if (!monto) continue;
        total = r2(total + monto);
        filas.push({
          id: `auto:${regla.key}:${mes}`,
          periodo: mes.slice(0, 7),
          fecha: overlapDesde,
          empleado: regla.empleado,
          monto,
          tipo: regla.tipo,
          activo: true,
          virtual: true,
        });
      }
    }
  }

  return { total: r2(total), filas };
}

// =============================================================================
// GET action=resumen
// =============================================================================
async function resumen(cors, q) {
  const desde = q.desde;
  const hasta = q.hasta;
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const [k, serie, gastosCatRows] = await Promise.all([
    kpisRango(desde, hasta),
    serieVentas(desde, hasta),
    topCategoriasGasto(desde, hasta, 100),
  ]);

  return json(200, cors, {
    ok: true,
    kpis: {
      ventas: k.ventas, compras: k.compras, gastos: k.gastos, nomina: k.nomina,
      utilidad: k.utilidad, margen: k.margen,
      iva_compras: k.iva_compras, ieps_compras: k.ieps_compras,
    },
    serie_ventas: serie,
    gastos_por_categoria: gastosCatRows.map(r => ({ categoria: r.categoria, total: Number(r.total || 0) })),
  });
}

// =============================================================================
// GET action=ventas_panel
// =============================================================================
async function ventasPanel(cors, q) {
  const desde = q.desde;
  const hasta = q.hasta;
  const caja = String(q.caja || '').trim();
  const pago = String(q.pago || '').trim();
  const limite = Math.min(50, Math.max(5, Number(q.limite) || 10));

  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const ds = bq.DATASET;
  const baseKpis = await kpisRango(desde, hasta);

  const ticketParams = { desde, hasta };
  const ticketFiltros = ['fecha BETWEEN @desde AND @hasta', ACTIVO];
  if (pago && !caja) {
    ticketFiltros.push('forma_pago = @pago');
    ticketParams.pago = pago;
  }
  const ticketWhere = 'WHERE ' + ticketFiltros.join(' AND ');

  const detalleParams = { desde, hasta };
  const detalleWhere = filtroDetalle(detalleParams, { caja, pago });

  const [ticketAggRows, ticketSerieRows, detalleAggRows, topRows, detalleSerieRows, horasRows, cajasRows, pagosRows, pagosDetalleRows] = await Promise.all([
    bq.query(
      `SELECT IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS ventas,
              COUNT(*) AS tickets,
              IFNULL(SUM(CAST(items AS INT64)), 0) AS items,
              MAX(ts) AS ultima_venta
         FROM \`${ds}.ventas\`
        ${ticketWhere}`,
      ticketParams),
    bq.query(
      `SELECT FORMAT_DATE('%Y-%m-%d', fecha) AS fecha,
              IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total,
              COUNT(*) AS tickets,
              IFNULL(SUM(CAST(items AS INT64)), 0) AS items
         FROM \`${ds}.ventas\`
        ${ticketWhere}
        GROUP BY fecha
        ORDER BY fecha ASC`,
      ticketParams),
    queryDetalleArticulos(
      `SELECT IFNULL(SUM(CAST(importe AS FLOAT64)), 0) AS ventas,
              COUNT(DISTINCT ticket_id) AS tickets,
              IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0) AS items,
              MAX(ts) AS ultima_venta
         FROM \`${ds}.ventas_articulos\`
        ${detalleWhere}`,
      detalleParams),
    queryDetalleArticulos(
      `SELECT COALESCE(NULLIF(producto, ''), NULLIF(clave, ''), 'Sin nombre') AS producto,
              ANY_VALUE(clave) AS clave,
              IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0) AS cantidad,
              IFNULL(SUM(CAST(importe AS FLOAT64)), 0) AS importe,
              COUNT(DISTINCT ticket_id) AS tickets
         FROM \`${ds}.ventas_articulos\`
        ${detalleWhere}
        GROUP BY producto
        ORDER BY importe DESC
        LIMIT @limite`,
      { ...detalleParams, limite }),
    queryDetalleArticulos(
      `SELECT FORMAT_DATE('%Y-%m-%d', fecha) AS fecha,
              IFNULL(SUM(CAST(importe AS FLOAT64)), 0) AS total,
              COUNT(DISTINCT ticket_id) AS tickets,
              IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0) AS items
         FROM \`${ds}.ventas_articulos\`
        ${detalleWhere}
        GROUP BY fecha
        ORDER BY fecha ASC`,
      detalleParams),
    queryDetalleArticulos(
      `SELECT SUBSTR(hora, 1, 2) AS hora,
              IFNULL(SUM(CAST(importe AS FLOAT64)), 0) AS total,
              COUNT(DISTINCT ticket_id) AS tickets
         FROM \`${ds}.ventas_articulos\`
        ${detalleWhere}
          AND hora IS NOT NULL
          AND hora != ''
        GROUP BY hora
        ORDER BY hora ASC`,
      detalleParams),
    queryDetalleArticulos(
      `SELECT DISTINCT caja
         FROM \`${ds}.ventas_articulos\`
        WHERE fecha BETWEEN @desde AND @hasta
          AND ${ACTIVO}
          AND caja IS NOT NULL
          AND caja != ''
        ORDER BY caja ASC`,
      { desde, hasta }),
    bq.query(
      `SELECT forma_pago,
              IFNULL(SUM(CAST(total AS FLOAT64)), 0) AS total,
              COUNT(*) AS tickets
         FROM \`${ds}.ventas\`
        ${ticketWhere}
        GROUP BY forma_pago
        ORDER BY total DESC`,
      ticketParams),
    queryDetalleArticulos(
      `SELECT forma_pago,
              IFNULL(SUM(CAST(importe AS FLOAT64)), 0) AS total,
              COUNT(DISTINCT ticket_id) AS tickets
         FROM \`${ds}.ventas_articulos\`
        ${detalleWhere}
        GROUP BY forma_pago
        ORDER BY total DESC`,
      detalleParams),
  ]);

  const detalleDisponible = detalleAggRows !== null;
  const useDetalle = Boolean(caja) && detalleDisponible;
  const ventasAgg = useDetalle ? (detalleAggRows[0] || {}) : (ticketAggRows[0] || {});
  const ventas = Number(ventasAgg.ventas || 0);
  const tickets = Number(ventasAgg.tickets || 0);
  const itemsDetalle = detalleDisponible ? Number((detalleAggRows[0] || {}).items || 0) : 0;
  const itemsTicket = Number(ventasAgg.items || 0);
  const items = itemsDetalle || itemsTicket;
  const serie = useDetalle && detalleSerieRows ? detalleSerieRows : ticketSerieRows;
  const pagosBase = useDetalle && pagosDetalleRows ? pagosDetalleRows : pagosRows;
  const pagosTotal = pagosBase.reduce((sum, r) => sum + Number(r.total || 0), 0) || 1;

  return json(200, cors, {
    ok: true,
    detalle_disponible: detalleDisponible,
    filtros: { desde, hasta, caja, pago },
    kpis: {
      ...baseKpis,
      ventas,
      utilidad: ventas - baseKpis.compras - baseKpis.gastos - baseKpis.nomina,
      margen: ventas > 0 ? ((ventas - baseKpis.compras - baseKpis.gastos - baseKpis.nomina) / ventas) * 100 : 0,
      tickets,
      items,
      ticket_promedio: tickets > 0 ? ventas / tickets : 0,
    },
    serie_ventas: serie.map(r => ({
      fecha: r.fecha,
      total: Number(r.total || 0),
      tickets: Number(r.tickets || 0),
      items: Number(r.items || 0),
    })),
    top_articulos: (topRows || []).map(r => ({
      producto: r.producto || 'Sin nombre',
      clave: r.clave || '',
      cantidad: Number(r.cantidad || 0),
      importe: Number(r.importe || 0),
      tickets: Number(r.tickets || 0),
    })),
    formas_pago: pagosBase.map(r => ({
      forma_pago: r.forma_pago || 'desconocido',
      total: Number(r.total || 0),
      tickets: Number(r.tickets || 0),
      pct: Number(((Number(r.total || 0) / pagosTotal) * 100).toFixed(1)),
    })),
    por_hora: (horasRows || []).map(r => ({
      hora: `${String(r.hora || '').padStart(2, '0')}:00`,
      total: Number(r.total || 0),
      tickets: Number(r.tickets || 0),
    })),
    cajas: (cajasRows || []).map(r => r.caja).filter(Boolean),
    pagos: pagosRows.map(r => r.forma_pago || 'desconocido').filter(Boolean),
    ultima_venta: ventasAgg.ultima_venta || null,
  });
}

// =============================================================================
// GET action=lista
// =============================================================================
async function lista(cors, q) {
  const tabla = String(q.tabla || '');
  const desde = q.desde;
  const hasta = q.hasta;

  if (!TABLAS_LISTA.includes(tabla)) {
    return json(400, cors, { ok: false, error: 'tabla invalida (ventas|ventas_articulos|compras|gastos|nomina)' });
  }
  const tieneDesde = desde !== undefined && desde !== '';
  const tieneHasta = hasta !== undefined && hasta !== '';
  if ((tieneDesde && !fechaValida(desde)) || (tieneHasta && !fechaValida(hasta))) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const ds = bq.DATASET;
  const params = {};
  // Las listas solo muestran filas activas (v2).
  const filtros = [ACTIVO];
  if (tieneDesde) { filtros.push('fecha >= @desde'); params.desde = desde; }
  if (tieneHasta) { filtros.push('fecha <= @hasta'); params.hasta = hasta; }
  const where = 'WHERE ' + filtros.join(' AND ');

  const filas = await bq.query(
    `SELECT *
       FROM \`${ds}.${tabla}\`
      ${where}
      ORDER BY fecha DESC
      LIMIT 1000`,
    params);

  let normalizadas = filas.map(normalizarFila);
  if (tabla === 'gastos') {
    const primerMes = await primerMesConVentas();
    const rangoDesde = tieneDesde ? desde : primerMes;
    const rangoHasta = tieneHasta ? hasta : hoyISO();
    if (rangoDesde && rangoHasta) {
      const fijos = await gastosFijosRango(rangoDesde, rangoHasta);
      normalizadas = normalizadas.concat(fijos.filas)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    }
  }
  if (tabla === 'nomina') {
    const primerMes = await primerMesConVentas();
    const rangoDesde = tieneDesde ? desde : primerMes;
    const rangoHasta = tieneHasta ? hasta : hoyISO();
    if (rangoDesde && rangoHasta) {
      const auto = await nominaAutomaticaRango(rangoDesde, rangoHasta);
      normalizadas = normalizadas.concat(auto.filas)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    }
  }

  return json(200, cors, { ok: true, filas: normalizadas });
}

// =============================================================================
// GET action=resumen_inventario_sicar
// =============================================================================
async function resumenInventarioSicar(cors, q) {
  const desde = q.desde;
  const hasta = q.hasta;
  const agrupar = String(q.agrupar || 'mes').toLowerCase();

  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }
  if (!['mes', 'dia'].includes(agrupar)) {
    return json(400, cors, { ok: false, error: 'agrupar debe ser mes|dia' });
  }

  const ds = bq.DATASET;
  const params = { desde, hasta };
  const formato = agrupar === 'dia' ? '%Y-%m-%d' : '%Y-%m';
  const filtroInventario = `
    fecha BETWEEN @desde AND @hasta
    AND STARTS_WITH(IFNULL(raw_ocr, ''), 'sicar_inventory:')
    AND ${ACTIVO}`;

  const [totales, periodos] = await Promise.all([
    bq.query(
      `SELECT COUNT(*) AS conteo,
              ROUND(IFNULL(SUM(CAST(total AS FLOAT64)), 0), 2) AS total,
              FORMAT_DATE('%Y-%m-%d', MIN(fecha)) AS primera,
              FORMAT_DATE('%Y-%m-%d', MAX(fecha)) AS ultima,
              ROUND(IFNULL(MAX(CAST(total AS FLOAT64)), 0), 2) AS max_total
         FROM \`${ds}.compras\`
        WHERE ${filtroInventario}`,
      params,
    ),
    bq.query(
      `SELECT FORMAT_DATE('${formato}', fecha) AS periodo,
              COUNT(*) AS conteo,
              ROUND(IFNULL(SUM(CAST(total AS FLOAT64)), 0), 2) AS total,
              FORMAT_DATE('%Y-%m-%d', MIN(fecha)) AS primera,
              FORMAT_DATE('%Y-%m-%d', MAX(fecha)) AS ultima,
              ROUND(IFNULL(MAX(CAST(total AS FLOAT64)), 0), 2) AS max_total
         FROM \`${ds}.compras\`
        WHERE ${filtroInventario}
        GROUP BY periodo
        ORDER BY periodo ASC`,
      params,
    ),
  ]);

  const resumen = totales[0] || {};
  return json(200, cors, {
    ok: true,
    agrupar,
    resumen: {
      conteo: Number(resumen.conteo || 0),
      total: Number(resumen.total || 0),
      primera: resumen.primera || null,
      ultima: resumen.ultima || null,
      max_total: Number(resumen.max_total || 0),
    },
    periodos: periodos.map(r => ({
      periodo: r.periodo,
      conteo: Number(r.conteo || 0),
      total: Number(r.total || 0),
      primera: r.primera || null,
      ultima: r.ultima || null,
      max_total: Number(r.max_total || 0),
    })),
  });
}

// Aplana tipos especiales del cliente de BigQuery (DATE/TIMESTAMP -> string,
// NUMERIC string -> Number) para que el JSON al frontend sea "plano".
function normalizarValor(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object' && v !== null && typeof v.value === 'string') return v.value;
  return v;
}
function normalizarFila(fila) {
  const out = {};
  for (const k of Object.keys(fila)) {
    let v = normalizarValor(fila[k]);
    if (typeof v === 'string' && COLS_NUMERIC.has(k) && v !== '' && !isNaN(Number(v))) {
      v = Number(v);
    }
    out[k] = v;
  }
  return out;
}

// =============================================================================
// GET action=analitica
// =============================================================================
async function analitica(cors, q) {
  const desde = q.desde;
  const hasta = q.hasta;
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  // Periodo anterior equivalente: mismo numero de dias, inmediatamente antes.
  const ndias = diasEntre(desde, hasta);
  const hastaAnt = restarDiasISO(desde, 1);
  const desdeAnt = restarDiasISO(hastaAnt, ndias - 1);

  const [kAct, kAnt, tProv, tCat] = await Promise.all([
    kpisRango(desde, hasta),
    kpisRango(desdeAnt, hastaAnt),
    topProveedores(desde, hasta),
    topCategoriasGasto(desde, hasta),
  ]);

  // cambio_pct por metrica: (actual - anterior) / |anterior| * 100. Si anterior=0
  // y actual!=0 -> 100 (o 0 si ambos son 0).
  function pct(a, b) {
    if (b === 0) return a === 0 ? 0 : 100;
    return ((a - b) / Math.abs(b)) * 100;
  }
  const cambio_pct = {
    ventas:   pct(kAct.ventas,   kAnt.ventas),
    compras:  pct(kAct.compras,  kAnt.compras),
    gastos:   pct(kAct.gastos,   kAnt.gastos),
    nomina:   pct(kAct.nomina,   kAnt.nomina),
    utilidad: pct(kAct.utilidad, kAnt.utilidad),
  };

  // Proyeccion del MES en curso por run-rate. Usa el mes natural de "hoy".
  const hoy = hoyISO();
  const anio = Number(hoy.slice(0, 4));
  const mes  = Number(hoy.slice(5, 7));
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const dias_mes = new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // ultimo dia del mes
  const dias_transcurridos = Number(hoy.slice(8, 10));
  const kMes = await kpisRango(inicioMes, hoy);
  const factor = dias_transcurridos > 0 ? dias_mes / dias_transcurridos : 0;
  const ventas_proy   = kMes.ventas * factor;
  const utilidad_proy = kMes.utilidad * factor;

  return json(200, cors, {
    ok: true,
    comparativo: {
      actual:   { ventas: kAct.ventas, compras: kAct.compras, gastos: kAct.gastos, nomina: kAct.nomina, utilidad: kAct.utilidad },
      anterior: { ventas: kAnt.ventas, compras: kAnt.compras, gastos: kAnt.gastos, nomina: kAnt.nomina, utilidad: kAnt.utilidad },
      cambio_pct,
    },
    top_proveedores: tProv,
    top_categorias_gasto: tCat,
    proyeccion_mes: {
      ventas_proy,
      utilidad_proy,
      dias_transcurridos,
      dias_mes,
    },
  });
}

// =============================================================================
// GET action=alertas
// =============================================================================
async function alertas(cors) {
  const lista = await calcularAlertas();
  return json(200, cors, { ok: true, alertas: lista });
}

// Funcion reutilizable: calcula las alertas operativas. La importa tambien
// sc-resumen-diario. Devuelve [{ nivel, tipo, mensaje }].
//   Reglas (CONTRACT v2):
//    - margen del mes < META_MARGEN (default 20)
//    - gasto/compra del dia de hoy > 2x promedio diario del mes
//    - ventas de ayer < 60% del mismo dia de la semana pasada
//    - salud SICAR: sin ventas fuente='sicar' ayer/hoy
async function calcularAlertas() {
  const ds = bq.DATASET;
  const out = [];

  const hoy = hoyISO();
  const ayer = ayerISO();
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const haceSemana = restarDiasISO(ayer, 7);

  // --- Regla 1: margen del mes en curso ---
  const kMes = await kpisRango(inicioMes, hoy);
  if (kMes.ventas > 0 && kMes.margen < META_MARGEN) {
    out.push({
      nivel: 'alto',
      tipo: 'margen',
      mensaje: `El margen del mes (${kMes.margen.toFixed(1)}%) esta por debajo de la meta (${META_MARGEN}%).`,
    });
  }

  // --- Regla 2: gasto+compra del dia de hoy > 2x promedio diario del mes ---
  const dias_transcurridos = Number(hoy.slice(8, 10));
  const egresoHoyRows = await bq.query(
    `SELECT
       (SELECT IFNULL(SUM(CAST(total AS FLOAT64)),0) FROM \`${ds}.compras\` WHERE fecha=@hoy AND ${ACTIVO}) AS compras,
       (SELECT IFNULL(SUM(CAST(total AS FLOAT64)),0) FROM \`${ds}.gastos\`  WHERE fecha=@hoy AND ${ACTIVO}) AS gastos`,
    { hoy });
  const gastosFijosHoy = await gastosFijosRango(hoy, hoy);
  const egresoHoy = Number(egresoHoyRows[0]?.compras || 0) + Number(egresoHoyRows[0]?.gastos || 0) + gastosFijosHoy.total;
  const egresoMes = kMes.compras + kMes.gastos;
  const promDiario = dias_transcurridos > 0 ? egresoMes / dias_transcurridos : 0;
  if (promDiario > 0 && egresoHoy > 2 * promDiario) {
    out.push({
      nivel: 'warn',
      tipo: 'egreso_dia',
      mensaje: `Los egresos de hoy ($${egresoHoy.toFixed(2)}) superan el doble del promedio diario del mes ($${promDiario.toFixed(2)}).`,
    });
  }

  // --- Regla 3: ventas de ayer < 60% del mismo dia de la semana pasada ---
  const ventasDiaRows = await bq.query(
    `SELECT
       (SELECT IFNULL(SUM(CAST(total AS FLOAT64)),0) FROM \`${ds}.ventas\` WHERE fecha=@ayer       AND ${ACTIVO}) AS ayer,
       (SELECT IFNULL(SUM(CAST(total AS FLOAT64)),0) FROM \`${ds}.ventas\` WHERE fecha=@haceSemana AND ${ACTIVO}) AS hace_semana`,
    { ayer, haceSemana });
  const vAyer = Number(ventasDiaRows[0]?.ayer || 0);
  const vSemana = Number(ventasDiaRows[0]?.hace_semana || 0);
  if (vSemana > 0 && vAyer < 0.6 * vSemana) {
    out.push({
      nivel: 'warn',
      tipo: 'caida_ventas',
      mensaje: `Las ventas de ayer ($${vAyer.toFixed(2)}) cayeron por debajo del 60% del mismo dia de la semana pasada ($${vSemana.toFixed(2)}).`,
    });
  }

  // --- Regla 4: salud SICAR (sin ventas fuente='sicar' ayer/hoy) ---
  const sicarRows = await bq.query(
    `SELECT COUNT(*) AS n
       FROM \`${ds}.ventas\`
      WHERE fuente = 'sicar' AND fecha IN (@ayer, @hoy) AND ${ACTIVO}`,
    { ayer, hoy });
  const nSicar = Number(sicarRows[0]?.n || 0);
  if (nSicar === 0) {
    out.push({
      nivel: 'alto',
      tipo: 'sicar',
      mensaje: 'No se han recibido ventas desde SICAR ayer ni hoy. Revisa que el bridge este corriendo.',
    });
  }

  return out;
}

// =============================================================================
// POST action=insertar
// =============================================================================
async function compraExistentePorHuella(rawOcr) {
  const huella = String(rawOcr || '').trim();
  if (!huella || !huella.startsWith('foto_hash:')) return null;
  const rows = await bq.query(
    `SELECT id
       FROM \`${bq.DATASET}.compras\`
      WHERE raw_ocr = @raw_ocr
        AND ${ACTIVO}
      LIMIT 1`,
    { raw_ocr: huella },
  );
  return rows[0] || null;
}

async function insertar(cors, body) {
  const tabla = String(body.tabla || '');
  const fila  = body.fila;

  if (!TABLAS_INSERTAR.includes(tabla)) {
    return json(400, cors, { ok: false, error: 'tabla invalida (compras|gastos|nomina)' });
  }
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) {
    return json(400, cors, { ok: false, error: 'Falta fila (objeto)' });
  }
  if (!fechaValida(fila.fecha)) {
    return json(400, cors, { ok: false, error: 'fila.fecha debe ser YYYY-MM-DD' });
  }

  const faltan = REQUERIDOS[tabla].filter(c => {
    const v = fila[c];
    return v === undefined || v === null || v === '';
  });
  if (faltan.length) {
    return json(400, cors, { ok: false, error: 'Faltan campos requeridos: ' + faltan.join(', ') });
  }

  // Construye el registro SOLO con columnas de la lista blanca de la tabla.
  // El backend SIEMPRE controla id y activo: se ignora lo que mande el frontend.
  const registro = filtrarColumnas(tabla, fila);
  registro.id = crypto.randomUUID();
  registro.activo = true;

  if (tabla === 'compras') {
    const existente = await compraExistentePorHuella(registro.raw_ocr);
    if (existente) {
      return json(200, cors, { ok: true, insertados: 0, duplicado: true, id: existente.id });
    }
  }

  // Subida opcional de imagenes a GCS. Graceful: si no hay GCS o falla, guarda
  // sin fotos y no bloquea (subirImagenes devuelve []).
  const imgs = Array.isArray(body.imagenes_base64) ? body.imagenes_base64 : null;
  if (imgs && imgs.length && (tabla === 'compras' || tabla === 'gastos')) {
    try {
      const urls = await gcs.subirImagenes(imgs, tabla);
      if (urls && urls.length) {
        registro.fotos = JSON.stringify(urls);
        registro.foto_url = urls[0];
      }
    } catch (e) {
      // No bloquea el guardado del registro.
    }
  }

  await bq.insertRows(tabla, [registro]);
  return json(200, cors, { ok: true, insertados: 1 });
}

// =============================================================================
// POST action=actualizar
// =============================================================================
async function actualizar(cors, body) {
  const tabla = String(body.tabla || '');
  const id    = body.id;
  const fila  = body.fila;

  if (!TABLAS_INSERTAR.includes(tabla)) {
    return json(400, cors, { ok: false, error: 'tabla invalida (compras|gastos|nomina)' });
  }
  if (!id || typeof id !== 'string') {
    return json(400, cors, { ok: false, error: 'Falta id (string)' });
  }
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) {
    return json(400, cors, { ok: false, error: 'Falta fila (objeto)' });
  }
  // fecha, si viene, debe ser valida.
  if (fila.fecha !== undefined && fila.fecha !== null && !fechaValida(fila.fecha)) {
    return json(400, cors, { ok: false, error: 'fila.fecha debe ser YYYY-MM-DD' });
  }

  // Solo columnas de la lista blanca; nunca se reescriben id/activo aqui.
  const campos = filtrarColumnas(tabla, fila);
  delete campos.id;
  delete campos.activo;
  if (Object.keys(campos).length === 0) {
    return json(400, cors, { ok: false, error: 'No hay campos validos para actualizar' });
  }

  await bq.actualizar(tabla, id, campos);
  return json(200, cors, { ok: true, actualizados: 1 });
}

// =============================================================================
// POST action=eliminar (soft delete)
// =============================================================================
async function eliminar(cors, body) {
  const tabla = String(body.tabla || '');
  const id    = body.id;

  if (!TABLAS_INSERTAR.includes(tabla)) {
    return json(400, cors, { ok: false, error: 'tabla invalida (compras|gastos|nomina)' });
  }
  if (!id || typeof id !== 'string') {
    return json(400, cors, { ok: false, error: 'Falta id (string)' });
  }

  await bq.softDelete(tabla, id);
  return json(200, cors, { ok: true, eliminados: 1 });
}

// =============================================================================
// POST action=eliminar_inventario_sicar (soft delete bulk)
// =============================================================================
async function eliminarInventarioSicar(cors, body) {
  const desde = body.desde;
  const hasta = body.hasta;
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const ds = bq.DATASET;
  const params = { desde, hasta };
  const countRows = await bq.query(
    `SELECT COUNT(*) AS total
       FROM \`${ds}.compras\`
      WHERE fecha BETWEEN @desde AND @hasta
        AND STARTS_WITH(raw_ocr, 'sicar_inventory:')
        AND ${ACTIVO}`,
    params,
  );
  const eliminados = Number(countRows[0]?.total || 0);
  if (eliminados > 0) {
    await bq.query(
      `UPDATE \`${ds}.compras\`
          SET activo = FALSE
        WHERE fecha BETWEEN @desde AND @hasta
          AND STARTS_WITH(raw_ocr, 'sicar_inventory:')
          AND ${ACTIVO}`,
      params,
    );
  }
  return json(200, cors, { ok: true, eliminados });
}

// =============================================================================
// Helper: filtra una fila a las columnas permitidas de la tabla y castea tipos.
// id/activo/ts no se incluyen aqui (los controla el caller / el servidor).
// =============================================================================
function filtrarColumnas(tabla, fila) {
  const COLS_NUMERIC_SET = COLS_NUMERIC;
  const COLS_BOOL = new Set(['impuestos_estimados', 'activo']);
  const registro = {};
  for (const col of COLUMNAS[tabla]) {
    if (col === 'id' || col === 'activo') continue; // los pone el servidor
    if (!(col in fila)) continue;
    const v = fila[col];
    if (v === undefined || v === null) continue;
    if (COLS_NUMERIC_SET.has(col)) {
      const n = Number(v);
      registro[col] = Number.isFinite(n) ? n : 0;
    } else if (COLS_BOOL.has(col)) {
      registro[col] = Boolean(v);
    } else if (typeof v === 'string') {
      // conceptos/fotos llegan ya como string JSON desde el frontend: no se
      // re-serializan para no doble-codificar.
      registro[col] = v;
    } else if ((col === 'conceptos' || col === 'fotos') && typeof v === 'object') {
      registro[col] = JSON.stringify(v);
    } else {
      registro[col] = String(v);
    }
  }
  return registro;
}

// Se exportan helpers para reuso por sc-chat y sc-resumen-diario.
exports.calcularAlertas      = calcularAlertas;
exports.kpisRango            = kpisRango;
exports.serieVentas          = serieVentas;
exports.topProveedores       = topProveedores;
exports.topCategoriasGasto   = topCategoriasGasto;
exports.hoyISO               = hoyISO;
exports.ayerISO              = ayerISO;
exports.restarDiasISO        = restarDiasISO;
