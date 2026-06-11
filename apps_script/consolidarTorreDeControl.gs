/**
 * ═══════════════════════════════════════════════════════════════
 *  consolidarTorreDeControl — v2 POR LOTES (anti-timeout)
 * ═══════════════════════════════════════════════════════════════
 *  Problema que corrige (correos de Apps Script 10-11/jun/2026):
 *    1) "Exceeded maximum execution time"
 *       La versión anterior consolidaba los 26 clientes en una sola
 *       ejecución y Google corta los triggers a los ~6 minutos.
 *    2) "Service Spreadsheets failed while accessing document with
 *        id 1xLF7C5A6p7dxlXDx7EiuQiR1MtEnwGeWRargX0tL5qE" (THD GIO)
 *       Error transitorio de la API de Sheets al abrir un documento
 *       grande. La versión anterior no reintentaba y abortaba todo.
 *
 *  Cómo funciona esta versión:
 *    • LockService        → evita dos ejecuciones simultáneas.
 *    • PropertiesService  → guarda cursor de cliente + última fila
 *                           consolidada por cliente (incremental).
 *    • Presupuesto 4.5min → sale limpio antes de que Google corte y
 *                           el siguiente trigger continúa donde quedó.
 *    • Reintentos con backoff (3x) para errores transitorios de
 *                           "Service Spreadsheets failed".
 *    • Incremental        → solo lee filas NUEVAS de cada cliente,
 *                           no todo el histórico en cada corrida.
 *
 *  INSTALACIÓN (5 minutos):
 *    1) Abre la hoja de la Torre de Control → Extensiones → Apps Script
 *       (es el proyecto "Proyecto sin título" que manda los correos
 *        de fallo; también lo encuentras en script.google.com →
 *        busca la ejecución fallida de consolidarTorreDeControl).
 *    2) Respalda la función vieja: coméntala o renómbrala a
 *       consolidarTorreDeControl_OLD(). NO la borres todavía.
 *    3) Pega TODO este archivo.
 *    4) Revisa TDC_CFG abajo:
 *         - torreTab: nombre EXACTO de la pestaña consolidada.
 *         - Si la unidad de trabajo vieja era distinta (no copiar
 *           filas sino calcular resúmenes), pega esa lógica dentro
 *           de consolidarTorreDeControlCliente_ y listo: el motor
 *           de lotes/lock/cursor sigue funcionando igual.
 *    5) Ejecuta una vez manualmente consolidarTorreDeControl desde
 *       el editor para autorizar y validar.
 *    6) El trigger de tiempo existente NO se toca: puede quedarse
 *       cada hora; cada corrida avanza el cursor y termina el ciclo
 *       en 1..N corridas según el tamaño.
 *
 *  NO HACER (reglas del diagnóstico previo):
 *    - No borrar triggers sin revisar cuál alimenta el histórico.
 *    - No mover columnas ni renombrar pestañas como parte del fix.
 *    - No tocar los vales impresos de Don Harina.
 * ═══════════════════════════════════════════════════════════════
 */

