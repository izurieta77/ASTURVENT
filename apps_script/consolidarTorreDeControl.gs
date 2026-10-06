/**
 * consolidarTorreDeControl v3 — misma lógica, endurecida
 * ---------------------------------------------------------------
 * Qué hace (igual que antes): reconstruye TORRE_DE_CONTROL en la hoja
 * maestra (THD GIO) juntando los despachos de los 26 clientes, con las
 * columnas de la hoja "Lavandería" + NOTA CRÉDITO.
 *
 * Qué cambia (5/oct/2026):
 *  1) Además de la primera pestaña (histórica "Despachos_SGM") lee
 *     "Despachos_SGM_APP", donde la app escribe desde 2026. La Torre
 *     llevaba ~5 meses sin datos nuevos por leer solo la histórica.
 *     Los nombres de columna distintos se mapean con alias.
 *  2) Filas de la app que ya existan en la histórica (mismo cliente,
 *     fecha, ticket y litros) no se duplican.
 *  3) Si un cliente falla (antes: catch vacío y se perdía en silencio),
 *     se reintenta y, si sigue fallando, se CONSERVAN sus filas
 *     anteriores de la Torre y queda registrado en el log.
 *  4) La Torre se sobrescribe sin hacer clear() antes: nunca queda vacía
 *     si la ejecución se corta a la mitad.
 *  5) LockService evita dos ejecuciones simultáneas; si se acerca el
 *     límite de 6 min sale SIN tocar la Torre.
 *
 * INSTALAR: en el proyecto donde ya vive la función (archivo 2.gs),
 * reemplaza TODO el contenido por este archivo. El trigger no se toca.
 */

var TDC_MAX_MS = 5 * 60 * 1000;

