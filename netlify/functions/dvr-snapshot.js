// Agente IA de monitoreo de tienda — captura snapshot por cada cámara configurada,
// la pasa por gpt-4o-mini vision y persiste la observación en Apps Script.
//
// Diseñado para correr en horario operativo (7am-11pm CDMX) cada ~7 min. La
// programación se controla desde netlify.toml ([functions."dvr-snapshot"].schedule).
//
// Env vars requeridas:
//   DVR_HOST           — DDNS o IP pública del DVR Hikvision (ej. tienda.no-ip.org)
//   DVR_PORT           — puerto HTTP del DVR (default 80)
//   DVR_USER, DVR_PASS — credenciales ISAPI
//   DVR_CHANNELS       — JSON: [{"ch":1,"label":"Entrada"},{"ch":2,"label":"Piso"},...]
//   OPENAI_API_KEY     — ya configurada para ia.js
//   APPS_SCRIPT_URL    — Web App de Apps Script con actions DVR
//   APPS_SCRIPT_TOKEN  — token largo para autenticar el log de observaciones
//
// Disparo manual (debug):
//   curl https://<site>.netlify.app/.netlify/functions/dvr-snapshot

const crypto = require('crypto');

const OPENAI_MODEL = 'gpt-4o-mini';
const SNAPSHOT_TIMEOUT_MS = 8000;
const OPENAI_TIMEOUT_MS   = 20000;

const SYSTEM_PROMPT = `Eres un agente de monitoreo de una tienda de conveniencia mexicana en una gasolinera Mobil. Analizas un frame de cámara CCTV y respondes SOLO con JSON válido, sin texto extra, con esta forma exacta:
{
  "personas_detectadas": number,
  "empleados_visibles": number,
  "clientes_visibles": number,
  "actividad": "barriendo"|"trapeando"|"limpiando_polvo"|"atendiendo"|"reponiendo"|"inactivo"|"cerrado"|"desconocido",
  "luces_encendidas": boolean,
  "cortina_abierta": boolean,
  "observacion_breve": "string <120 chars"
}
Criterios: empleado = uniforme/playera del personal; cliente = ropa de calle. Si no estás seguro de la actividad, usa "desconocido". Si la imagen es de noche y no hay personas ni luces, "cerrado". No inventes detalles.`;

