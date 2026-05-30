// Lectura de tickets con IA (vision) para SUPER CHEAP.
//
// El frontend manda la foto de un ticket de compra/gasto en base64 y esta
// funcion la envia a OpenAI (modelo de vision) para extraer los montos. La API
// key vive SOLO en el servidor (env var OPENAI_API_KEY); el navegador nunca la ve.
//
// Requiere Bearer token valido (mismo que sc-data; firmado por auth.js).
//
//   POST  { imagen_base64:"<base64 sin encabezado data:>", tipo:"compra|gasto" }
//
// Respuesta (ver CONTRACT.md):
//   { ok:true, datos:{ fecha, proveedor, categoria, subtotal, iva, ieps, total,
//                      conceptos:[{descripcion, importe}], impuestos_estimados,
//                      revisar, nota } }
//
// Reglas de impuestos (CONTRACT.md):
//   1. Si el ticket desglosa IVA/IEPS -> se usan tal cual, impuestos_estimados=false.
//   2. Si NO los desglosa -> el total ya los incluye; se estima IVA 16% (y IEPS solo
//      si aplica); impuestos_estimados=true.
//   3. Validar |subtotal+iva+ieps - total| <= 0.50 -> si no cuadra, revisar=true.

const { corsHeaders, json, verifyToken, bearer } = require('./_lib');

const MODEL      = 'gpt-4o';          // modelo de vision
const MAX_TOKENS = 900;               // techo de salida (controla costo)
// Limite de tamano de la imagen base64. Una imagen base64 muy grande puede
// reventar la funcion (memoria/timeout) y el limite de payload de OpenAI.
// ~8 MB de base64 ~= 6 MB de imagen real, suficiente para la foto de un ticket.
const MAX_B64_LEN = 8 * 1024 * 1024;
const IVA_TASA    = 0.16;             // IVA general en Mexico (16%)
const TOLERANCIA  = 0.50;             // tolerancia para validar subtotal+iva+ieps≈total

