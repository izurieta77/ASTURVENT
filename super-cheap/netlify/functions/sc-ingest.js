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
const bq = require('./_bq');

function fechaValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

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

  const recibidos = ventas.length;
  if (recibidos === 0) return json(200, cors, { ok: true, recibidos: 0, insertados: 0 });

  try {
    // Normaliza y filtra ventas validas (deben traer ticket_id y fecha valida).
    const limpias = [];
    const idsRecibidos = [];
    for (const v of ventas) {
      const ticket_id = v && v.ticket_id != null ? String(v.ticket_id) : '';
      if (!ticket_id || !fechaValida(v.fecha)) continue;
      idsRecibidos.push(ticket_id);
      limpias.push({
        fecha:      v.fecha,
        ticket_id,
        total:      v.total != null ? Number(v.total) : 0,
        forma_pago: v.forma_pago != null ? String(v.forma_pago) : null,
        items:      v.items != null ? Number(v.items) : null,
      });
    }

    if (limpias.length === 0) {
      return json(200, cors, { ok: true, recibidos, insertados: 0 });
    }

    const ds = bq.DATASET;

    // Consulta que ticket_id ya existen, para no duplicar (idempotencia).
    const existentesRows = await bq.query(
      `SELECT ticket_id
         FROM \`${ds}.ventas\`
        WHERE ticket_id IN UNNEST(@ids)`,
      { ids: idsRecibidos });

    const yaExisten = new Set(existentesRows.map(r => String(r.ticket_id)));

    // Deduplica tambien dentro del mismo lote (mismo ticket_id repetido).
    const vistos = new Set();
    const nuevas = [];
    for (const fila of limpias) {
      if (yaExisten.has(fila.ticket_id) || vistos.has(fila.ticket_id)) continue;
      vistos.add(fila.ticket_id);
      nuevas.push({ ...fila, fuente: 'sicar', ts: new Date().toISOString() });
    }

    if (nuevas.length > 0) {
      await bq.insertRows('ventas', nuevas);
    }

    return json(200, cors, { ok: true, recibidos, insertados: nuevas.length });
  } catch (e) {
    return json(502, cors, { ok: false, error: 'Error de datos: ' + (e.message || String(e)) });
  }
};
