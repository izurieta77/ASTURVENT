// Cliente centralizado de BigQuery para SUPER CHEAP.
//
// Se instancia UNA sola vez por proceso (singleton a nivel de modulo) para
// reutilizar la conexion entre invocaciones "calientes" de la funcion.
// Las funciones NUNCA deben crear su propio cliente; siempre usan este.
//
// Env vars requeridas:
//   GCP_PROJECT_ID  — id del proyecto de Google Cloud.
//   GCP_SA_KEY      — credenciales del service account en JSON (una sola linea).
//   BQ_DATASET      — opcional, dataset (por defecto 'super_cheap').

const { BigQuery } = require('@google-cloud/bigquery');

// Dataset destino. Se exporta para que las funciones armen `dataset.tabla`.
const DATASET = process.env.BQ_DATASET || 'super_cheap';

// Singleton del cliente. Se crea de forma perezosa en getClient().
let _client = null;

// Crea (o reutiliza) el cliente de BigQuery. Lanza un error claro si faltan
// las variables de entorno o si GCP_SA_KEY no es JSON valido.
function getClient() {
  if (_client) return _client;

  const projectId = process.env.GCP_PROJECT_ID;
  const saKeyRaw  = process.env.GCP_SA_KEY;

  if (!projectId) {
    throw new Error('Falta GCP_PROJECT_ID en las variables de entorno.');
  }
  if (!saKeyRaw) {
    throw new Error('Falta GCP_SA_KEY en las variables de entorno.');
  }

  // Aceptamos GCP_SA_KEY de dos formas para evitar problemas de formato al
  // guardarla: (1) el JSON tal cual, o (2) ese mismo JSON codificado en Base64.
  // Si no empieza con '{', asumimos Base64 y lo decodificamos primero.
  let credentials;
  try {
    const txt = saKeyRaw.trim().startsWith('{')
      ? saKeyRaw
      : Buffer.from(saKeyRaw, 'base64').toString('utf8');
    credentials = JSON.parse(txt);
  } catch (e) {
    throw new Error('GCP_SA_KEY no es un JSON valido (ni Base64 de un JSON): ' + (e.message || e));
  }

  _client = new BigQuery({ projectId, credentials });
  return _client;
}

// Ejecuta una consulta PARAMETRIZADA y devuelve el arreglo de filas.
//   sql    — string con la consulta (usa @nombre para los parametros).
//   params — objeto { nombre: valor } con los parametros nombrados.
async function query(sql, params = {}) {
  const bq = getClient();
  const [rows] = await bq.query({
    query: sql,
    params,
    // Usar SQL estandar (no legacy) de forma explicita.
    useLegacySql: false,
  });
  return rows;
}

// Inserta filas en una tabla del dataset usando streaming inserts.
//   tabla — nombre de la tabla (ventas|compras|gastos|nomina).
//   filas — arreglo de objetos cuyas llaves coinciden con las columnas.
async function insertRows(tabla, filas) {
  const bq = getClient();
  await bq.dataset(DATASET).table(tabla).insert(filas);
  return { insertados: Array.isArray(filas) ? filas.length : 1 };
}

module.exports = {
  DATASET,
  query,
  insertRows,
};