function consolidarTorreDeControl() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) { Logger.log('TDC: otra ejecución activa, salgo.'); return; }
  const t0 = Date.now();
  try {
    const masterId = "1xLF7C5A6p7dxlXDx7EiuQiR1MtEnwGeWRargX0tL5qE";
    const idLavanderia = "1p7SIxuTew9zvxsidhLNxKs3TGoPh4cCGMxtMAk1XLXQ"; // se usa como mapa de columnas

    const clientes = [
  {id: "1xLF7C5A6p7dxlXDx7EiuQiR1MtEnwGeWRargX0tL5qE", prefijo: "TGIO"},
  {id: "1gvG1BLhADJsfh1HiSrzoLGrOqcOgS-MEnLOn6NPpHb0", prefijo: "TALF"},
  {id: "1yGDhpQtC_jIH7DbQQZd-oxwsGcS3q6hLM0OJ3lQjYQs", prefijo: "GAJ"},
  {id: "1N5nIQd3zJDh-_tJidXBjD7VHJSv_7W0FhzF9WimhsOs", prefijo: "DEH"},
  {id: "1tbtLrtW4m_uGvt7niyU6RtBzAS5vl8yYBB2mNj-YlVw", prefijo: "DHAR"},
  {id: "1x1wxGCjtH7h1mFZBYZH3YC09lUrahE4W6YgwGeQKzMs", prefijo: "RECA"},
  {id: "1EblV9OeZNbv8JV72C2Ebahe9PsPsJCDy7-QU-FzCdqc", prefijo: "MAC"},
  {id: "110sk87iQtj340XoCRM4kvJOjKPSmRdyhODxJquZkc7A", prefijo: "ATZ"},
  {id: "1lyiW86RfNeJhj2cl_3v6z1aeFdTu6u8IrlWgpbnm1y4", prefijo: "SERI"},
  {id: "1J6JmQfbqptBIMxO-hgMNSRFH04vyGkrHaqr6VQ7d-34", prefijo: "DEL"},
  {id: "19Cfn1CKmcqycV1gmByEQCeHSzE9zzn727B4uFoIhgAk", prefijo: "ECOM"},
  {id: "1p7SIxuTew9zvxsidhLNxKs3TGoPh4cCGMxtMAk1XLXQ", prefijo: "LMAN"},
  {id: "1GtblBP16gAau_rabpTJJ-hWz0c_eKG0rL5aMEmtSlHA", prefijo: "LTOL"},
  {id: "1seX3vC7cMd9VGCZxhMeBS8MIlrE97l5VnNG4Zg-zBy4", prefijo: "PANF"},
  {id: "1inNYu9wgaHla2rGa2dt0VG-YNtumx0M7WVYgiMRNBWw", prefijo: "CEMI"},
  {id: "139uURtkXpEpiZQTD4ER6VfsWs6mw4nPFKc3Wxb6ly74", prefijo: "PORTUR"},
  {id: "15X4vSljJxS9l3srhsCht4vNUPsPXMbhooPHa6v9InCo", prefijo: "TECNO"},
  {id: "1dc67vnTRdBxjx6hnC6k0u6_58HqHU9A0iSpQV98wPXg", prefijo: "PUROSON"},
  {id: "1avOiXQLECGG6ruy_YTAzngYvht7YZkAwzXsuNPq9NTM", prefijo: "AST"},
  {id: "1-130dHpLzOe1ZXU9FtOlJ8D-XmR-A1ph-LkZaVTaIzE", prefijo: "GZAR"},
  {id: "1pKBVQicx7vsc40r0D9CF48jk2DJ9QQcDyBe1jfMNHXU", prefijo: "GRUV"},
  {id: "1UtgLrMwPvqMip3wTJ-n_6uOBXwhsIdvft5YfoAVJhSo", prefijo: "ISM"},
  {id: "174YYRnjF118YJtQvUoGCbAy3G2TDk0VfrQv_LsFo7O0", prefijo: "ISA"},
  {id: "1wK8cYumTqCvsYD4-esHwJbLoHxKjnNSO0GdtMxpyEQc", prefijo: "ROG"},
  {id: "1kmSyj5MJHQTcMKbvO0epfKBvYCZB_PuHjiPyY9l6Vbg", prefijo: "VENETIAMOT"},
  {id: "101Oe1Ud9rzGWIPNoc8b_xIcbR4be4WeqOqjzDyNVlHE", prefijo: "TOLUT"}
    ];

    // 1. Estructura maestra (igual que antes)
    const ssLav = tdcAbrir_(idLavanderia);
    const sheetLav = ssLav.getSheets()[0];
    const headersLav = tdcReintento_(() => sheetLav.getRange(1, 1, 1, sheetLav.getMaxColumns()).getValues()[0]);
    const estructuraMaestra = [];
    for (let i = 0; i < headersLav.length; i++) {
      if (String(headersLav[i]).trim() !== "") estructuraMaestra.push(String(headersLav[i]).trim().toUpperCase());
    }
    if (!estructuraMaestra.includes("NOTA CRÉDITO")) estructuraMaestra.push("NOTA CRÉDITO");

    // 2. Recolectar clientes
    const porCliente = {};
    const fallidos = [];
    for (const cliente of clientes) {
      if (Date.now() - t0 > TDC_MAX_MS) {
        Logger.log('TDC: se acerca el límite de tiempo; salgo SIN modificar la Torre.');
        return;
      }
      try {
        porCliente[cliente.prefijo] = tdcLeerCliente_(cliente, estructuraMaestra);
      } catch (e) {
        fallidos.push(cliente.prefijo + ': ' + (e && e.message || e));
      }
    }

    // 3. Armar resultado; clientes fallidos conservan sus filas anteriores
    const masterSS = tdcAbrir_(masterId);
    let torre = masterSS.getSheetByName("TORRE_DE_CONTROL");
    if (!torre) torre = masterSS.insertSheet("TORRE_DE_CONTROL");
    const colsTorre = ["CLIENTE"].concat(estructuraMaestra);

    const todos = [];
    Object.keys(porCliente).forEach(p => porCliente[p].forEach(f => todos.push(f)));
    if (fallidos.length) {
      const prev = torre.getLastRow() > 1
        ? tdcReintento_(() => torre.getRange(2, 1, torre.getLastRow() - 1, colsTorre.length).getValues()) : [];
      const fallaron = {};
      fallidos.forEach(x => fallaron[x.split(':')[0]] = true);
      prev.forEach(f => { if (fallaron[f[0]]) todos.push(f); });
    }

    // Seguridad: no sobrescribir con un resultado absurdamente chico
    const filasPrevias = Math.max(0, torre.getLastRow() - 1);
    if (filasPrevias > 1000 && todos.length < filasPrevias * 0.5) {
      throw new Error('TDC: resultado (' + todos.length + ' filas) < 50% de la Torre actual (' + filasPrevias + '). No se sobrescribe.');
    }

    // 4. Escribir SIN clear previo
    tdcReintento_(() => {
      torre.getRange(1, 1, 1, colsTorre.length).setValues([colsTorre]).setFontWeight("bold").setBackground("#D9EAD3");
      torre.setFrozenRows(1);
      if (todos.length) {
        if (torre.getMaxRows() < todos.length + 1) torre.insertRowsAfter(torre.getMaxRows(), todos.length + 1 - torre.getMaxRows());
        torre.getRange(2, 1, todos.length, colsTorre.length).setValues(todos);
      }
      const ultima = torre.getLastRow();
      if (ultima > todos.length + 1) torre.getRange(todos.length + 2, 1, ultima - todos.length - 1, torre.getMaxColumns()).clearContent();
    });

    PropertiesService.getScriptProperties().setProperty('TDC_LAST_OK', new Date().toISOString());
    Logger.log('TDC OK: ' + todos.length + ' filas, ' + Math.round((Date.now() - t0) / 1000) + 's' +
      (fallidos.length ? ' | CLIENTES CON ERROR (filas previas conservadas): ' + fallidos.join(' | ') : ''));
  } finally {
    lock.releaseLock();
  }
}

