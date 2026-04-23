// Proxy serverless para llamadas de IA — SGM Mobil Metepec
//
// Mueve la API key de OpenAI del navegador al servidor. El frontend NUNCA
// ve la clave; solo hace POST a /.netlify/functions/ia con { system, messages }.
//
// Modelo: gpt-4o-mini (más barato + suficiente para analítica de flotilla).
// Configurar en Netlify: Site settings → Environment variables → OPENAI_API_KEY.

const MODEL       = 'gpt-4o-mini';
const MAX_TOKENS  = 800;              // techo por turno para controlar costo
const MAX_CONTEXT = 16000;            // chars de contexto; trunca si viene más
const ALLOWED_ORIGINS = [
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
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: JSON.stringify({ ok:false, error:'Method not allowed' }) };

  const key = process.env.OPENAI_API_KEY;
  if (!key) return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:'OPENAI_API_KEY no configurada en Netlify' }) };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'JSON inválido' }) }; }

  const systemRaw = String(payload.system || '');
  const system    = systemRaw.length > MAX_CONTEXT ? systemRaw.slice(0, MAX_CONTEXT) + '\n...[truncado]' : systemRaw;

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'Falta messages' }) };

  const openaiMessages = [
    { role: 'system', content: system || 'Eres un asistente útil.' },
    ...messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 8000),
    })),
  ];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       MODEL,
        messages:    openaiMessages,
        temperature: 0.4,
        max_tokens:  Math.min(Number(payload.max_tokens) || MAX_TOKENS, MAX_TOKENS),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, headers: cors, body: JSON.stringify({ ok:false, error: data.error?.message || `OpenAI HTTP ${res.status}` }) };
    }

    const text  = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        content: [{ text }],     // shape compatible con el parser actual del frontend
        usage,
        model: data.model || MODEL,
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ ok:false, error: 'Upstream error: ' + (e.message || e) }) };
  }
};
