// API del dashboard SUPER CHEAP (v2).
//
// Toda llamada requiere un Bearer token valido (firmado por auth.js).
// Responde con la forma exacta definida en CONTRACT.md (seccion CONTRATO v2).
//
//   GET  ?action=resumen&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   GET  ?action=tendencia_compras_ventas&desde=&hasta=&agrupar=mes|dia
//   GET  ?action=plan_compras_semanal&desde=&hasta=&limite=
//   GET  ?action=lista&tabla=ventas|compras|gastos|nomina&desde=&hasta=
//   GET  ?action=resumen_inventario_sicar&desde=&hasta=&agrupar=mes|dia
//   GET  ?action=resumen_ajuste_inventario_olvidado&desde=&hasta=
//   GET  ?action=analitica&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   GET  ?action=alertas
//   POST { action:"insertar",   tabla:"compras|gastos|nomina", fila:{...}, imagenes_base64?:[...] }
//   POST { action:"actualizar", tabla, id, fila }
//   POST { action:"eliminar",   tabla, id }
//   POST { action:"importar_ventas", ventas:[...] }  // Plan B Excel SICAR
//   POST { action:"eliminar_inventario_sicar", desde, hasta } // admin: soft delete bulk
//   POST { action:"generar_ajuste_inventario_olvidado", desde, hasta }
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

const AJUSTE_INVENTARIO_OLVIDADO_PREFIX = 'sicar_inventory_forgotten:';
const AJUSTE_INVENTARIO_GENERAL = 0.02;
const AJUSTE_INVENTARIO_VINOS_LICORES = 0.01;
const PATRON_VINOS_LICORES = [
  'vino', 'vinos', 'licor', 'licores', 'tequila', 'mezcal', 'whisky', 'whiskey',
  'ron', 'vodka', 'brandy', 'cognac', 'ginebra', 'gin', 'champagne', 'champana',
  'champaña', 'sidra', 'cerveza', 'cervezas', 'bacardi', 'buchanan', 'cuervo',
  'herradura', 'smirnoff', 'absolut', 'baileys', 'aperol', 'campari',
  'modelo', 'victoria', 'tecate', 'pacifico', 'stella', 'miller', 'new mix',
].join('|');

const CATEGORIAS_PLAN_COMPRA = [
  { categoria: 'Vinos y licores', re: new RegExp(PATRON_VINOS_LICORES, 'i') },
  { categoria: 'Comida preparada', re: /\b(torta|sandwich|baguette|cargo por porcion|mezcla de la casa)\b/i },
  { categoria: 'Bebidas', re: /\b(coca|cocacola|pepsi|sprite|fanta|fresca|sidral|jarrito|boing|jumex|del valle|gatorade|powerade|suero|electrolit|agua|ciel|bonafont|refresco|jugo|leche|yogurt|yakult|amper|monster|fuze|delaware|penafiel|selz|vive 100|red bull|hielo)\b/i },
  { categoria: 'Dulces y botanas', re: /\b(sabrita|ruffles|dorito|doritos|cheeto|cheetos|takis|chips|papas|cacahuate|botana|palomita|dulce|chocolate|mazapan|paleta|chicle|gomita|galleta|marinela|pinguino|gansito|submarino|bubu|kinder|snicker|m&m|panditas|bolzaza|churrumais|clorets|tutsi|picafresa|pikaros|kiyakis|pollitos|trident|orbit|alfajor|canasta)\b/i },
  { categoria: 'Pan y reposteria', re: /\b(pan|bimbo|tortilla|tortillina|cuernito|concha|bolillo|telera|pastel|panque|reposteria|donita|donitas|donas|roles|nito|duo nito|rebanadas|crossantines|croissantines)\b/i },
  { categoria: 'Abarrotes', re: /\b(arroz|frijol|aceite|atun|sardina|sopa|pasta|azucar|sal|cafe|huevo|mayonesa|catsup|salsa|lata|conserva|harina|cereal|avena|consome|knorr)\b/i },
  { categoria: 'Limpieza', re: /\b(cloro|detergente|fabuloso|pinol|suavitel|jabon|escoba|trapeador|bolsa basura|limpiador|desinfectante|servitoalla)\b/i },
  { categoria: 'Cuidado personal', re: /\b(shampoo|desodorante|pasta dental|cepillo|crema|rastrillo|papel higienico|toalla femenina|panal|panales|gel|talco)\b/i },
  { categoria: 'Cigarros', re: /\b(cigarro|cigarros|marlboro|pall mall|camel|chesterfield|delicados|montana|lucky|faritos)\b/i },
  { categoria: 'Papeleria y varios', re: /\b(estampa|estampas|sobre|pluma|lapiz|cuaderno|cinta|encendedor|vaso|plato|servilleta|popote|bolsa)\b/i },
];

