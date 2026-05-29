// Utilidades compartidas por las funciones de SUPER CHEAP:
//  - CORS
//  - firma/verificacion de tokens de sesion (HMAC, mismo patron que la gasolinera)
//  - helpers de respuesta JSON

const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Dominios permitidos (origenes que pueden llamar a las funciones desde el navegador).
// Cualquier subdominio *.netlify.app ya esta permitido por la regex de mas abajo,
// asi que para el sitio en Netlify NO hace falta tocar nada. Solo agrega aqui el
// DOMINIO FINAL/PERSONALIZADO cuando lo conectes (ej. 'https://panel.supercheap.mx').
const ALLOWED_ORIGINS = [
  'http://localhost:8888',
  'http://localhost:3000',
  // 'https://TU-DOMINIO-PERSONALIZADO.com',  // <- descomenta y ajusta al conectar el dominio final
];

function corsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  // Permite cualquier subdominio *.netlify.app (incluido el preview deploy con guiones)
  // ademas de la lista explicita de arriba.
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
  return {
    'Access-Control-Allow-Origin':  ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };
}

function json(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function signToken(payload, secret) {
  const b64  = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}

// Verifica un token "<b64>.<hmac>". Devuelve el payload si es valido y no expiro,
// o null en cualquier otro caso.
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const [b64, hmac] = token.split('.');
  if (!b64 || !hmac) return null;
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Extrae el token del header Authorization: Bearer <token>.
function bearer(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : '';
}

// Comparacion en tiempo constante de cadenas.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  try { return crypto.timingSafeEqual(aBuf, bBuf); } catch { return false; }
}

module.exports = {
  TOKEN_TTL_MS,
  ALLOWED_ORIGINS,
  corsHeaders,
  json,
  signToken,
  verifyToken,
  bearer,
  safeEqual,
};
