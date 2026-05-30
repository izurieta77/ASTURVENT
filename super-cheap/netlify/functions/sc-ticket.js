// Lectura de tickets con IA (vision) para SUPER CHEAP — Skill 8 (v2).
//
// El frontend manda una o VARIAS fotos del MISMO ticket/nota en base64 y esta
// funcion las envia a OpenAI (modelo de vision) para extraer los montos. La API
// key vive SOLO en el servidor (env var OPENAI_API_KEY); el navegador nunca la ve.
//
// Requiere Bearer token valido (mismo que sc-data; firmado por auth.js).
//
//   POST  { imagenes_base64:["<b64>", ...], tipo:"compra|gasto" }
//   (acepta tambien { imagen_base64:"<b64>", tipo } para compatibilidad)
//
// Las imagenes se mandan en UNA SOLA llamada de vision: son PARTES del MISMO
// documento, por lo que el modelo debe FUSIONAR conceptos/totales SIN duplicar.
// Soporta documentos IMPRESOS o A MANO (manuscritos).
//
// Respuesta (ver CONTRACT.md v2):
//   { ok:true, datos:{ fecha, hora, proveedor, categoria, subtotal, iva, ieps,
//                      total, conceptos:[{descripcion, importe}],
//                      impuestos_estimados, revisar, nota } }
//
// Reglas de impuestos (CONTRACT.md):
//   1. Si el ticket desglosa IVA/IEPS -> se usan tal cual, impuestos_estimados=false.
//   2. Si NO los desglosa -> el total ya los incluye; se estima IVA 16% (y IEPS solo
//      si aplica); impuestos_estimados=true.
//   3. Validar |subtotal+iva+ieps - total| <= 0.50 -> si no cuadra, revisar=true.
//   4. Si la fecha no es legible -> revisar=true.

const { corsHeaders, json, verifyToken, bearer } = require('./_lib');

const MODEL      = 'gpt-4o';          // modelo de vision
const MAX_TOKENS = 1200;              // techo de salida (mas alto por multi-foto)
// Limite de tamano TOTAL combinado de las imagenes base64 (~20 MB).
const MAX_B64_TOTAL = 20 * 1024 * 1024;
const MAX_IMAGENES  = 8;              // techo de imagenes por llamada
const IVA_TASA    = 0.16;            // IVA general en Mexico (16%)
const TOLERANCIA  = 0.50;            // tolerancia para validar subtotal+iva+ieps≈total

function r2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// Quita el encabezado data: si viene y recorta.
function limpiarB64(s) {
  let b64 = String(s || '');
  const coma = b64.indexOf(',');
  if (b64.startsWith('data:') && coma >= 0) b64 = b64.slice(coma + 1);
  return b64.trim();
}

// Prompt del sistema: salida JSON estricta, multi-foto, manuscritos, fecha+hora.
const SYSTEM_PROMPT =
  'Eres un asistente contable para una tienda de conveniencia en Mexico. ' +
  'Recibes UNA O VARIAS imagenes que son PARTES DEL MISMO ticket, factura o nota ' +
  '(por ejemplo varias hojas o secciones). FUSIONA la informacion de todas las ' +
  'imagenes en un solo documento: NO dupliques conceptos ni sumes dos veces el ' +
  'mismo total. El documento puede estar IMPRESO o escrito A MANO (manuscrito); ' +
  'lee la letra manuscrita lo mejor posible. Devuelves SOLO un objeto JSON valido ' +
  '(sin texto extra, sin markdown, sin ```). Estructura exacta requerida:\n' +
  '{\n' +
  '  "fecha": "YYYY-MM-DD" o null,\n' +
  '  "hora": "HH:MM" o null,\n' +
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
  '- "hora" en formato 24h HH:MM si es legible; si no, null.\n' +
  '- "iva_desglosado" = true SOLO si el documento muestra explicitamente el monto ' +
  'de IVA (o IEPS) desglosado. Si solo ves el total, ponlo en false.\n' +
  '- Si el IVA viene desglosado, copia subtotal, iva, ieps y total tal como aparecen.\n' +
  '- Si NO viene desglosado, pon iva=0 e ieps=0 y deja el total; el servidor estimara.\n' +
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

  // Acepta imagenes_base64:[...] o imagen_base64:"..." (compatibilidad).
  let entradas = [];
  if (Array.isArray(payload.imagenes_base64)) entradas = payload.imagenes_base64;
  else if (payload.imagen_base64) entradas = [payload.imagen_base64];

  const imagenes = entradas.map(limpiarB64).filter(Boolean);

  if (imagenes.length === 0) {
    return json(400, cors, { ok: false, error: 'Falta imagenes_base64 (o imagen_base64)' });
  }
  if (imagenes.length > MAX_IMAGENES) {
    return json(413, cors, { ok: false, error: `Demasiadas imagenes (max ${MAX_IMAGENES}).` });
  }
  const totalLen = imagenes.reduce((s, b) => s + b.length, 0);
  if (totalLen > MAX_B64_TOTAL) {
    return json(413, cors, { ok: false, error: 'Las imagenes son demasiado grandes. Tomalas a menor resolucion.' });
  }

  // --- Llamada a OpenAI (vision) con TODAS las imagenes en un solo mensaje ---
  const contenidoUsuario = [
    { type: 'text', text: `Estas ${imagenes.length} imagen(es) son partes del MISMO ticket/nota de ${tipo}. Fusiona la informacion y devuelve el JSON.` },
    ...imagenes.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })),
  ];

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
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: contenidoUsuario },
        ],
      }),
    });

    data = await res.json().catch(() => ({}));
    if (!res.ok) {
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

  // Fecha YYYY-MM-DD (o null). Si no es legible -> revisar.
  let fecha = null;
  let fechaIlegible = false;
  if (typeof raw.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.fecha.trim())) {
    fecha = raw.fecha.trim();
  } else {
    fechaIlegible = true;
  }

  // Hora HH:MM (o null).
  let hora = null;
  if (typeof raw.hora === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw.hora.trim())) {
    // Normaliza a HH:MM con cero a la izquierda.
    const [h, m] = raw.hora.trim().split(':');
    hora = `${String(h).padStart(2, '0')}:${m}`;
  }

  // Conceptos saneados.
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
    impuestos_estimados = false;
    if (!(subtotal > 0)) subtotal = r2(total - iva - ieps);
    nota = 'IVA/IEPS tomados directamente del ticket.';
  } else {
    impuestos_estimados = true;
    if (!(total > 0) && subtotal > 0) total = subtotal;
    ieps = 0;
    subtotal = r2(total / (1 + IVA_TASA));
    iva = r2(total - subtotal);
    nota = 'El ticket no desglosa impuestos: se estimo IVA 16% sobre el total. Revisa los montos.';
  }

  // Regla 3: validar que subtotal + iva + ieps ≈ total.
  const cuadra = Math.abs((subtotal + iva + ieps) - total) <= TOLERANCIA;
  let revisar = !cuadra;
  if (revisar) {
    nota = (nota ? nota + ' ' : '') + 'Los montos no cuadran exactamente; verifica antes de guardar.';
  }
  // Regla 4: fecha no legible -> revisar.
  if (fechaIlegible) {
    revisar = true;
    nota = (nota ? nota + ' ' : '') + 'No se pudo leer la fecha con seguridad; capturala manualmente.';
  }

  return json(200, cors, {
    ok: true,
    datos: {
      fecha,
      hora,
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
