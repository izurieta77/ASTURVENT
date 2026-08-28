// Same-origin write proxy for AppSGM.
//
// The browser must receive the real Apps Script JSON response instead of
// relying on an opaque no-cors request or a public Sheets API lookup.

const MAX_BODY_CHARS = 850 * 1024;
const UPSTREAM_TIMEOUT_MS = 55000;

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowedOrigin = getAllowedOrigin_(origin);
  const cors = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json_(405, cors, { ok: false, error: 'Method not allowed' });
  if ((event.body || '').length > MAX_BODY_CHARS) {
    return json_(413, cors, { ok: false, error: 'Payload demasiado grande' });
  }

  let request;
  try {
    request = JSON.parse(event.body || '{}');
  } catch {
    return json_(400, cors, { ok: false, error: 'JSON invalido' });
  }

  const endpoint = String(process.env.SGM_APPS_SCRIPT_URL || request.endpoint || '').trim();
  const validation = validateAppsScriptUrl_(endpoint);
  if (!validation.ok) return json_(400, cors, { ok: false, error: validation.error });

  const payload = request.payload || {
    action: request.action,
    sheet: request.sheet,
    row: request.row,
  };
  if (!payload || !payload.action) {
    return json_(400, cors, { ok: false, error: 'Falta payload.action' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text || '{}');
    } catch {
      return json_(502, cors, {
        ok: false,
        error: 'Apps Script no devolvio JSON valido',
        upstreamStatus: upstream.status,
      });
    }

    if (!upstream.ok) {
      return json_(upstream.status || 502, cors, {
        ok: false,
        error: data.error || `Apps Script HTTP ${upstream.status}`,
        upstream: data,
      });
    }

    const confirmed = data.ok === true;
    return json_(confirmed ? 200 : 502, cors, {
      ok: confirmed,
      confirmed,
      id: data.id || data.rid || payload.row?.ID_REGISTRO || payload.row?.id || '',
      prefix: data.prefix || payload.row?.PREFIX || payload.row?.prefix || '',
      upstream: data,
      error: confirmed ? undefined : (data.error || 'Apps Script no confirmo la escritura'),
    });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Timeout esperando respuesta de Apps Script'
      : String(error?.message || error);
    return json_(502, cors, { ok: false, error: message });
  } finally {
    clearTimeout(timer);
  }
};

function getAllowedOrigin_(origin) {
  const value = String(origin || '');
  if (/^https:\/\/(?:[a-z0-9-]+--)?appsgm\.netlify\.app$/i.test(value)) return value;
  if (/^http:\/\/localhost:(?:3000|8888)$/.test(value)) return value;
  return 'https://appsgm.netlify.app';
}

function validateAppsScriptUrl_(value) {
  if (!value) return { ok: false, error: 'Endpoint de Apps Script no configurado' };
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === 'script.google.com';
    const allowedPath = /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
    if (!allowedHost || !allowedPath) {
      return { ok: false, error: 'Endpoint de Apps Script no permitido' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Endpoint de Apps Script invalido' };
  }
}

function json_(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}
