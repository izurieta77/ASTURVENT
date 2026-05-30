// Asistente de direccion para SUPER CHEAP — sc-chat (v2).
//
// El frontend manda { pregunta } + Bearer token. El backend arma un contexto
// ACOTADO desde BigQuery (KPIs mes actual y anterior, serie de ventas reciente,
// top proveedores, top categorias de gasto, alertas) y lo pasa, junto con la
// pregunta, a OpenAI (mismo estilo que ia.js de la gasolinera).
//
// IMPORTANTE: el modelo NO ejecuta SQL. Solo redacta respuestas a partir del
// contexto que ya calculo el backend con consultas fijas y parametrizadas.
//
//   POST { pregunta:String }  + Authorization: Bearer <token>
//   -> { ok:true, respuesta:String }

const { corsHeaders, json, verifyToken, bearer } = require('./_lib');
const data = require('./sc-data');

const MODEL      = 'gpt-4o-mini';   // suficiente para Q&A sobre el contexto
const MAX_TOKENS = 700;

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, cors, { ok: false, error: 'Method not allowed' });

  // --- Autenticacion ---
  const secret = process.env.AUTH_SECRET;
  if (!secret) return json(500, cors, { ok: false, error: 'AUTH_SECRET no configurada en Netlify' });
  const session = verifyToken(bearer(event), secret);
  if (!session) return json(401, cors, { ok: false, error: 'No autorizado' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, cors, { ok: false, error: 'OPENAI_API_KEY no configurada en Netlify' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

  const pregunta = String(body.pregunta || '').trim();
  if (!pregunta) return json(400, cors, { ok: false, error: 'Falta pregunta' });

  try {
    // --- Arma contexto acotado desde BigQuery (consultas fijas) ---
    const hoy = data.hoyISO();
    const inicioMesAct = `${hoy.slice(0, 7)}-01`;

    // Mes anterior (rango natural completo).
    const finMesAnt = data.restarDiasISO(inicioMesAct, 1);
    const inicioMesAnt = `${finMesAnt.slice(0, 7)}-01`;

    // Serie de ventas reciente: ultimos 30 dias.
    const desdeSerie = data.restarDiasISO(hoy, 29);

    const [kpisAct, kpisAnt, serie, tProv, tCat, alertas] = await Promise.all([
      data.kpisRango(inicioMesAct, hoy),
      data.kpisRango(inicioMesAnt, finMesAnt),
      data.serieVentas(desdeSerie, hoy),
      data.topProveedores(inicioMesAct, hoy, 5),
      data.topCategoriasGasto(inicioMesAct, hoy, 5),
      data.calcularAlertas(),
    ]);

    const contexto = {
      fecha_hoy: hoy,
      kpis_mes_actual: kpisAct,
      kpis_mes_anterior: kpisAnt,
      serie_ventas_30d: serie,
      top_proveedores_mes: tProv,
      top_categorias_gasto_mes: tCat,
      alertas,
    };

    const system =
      'Eres el asistente de direccion de SUPER CHEAP, una tienda de conveniencia ' +
      'en Mexico. Respondes en espanol, claro y conciso, orientado a un dueno no ' +
      'tecnico. Usa SOLO los datos del contexto JSON que se te da; no inventes ' +
      'cifras ni supongas datos que no esten ahi. Si la pregunta no se puede ' +
      'responder con el contexto, dilo y sugiere que rango/dato consultar. Los ' +
      'montos estan en pesos mexicanos (MXN).\n\n' +
      'CONTEXTO (datos reales de BigQuery):\n' +
      JSON.stringify(contexto);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: pregunta.slice(0, 2000) },
        ],
      }),
    });

    const oa = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(502, cors, { ok: false, error: oa.error?.message || `OpenAI HTTP ${res.status}` });
    }

    const respuesta = oa.choices?.[0]?.message?.content || '';
    return json(200, cors, { ok: true, respuesta });
  } catch (e) {
    return json(502, cors, { ok: false, error: 'Error de datos: ' + (e.message || String(e)) });
  }
};
