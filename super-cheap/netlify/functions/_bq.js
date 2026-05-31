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
//
// v2: insertRows/actualizar/softDelete usan DML parametrizado (INSERT/UPDATE)
// en lugar de streaming inserts, para poder editar/borrar las filas de
// inmediato (el streaming buffer impide UPDATE/DELETE durante ~90 min).

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

// --- Helpers de CAST por nombre de columna (compartidos por INSERT/UPDATE) ---

// Valida que un nombre de columna sea seguro para interpolar en SQL.
// Solo letras y guion bajo: previene inyeccion via nombres de columna.
function validarColumna(col) {
  if (!/^[a-z_]+$/i.test(col)) {
    throw new Error('Nombre de columna invalido: ' + col);
  }
  return col;
}

// Valida el nombre de tabla (defensa en profundidad; el caller ademas usa
// una whitelist ventas|compras|gastos|nomina).
function validarTabla(tabla) {
  if (!/^[a-z_]+$/i.test(tabla)) {
    throw new Error('Nombre de tabla invalido: ' + tabla);
  }
  return tabla;
}

// Devuelve la expresion SQL para asignar el parametro @param a la columna col,
// aplicando el CAST que corresponde al tipo de la columna en BigQuery.
//   col   — nombre de columna (ya validado).
//   param — nombre del parametro nombrado (ya validado, sin @).
function exprCast(col, param) {
  const c = col.toLowerCase();
  if (c === 'fecha') return `DATE(@${param})`;
  if (c === 'total' || c === 'subtotal' || c === 'iva' || c === 'ieps' || c === 'monto' ||
      c === 'cantidad' || c === 'precio' || c === 'importe') {
    return `CAST(@${param} AS NUMERIC)`;
  }
  if (c === 'items') return `CAST(@${param} AS INT64)`;
  if (c === 'impuestos_estimados' || c === 'activo') return `CAST(@${param} AS BOOL)`;
  // El resto (id, proveedor, concepto, categoria, conceptos, foto_url, fotos,
  // raw_ocr, periodo, empleado, tipo, ticket_id, forma_pago, fuente, hora) son
  // STRING: se pasan como @param tal cual.
  return `@${param}`;
}

// Construye el tipo explicito de BigQuery para un parametro, segun la columna.
// Es necesario porque algunos valores pueden venir null (sin tipo inferible) o
// numeros que el cliente serializaria distinto. Devuelve el string de tipo
// esperado por la API ('STRING','NUMERIC','INT64','BOOL','DATE').
function tipoParam(col) {
  const c = col.toLowerCase();
  if (c === 'fecha') return 'STRING';   // se castea con DATE(@x); el valor viaja como STRING 'YYYY-MM-DD'
  if (c === 'total' || c === 'subtotal' || c === 'iva' || c === 'ieps' || c === 'monto' ||
      c === 'cantidad' || c === 'precio' || c === 'importe') return 'NUMERIC';
  if (c === 'items') return 'INT64';
  if (c === 'impuestos_estimados' || c === 'activo') return 'BOOL';
  return 'STRING';
}