var TDC_CFG = {
  // ID del spreadsheet de la Torre de Control. Vacío = el spreadsheet
  // contenedor de este script (script vinculado).
  torreSheetId: '',

  // Pestaña destino del consolidado. ⚠ AJUSTA al nombre real.
  torreTab: 'TORRE_DE_CONTROL',

  // Pestaña fuente en cada sheet de cliente (igual que en index.html).
  hojaCliente: 'Despachos_SGM_APP',

  // Presupuesto de tiempo por ejecución: 4.5 min (Google corta a ~6).
  maxMs: 270000,

  // Reintentos ante "Service Spreadsheets failed" (error transitorio).
  maxReintentos: 3,

  // Claves de estado en PropertiesService.
  cursorKey: 'SGM_TDC_CURSOR_V2',   // índice del cliente en proceso
  filasKey:  'SGM_TDC_FILAS_V2',    // JSON {prefix: últimaFilaLeída}

  // Mapa cliente → spreadsheet (espejo de CLIENTE_SHEETS de index.html).
  clientes: {
    "TGIO":       { sheetId: "1xLF7C5A6p7dxlXDx7EiuQiR1MtEnwGeWRargX0tL5qE" },
    "TALF":       { sheetId: "1gvG1BLhADJsfh1HiSrzoLGrOqcOgS-MEnLOn6NPpHb0" },
    "GAJ":        { sheetId: "1yGDhpQtC_jIH7DbQQZd-oxwsGcS3q6hLM0OJ3lQjYQs" },
    "DEH":        { sheetId: "1N5nIQd3zJDh-_tJidXBjD7VHJSv_7W0FhzF9WimhsOs" },
    "DHAR":       { sheetId: "1tbtLrtW4m_uGvt7niyU6RtBzAS5vl8yYBB2mNj-YlVw" },
    "RECA":       { sheetId: "1x1wxGCjtH7h1mFZBYZH3YC09lUrahE4W6YgwGeQKzMs" },
    "MAC":        { sheetId: "1EblV9OeZNbv8JV72C2Ebahe9PsPsJCDy7-QU-FzCdqc" },
    "ATZ":        { sheetId: "110sk87iQtj340XoCRM4kvJOjKPSmRdyhODxJquZkc7A" },
    "SERI":       { sheetId: "1lyiW86RfNeJhj2cl_3v6z1aeFdTu6u8IrlWgpbnm1y4" },
    "DEL":        { sheetId: "1J6JmQfbqptBIMxO-hgMNSRFH04vyGkrHaqr6VQ7d-34" },
    "ECOM":       { sheetId: "19Cfn1CKmcqycV1gmByEQCeHSzE9zzn727B4uFoIhgAk" },
    "LMAN":       { sheetId: "1p7SIxuTew9zvxsidhLNxKs3TGoPh4cCGMxtMAk1XLXQ" },
    "LTOL":       { sheetId: "1GtblBP16gAau_rabpTJJ-hWz0c_eKG0rL5aMEmtSlHA" },
    "PANF":       { sheetId: "1seX3vC7cMd9VGCZxhMeBS8MIlrE97l5VnNG4Zg-zBy4" },
    "CEMI":       { sheetId: "1inNYu9wgaHla2rGa2dt0VG-YNtumx0M7WVYgiMRNBWw" },
    "PORTUR":     { sheetId: "139uURtkXpEpiZQTD4ER6VfsWs6mw4nPFKc3Wxb6ly74" },
    "TECNO":      { sheetId: "15X4vSljJxS9l3srhsCht4vNUPsPXMbhooPHa6v9InCo" },
    "PUROSON":    { sheetId: "1dc67vnTRdBxjx6hnC6k0u6_58HqHU9A0iSpQV98wPXg" },
    "AST":        { sheetId: "1avOiXQLECGG6ruy_YTAzngYvht7YZkAwzXsuNPq9NTM" },
    "GZAR":       { sheetId: "1-130dHpLzOe1ZXU9FtOlJ8D-XmR-A1ph-LkZaVTaIzE" },
    "GRUV":       { sheetId: "1pKBVQicx7vsc40r0D9CF48jk2DJ9QQcDyBe1jfMNHXU" },
    "ISM":        { sheetId: "1UtgLrMwPvqMip3wTJ-n_6uOBXwhsIdvft5YfoAVJhSo" },
    "ISA":        { sheetId: "174YYRnjF118YJtQvUoGCbAy3G2TDk0VfrQv_LsFo7O0" },
    "ROG":        { sheetId: "1wK8cYumTqCvsYD4-esHwJbLoHxKjnNSO0GdtMxpyEQc" },
    "VENETIAMOT": { sheetId: "1kmSyj5MJHQTcMKbvO0epfKBvYCZB_PuHjiPyY9l6Vbg" },
    "TOLUT":      { sheetId: "101Oe1Ud9rzGWIPNoc8b_xIcbR4be4WeqOqjzDyNVlHE" }
  }
};

