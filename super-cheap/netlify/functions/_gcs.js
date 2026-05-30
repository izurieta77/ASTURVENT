// Subida de imagenes a Google Cloud Storage para SUPER CHEAP.
//
// Uso: subir las fotos de un ticket/nota a un bucket de GCS y devolver una
// referencia para guardarlas en BigQuery (columnas foto_url / fotos).
//
// PRIVACIDAD: el bucket es PRIVADO (la organizacion puede tener activada la
// "prevencion de acceso publico"). Por eso NO publicamos las imagenes; se
// guarda la ruta del objeto (formato "gs://bucket/objeto") y se generan
// enlaces FIRMADOS temporales bajo demanda con firmarUrl() para mostrarlas.
//
// Es GRACEFUL: si no hay GCS_BUCKET o credenciales, o si la subida falla, NO
// lanza error; devuelve [] para que la captura del registro no se bloquee.
//
// Env vars:
//   GCS_BUCKET      — nombre del bucket (requerido para subir).
//   GCP_PROJECT_ID  — id del proyecto (mismo que _bq.js).
//   GCP_SA_KEY      — credenciales del service account (JSON o Base64 de JSON),
//                     mismo patron que _bq.js.

const crypto = require('crypto');

// Singleton del cliente de Storage (igual idea que _bq.js).
let _bucket = null;
let _bucketIntentado = false;

// Crea (o reutiliza) el handle al bucket. Devuelve null si falta configuracion
// o si las credenciales no son validas (sin lanzar).
function getBucket() {
  if (_bucketIntentado) return _bucket;
  _bucketIntentado = true;

  const bucketName = process.env.GCS_BUCKET;
  const projectId  = process.env.GCP_PROJECT_ID;
  const saKeyRaw   = process.env.GCP_SA_KEY;
  if (!bucketName || !projectId || !saKeyRaw) return null;

  try {
    // require perezoso: si la dependencia no esta instalada, no rompe el modulo.
    const { Storage } = require('@google-cloud/storage');
    const txt = saKeyRaw.trim().startsWith('{')
      ? saKeyRaw
      : Buffer.from(saKeyRaw, 'base64').toString('utf8');
    const credentials = JSON.parse(txt);
    const storage = new Storage({ projectId, credentials });
    _bucket = storage.bucket(bucketName);
  } catch (e) {
    // Cualquier fallo (dependencia ausente, credenciales malas) -> graceful.
    _bucket = null;
  }
  return _bucket;
}

// Quita el encabezado data: de un base64 si viene, y recorta espacios.
function limpiarBase64(s) {
  let b64 = String(s || '');
  const coma = b64.indexOf(',');
  if (b64.startsWith('data:') && coma >= 0) b64 = b64.slice(coma + 1);
  return b64.trim();
}

// Sube cada imagen del arreglo base64 al bucket y devuelve sus URLs publicas.
//   base64Array — arreglo de strings base64 (con o sin encabezado data:).
//   prefijo     — carpeta logica dentro del bucket (ej: 'compras').
// Devuelve [] si GCS no esta configurado o ante cualquier error.
async function subirImagenes(base64Array, prefijo) {
  const arr = Array.isArray(base64Array) ? base64Array : (base64Array ? [base64Array] : []);
  if (arr.length === 0) return [];

  const bucket = getBucket();
  if (!bucket) return [];

  const safePrefijo = /^[a-z0-9_-]+$/i.test(String(prefijo || '')) ? String(prefijo) : 'tickets';
  const urls = [];

  for (const item of arr) {
    const b64 = limpiarBase64(item);
    if (!b64) continue;
    try {
      const buffer = Buffer.from(b64, 'base64');
      if (!buffer.length) continue;
      const nombre = `${safePrefijo}/${crypto.randomUUID()}.jpg`;
      const file = bucket.file(nombre);
      await file.save(buffer, {
        contentType: 'image/jpeg',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=3600' },
      });
      // Guardamos la REFERENCIA privada (gs://bucket/objeto). Para mostrarla,
      // el frontend pide un enlace firmado temporal via firmarUrl().
      urls.push(`gs://${bucket.name}/${nombre}`);
    } catch (e) {
      // Una imagen que falla no debe tumbar las demas ni el guardado del registro.
      continue;
    }
  }

  return urls;
}

// Genera un enlace firmado temporal (lectura) para una referencia gs://...
// Devuelve null si no se puede (sin bucket, ref invalida o error).
async function firmarUrl(ref, minutos) {
  const r = String(ref || '');
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(r);
  if (!m) return null;
  const bucket = getBucket();
  if (!bucket || bucket.name !== m[1]) return null;
  try {
    const [url] = await bucket.file(m[2]).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + (Number(minutos) > 0 ? Number(minutos) : 60) * 60 * 1000,
    });
    return url;
  } catch (e) {
    return null;
  }
}

module.exports = { subirImagenes, firmarUrl };
