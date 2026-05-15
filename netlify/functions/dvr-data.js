// Endpoint autenticado para el panel admin "Monitoreo Tienda".
//
// Proxy de lectura hacia Apps Script — el frontend nunca ve APPS_SCRIPT_URL/TOKEN.
// Requiere token de sesión admin firmado por auth.js (HMAC con AUTH_SECRET).
//
// Acciones soportadas (POST body { action, ...params }):
//   - cameras                  → lista de cámaras configuradas (sin credenciales)
//   - latestObservations       → últimas N observaciones (por defecto 20)
//   - dailyReport              → reporte agregado de una fecha
//   - listReports              → lista de fechas con reporte disponible
//   - triggerSnapshot          → dispara dvr-snapshot manualmente (debug)

const crypto = require('crypto');

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return j_(405, cors, { ok:false, error:'Method not allowed' });

  // Verificar token admin
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) return j_(500, cors, { ok:false, error:'AUTH_SECRET no configurada' });

  const authH = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authH.startsWith('Bearer ') ? authH.slice(7) : '';
  const session = verifyToken_(token, secret);
  if (!session)             return j_(401, cors, { ok:false, error:'Token inválido o expirado' });
  if (session.tipo !== 'admin') return j_(403, cors, { ok:false, error:'Solo admin' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return j_(400, cors, { ok:false, error:'JSON inválido' }); }

  const action = String(payload.action || '');
  const appsUrl = process.env.APPS_SCRIPT_URL;
  const appsTok = process.env.APPS_SCRIPT_TOKEN || '';
  if (!appsUrl) return j_(500, cors, { ok:false, error:'APPS_SCRIPT_URL no configurada' });

  try {
    if (action === 'cameras') {
      let channels = [];
      try { channels = JSON.parse(process.env.DVR_CHANNELS || '[]'); } catch {}
      return j_(200, cors, { ok:true, cameras: channels.map(c => ({ ch:Number(c.ch), label:String(c.label || `CH${c.ch}`) })) });
    }

    if (action === 'latestObservations') {
      const limit = Math.min(Number(payload.limit) || 20, 200);
      const data = await appsFetch_(appsUrl, appsTok, { action:'getDVRLatestObservations', limit });
      return j_(200, cors, { ok:true, data });
    }

    if (action === 'dailyReport') {
      const fecha = String(payload.fecha || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return j_(400, cors, { ok:false, error:'fecha YYYY-MM-DD requerida' });
      const data = await appsFetch_(appsUrl, appsTok, { action:'getDVRDailyReport', fecha });
      return j_(200, cors, { ok:true, data });
    }

    if (action === 'listReports') {
      const limit = Math.min(Number(payload.limit) || 30, 90);
      const data = await appsFetch_(appsUrl, appsTok, { action:'listDVRDailyReports', limit });
      return j_(200, cors, { ok:true, data });
    }

    if (action === 'triggerSnapshot') {
      // Llama internamente al endpoint dvr-snapshot vía URL pública del site
      const base = `https://${event.headers.host}`;
      const res  = await fetch(`${base}/.netlify/functions/dvr-snapshot`);
      const data = await res.json().catch(() => ({}));
      return j_(res.status, cors, data);
    }

    return j_(400, cors, { ok:false, error:`action desconocida: ${action}` });
  } catch (e) {
    return j_(502, cors, { ok:false, error: String(e.message || e).slice(0, 240) });
  }
};

async function appsFetch_(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, _token: token }),
  });
  if (!res.ok) throw new Error(`AppsScript HTTP ${res.status}`);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

// Verifica el formato b64.hmac de auth.js:103-107
function verifyToken_(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const b64  = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try { if (!crypto.timingSafeEqual(a, b)) return null; } catch { return null; }
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload.exp || Date.now() > Number(payload.exp)) return null;
  return payload;
}

function j_(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}