// ═════════════════════════════════════════════════════════════
//  ENTRY POINT — apunta aquí el trigger de tiempo existente
// ═════════════════════════════════════════════════════════════

function consolidarTorreDeControl() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    Logger.log('TDC: otra ejecución sigue activa, salgo sin hacer nada.');
    return;
  }

  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var prefijos = Object.keys(TDC_CFG.clientes);
  var cursor = Number(props.getProperty(TDC_CFG.cursorKey) || 0);
  if (cursor >= prefijos.length) cursor = 0;   // ciclo nuevo

  var procesados = 0, filasNuevas = 0, errores = [];

  try {
    while (cursor < prefijos.length && (Date.now() - started) < TDC_CFG.maxMs) {
      var prefix = prefijos[cursor];
      try {
        filasNuevas += consolidarTorreDeControlCliente_(prefix);
        procesados++;
      } catch (err) {
        // Un cliente con error no debe tumbar el ciclo completo.
        errores.push(prefix + ': ' + (err && err.message || err));
        Logger.log('TDC ERROR ' + prefix + ': ' + (err && err.message || err));
      }
      cursor++;
      props.setProperty(TDC_CFG.cursorKey, String(cursor));
    }

    if (cursor >= prefijos.length) {
      props.deleteProperty(TDC_CFG.cursorKey);
      Logger.log('TDC: CICLO COMPLETO. clientes=' + procesados +
                 ' filasNuevas=' + filasNuevas +
                 (errores.length ? ' errores=' + errores.join(' | ') : ''));
    } else {
      Logger.log('TDC: pausa segura por tiempo. cursor=' + cursor + '/' +
                 prefijos.length + ' clientes=' + procesados +
                 ' filasNuevas=' + filasNuevas +
                 '. El siguiente trigger continúa aquí.');
    }
  } finally {
    lock.releaseLock();
  }
}

// ═════════════════════════════════════════════════════════════
//  UNIDAD DE TRABAJO POR CLIENTE (incremental)
//  Si tu lógica vieja hacía algo distinto a copiar filas, pega esa
//  lógica aquí adentro y conserva el motor de lotes de arriba.
// ═════════════════════════════════════════════════════════════

function consolidarTorreDeControlCliente_(prefix) {
  var cfg = TDC_CFG.clientes[prefix];
  if (!cfg || !cfg.sheetId) return 0;

  var props = PropertiesService.getScriptProperties();
  var filasIdx = JSON.parse(props.getProperty(TDC_CFG.filasKey) || '{}');
  var ultimaLeida = Number(filasIdx[prefix] || 1);   // 1 = solo header

  var ssCliente = tdcAbrirConReintento_(cfg.sheetId);
  var hoja = ssCliente.getSheetByName(cfg.hoja || TDC_CFG.hojaCliente);
  if (!hoja) {
    Logger.log('TDC ' + prefix + ': no existe pestaña ' +
               (cfg.hoja || TDC_CFG.hojaCliente) + ', omitido.');
    return 0;
  }

  var lastRow = hoja.getLastRow();
  var lastCol = hoja.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return 0;       // vacío
  if (ultimaLeida >= lastRow) return 0;              // sin filas nuevas

  var headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0];
  var nuevas = hoja.getRange(ultimaLeida + 1, 1,
                             lastRow - ultimaLeida, lastCol).getValues();

  var torre = tdcHojaTorre_();
  var escritas = tdcAppendPorHeader_(torre, headers, nuevas, prefix);

  filasIdx[prefix] = lastRow;
  props.setProperty(TDC_CFG.filasKey, JSON.stringify(filasIdx));
  return escritas;
}

// Apertura con reintentos: cubre el error transitorio
// "Service Spreadsheets failed while accessing document with id ..."
function tdcAbrirConReintento_(sheetId) {
  var ultimoError;
  for (var i = 0; i < TDC_CFG.maxReintentos; i++) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (err) {
      ultimoError = err;
      Utilities.sleep(2000 * Math.pow(2, i));   // 2s, 4s, 8s
    }
  }
  throw ultimoError;
}

