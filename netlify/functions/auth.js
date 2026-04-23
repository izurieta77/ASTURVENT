// Login server-side para SGM Mobil Metepec.
//
// Mueve PINs, PINs de agentes y claves de cliente del HTML público a env vars
// de Netlify. El frontend pierde acceso a las credenciales; solo envía el
// intento de login y recibe un token de sesión firmado.
//
// Env vars requeridas (en Netlify → Site config → Environment variables,
// marcadas como "Contains secret values" + Production/Deploy previews/Branch
// deploys):
//   ADMIN_PIN       — string, ej "071288"
//   AGENT_PINS      — JSON, ej {"RIGO":"101","RAFAEL":"102",...}
//   CLIENT_CODES    — JSON, ej {"TGIO":"TGIO2026","TALF":"TALF2026",...}
//   AUTH_SECRET     — string aleatorio ≥32 chars, para firmar los tokens
//
// Respuesta en éxito:
//   { ok:true, session:{tipo,nombre?,prefijo?,isla?,exp}, token:"<b64>.<hmac>" }

const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ALLOWED_ORIGINS = [
  'https://appsgm.netlify.app',
  'https://jade-semolina-ece7ce.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000',
];

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json_(405, cors, { ok:false, error:'Method not allowed' });

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) return json_(500, cors, { ok:false, error:'AUTH_SECRET no configurada en Netlify' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json_(400, cors, { ok:false, error:'JSON inválido' }); }

  const tipo    = String(payload.tipo || '').toLowerCase();
  const nombre  = String(payload.nombre  || '').trim().toUpperCase();
  const prefijo = String(payload.prefijo || '').trim().toUpperCase();
  const isla    = String(payload.isla    || '1').trim();
  const pin     = String(payload.pin     || '').trim();
  const clave   = String(payload.clave   || '').trim().toUpperCase();

  let session = null;

  if (tipo === 'admin') {
    const expected = process.env.ADMIN_PIN || '';
    if (!expected) return json_(500, cors, { ok:false, error:'ADMIN_PIN no configurada' });
    if (!safeEqual_(pin, expected)) return json_(401, cors, { ok:false, error:'PIN incorrecto' });
    session = { tipo: 'admin' };

  } else if (tipo === 'agente') {
    if (!nombre) return json_(400, cors, { ok:false, error:'Falta nombre de agente' });
    let agents = {};
    try { agents = JSON.parse(process.env.AGENT_PINS || '{}'); } catch {}
    const expected = agents[nombre];
    if (!expected) return json_(401, cors, { ok:false, error:'Agente no registrado' });
    if (!safeEqual_(pin, String(expected))) return json_(401, cors, { ok:false, error:'PIN incorrecto' });
    const validIsla = ['1','2','3','4'].includes(isla);
    session = { tipo: 'agente', nombre, isla: validIsla ? isla : '1' };

  } else if (tipo === 'cliente') {
    if (!prefijo) return json_(400, cors, { ok:false, error:'Falta prefijo de cliente' });
    let codes = {};
    try { codes = JSON.parse(process.env.CLIENT_CODES || '{}'); } catch {}
    const expected = codes[prefijo];
    if (!expected) return json_(401, cors, { ok:false, error:'Cliente no registrado' });
    if (!safeEqual_(clave, String(expected).toUpperCase())) return json_(401, cors, { ok:false, error:'Clave incorrecta' });
    session = { tipo: 'cliente', prefijo };

  } else {
    return json_(400, cors, { ok:false, error:'tipo inválido (admin|agente|cliente)' });
  }

  const exp = Date.now() + TOKEN_TTL_MS;
  const tokenPayload = { ...session, exp };
  const token = signToken_(tokenPayload, secret);

  return json_(200, cors, { ok:true, session: tokenPayload, token });
};

function json_(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function safeEqual_(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  try { return crypto.timingSafeEqual(aBuf, bBuf); } catch { return false; }
}

function signToken_(payload, secret) {
  const b64  = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}
