// Resumen diario automatico para SUPER CHEAP — sc-resumen-diario (v2).
//
// Es una Netlify Scheduled Function: corre todos los dias a las 14:00 UTC
// (~08:00/09:00 hora del centro de Mexico). Calcula el resumen del DIA ANTERIOR
// + las alertas operativas, lo redacta con OpenAI en lenguaje claro y lo envia
// por correo via Resend.
//
// No requiere Bearer: lo dispara el scheduler de Netlify (no el navegador).
//
// Env vars: OPENAI_API_KEY (opcional; si falta se manda un resumen sin redactar),
//   RESEND_API_KEY, MAIL_TO, MAIL_FROM. Si falta RESEND_API_KEY, hace log y
//   termina OK sin enviar.

const data = require('./sc-data');

const MODEL      = 'gpt-4o-mini';
const MAX_TOKENS = 600;

// Formatea un numero como MXN simple.
function mxn(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Pide a OpenAI que redacte el resumen a partir del contexto. Devuelve el texto
// redactado, o null si no hay key o falla (el caller usa un fallback).
async function redactar(contexto) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const system =
    'Eres el asistente de direccion de SUPER CHEAP, una tienda de conveniencia ' +
    'en Mexico. Redacta un RESUMEN DIARIO breve (5-8 lineas) en espanol claro para ' +
    'el dueno, a partir del contexto JSON. Menciona ventas del dia, utilidad, y ' +
    'destaca cualquier alerta. Tono directo y practico. Montos en MXN. No inventes ' +
    'cifras fuera del contexto.\n\nCONTEXTO:\n' + JSON.stringify(contexto);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Redacta el resumen diario.' },
        ],
      }),
    });
    const oa = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return oa.choices?.[0]?.message?.content || null;
  } catch (e) {
    return null;
  }
}

// Envia el correo via Resend. Devuelve true si se envio, false si no.
async function enviarCorreo(asunto, cuerpoTexto) {
  const key  = process.env.RESEND_API_KEY;
  const to   = process.env.MAIL_TO;
  const from = process.env.MAIL_FROM;

  if (!key) {
    console.log('[sc-resumen-diario] RESEND_API_KEY no configurada: no se envia correo.');
    return false;
  }
  if (!to || !from) {
    console.log('[sc-resumen-diario] Falta MAIL_TO o MAIL_FROM: no se envia correo.');
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        subject: asunto,
        text: cuerpoTexto,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.log('[sc-resumen-diario] Resend respondio error:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.log('[sc-resumen-diario] Error enviando correo:', e.message || e);
    return false;
  }
}

// Determina si la invocacion proviene REALMENTE del scheduler de Netlify (y no
// de una llamada HTTP anonima externa que intente disparar el envio de correos).
//
// Defensa en dos capas:
//   1) Las Scheduled Functions de Netlify se invocan internamente: el `event`
//      llega sin httpMethod (o vacio) y/o con la marca de "next_run" en el body.
//      Una peticion HTTP normal SIEMPRE trae httpMethod (GET/POST/...).
//   2) Si se define RESUMEN_SECRET, ademas se exige el header
//      `x-resumen-secret` con ese valor (permite forzar el resumen a mano de
//      forma segura, ej. para pruebas).
function invocacionAutorizada(event) {
  const ev = event || {};
  const metodo = ev.httpMethod || ev.method || '';

  // Capa 1: el scheduler no manda httpMethod; una llamada HTTP externa si.
  const esScheduled = !metodo || /next_run/.test(String(ev.body || ''));

  // Capa 2: secreto opcional para forzar manualmente.
  const secreto = process.env.RESUMEN_SECRET;
  const headers = ev.headers || {};
  const recibido = headers['x-resumen-secret'] || headers['X-Resumen-Secret'] || '';
  const conSecreto = !!secreto && recibido === secreto;

  return esScheduled || conSecreto;
}

// Handler de la funcion programada.
module.exports.handler = async (event) => {
  // Guarda: bloquea disparos HTTP anonimos del envio de correos.
  if (!invocacionAutorizada(event)) {
    return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'No autorizado' }) };
  }
  try {
    const ayer = data.ayerISO();

    const [kpis, alertas] = await Promise.all([
      data.kpisRango(ayer, ayer),
      data.calcularAlertas(),
    ]);

    const contexto = { fecha: ayer, kpis, alertas };

    // Cuerpo: redaccion de OpenAI si esta disponible, si no un fallback armado.
    let cuerpo = await redactar(contexto);
    if (!cuerpo) {
      const lineas = [
        `Resumen del ${ayer}`,
        ``,
        `Ventas:   ${mxn(kpis.ventas)}`,
        `Compras:  ${mxn(kpis.compras)}`,
        `Gastos:   ${mxn(kpis.gastos)}`,
        `Nomina:   ${mxn(kpis.nomina)}`,
        `Utilidad: ${mxn(kpis.utilidad)}  (margen ${kpis.margen.toFixed(1)}%)`,
      ];
      if (alertas.length) {
        lineas.push('', 'Alertas:');
        for (const a of alertas) lineas.push(`- [${a.nivel}] ${a.mensaje}`);
      } else {
        lineas.push('', 'Sin alertas.');
      }
      cuerpo = lineas.join('\n');
    }

    const asunto = `SUPER CHEAP — Resumen ${ayer}`;
    const enviado = await enviarCorreo(asunto, cuerpo);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fecha: ayer, enviado, alertas: alertas.length }),
    };
  } catch (e) {
    // Una funcion programada que falla solo se loguea; no rompe nada del sitio.
    console.log('[sc-resumen-diario] Error:', e.message || e);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
  }
};

// Configuracion de la Scheduled Function de Netlify (CommonJS + esbuild).
module.exports.config = { schedule: '0 14 * * *' };