exports.handler = async (event) => {
  const started = Date.now();
  const isManual = event.httpMethod === 'GET' || event.httpMethod === 'POST';

  let channels;
  try { channels = JSON.parse(process.env.DVR_CHANNELS || '[]'); }
  catch { return j_(500, { ok:false, error:'DVR_CHANNELS no es JSON válido' }); }
  if (!Array.isArray(channels) || channels.length === 0) {
    return j_(500, { ok:false, error:'DVR_CHANNELS vacío o no es array' });
  }

  const host = process.env.DVR_HOST;
  const port = process.env.DVR_PORT || '80';
  const user = process.env.DVR_USER;
  const pass = process.env.DVR_PASS;
  if (!host || !user || !pass) return j_(500, { ok:false, error:'DVR_HOST/DVR_USER/DVR_PASS no configuradas' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return j_(500, { ok:false, error:'OPENAI_API_KEY no configurada' });

  const appsUrl  = process.env.APPS_SCRIPT_URL;
  const appsTok  = process.env.APPS_SCRIPT_TOKEN || '';
  if (!appsUrl) return j_(500, { ok:false, error:'APPS_SCRIPT_URL no configurada' });

  const timestamp = new Date().toISOString();
  const results = [];

  for (const cam of channels) {
    const ch    = Number(cam.ch);
    const label = String(cam.label || `CH${ch}`);
    const out   = { ch, label, ok:false };
    try {
      const jpg = await fetchSnapshotDigest_(host, port, user, pass, ch);
      const b64 = jpg.toString('base64');
      const analysis = await analyzeWithVision_(openaiKey, b64);
      out.analysis = analysis;
      // Persistir (no bloquea el resto si falla una cámara)
      await postToAppsScript_(appsUrl, appsTok, {
        action: 'logDVRObservation',
        timestamp,
        camera_ch: ch,
        camera_label: label,
        analysis,
      });
      out.ok = true;
    } catch (e) {
      out.error = String(e.message || e).slice(0, 240);
    }
    results.push(out);
  }

  const took_ms = Date.now() - started;
  return j_(200, { ok:true, timestamp, took_ms, manual:isManual, results });
};

// ────────────────────────────────────────────────────────────────────────────
// Hikvision ISAPI snapshot con HTTP Digest Auth (sin dependencias externas)
// ────────────────────────────────────────────────────────────────────────────
function fetchSnapshotDigest_(host, port, user, pass, ch) {
  const path = `/ISAPI/Streaming/channels/${ch}01/picture`;
  const url  = `http://${host}:${port}${path}`;
  return new Promise(async (resolve, reject) => {
    try {
      // Primer intento sin auth — esperamos 401 con challenge Digest
      const r1 = await fetchBuf_(url, {}, SNAPSHOT_TIMEOUT_MS);
      if (r1.status === 200) return resolve(r1.body);
      if (r1.status !== 401) return reject(new Error(`DVR HTTP ${r1.status} en challenge`));

      const wa = r1.headers['www-authenticate'] || r1.headers['WWW-Authenticate'] || '';
      const challenge = parseDigestChallenge_(wa);
      if (!challenge) return reject(new Error('DVR no devolvió challenge Digest válido'));

      const authHeader = buildDigestHeader_({ user, pass, method:'GET', uri:path, challenge });
      const r2 = await fetchBuf_(url, { headers:{ Authorization: authHeader } }, SNAPSHOT_TIMEOUT_MS);
      if (r2.status !== 200) return reject(new Error(`DVR HTTP ${r2.status} tras auth`));
      const ct = (r2.headers['content-type'] || '').toLowerCase();
      if (!ct.includes('image/')) return reject(new Error(`Respuesta no es imagen (content-type: ${ct})`));
      resolve(r2.body);
    } catch (e) { reject(e); }
  });
}

function fetchBuf_(url, opts, timeoutMs) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      method:   opts.method || 'GET',
      hostname: u.hostname,
      port:     u.port || 80,
      path:     u.pathname + u.search,
      headers:  opts.headers || {},
      timeout:  timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

function parseDigestChallenge_(headerValue) {
  if (!headerValue || !headerValue.toLowerCase().startsWith('digest ')) return null;
  const out = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
  let m;
  while ((m = re.exec(headerValue.slice(7))) !== null) {
    out[m[1].toLowerCase()] = (m[2] !== undefined ? m[2] : m[3]).trim();
  }
  if (!out.realm || !out.nonce) return null;
  return out;
}

function buildDigestHeader_({ user, pass, method, uri, challenge }) {
  const realm  = challenge.realm;
  const nonce  = challenge.nonce;
  const qop    = (challenge.qop || '').split(',')[0].trim() || 'auth';
  const algo   = (challenge.algorithm || 'MD5').toUpperCase();
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc     = '00000001';
  const md5 = s => crypto.createHash('md5').update(s).digest('hex');
  const HA1 = md5(`${user}:${realm}:${pass}`);
  const HA2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${HA1}:${nonce}:${nc}:${cnonce}:${qop}:${HA2}`)
    : md5(`${HA1}:${nonce}:${HA2}`);
  const parts = [
    `username="${user}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algo}`,
    `response="${response}"`,
    qop ? `qop=${qop}` : null,
    qop ? `nc=${nc}` : null,
    qop ? `cnonce="${cnonce}"` : null,
    challenge.opaque ? `opaque="${challenge.opaque}"` : null,
  ].filter(Boolean);
  return 'Digest ' + parts.join(', ');
}

// ────────────────────────────────────────────────────────────────────────────
// gpt-4o-mini vision con detail=low (≈2833 tokens entrada)
// ────────────────────────────────────────────────────────────────────────────
async function analyzeWithVision_(apiKey, base64Jpeg) {
  const ctl = new AbortController();
  const to  = setTimeout(() => ctl.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      signal: ctl.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Analiza este frame y devuelve solo el JSON pedido.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Jpeg}`, detail: 'low' } },
          ] },
        ],
        temperature: 0.1,
        max_tokens: 250,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
    const raw  = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { _parse_error:true, _raw:raw.slice(0,200) }; }
    return { parsed, usage: data.usage || {} };
  } finally {
    clearTimeout(to);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Apps Script (Web App) — append observation
// ────────────────────────────────────────────────────────────────────────────
async function postToAppsScript_(url, token, body) {
  const ctl = new AbortController();
  const to  = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({ ...body, _token: token }),
    });
    // Apps Script suele responder 200 incluso con error en el body; no fallamos duro
    if (!res.ok) throw new Error(`AppsScript HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

function j_(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
