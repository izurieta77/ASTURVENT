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
const OPENAI_TIMEOUT_MS = 8500;
// Mantener el payload por debajo de los limites practicos de funciones serverless.
const MAX_B64_TOTAL = 5.5 * 1024 * 1024;
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

function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function dedupeConceptos(conceptos) {
  const vistos = new Set();
  const salida = [];
  for (const c of conceptos || []) {
    const desc = normalizarTexto(c.descripcion);
    const importe = r2(c.importe).toFixed(2);
    const key = [desc, importe, c.uso || 'otro', c.ingrediente || ''].join('|');
    if (!desc && importe === '0.00') continue;
    if (vistos.has(key)) continue;
    vistos.add(key);
    salida.push(c);
  }
  return salida;
}

function sumaConceptos(conceptos) {
  return r2((conceptos || []).reduce((s, c) => s + (Number(c.importe) || 0), 0));
}

// Prompt del sistema: salida JSON estricta, multi-foto, manuscritos, fecha+hora,
// y CLASIFICACION INTELIGENTE de insumos (maquila vs reventa) + ingrediente.
const SYSTEM_PROMPT =
  'Eres un asistente contable y de costos para una tienda de conveniencia en Mexico ' +
  'que ADEMAS maquila (prepara) alimentos: tortas, sandwiches y cuernitos. ' +
  'Recibes UNA O VARIAS imagenes que son PARTES DEL MISMO ticket, factura o nota ' +
  '(por ejemplo varias hojas o secciones). FUSIONA la informacion de todas las ' +
  'imagenes en un solo documento: NO dupliques conceptos ni sumes dos veces el ' +
  'mismo total. Algunas fotos pueden traslaparse: si una linea, subtotal o total ' +
  'aparece repetido en dos fotos, usalo una sola vez. No trates cada foto como ' +
  'un ticket distinto. El documento puede estar IMPRESO o escrito A MANO (manuscrito); ' +
  'lee la letra manuscrita lo mejor posible. NO agregues datos "a lo tonto": LEE y ' +
  'ENTIENDE para que sirve cada producto comprado.\n' +
  'Devuelves SOLO un objeto JSON valido (sin texto extra, sin markdown, sin ```). ' +
  'Estructura exacta requerida:\n' +
  '{\n' +
  '  "fecha": "YYYY-MM-DD" o null,\n' +
  '  "hora": "HH:MM" o null,\n' +
  '  "proveedor": string o null,\n' +
  '  "categoria": string o null,\n' +
  '  "clasificacion": "maquila" | "reventa" | "mixto" | "otro",\n' +
  '  "subtotal": number,\n' +
  '  "iva": number,\n' +
  '  "ieps": number,\n' +
  '  "total": number,\n' +
  '  "conceptos": [ { "descripcion": string, "importe": number, "uso": "maquila"|"reventa"|"otro", "ingrediente": string o null } ],\n' +
  '  "iva_desglosado": boolean\n' +
  '}\n' +
  'Reglas de NUMEROS:\n' +
  '- Usa punto decimal, sin simbolo de moneda ni separador de miles.\n' +
  '- "hora" en formato 24h HH:MM si es legible; si no, null.\n' +
  '- "iva_desglosado" = true SOLO si el documento muestra explicitamente el monto ' +
  'de IVA (o IEPS) desglosado. Si solo ves el total, ponlo en false.\n' +
  '- Si el IVA viene desglosado, copia subtotal, iva, ieps y total tal como aparecen.\n' +
  '- Si NO viene desglosado, pon iva=0 e ieps=0 y deja el total; el servidor estimara.\n' +
  '- "categoria" sugiere una categoria corta (ej: abarrotes, bebidas, carnes frios, panaderia, limpieza, renta, luz, agua).\n' +
  '- Si no puedes leer un dato, usa null (texto) o 0 (numeros). NUNCA inventes montos.\n' +
  'Reglas de ENTENDIMIENTO (clasificar cada concepto):\n' +
  '- "uso"="maquila": INSUMOS para preparar las tortas/sandwiches/cuernitos. Ejemplos: ' +
  'jamon, queso, panela, pierna, salami, pan, bolillo, telera, cuernito/croissant, ' +
  'mayonesa, mostaza, chiles, jitomate, lechua, aguacate, mantequilla. Si el producto ' +
  'tipicamente se usa como ingrediente de una torta/sandwich/cuernito, es "maquila".\n' +
  '- "uso"="reventa": productos que se VENDEN TAL CUAL sin preparar. Ejemplos: refrescos, ' +
  'agua embotellada, sabritas/frituras, dulces, cigarros, cerveza, galletas empaquetadas.\n' +
  '- "uso"="otro": lo que no es ni ingrediente ni mercancia de reventa (limpieza, ' +
  'papeleria, servicios, equipo, bolsas).\n' +
  '- "ingrediente": cuando uso="maquila", normaliza el nombre del insumo a una palabra ' +
  'clave en minusculas y singular (ej: "jamon", "queso", "pan", "cuernito", "jitomate"). ' +
  'Para uso!="maquila" pon null.\n' +
  '- "clasificacion" (del ticket completo): "maquila" si casi todo es insumo de maquila; ' +
  '"reventa" si casi todo es mercancia de reventa; "mixto" si hay de ambos; "otro" si no aplica.';

