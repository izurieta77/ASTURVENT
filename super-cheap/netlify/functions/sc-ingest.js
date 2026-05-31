// Endpoint de ingestion de ventas desde el bridge local de SICAR.
//
// Lo llama sicar-bridge (no el navegador), por eso NO usa Bearer token sino un
// token compartido en el header X-Ingest-Token == SICAR_INGEST_TOKEN.
//
//   POST  { ventas:[ { fecha, ticket_id, total, forma_pago, items } ] }
//
// Idempotente por ticket_id: antes de insertar consulta cuales ticket_id ya
// existen en la tabla `ventas` y solo inserta los nuevos. Asi reenviar el mismo
// lote no duplica filas.

const { corsHeaders, json, safeEqual } = require('./_lib');
const ventasIngest = require('./_ventas_ingest');

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, cors, { ok: false, error: 'Method not allowed' });

  // --- Auth por token compartido ---
  const expected = process.env.SICAR_INGEST_TOKEN;
  if (!expected) return json(500, cors, { ok: false, error: 'SICAR_INGEST_TOKEN no configurada en Netlify' });

  const token = event.headers?.['x-ingest-token'] || event.headers?.['X-Ingest-Token'] || '';
  if (!safeEqual(token, expected)) {
    return json(401, cors, { ok: false, error: 'Token de ingestion invalido' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

  const ventas = Array.isArray(body.ventas) ? body.ventas : null;
  if (!ventas) return json(400, cors, { ok: false, error: 'Falta ventas (arreglo)' });

  try {
    const resultado = await ventasIngest.insertarVentas(ventas, { fuente: 'sicar' });
    return json(200, cors, resultado);
  } catch (e) {
    return json(502, cors, { ok: false, error: 'Error de datos: ' + (e.message || String(e)) });
  }
};