// Normaliza el valor JS al tipo que espera el parametro de BigQuery.
function valorParam(col, v) {
  if (v === undefined) v = null;
  const c = col.toLowerCase();
  if (v === null) return null;
  if (c === 'total' || c === 'subtotal' || c === 'iva' || c === 'ieps' || c === 'monto' ||
      c === 'cantidad' || c === 'precio' || c === 'importe') {
    // RIESGO ALTO de precision: el cliente de BigQuery, al recibir un Number JS
    // con type 'NUMERIC', lo serializa con toString() y puede caer en notacion
    // cientifica (ej. 1e-7) o perder/rechazar decimales. Lo mas robusto es
    // enviar el NUMERIC como STRING en notacion decimal fija. Se redondea a 6
    // decimales (NUMERIC de BQ admite hasta 9) para no arrastrar ruido de float.
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    let s = n.toFixed(6);
    // Quita ceros a la derecha y el punto sobrante (ej. '12.500000' -> '12.5').
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  if (c === 'items') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (c === 'impuestos_estimados' || c === 'activo') return Boolean(v);
  // STRING (incluye fecha como 'YYYY-MM-DD').
  return String(v);
}

// Inserta filas en una tabla del dataset usando DML INSERT INTO parametrizado.
//   tabla — nombre de la tabla (validado: [a-z_]+; el caller usa whitelist).
//   filas — arreglo de objetos cuyas llaves coinciden con las columnas.
//
// Detalles:
//   - `ts` SIEMPRE se agrega como CURRENT_TIMESTAMP() (no es parametro). Si la
//     fila trae `ts`, se ignora (lo pone el servidor).
//   - Se aplican CAST por nombre de columna (ver exprCast).
//   - Soporta varias filas en una sola sentencia INSERT (VALUES (..),(..)).
async function insertRows(tabla, filas) {
  validarTabla(tabla);
  const lista = Array.isArray(filas) ? filas : [filas];
  if (lista.length === 0) return { insertados: 0 };

  // Union de columnas presentes en todas las filas (excluyendo ts, que va aparte).
  const cols = [];
  const colSet = new Set();
  for (const fila of lista) {
    for (const k of Object.keys(fila || {})) {
      if (k === 'ts') continue;
      const c = validarColumna(k);
      if (!colSet.has(c)) { colSet.add(c); cols.push(c); }
    }
  }

  // Construye la clausula VALUES y el objeto de parametros + tipos.
  const params = {};
  const types  = {};
  const valuesSql = [];

  lista.forEach((fila, i) => {
    const partes = cols.map((col) => {
      const param = `${col}_${i}`;
      params[param] = valorParam(col, fila ? fila[col] : null);
      types[param]  = tipoParam(col);
      return exprCast(col, param);
    });
    // ts siempre al final como CURRENT_TIMESTAMP().
    partes.push('CURRENT_TIMESTAMP()');
    valuesSql.push('(' + partes.join(', ') + ')');
  });

  const columnasSql = [...cols, 'ts'].join(', ');
  const sql = `INSERT INTO \`${DATASET}.${tabla}\` (${columnasSql}) VALUES ${valuesSql.join(', ')}`;

  const bq = getClient();
  await bq.query({ query: sql, params, types, useLegacySql: false });
  return { insertados: lista.length };
}

// Actualiza una fila por id usando DML UPDATE parametrizado.
//   tabla  — nombre de la tabla (validado).
//   id     — valor del id (STRING) de la fila a actualizar.
//   campos — objeto { col: valor } con las columnas a modificar. `ts` se
//            ignora (no se reescribe). No se permite cambiar `id`.
async function actualizar(tabla, id, campos) {
  validarTabla(tabla);
  if (!id) throw new Error('Falta id para actualizar.');

  const cols = Object.keys(campos || {}).filter(k => k !== 'ts' && k !== 'id');
  if (cols.length === 0) return { actualizados: 0 };

  const params = { id: String(id) };
  const types  = { id: 'STRING' };
  const sets   = cols.map((col) => {
    validarColumna(col);
    const param = `set_${col}`;
    params[param] = valorParam(col, campos[col]);
    types[param]  = tipoParam(col);
    return `${col} = ${exprCast(col, param)}`;
  });

  const sql = `UPDATE \`${DATASET}.${tabla}\` SET ${sets.join(', ')} WHERE id = @id`;
  const bq = getClient();
  await bq.query({ query: sql, params, types, useLegacySql: false });
  return { actualizados: 1 };
}

// Borrado suave: marca activo=FALSE para la fila con el id dado.
async function softDelete(tabla, id) {
  validarTabla(tabla);
  if (!id) throw new Error('Falta id para eliminar.');
  const sql = `UPDATE \`${DATASET}.${tabla}\` SET activo = FALSE WHERE id = @id`;
  const bq = getClient();
  await bq.query({
    query: sql,
    params: { id: String(id) },
    types:  { id: 'STRING' },
    useLegacySql: false,
  });
  return { eliminados: 1 };
}

module.exports = {
  DATASET,
  getClient,
  query,
  insertRows,
  actualizar,
  softDelete,
};