exports.handler = async (event) => {
  const cors = corsHeaders(event);

  try {

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
    ...imagenes.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } })),
  ];

  let data;
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
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
    clearTimeout(timeout);

    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(502, cors, { ok: false, error: data.error?.message || `OpenAI HTTP ${res.status}` });
    }
  } catch (e) {
    if (timeout) clearTimeout(timeout);
    if (e && e.name === 'AbortError') {
      return json(504, cors, { ok: false, error: 'La lectura del ticket tardo demasiado. Intenta con menos fotos o fotos mas cercanas.' });
    }
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

  // Conceptos saneados (incluye uso/ingrediente entendidos por la IA).
  const USOS = ['maquila', 'reventa', 'otro'];
  const conceptosLeidos = Array.isArray(raw.conceptos)
    ? raw.conceptos
        .map(c => {
          const uso = c && USOS.includes(String(c.uso)) ? String(c.uso) : 'otro';
          const ing = uso === 'maquila' && c && c.ingrediente != null && String(c.ingrediente).trim()
            ? String(c.ingrediente).trim().toLowerCase()
            : null;
          return {
            descripcion: c && c.descripcion != null ? String(c.descripcion) : '',
            importe: r2(c && c.importe),
            uso,
            ingrediente: ing,
          };
        })
        .filter(c => c.descripcion || c.importe)
    : [];
  const conceptos = dedupeConceptos(conceptosLeidos);
  const conceptosDuplicados = conceptosLeidos.length - conceptos.length;

  // Clasificacion del ticket completo (maquila|reventa|mixto|otro).
  const CLASIF = ['maquila', 'reventa', 'mixto', 'otro'];
  let clasificacion = CLASIF.includes(String(raw.clasificacion)) ? String(raw.clasificacion) : null;
  if (!clasificacion && conceptos.length) {
    // Respaldo: derivar de los usos de los conceptos si la IA no la mando.
    const usos = new Set(conceptos.map(c => c.uso));
    if (usos.has('maquila') && usos.has('reventa')) clasificacion = 'mixto';
    else if (usos.has('maquila')) clasificacion = 'maquila';
    else if (usos.has('reventa')) clasificacion = 'reventa';
    else clasificacion = 'otro';
  }
  if (!clasificacion) clasificacion = 'otro';

  let subtotal = r2(raw.subtotal);
  let iva      = r2(raw.iva);
  let ieps     = r2(raw.ieps);
  let total    = r2(raw.total);
  const desglosado = raw.iva_desglosado === true && (iva > 0 || ieps > 0);

  let impuestos_estimados = false;
  let nota = '';
  let revisar = false;

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
  const sumaLineas = sumaConceptos(conceptos);
  if (!desglosado && total > 0 && sumaLineas > 0) {
    const ratio = total / sumaLineas;
    const entero = Math.round(ratio);
    if (entero >= 2 && entero <= 4 && Math.abs(ratio - entero) <= 0.08) {
      total = sumaLineas;
      subtotal = r2(total / (1 + IVA_TASA));
      iva = r2(total - subtotal);
      revisar = true;
      nota = (nota ? nota + ' ' : '') +
        'El total parecia duplicado por fotos traslapadas; se uso la suma unica de conceptos. Verifica antes de guardar.';
    }
  }
  if (conceptosDuplicados > 0) {
    nota = (nota ? nota + ' ' : '') +
      `Se omitieron ${conceptosDuplicados} concepto(s) repetido(s) detectado(s) en las fotos.`;
  }

  const cuadra = Math.abs((subtotal + iva + ieps) - total) <= TOLERANCIA;
  revisar = revisar || !cuadra;
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
      clasificacion,
      impuestos_estimados,
      revisar,
      nota,
    },
  });
  } catch (e) {
    return json(500, cors, {
      ok: false,
      error: 'Error interno leyendo ticket: ' + (e.message || String(e)),
    });
  }
};
