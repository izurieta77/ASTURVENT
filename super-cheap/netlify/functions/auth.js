// Login del dashboard SUPER CHEAP (independiente del login de la gasolinera).
//
// El frontend hace POST con { pin }. Si el PIN coincide con SC_PIN, se devuelve
// un token de sesion firmado con HMAC que luego viaja en `Authorization: Bearer`
// hacia sc-data y sc-ticket.
//
// Env vars requeridas:
//   SC_PIN       — PIN del dashboard (ej. "1234").
//   AUTH_SECRET  — secreto aleatorio >=16 chars para firmar el token.

const { corsHeaders, json, signToken, safeEqual, TOKEN_TTL_MS } = require('./_lib');

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  // Preflight CORS.
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, cors, { ok: false, error: 'Method not allowed' });

  const secret = process.env.AUTH_SECRET;
  const scPin  = process.env.SC_PIN;
  if (!secret || secret.length < 16) return json(500, cors, { ok: false, error: 'AUTH_SECRET no configurada en Netlify' });
  if (!scPin)                        return json(500, cors, { ok: false, error: 'SC_PIN no configurada en Netlify' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

  const pin = String(payload.pin || '').trim();

  // Comparacion en tiempo constante para no filtrar info por timing.
  if (!safeEqual(pin, String(scPin))) {
    return json(401, cors, { ok: false, error: 'PIN incorrecto' });
  }

  const session = { tipo: 'sc', exp: Date.now() + TOKEN_TTL_MS };
  const token   = signToken(session, secret);

  return json(200, cors, { ok: true, token, session });
};