function textoSinAcentos(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function categoriaPlanCompra(categoria, producto, clave) {
  const cat = String(categoria || '').trim();
  if (cat && !/^sin categor/i.test(textoSinAcentos(cat))) return cat;
  const texto = textoSinAcentos([producto, clave].filter(Boolean).join(' '));
  const match = CATEGORIAS_PLAN_COMPRA.find(c => c.re.test(texto));
  return match ? match.categoria : 'Sin categoria';
}

function textoPlanKey(s) {
  return textoSinAcentos(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clavePlanKey(s) {
  return textoPlanKey(s).replace(/\s+/g, '');
}

function parseJsonArraySeguro(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(String(s));
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function productoClaveDesdeConcepto(concepto) {
  const desc = String((concepto && concepto.descripcion) || '').trim();
  let producto = desc
    .replace(/^\s*[\d.,]+\s+unidad(?:es)?\s*/i, '')
    .trim();
  let clave = String((concepto && (concepto.clave || concepto.codigo || concepto.sku)) || '').trim();
  const m = /\(([^()]+)\)\s*$/.exec(producto);
  if (m) {
    if (!clave) clave = m[1].trim();
    producto = producto.slice(0, m.index).trim();
  }
  return { producto, clave };
}

function costoDesdeConcepto(concepto) {
  if (!concepto || typeof concepto !== 'object') return null;
  const directo = Number(concepto.costo_unitario ?? concepto.costo ?? concepto.precio_compra ?? concepto.ultimo_costo ?? concepto.costo_promedio);
  if (Number.isFinite(directo) && directo > 0) return directo;
  const importe = Number(concepto.importe ?? concepto.total ?? concepto.monto);
  const cantidad = Number(concepto.cantidad);
  if (Number.isFinite(importe) && importe > 0 && Number.isFinite(cantidad) && cantidad > 0) {
    return importe / cantidad;
  }
  return null;
}

async function costosUnitariosPlanCompra(hasta) {
  const rows = await bq.query(
    `SELECT fecha, proveedor, conceptos, raw_ocr
       FROM \`${bq.DATASET}.compras\`
      WHERE fecha <= @hasta
        AND ${ACTIVO}
        AND conceptos IS NOT NULL
        AND conceptos != ''
      ORDER BY fecha DESC
      LIMIT 20000`,
    { hasta },
  );
  const porClave = new Map();
  const porProductoDatos = new Map();
  for (const row of rows) {
    const conceptos = parseJsonArraySeguro(row.conceptos);
    for (const c of conceptos) {
      const costo = costoDesdeConcepto(c);
      if (!(costo > 0)) continue;
      const info = productoClaveDesdeConcepto(c);
      const dato = {
        costo: r2(costo),
        fecha: row.fecha || null,
        proveedor: row.proveedor || '',
        origen: String(row.raw_ocr || '').startsWith('sicar_') ? 'SICAR' : 'ticket',
      };
      const claveKey = clavePlanKey(info.clave);
      const productoKey = textoPlanKey(info.producto);
      if (claveKey && !porClave.has(claveKey)) porClave.set(claveKey, { ...dato, metodo: 'clave' });
      if (productoKey) {
        if (!porProductoDatos.has(productoKey)) {
          porProductoDatos.set(productoKey, { dato: { ...dato, metodo: 'producto' }, claves: new Set() });
        }
        if (claveKey) porProductoDatos.get(productoKey).claves.add(claveKey);
      }
    }
  }
  const porProducto = new Map();
  for (const [productoKey, entry] of porProductoDatos.entries()) {
    if (productoKey.length >= 8 && entry.claves.size <= 1) {
      porProducto.set(productoKey, entry.dato);
    }
  }
  return { porClave, porProducto };
}

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
      if (action === 'tendencia_compras_ventas' || action === 'tendencia_operativa') return await tendenciaComprasVentas(cors, q);
      if (action === 'ventas_panel') return await ventasPanel(cors, q);
      if (action === 'plan_compras_semanal') return await planComprasSemanal(cors, q);
      if (action === 'lista')     return await lista(cors, q);
      if (action === 'resumen_inventario_sicar') return await resumenInventarioSicar(cors, q);
      if (action === 'resumen_ajuste_inventario_olvidado') return await resumenAjusteInventarioOlvidado(cors, q);
      if (action === 'analitica') return await analitica(cors, q);
      if (action === 'alertas')   return await alertas(cors, q);
      if (action === 'foto') {
        // Devuelve un enlace firmado temporal para ver una foto privada (gs://...).
        const url = await gcs.firmarUrl(String(q.ref || ''), 60);
        return json(url ? 200 : 404, cors, url ? { ok: true, url } : { ok: false, error: 'Foto no disponible' });
      }
      return json(400, cors, { ok: false, error: 'action invalida (resumen|tendencia_compras_ventas|ventas_panel|plan_compras_semanal|lista|resumen_inventario_sicar|resumen_ajuste_inventario_olvidado|analitica|alertas|foto)' });
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
      if (action === 'generar_ajuste_inventario_olvidado') return await generarAjusteInventarioOlvidado(cors, body);
      if (action === 'importar_ventas') return await importarVentas(cors, body);
      return json(400, cors, { ok: false, error: 'action invalida (insertar|actualizar|eliminar|eliminar_inventario_sicar|generar_ajuste_inventario_olvidado|importar_ventas)' });
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

async function primerDiaOperacion() {
  const ds = bq.DATASET;
  const rows = await bq.query(
    `SELECT FORMAT_DATE('%Y-%m-%d', MIN(fecha)) AS fecha
       FROM (
         SELECT fecha FROM \`${ds}.ventas\` WHERE ${ACTIVO}
         UNION ALL
         SELECT fecha FROM \`${ds}.compras\` WHERE ${ACTIVO}
       )`,
  );
  const fecha = rows[0]?.fecha;
  return fechaValida(fecha) ? fecha : null;
}

// Serie mensual/diaria para revisar si las compras estan rebasando ventas.
async function tendenciaComprasVentas(cors, q) {
  const agrupar = String(q.agrupar || 'mes').toLowerCase();
  if (!['mes', 'dia'].includes(agrupar)) {
    return json(400, cors, { ok: false, error: 'agrupar debe ser mes o dia' });
  }

  const hasta = fechaValida(q.hasta) ? q.hasta : hoyISO();
  let desde = fechaValida(q.desde) ? q.desde : null;
  if (!desde) desde = await primerDiaOperacion() || inicioMesISO(hasta);
  if (desde > hasta) {
    return json(400, cors, { ok: false, error: 'desde no puede ser mayor que hasta' });
  }

  const ds = bq.DATASET;
  const periodoExpr = agrupar === 'dia'
    ? "FORMAT_DATE('%Y-%m-%d', fecha)"
    : "FORMAT_DATE('%Y-%m', fecha)";

  const rows = await bq.query(
    `WITH ventas AS (
       SELECT ${periodoExpr} AS periodo,
              ROUND(IFNULL(SUM(CAST(total AS FLOAT64)), 0), 2) AS ventas,
              COUNT(*) AS tickets
         FROM \`${ds}.ventas\`
        WHERE fecha BETWEEN @desde AND @hasta
          AND ${ACTIVO}
        GROUP BY periodo
     ),
     compras_base AS (
       SELECT ${periodoExpr} AS periodo,
              IFNULL(CAST(total AS FLOAT64), 0) AS total,
              IFNULL(raw_ocr, '') AS raw_ocr
         FROM \`${ds}.compras\`
        WHERE fecha BETWEEN @desde AND @hasta
          AND ${ACTIVO}
     ),
     compras AS (
       SELECT periodo,
              ROUND(IFNULL(SUM(total), 0), 2) AS compras,
              COUNT(*) AS compras_registros,
              ROUND(IFNULL(SUM(CASE WHEN STARTS_WITH(raw_ocr, 'sicar_inventory:') THEN total ELSE 0 END), 0), 2) AS compras_inventario_sicar,
              ROUND(IFNULL(SUM(CASE WHEN STARTS_WITH(raw_ocr, @forgotten_prefix) THEN total ELSE 0 END), 0), 2) AS compras_ajuste_olvidado,
              ROUND(IFNULL(SUM(CASE WHEN STARTS_WITH(raw_ocr, @negative_prefix) THEN total ELSE 0 END), 0), 2) AS compras_existencia_negativa,
              ROUND(IFNULL(SUM(CASE
                WHEN raw_ocr = ''
                  OR (
                    NOT STARTS_WITH(raw_ocr, 'sicar_inventory:')
                    AND NOT STARTS_WITH(raw_ocr, @forgotten_prefix)
                    AND NOT STARTS_WITH(raw_ocr, @negative_prefix)
                    AND NOT STARTS_WITH(raw_ocr, 'sicar_')
                  )
                THEN total ELSE 0 END), 0), 2) AS compras_manual,
              ROUND(IFNULL(SUM(CASE
                WHEN STARTS_WITH(raw_ocr, 'sicar_')
                  AND NOT STARTS_WITH(raw_ocr, 'sicar_inventory:')
                  AND NOT STARTS_WITH(raw_ocr, @forgotten_prefix)
                  AND NOT STARTS_WITH(raw_ocr, @negative_prefix)
                THEN total ELSE 0 END), 0), 2) AS compras_otras_sicar
         FROM compras_base
        GROUP BY periodo
     ),
     periodos AS (
       SELECT periodo FROM ventas
       UNION DISTINCT
       SELECT periodo FROM compras
     )
     SELECT p.periodo,
            IFNULL(v.ventas, 0) AS ventas,
            IFNULL(v.tickets, 0) AS tickets,
            IFNULL(c.compras, 0) AS compras,
            IFNULL(c.compras_registros, 0) AS compras_registros,
            IFNULL(c.compras_manual, 0) AS compras_manual,
            IFNULL(c.compras_inventario_sicar, 0) AS compras_inventario_sicar,
            IFNULL(c.compras_ajuste_olvidado, 0) AS compras_ajuste_olvidado,
            IFNULL(c.compras_existencia_negativa, 0) AS compras_existencia_negativa,
            IFNULL(c.compras_otras_sicar, 0) AS compras_otras_sicar
       FROM periodos p
       LEFT JOIN ventas v USING(periodo)
       LEFT JOIN compras c USING(periodo)
      ORDER BY p.periodo ASC`,
    {
      desde,
      hasta,
      forgotten_prefix: AJUSTE_INVENTARIO_OLVIDADO_PREFIX,
      negative_prefix: 'sicar_negative_stock:',
    },
  );

  const periodos = rows.map(r => {
    const ventas = r2(r.ventas);
    const compras = r2(r.compras);
    const brecha = r2(ventas - compras);
    return {
      periodo: r.periodo,
      ventas,
      compras,
      tickets: Number(r.tickets || 0),
      compras_registros: Number(r.compras_registros || 0),
      compras_manual: r2(r.compras_manual),
      compras_inventario_sicar: r2(r.compras_inventario_sicar),
      compras_ajuste_olvidado: r2(r.compras_ajuste_olvidado),
      compras_existencia_negativa: r2(r.compras_existencia_negativa),
      compras_otras_sicar: r2(r.compras_otras_sicar),
      brecha,
      utilidad_bruta_antes_gastos: brecha,
      compras_pct_ventas: ventas > 0 ? r2((compras / ventas) * 100) : null,
      compras_mayores_ventas: compras > ventas,
      sin_ventas_con_compras: ventas === 0 && compras > 0,
    };
  });

  const resumen = periodos.reduce((acc, r) => {
    acc.total_ventas = r2(acc.total_ventas + r.ventas);
    acc.total_compras = r2(acc.total_compras + r.compras);
    acc.compras_manual = r2(acc.compras_manual + r.compras_manual);
    acc.compras_inventario_sicar = r2(acc.compras_inventario_sicar + r.compras_inventario_sicar);
    acc.compras_ajuste_olvidado = r2(acc.compras_ajuste_olvidado + r.compras_ajuste_olvidado);
    acc.compras_existencia_negativa = r2(acc.compras_existencia_negativa + r.compras_existencia_negativa);
    acc.compras_otras_sicar = r2(acc.compras_otras_sicar + r.compras_otras_sicar);
    if (r.compras_mayores_ventas) acc.periodos_compras_mayores_ventas += 1;
    if (r.sin_ventas_con_compras) acc.periodos_sin_ventas_con_compras += 1;
    if (!acc.peor_periodo || r.brecha < acc.peor_periodo.brecha) {
      acc.peor_periodo = { periodo: r.periodo, ventas: r.ventas, compras: r.compras, brecha: r.brecha };
    }
    return acc;
  }, {
    total_ventas: 0,
    total_compras: 0,
    compras_manual: 0,
    compras_inventario_sicar: 0,
    compras_ajuste_olvidado: 0,
    compras_existencia_negativa: 0,
    compras_otras_sicar: 0,
    periodos_compras_mayores_ventas: 0,
    periodos_sin_ventas_con_compras: 0,
    peor_periodo: null,
  });
  resumen.total_brecha = r2(resumen.total_ventas - resumen.total_compras);
  resumen.compras_pct_ventas = resumen.total_ventas > 0
    ? r2((resumen.total_compras / resumen.total_ventas) * 100)
    : null;
  resumen.periodos = periodos.length;

  return json(200, cors, {
    ok: true,
    filtros: { desde, hasta, agrupar },
    resumen,
    periodos,
  });
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
// GET action=plan_compras_semanal
// =============================================================================
async function planComprasSemanal(cors, q) {
  const hoy = hoyISO();
  const desde = fechaValida(q.desde) ? q.desde : `${hoy.slice(0, 4)}-01-01`;
  const hasta = fechaValida(q.hasta) ? q.hasta : hoy;
  const limite = Math.min(3000, Math.max(50, Number(q.limite) || 1500));

  if (desde > hasta) {
    return json(400, cors, { ok: false, error: 'desde no puede ser mayor que hasta' });
  }

  const semanasPeriodo = Math.max(1, Math.ceil(diasEntre(desde, hasta) / 7));
  const ds = bq.DATASET;
  const [rows, costos] = await Promise.all([
    queryDetalleArticulos(
    `WITH dedup AS (
       SELECT * EXCEPT(rn)
       FROM (
         SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY fecha, ticket_id, COALESCE(linea_key, CONCAT(IFNULL(clave, ''), '|', IFNULL(producto, ''), '|', CAST(precio AS STRING)))
                  ORDER BY ts DESC
                ) AS rn
           FROM \`${ds}.ventas_articulos\`
          WHERE fecha BETWEEN @desde AND @hasta
            AND ${ACTIVO}
            AND (producto IS NOT NULL OR clave IS NOT NULL)
       )
       WHERE rn = 1
     )
     SELECT COALESCE(NULLIF(TRIM(categoria), ''), NULLIF(TRIM(departamento), ''), 'Sin categoria') AS categoria,
            COALESCE(NULLIF(TRIM(producto), ''), NULLIF(TRIM(clave), ''), 'Sin nombre') AS producto,
            COALESCE(NULLIF(TRIM(clave), ''), '') AS clave,
            IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0) AS unidades_anio,
            IFNULL(SUM(CAST(importe AS FLOAT64)), 0) AS importe_anio,
            COUNT(DISTINCT FORMAT_DATE('%G-%V', fecha)) AS semanas_con_venta,
            COUNT(DISTINCT fecha) AS dias_con_venta,
            COUNT(DISTINCT ticket_id) AS tickets,
            ROUND(SAFE_DIVIDE(IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0), @semanas_periodo), 2) AS piezas_semana,
            ROUND(SAFE_DIVIDE(IFNULL(SUM(CAST(importe AS FLOAT64)), 0), NULLIF(IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0), 0)), 2) AS precio_promedio
       FROM dedup
      GROUP BY categoria, producto, clave
     HAVING IFNULL(SUM(CAST(cantidad AS FLOAT64)), 0) > 0
      ORDER BY categoria ASC, piezas_semana DESC, importe_anio DESC
      LIMIT @limite`,
      { desde, hasta, semanas_periodo: semanasPeriodo, limite },
    ),
    costosUnitariosPlanCompra(hasta),
  ]);

  if (rows === null) {
    return json(200, cors, {
      ok: true,
      detalle_disponible: false,
      filtros: { desde, hasta, limite },
      resumen: {
        total_productos: 0,
        productos_sugeridos: 0,
        categorias: 0,
        semanas_periodo: semanasPeriodo,
        piezas_semana_total: 0,
        compra_sugerida_total: 0,
        productos_colchon: 0,
        costo_estimado_semana: 0,
        productos_con_costo: 0,
        productos_sin_costo: 0,
      },
      categorias: [],
      productos: [],
    });
  }

  const productos = rows.map(r => {
    const categoria = categoriaPlanCompra(r.categoria, r.producto, r.clave);
    const precioPromedio = r2(r.precio_promedio);
    const piezasSemana = r2(r.piezas_semana);
    const baseCompra = piezasSemana >= 0.25 ? Math.ceil(piezasSemana) : 0;
    const colchon = precioPromedio > 0 && precioPromedio <= 100
      ? (piezasSemana >= 2 ? 2 : (piezasSemana >= 1 ? 1 : 0))
      : 0;
    const compraSugerida = baseCompra + colchon;
    const semanasConVenta = Number(r.semanas_con_venta || 0);
    const prioridad = (piezasSemana >= 5 || semanasConVenta >= Math.max(4, semanasPeriodo * 0.55))
      ? 'alta'
      : (piezasSemana >= 1 || semanasConVenta >= 2 ? 'media' : 'baja');
    const claveKey = clavePlanKey(r.clave);
    const productoKey = textoPlanKey(r.producto);
    const costo = costos.porClave.get(claveKey) || (!claveKey ? costos.porProducto.get(productoKey) : null);
    const costoUnitario = costo && costo.costo > 0 ? r2(costo.costo) : null;
    const costoSemana = costoUnitario !== null && compraSugerida > 0 ? r2(costoUnitario * compraSugerida) : null;
    const costoConfianza = costoUnitario === null
      ? 'sin_costo'
      : (costo.metodo === 'clave' && costo.origen === 'SICAR' ? 'alta' : (costo.metodo === 'clave' ? 'media' : 'baja'));
    return {
      categoria,
      producto: r.producto || 'Sin nombre',
      clave: r.clave || '',
      unidades_anio: r2(r.unidades_anio),
      importe_anio: r2(r.importe_anio),
      semanas_con_venta: semanasConVenta,
      dias_con_venta: Number(r.dias_con_venta || 0),
      tickets: Number(r.tickets || 0),
      piezas_semana: piezasSemana,
      precio_promedio: precioPromedio,
      compra_base_semana: baseCompra,
      colchon_piezas: colchon,
      compra_sugerida_semana: compraSugerida,
      costo_unitario: costoUnitario,
      costo_semana: costoSemana,
      costo_fecha: costo ? costo.fecha : null,
      costo_origen: costo ? costo.origen : '',
      costo_proveedor: costo ? costo.proveedor : '',
      costo_metodo: costo ? costo.metodo : '',
      costo_confianza: costoConfianza,
      prioridad,
    };
  });

  const porCategoria = new Map();
  const resumen = productos.reduce((acc, p) => {
    acc.total_productos += 1;
    if (p.compra_sugerida_semana > 0) acc.productos_sugeridos += 1;
    acc.piezas_semana_total = r2(acc.piezas_semana_total + p.piezas_semana);
    acc.compra_sugerida_total += p.compra_sugerida_semana;
    if (p.colchon_piezas > 0) acc.productos_colchon += 1;
    if (p.costo_semana !== null) {
      acc.costo_estimado_semana = r2(acc.costo_estimado_semana + p.costo_semana);
      if (p.compra_sugerida_semana > 0) acc.productos_con_costo += 1;
    } else if (p.compra_sugerida_semana > 0) {
      acc.productos_sin_costo += 1;
    }
    const cat = porCategoria.get(p.categoria) || {
      categoria: p.categoria,
      productos: 0,
      piezas_semana: 0,
      compra_sugerida_semana: 0,
      importe_anio: 0,
      costo_estimado_semana: 0,
      productos_sin_costo: 0,
    };
    cat.productos += 1;
    cat.piezas_semana = r2(cat.piezas_semana + p.piezas_semana);
    cat.compra_sugerida_semana += p.compra_sugerida_semana;
    cat.importe_anio = r2(cat.importe_anio + p.importe_anio);
    if (p.costo_semana !== null) cat.costo_estimado_semana = r2(cat.costo_estimado_semana + p.costo_semana);
    else if (p.compra_sugerida_semana > 0) cat.productos_sin_costo += 1;
    porCategoria.set(p.categoria, cat);
    return acc;
  }, {
    total_productos: 0,
    productos_sugeridos: 0,
    categorias: 0,
    semanas_periodo: semanasPeriodo,
    piezas_semana_total: 0,
    compra_sugerida_total: 0,
    productos_colchon: 0,
    costo_estimado_semana: 0,
    productos_con_costo: 0,
    productos_sin_costo: 0,
  });
  resumen.categorias = porCategoria.size;

  const categorias = Array.from(porCategoria.values())
    .sort((a, b) => b.compra_sugerida_semana - a.compra_sugerida_semana || a.categoria.localeCompare(b.categoria));

  return json(200, cors, {
    ok: true,
    detalle_disponible: true,
    filtros: { desde, hasta, limite },
    regla: {
      base: 'ceil(piezas vendidas por semana en el periodo)',
      colchon: '+2 maximo si precio promedio no excede 100 pesos: +2 desde 2 pzas/sem, +1 desde 1 pza/sem, 0 si rota menos',
    },
    resumen,
    categorias,
    productos,
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

function normalizarResumenAjuste(rows) {
  const periodos = rows.map(r => ({
    periodo: r.periodo,
    segmento: r.segmento,
    porcentaje: Number(r.porcentaje || 0),
    movimientos: Number(r.movimientos || 0),
    base_total: Number(r.base_total || 0),
    ajuste_total: Number(r.ajuste_total || 0),
    primera: r.primera || null,
    ultima: r.ultima || null,
  }));

  return {
    resumen: {
      movimientos: periodos.reduce((sum, r) => sum + r.movimientos, 0),
      base_total: r2(periodos.reduce((sum, r) => sum + r.base_total, 0)),
      ajuste_total: r2(periodos.reduce((sum, r) => sum + r.ajuste_total, 0)),
      primera: periodos.length ? periodos.map(r => r.primera).filter(Boolean).sort()[0] : null,
      ultima: periodos.length ? periodos.map(r => r.ultima).filter(Boolean).sort().slice(-1)[0] : null,
      filas_ajuste: periodos.length,
    },
    periodos,
  };
}

function sumarDiasISO(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function calcularAjusteInventarioOlvidado(desde, hasta) {
  const ds = bq.DATASET;
  const patron = `(^|[^a-z0-9áéíóúüñ])(${PATRON_VINOS_LICORES})([^a-z0-9áéíóúüñ]|$)`;
  const rows = await bq.query(
    `WITH base AS (
       SELECT
         fecha,
         FORMAT_DATE('%Y-%m', fecha) AS periodo,
         CAST(total AS FLOAT64) AS total,
         LOWER(CONCAT(IFNULL(categoria, ''), ' ', IFNULL(clasificacion, ''), ' ', IFNULL(conceptos, ''))) AS texto
       FROM \`${ds}.compras\`
       WHERE fecha BETWEEN @desde AND @hasta
         AND STARTS_WITH(IFNULL(raw_ocr, ''), 'sicar_inventory:')
         AND ${ACTIVO}
     ),
     clasificada AS (
       SELECT
         periodo,
         fecha,
         total,
         REGEXP_CONTAINS(texto, @patron) AS es_vinos_licores
       FROM base
       WHERE total > 0
     )
     SELECT
       periodo,
       IF(es_vinos_licores, 'vinos_licores', 'general') AS segmento,
       IF(es_vinos_licores, @pct_vinos_licores, @pct_general) AS porcentaje,
       COUNT(*) AS movimientos,
       ROUND(IFNULL(SUM(total), 0), 2) AS base_total,
       ROUND(IFNULL(SUM(total * IF(es_vinos_licores, @pct_vinos_licores, @pct_general)), 0), 2) AS ajuste_total,
       FORMAT_DATE('%Y-%m-%d', MIN(fecha)) AS primera,
       FORMAT_DATE('%Y-%m-%d', MAX(fecha)) AS ultima
     FROM clasificada
     GROUP BY periodo, segmento, porcentaje
     HAVING ajuste_total > 0
     ORDER BY periodo ASC, segmento ASC`,
    {
      desde,
      hasta,
      patron,
      pct_general: AJUSTE_INVENTARIO_GENERAL,
      pct_vinos_licores: AJUSTE_INVENTARIO_VINOS_LICORES,
    },
  );
  return normalizarResumenAjuste(rows);
}

// =============================================================================
// GET action=resumen_ajuste_inventario_olvidado
// =============================================================================
async function resumenAjusteInventarioOlvidado(cors, q) {
  const desde = q.desde;
  const hasta = q.hasta;
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const resultado = await calcularAjusteInventarioOlvidado(desde, hasta);
  return json(200, cors, { ok: true, ...resultado });
}

function repartirImporteDiario(total, dias) {
  const centavos = Math.round(r2(total) * 100);
  const base = Math.floor(centavos / dias);
  const remanente = centavos - (base * dias);
  return Array.from({ length: dias }, (_, i) => ((base + (i < remanente ? 1 : 0)) / 100));
}

function filaCompraAjusteInventario(r, fechaOverride, totalOverride, opts = {}) {
  const porcentaje = Number(r.porcentaje || 0);
  const pctTexto = `${Math.round(porcentaje * 100)}%`;
  const segmento = r.segmento === 'vinos_licores' ? 'vinos y licores' : 'general';
  const fecha = fechaOverride || r.ultima;
  const total = r2(totalOverride !== undefined ? totalOverride : r.ajuste_total);
  const subtotal = r2(total / 1.16);
  const iva = r2(total - subtotal);
  const baseTotal = r2(r.base_total);
  const esDiario = Boolean(opts.diario);
  const descripcion = esDiario
    ? `Ajuste diario prorrateado ${pctTexto} por compras olvidadas de inventario SICAR - ${segmento} (${fecha})`
    : `Ajuste mensual ${pctTexto} por compras olvidadas de inventario SICAR - ${segmento} (${r.periodo})`;
  const nota = esDiario
    ? `Base acumulada del mes en compras automaticas SICAR: $${baseTotal.toFixed(2)}. Porcentaje aplicado: ${pctTexto}. Prorrateo diario del mes en curso.`
    : `Base de compras automaticas SICAR: $${baseTotal.toFixed(2)}. Porcentaje aplicado: ${pctTexto}.`;
  const rawOcr = esDiario
    ? `${AJUSTE_INVENTARIO_OLVIDADO_PREFIX}${r.periodo}:${r.segmento}:${fecha}`
    : `${AJUSTE_INVENTARIO_OLVIDADO_PREFIX}${r.periodo}:${r.segmento}`;

  return {
    id: crypto.randomUUID(),
    fecha,
    hora: '23:59:00',
    proveedor: 'Ajuste inventario SICAR',
    subtotal,
    iva,
    ieps: 0,
    total,
    impuestos_estimados: true,
    categoria: r.segmento === 'vinos_licores'
      ? 'inventario_olvidado_vinos_licores'
      : 'inventario_olvidado_general',
    clasificacion: 'reventa',
    conceptos: JSON.stringify([{
      descripcion,
      importe: total,
      uso: 'reventa',
      ingrediente: null,
      cantidad: null,
      costo_unitario: null,
      nota,
    }]),
    raw_ocr: rawOcr,
    activo: true,
  };
}

function filasCompraAjusteInventario(r, hasta) {
  const periodoHasta = String(hasta || '').slice(0, 7);
  const periodoActual = hoyISO().slice(0, 7);
  if (r.periodo !== periodoHasta || r.periodo !== periodoActual) {
    return [filaCompraAjusteInventario(r)];
  }

  const inicio = inicioMesISO(hasta);
  const dias = diasEntre(inicio, hasta);
  const importes = repartirImporteDiario(r.ajuste_total, dias);
  return importes.map((importe, idx) => filaCompraAjusteInventario(
    r,
    sumarDiasISO(inicio, idx),
    importe,
    { diario: true },
  ));
}

// =============================================================================
// POST action=generar_ajuste_inventario_olvidado
// =============================================================================
async function generarAjusteInventarioOlvidado(cors, body) {
  const desde = body.desde;
  const hasta = body.hasta;
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    return json(400, cors, { ok: false, error: 'desde/hasta deben ser fechas YYYY-MM-DD' });
  }

  const resultado = await calcularAjusteInventarioOlvidado(desde, hasta);
  const filas = resultado.periodos.flatMap(r => filasCompraAjusteInventario(r, hasta));
  const ds = bq.DATASET;
  const params = { desde, hasta, prefix: AJUSTE_INVENTARIO_OLVIDADO_PREFIX };
  const prevRows = await bq.query(
    `SELECT COUNT(*) AS total
       FROM \`${ds}.compras\`
      WHERE fecha BETWEEN @desde AND @hasta
        AND STARTS_WITH(IFNULL(raw_ocr, ''), @prefix)
        AND ${ACTIVO}`,
    params,
  );
  const reemplazados = Number(prevRows[0]?.total || 0);
  if (reemplazados > 0) {
    await bq.query(
      `UPDATE \`${ds}.compras\`
          SET activo = FALSE
        WHERE fecha BETWEEN @desde AND @hasta
          AND STARTS_WITH(IFNULL(raw_ocr, ''), @prefix)
          AND ${ACTIVO}`,
      params,
    );
  }

  if (filas.length) {
    await bq.insertRows('compras', filas);
  }

  return json(200, cors, {
    ok: true,
    insertados: filas.length,
    reemplazados,
    ...resultado,
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
