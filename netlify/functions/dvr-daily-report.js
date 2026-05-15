// Reporte diario del agente de monitoreo de tienda.
//
// Lee las observaciones del día anterior desde Apps Script, agrega indicadores
// (apertura/cierre, tareas de limpieza, inactividad) y pide a gpt-4o-mini una
// narrativa breve. Guarda el reporte en la hoja DVR_Reportes_Diarios.
//
// Programado en netlify.toml a las 23:05 CDMX (05:05 UTC).
// Disparo manual: GET /.netlify/functions/dvr-daily-report?fecha=YYYY-MM-DD

const OPENAI_MODEL = 'gpt-4o-mini';

exports.handler = async (event) => {
  const openaiKey = process.env.OPENAI_API_KEY;
  const appsUrl   = process.env.APPS_SCRIPT_URL;
  const appsTok   = process.env.APPS_SCRIPT_TOKEN || '';
  if (!openaiKey) return j_(500, { ok:false, error:'OPENAI_API_KEY no configurada' });
  if (!appsUrl)   return j_(500, { ok:false, error:'APPS_SCRIPT_URL no configurada' });

  // Por defecto: día de "hoy" en CDMX cuando el cron dispara a las 23:05 locales,
  // o el parámetro ?fecha=YYYY-MM-DD si viene en query.
  const qs    = event.queryStringParameters || {};
  const fecha = qs.fecha || todayCDMX_();

  // 1) Traer observaciones del día
  let observaciones;
  try {
    observaciones = await appsFetch_(appsUrl, appsTok, { action:'getDVRObservations', fecha });
  } catch (e) {
    return j_(502, { ok:false, error:'AppsScript getDVRObservations falló: ' + e.message });
  }
  if (!Array.isArray(observaciones)) observaciones = [];

  // 2) Agregar
  const resumen = aggregate_(observaciones);

  // 3) Narrativa con gpt-4o-mini (texto, barato)
  let narrativa = '';
  try {
    narrativa = await composeNarrative_(openaiKey, fecha, resumen, observaciones.length);
  } catch (e) {
    narrativa = `(No se pudo generar narrativa: ${e.message})`;
  }

  const reporte = { fecha, resumen, narrativa, total_observaciones: observaciones.length, generado_en: new Date().toISOString() };

  // 4) Guardar
  try {
    await appsFetch_(appsUrl, appsTok, { action:'saveDVRDailyReport', fecha, reporte });
  } catch (e) {
    return j_(502, { ok:false, error:'AppsScript saveDVRDailyReport falló: ' + e.message, reporte });
  }

  return j_(200, { ok:true, fecha, reporte });
};

// ────────────────────────────────────────────────────────────────────────────
// Agregación
// ────────────────────────────────────────────────────────────────────────────
function aggregate_(obs) {
  // Espera filas: { timestamp, camera_label, parsed:{...} } o { ..., analysis:{ parsed:{...} } }
  const rows = obs.map(o => {
    const p = (o.parsed) || (o.analysis && o.analysis.parsed) || {};
    return {
      ts:       o.timestamp || o.ts || '',
      label:    o.camera_label || o.label || '',
      personas: Number(p.personas_detectadas || 0),
      empleados:Number(p.empleados_visibles || 0),
      clientes: Number(p.clientes_visibles || 0),
      actividad:String(p.actividad || 'desconocido'),
      luces:    !!p.luces_encendidas,
      cortina:  !!p.cortina_abierta,
    };
  }).filter(r => r.ts).sort((a,b) => a.ts.localeCompare(b.ts));

  // Primera/última obs con cortina abierta O personas visibles
  const abiertas = rows.filter(r => r.cortina || r.personas > 0);
  const apertura = abiertas[0]?.ts || null;
  const cierre   = abiertas[abiertas.length - 1]?.ts || null;

  // Conteo por actividad (sin importar cámara — la limpieza suele verse en la de piso)
  const conteoAct = {};
  for (const r of rows) conteoAct[r.actividad] = (conteoAct[r.actividad] || 0) + 1;

  const SAMPLING_MIN = 7;
  const min = k => (conteoAct[k] || 0) * SAMPLING_MIN;

  // Inactividad: rachas con empleados=0 entre apertura y cierre
  let inactividad_min = 0;
  if (apertura && cierre) {
    const enHorario = rows.filter(r => r.ts >= apertura && r.ts <= cierre);
    for (const r of enHorario) if (r.empleados === 0) inactividad_min += SAMPLING_MIN;
  }

  return {
    apertura,
    cierre,
    limpieza: {
      barrido_min:     min('barriendo'),
      trapeado_min:    min('trapeando'),
      polvo_min:       min('limpiando_polvo'),
      hubo_barrido:    (conteoAct['barriendo'] || 0) > 0,
      hubo_trapeado:   (conteoAct['trapeando'] || 0) > 0,
      hubo_polvo:      (conteoAct['limpiando_polvo'] || 0) > 0,
    },
    inactividad_min,
    conteo_actividad: conteoAct,
    cobertura_observaciones: rows.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Narrativa
// ────────────────────────────────────────────────────────────────────────────
async function composeNarrative_(apiKey, fecha, resumen, totalObs) {
  const prompt = `Genera un reporte ejecutivo de 2-3 párrafos cortos (sin viñetas, sin markdown) sobre la operación de la tienda el ${fecha}.
Datos:
- Apertura: ${resumen.apertura || 'no detectada'}
- Cierre: ${resumen.cierre || 'no detectado'}
- Total de observaciones: ${totalObs}
- Minutos barriendo: ${resumen.limpieza.barrido_min}
- Minutos trapeando: ${resumen.limpieza.trapeado_min}
- Minutos limpiando polvo: ${resumen.limpieza.polvo_min}
- Minutos sin empleados en horario operativo: ${resumen.inactividad_min}
- Conteo por actividad: ${JSON.stringify(resumen.conteo_actividad)}

Tono: profesional, neutral, en español de México. No inventes datos que no estén arriba. Si algún indicador es 0 o nulo, dilo explícitamente.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'Eres un asistente que redacta reportes ejecutivos breves para un gerente de gasolinera.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  return data.choices?.[0]?.message?.content || '';
}

// ────────────────────────────────────────────────────────────────────────────
// Apps Script helper (POST con action; espera JSON en respuesta o array vacío)
// ────────────────────────────────────────────────────────────────────────────
async function appsFetch_(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, _token: token }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

function todayCDMX_() {
  // CDMX = UTC-6 (sin DST). Hoy en CDMX = ahora UTC - 6h, formateado YYYY-MM-DD.
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function j_(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