// Redondea a 2 decimales devolviendo Number.
function r2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// Prompt del sistema: pide salida JSON estricta con las reglas de impuestos.
const SYSTEM_PROMPT =
  'Eres un asistente contable para una tienda de conveniencia en Mexico. ' +
  'Analizas la foto de un ticket o factura y devuelves SOLO un objeto JSON valido ' +
  '(sin texto extra, sin markdown, sin ```). Estructura exacta requerida:\n' +
  '{\n' +
  '  "fecha": "YYYY-MM-DD" o null,\n' +
  '  "proveedor": string o null,\n' +
  '  "categoria": string o null,\n' +
  '  "subtotal": number,\n' +
  '  "iva": number,\n' +
  '  "ieps": number,\n' +
  '  "total": number,\n' +
  '  "conceptos": [ { "descripcion": string, "importe": number } ],\n' +
  '  "iva_desglosado": boolean\n' +
  '}\n' +
  'Reglas:\n' +
  '- Usa punto decimal, sin simbolo de moneda ni separador de miles.\n' +
  '- "iva_desglosado" = true SOLO si el ticket muestra explicitamente el monto de IVA ' +
  '(o IEPS) desglosado. Si solo ves el total, ponlo en false.\n' +
  '- Si el IVA viene desglosado, copia subtotal, iva, ieps y total tal como aparecen.\n' +
  '- Si NO viene desglosado, pon iva=0 e ieps=0 y deja el total; el servidor estimara los impuestos.\n' +
  '- "categoria" sugiere una categoria corta (ej: abarrotes, bebidas, limpieza, renta, luz, agua).\n' +
  '- Si no puedes leer un dato, usa null (texto) o 0 (numeros). NUNCA inventes.';

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, cors, { ok: false, error: 'Method not allowed' });

  // --- Autenticacion: SIEMPRE se exige Bearer token valido. ---
  const secret = process.env.AUTH_SECRET;
  if (!secret) return json(500, cors, { ok: false, error: 'AUTH_SECRET no configurada en Netlify' });
  const session = verifyToken(bearer(event), secret);
  if (!session) return json(401, cors, { ok: false, error: 'No autorizado' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, cors, { ok: false, error: 'OPENAI_API_KEY no configurada en Netlify' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, cors, { ok: false, error: 'JSON invalido' }); }

  const tipo = payload.tipo === 'gasto' ? 'gasto' : 'compra';
  let b64 = String(payload.imagen_base64 || '');
  // Por si llega con encabezado data: lo quitamos para quedarnos con el base64 puro.
  const coma = b64.indexOf(',');
  if (b64.startsWith('data:') && coma >= 0) b64 = b64.slice(coma + 1);
  b64 = b64.trim();

  if (!b64) return json(400, cors, { ok: false, error: 'Falta imagen_base64' });
  if (b64.length > MAX_B64_LEN) {
    return json(413, cors, { ok: false, error: 'La imagen es demasiado grande. Toma la foto a menor resolucion.' });
  }

  // --- Llamada a OpenAI (vision) ---
  let data;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        // Forzar salida JSON valida.
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Lee este ticket de ${tipo} y devuelve el JSON.` },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
            ],
          },
        ],
      }),
    });

    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // No se filtra el cuerpo completo de OpenAI; solo el mensaje de error.
      return json(502, cors, { ok: false, error: data.error?.message || `OpenAI HTTP ${res.status}` });
    }
  } catch (e) {
    return json(502, cors, { ok: false, error: 'No se pudo contactar el servicio de IA.' });
  }

  // --- Parseo de la respuesta del modelo ---
  let raw;
  try {
    raw = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    return json(502, cors, { ok: false, error: 'La IA devolvio un formato inesperado. Intenta con otra foto.' });
  }

  // Normaliza fecha al formato YYYY-MM-DD (o null si no es valida).
  let fecha = null;
  if (typeof raw.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.fecha.trim())) {
    fecha = raw.fecha.trim();
  }

  // Conceptos: arreglo de { descripcion, importe } saneado.
  const conceptos = Array.isArray(raw.conceptos)
    ? raw.conceptos
        .map(c => ({
          descripcion: c && c.descripcion != null ? String(c.descripcion) : '',
          importe: r2(c && c.importe),
        }))
        .filter(c => c.descripcion || c.importe)
    : [];

  let subtotal = r2(raw.subtotal);
  let iva      = r2(raw.iva);
  let ieps     = r2(raw.ieps);
  let total    = r2(raw.total);
  const desglosado = raw.iva_desglosado === true && (iva > 0 || ieps > 0);

  let impuestos_estimados = false;
  let nota = '';

  if (desglosado) {
    // Regla 1: impuestos desglosados -> se usan tal cual.
    impuestos_estimados = false;
    // Si falta el subtotal, se deriva del total menos impuestos.
    if (!(subtotal > 0)) subtotal = r2(total - iva - ieps);
    nota = 'IVA/IEPS tomados directamente del ticket.';
  } else {
    // Regla 2: no viene desglosado -> el total ya los incluye; se estima IVA 16%.
    impuestos_estimados = true;
    if (!(total > 0) && subtotal > 0) {
      // Si solo se leyo el subtotal, se asume que es el total con impuestos incluidos.
      total = subtotal;
    }
    // IEPS no se puede inferir de forma fiable de un total; se deja en 0 salvo que
    // la IA lo haya desglosado (caso ya cubierto arriba).
    ieps = 0;
    // total = subtotal + iva, con iva = subtotal * 0.16  =>  subtotal = total / 1.16
    subtotal = r2(total / (1 + IVA_TASA));
    iva = r2(total - subtotal);
    nota = 'El ticket no desglosa impuestos: se estimo IVA 16% sobre el total. Revisa los montos.';
  }

  // Regla 3: validar que subtotal + iva + ieps ≈ total (tolerancia 0.50).
  const cuadra = Math.abs((subtotal + iva + ieps) - total) <= TOLERANCIA;
  const revisar = !cuadra;
  if (revisar) {
    nota = (nota ? nota + ' ' : '') + 'Los montos no cuadran exactamente; verifica antes de guardar.';
  }

  return json(200, cors, {
    ok: true,
    datos: {
      fecha,
      proveedor: raw.proveedor != null ? String(raw.proveedor) : null,
      categoria: raw.categoria != null ? String(raw.categoria) : null,
      subtotal,
      iva,
      ieps,
      total,
      conceptos,
      impuestos_estimados,
      revisar,
      nota,
    },
  });
};