// Lee la pestaña histórica (primera) + Despachos_SGM_APP de un cliente
function tdcLeerCliente_(cliente, estructura) {
  const ss = tdcAbrir_(cliente.id);
  const hojas = ss.getSheets();
  let historica = hojas[0];
  if (historica.getName() === "SGM_Saldos" && hojas.length > 1) historica = hojas[1];
  const app = ss.getSheetByName("Despachos_SGM_APP");

  const filasHist = tdcFilas_(historica, cliente.prefijo, estructura);
  const vistos = {};
  filasHist.forEach(f => { vistos[tdcClave_(estructura, f)] = true; });

  const out = filasHist.slice();
  if (app && app.getSheetId() !== historica.getSheetId()) {
    tdcFilas_(app, cliente.prefijo, estructura).forEach(f => {
      const k = tdcClave_(estructura, f);
      if (k && vistos[k]) return;
      if (k) vistos[k] = true;
      out.push(f);
    });
  }
  return out;
}

const TDC_ALIAS = {
  "TICKET": ["TICKET", "TICKET_EGAS", "NUMERO_DE_TICKET"],
  "PLACAS": ["PLACAS", "PLACA"],
  "CANTIDAD": ["CANTIDAD", "LITROS"],
  "PRECINTO_1_ENTRADA": ["PRECINTO_1_ENTRADA", "NUM_SELLO_E1"],
  "PRECINTO_2_ENTRADA": ["PRECINTO_2_ENTRADA", "NUM_SELLO_E2"],
  "PRECINTO_1_SALIDA": ["PRECINTO_1_SALIDA", "NUM_SELLO_S1"],
  "PRECINTO_2_SALIDA": ["PRECINTO_2_SALIDA", "NUM_SELLO_S2"],
  "FOTO_SELLO_1": ["FOTO_SELLO_1", "FOTO_SELLO_E1"],
  "FOTO_SELLO_2": ["FOTO_SELLO_2", "FOTO_SELLO_E2"],
  "FOTO_SELLO_3": ["FOTO_SELLO_3", "FOTO_SELLO_S1"],
  "FOTO_SELLO_4": ["FOTO_SELLO_4", "FOTO_SELLO_S2"]
};

function tdcNorm_(h) { return String(h).trim().toUpperCase().replace(/\s+/g, "_"); }

function tdcFilas_(sheet, prefijo, estructura) {
  const data = tdcReintento_(() => sheet.getDataRange().getValues());
  if (data.length <= 1) return [];
  const headers = data[0].map(tdcNorm_);
  const idx = estructura.map(col => {
    const nombres = (TDC_ALIAS[tdcNorm_(col)] || [tdcNorm_(col)]);
    for (const n of nombres) { const i = headers.indexOf(n); if (i !== -1) return i; }
    return -1;
  });
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const fila = data[i];
    if (fila[0] !== "" || fila[1] !== "") {
      const nueva = [prefijo];
      for (let c = 0; c < idx.length; c++) nueva.push(idx[c] !== -1 ? fila[idx[c]] : "");
      out.push(nueva);
    }
  }
  return out;
}

// Clave para no duplicar: cliente|d/m/aaaa|ticket|litros (vacía si no hay ticket)
function tdcClave_(estructura, f) {
  const iF = estructura.indexOf("FECHA") + 1, iT = estructura.indexOf("TICKET") + 1, iC = estructura.indexOf("CANTIDAD") + 1;
  const ticket = iT > 0 ? String(f[iT]).trim() : "";
  if (!ticket) return "";
  let fecha = iF > 0 ? f[iF] : "";
  if (fecha instanceof Date) fecha = fecha.getDate() + "/" + (fecha.getMonth() + 1) + "/" + fecha.getFullYear();
  else { const m = String(fecha).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); fecha = m ? (+m[1]) + "/" + (+m[2]) + "/" + m[3] : String(fecha); }
  const lit = iC > 0 ? Number(String(f[iC]).replace(",", ".")) : "";
  return f[0] + "|" + fecha + "|" + ticket + "|" + (isNaN(lit) ? "" : Math.round(lit * 10) / 10);
}

function tdcAbrir_(id) { return tdcReintento_(() => SpreadsheetApp.openById(id)); }

// Reintenta errores transitorios de Google (INTERNAL, server error, Service Spreadsheets failed)
function tdcReintento_(fn) {
  let ult;
  for (let i = 0; i < 3; i++) {
    try { return fn(); } catch (e) { ult = e; Utilities.sleep(1500 * Math.pow(2, i)); }
  }
  throw ult;
}