function tdcHojaTorre_() {
  var ss = TDC_CFG.torreSheetId
    ? tdcAbrirConReintento_(TDC_CFG.torreSheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TDC_CFG.torreTab);
  if (!sheet) {
    throw new Error('Pestaña destino no encontrada: "' + TDC_CFG.torreTab +
                    '". Ajusta TDC_CFG.torreTab al nombre real.');
  }
  return sheet;
}

// Escribe filas mapeando por NOMBRE de header (case/espacios-insensible),
// igual que el backend v4: los campos sin columna destino se ignoran.
function tdcAppendPorHeader_(torre, headersOrigen, filas, prefix) {
  var lastCol = torre.getLastColumn();
  if (lastCol === 0) {
    torre.getRange(1, 1, 1, headersOrigen.length).setValues([headersOrigen]);
    lastCol = headersOrigen.length;
  }
  var headersTorre = torre.getRange(1, 1, 1, lastCol).getValues()[0];

  var norm = function (k) {
    return String(k || '').toLowerCase().replace(/[\s_\-]/g, '');
  };
  var idxOrigen = {};
  headersOrigen.forEach(function (h, i) { idxOrigen[norm(h)] = i; });

  var out = filas.map(function (fila) {
    return headersTorre.map(function (h) {
      var nh = norm(h);
      if (nh === 'prefix' || nh === 'prefijo') {
        var i = idxOrigen[nh];
        var v = (i !== undefined) ? fila[i] : '';
        return v || prefix;
      }
      var ix = idxOrigen[nh];
      return (ix !== undefined) ? fila[ix] : '';
    });
  });

  if (!out.length) return 0;
  torre.getRange(torre.getLastRow() + 1, 1, out.length, headersTorre.length)
       .setValues(out);
  return out.length;
}

// ═════════════════════════════════════════════════════════════
//  UTILIDADES MANUALES
// ═════════════════════════════════════════════════════════════

// Borra cursores y vuelve a empezar el ciclo desde cero.
// ⚠ NO borra datos de la Torre; solo el estado de avance. Si la Torre
// ya tiene filas y reinicias, se pueden duplicar: úsalo solo tras
// limpiar la pestaña destino o en la primera instalación.
function tdcReset() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(TDC_CFG.cursorKey);
  props.deleteProperty(TDC_CFG.filasKey);
  Logger.log('TDC: estado reiniciado.');
}

// Marca todo el histórico actual como "ya consolidado" sin copiarlo.
// Útil en la primera instalación si la Torre YA contiene el histórico:
// a partir de aquí solo se consolidará lo nuevo.
function tdcMarcarHistoricoComoConsolidado() {
  var props = PropertiesService.getScriptProperties();
  var filasIdx = {};
  Object.keys(TDC_CFG.clientes).forEach(function (prefix) {
    try {
      var cfg = TDC_CFG.clientes[prefix];
      var hoja = tdcAbrirConReintento_(cfg.sheetId)
        .getSheetByName(cfg.hoja || TDC_CFG.hojaCliente);
      filasIdx[prefix] = hoja ? hoja.getLastRow() : 1;
    } catch (e) {
      filasIdx[prefix] = 1;
    }
  });
  props.setProperty(TDC_CFG.filasKey, JSON.stringify(filasIdx));
  props.deleteProperty(TDC_CFG.cursorKey);
  Logger.log('TDC: histórico marcado como consolidado: ' +
             JSON.stringify(filasIdx));
}

// Muestra el estado actual del avance en el log.
function tdcEstado() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('cursor=' + (props.getProperty(TDC_CFG.cursorKey) || '(ciclo completo)'));
  Logger.log('filas=' + (props.getProperty(TDC_CFG.filasKey) || '{}'));
}
