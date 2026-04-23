/**
 * SGM Flotillas — Apps Script backend unificado
 * F2a (2026-04-23): + handlers de Catálogo de Unidades; quitado claudeProxy
 *                     y CLAUDE_API_KEY (IA ya corre por Netlify function).
 */

// ═══════════════════════════════════════════════════════════
// CONFIG GENERAL
// ═══════════════════════════════════════════════════════════
var VERSION = 'SGM_BACKEND_APP_TAB_v2_2026_04_23';
var WRITE_TAB_NAME = 'Despachos_SGM_APP';
var LEGACY_READ_TABS = ['Despachos_SGM_APP', 'Despachos_SGM', 'Sheet1', 'Hoja 1', 'Hoja1'];

var DRIVE_FOLDER_NAME = 'SGM_Despachos';
var SALDOS_PROP_KEY = 'SGM_SALDOS_V1';
var CATALOGO_PROP_KEY = 'SGM_CATALOGO_V1';

var BITACORA_SHEET_ID = '';
var BITACORA_TAB_NAME = 'BITACORA';

// ═══════════════════════════════════════════════════════════
// CLIENTES / SPREADSHEETS
// ═══════════════════════════════════════════════════════════
var CLIENTE_NAMES = {
  "TGIO":"THD GIO","TALF":"THD ALFREDO COLIN","GAJ":"GAJU",
  "DEH":"TRANSPORTES DEHUI SA DE CV","DHAR":"DON HARINA / WAWITA",
  "PANF":"PLÁSTICOS INDUSTRIALES (PANFILO MENDEZ)","RECA":"RECA COMUNICACIONES",
  "MAC":"MACERE","AST":"ASTURVENT","ATZ":"ATZUZI",
  "GZAR":"G PUNTO Z ARQUITECTOS","SERI":"GRUPO SERICAL SA DE CV",
  "GRUV":"GRUVIMEX","DEL":"DELTEX","ECOM":"ECOM",
  "ISM":"GRUTACOS / ISMAEL CONTRERAS COLIN","AMSC":"AMSC CONSTRURAMA",
  "ISA":"ISA ALIMENTOS","ROG":"LOGÍSTICA ROGO SA DE CV",
  "LMAN":"LAVANDERÍA LOS MANANTIALES SA DE CV","LTOL":"LÁMINAS TOLUCA",
  "CEMI":"CEMI AUTOMATION SA DE CV","PORTUR":"PORTUR",
  "TECNO":"TECNO ILUMINACIÓN OH SA DE CV","PUROSON":"PURO SONORA (JANB)",
  "VENETIAMOT":"MOTEL VENETIA OPERADORA HOTELERA BECSA","TOLUT":"TOLUTEL SA DE CV"
};

var CLIENTE_SHEETS = {
  "TGIO":      {sheetId:"1xLF7C5A6p7dxlXDx7EiuQiR1MtEnwGeWRargX0tL5qE",hoja:WRITE_TAB_NAME},
  "TALF":      {sheetId:"1gvG1BLhADJsfh1HiSrzoLGrOqcOgS-MEnLOn6NPpHb0",hoja:WRITE_TAB_NAME},
  "GAJ":       {sheetId:"1yGDhpQtC_jIH7DbQQZd-oxwsGcS3q6hLM0OJ3lQjYQs",hoja:WRITE_TAB_NAME},
  "DEH":       {sheetId:"1N5nIQd3zJDh-_tJidXBjD7VHJSv_7W0FhzF9WimhsOs",hoja:WRITE_TAB_NAME},
  "DHAR":      {sheetId:"1tbtLrtW4m_uGvt7niyU6RtBzAS5vl8yYBB2mNj-YlVw",hoja:WRITE_TAB_NAME},
  "RECA":      {sheetId:"1x1wxGCjtH7h1mFZBYZH3YC09lUrahE4W6YgwGeQKzMs",hoja:WRITE_TAB_NAME},
  "MAC":       {sheetId:"1EblV9OeZNbv8JV72C2Ebahe9PsPsJCDy7-QU-FzCdqc",hoja:WRITE_TAB_NAME},
  "AST":       {sheetId:"1avOiXQLECGG6ruy_YTAzngYvht7YZkAwzXsuNPq9NTM",hoja:WRITE_TAB_NAME},
  "ATZ":       {sheetId:"110sk87iQtj340XoCRM4kvJOjKPSmRdyhODxJquZkc7A", hoja:WRITE_TAB_NAME},
  "GZAR":      {sheetId:"1-130dHpLzOe1ZXU9FtOlJ8D-XmR-A1ph-LkZaVTaIzE",hoja:WRITE_TAB_NAME},
  "SERI":      {sheetId:"1lyiW86RfNeJhj2cl_3v6z1aeFdTu6u8IrlWgpbnm1y4",hoja:WRITE_TAB_NAME},
  "GRUV":      {sheetId:"1pKBVQicx7vsc40r0D9CF48jk2DJ9QQcDyBe1jfMNHXU",hoja:WRITE_TAB_NAME},
  "DEL":       {sheetId:"1J6JmQfbqptBIMxO-hgMNSRFH04vyGkrHaqr6VQ7d-34", hoja:WRITE_TAB_NAME},
  "ECOM":      {sheetId:"19Cfn1CKmcqycV1gmByEQCeHSzE9zzn727B4uFoIhgAk",hoja:WRITE_TAB_NAME},
  "ISM":       {sheetId:"1UtgLrMwPvqMip3wTJ-n_6uOBXwhsIdvft5YfoAVJhSo",hoja:WRITE_TAB_NAME},
  "AMSC":      {sheetId:"1mrc-VBY1_kKLUcK3A052kRuVzikVGJMcN9PW72Omfbc", hoja:WRITE_TAB_NAME},
  "ISA":       {sheetId:"174YYRnjF118YJtQvUoGCbAy3G2TDk0VfrQv_LsFo7O0",hoja:WRITE_TAB_NAME},
  "ROG":       {sheetId:"1wK8cYumTqCvsYD4-esHwJbLoHxKjnNSO0GdtMxpyEQc",hoja:WRITE_TAB_NAME},
  "LMAN":      {sheetId:"1p7SIxuTew9zvxsidhLNxKs3TGoPh4cCGMxtMAk1XLXQ",hoja:WRITE_TAB_NAME},
  "LTOL":      {sheetId:"1GtblBP16gAau_rabpTJJ-hWz0c_eKG0rL5aMEmtSlHA", hoja:WRITE_TAB_NAME},
  "PANF":      {sheetId:"1seX3vC7cMd9VGCZxhMeBS8MIlrE97l5VnNG4Zg-zBy4",hoja:WRITE_TAB_NAME},
  "CEMI":      {sheetId:"1inNYu9wgaHla2rGa2dt0VG-YNtumx0M7WVYgiMRNBWw",hoja:WRITE_TAB_NAME},
  "PORTUR":    {sheetId:"139uURtkXpEpiZQTD4ER6VfsWs6mw4nPFKc3Wxb6ly74", hoja:WRITE_TAB_NAME},
  "TECNO":     {sheetId:"15X4vSljJxS9l3srhsCht4vNUPsPXMbhooPHa6v9InCo", hoja:WRITE_TAB_NAME},
  "PUROSON":   {sheetId:"1dc67vnTRdBxjx6hnC6k0u6_58HqHU9A0iSpQV98wPXg",hoja:WRITE_TAB_NAME},
  "VENETIAMOT":{sheetId:"1kmSyj5MJHQTcMKbvO0epfKBvYCZB_PuHjiPyY9l6Vbg",hoja:WRITE_TAB_NAME},
  "TOLUT":     {sheetId:"101Oe1Ud9rzGWIPNoc8b_xIcbR4be4WeqOqjzDyNVlHE", hoja:WRITE_TAB_NAME}
};

// ═══════════════════════════════════════════════════════════
// HEADERS MAESTROS
// ═══════════════════════════════════════════════════════════
var REQUIRED_HEADERS = [
  'FECHA','HORA','CLIENTE','PREFIX','FOLIO_VALE','CODIGO_AUTZ',
  'TIPO_DOCUMENTO','TICKET_EGAS','CHOFER','PLACAS','PRODUCTO',
  'CANTIDAD','MONTO','PRECIO_UNIT','ODOMETRO','AGENTE','ISLA',
  'ID_REGISTRO','ORIGEN','TIMESTAMP_MS','FOTO_PLACA','FOTO_TICKET',
  'FIRMA_CHOFER','FOTO_SELLO_E1','NUM_SELLO_E1','FOTO_SELLO_E2',
  'NUM_SELLO_E2','FOTO_SELLO_S1','NUM_SELLO_S1','FOTO_SELLO_S2','NUM_SELLO_S2'
];

// ═══════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : '';
  if (action === 'getSaldos')   return jsonResponse_(loadSaldos_());
  if (action === 'getCatalogo') return jsonResponse_(loadCatalogo_());
  if (action === 'diag') return jsonResponse_({
    ok: true, version: VERSION, writeTab: WRITE_TAB_NAME,
    clientesConfigurados: Object.keys(CLIENTE_SHEETS).length
  });
  return jsonResponse_({ ok: true, service: 'SGM Flotillas Backend', version: VERSION });
}

function doPost(e) {
  var body = parseBody_(e);
  var action = String(body.action || '');
  try {
    if (action === 'append')             return jsonResponse_(guardarDespacho_(body.row || body.data || body));
    if (action === 'uploadPhoto')        return jsonResponse_(subirFotoDrive_(body));
    if (action === 'saveSaldos')         return jsonResponse_(saveSaldos_(body.saldos || {}));
    if (action === 'getSaldos')          return jsonResponse_(loadSaldos_());
    if (action === 'getCatalogo')        return jsonResponse_(loadCatalogo_());
    if (action === 'saveCatalogoItem')   return jsonResponse_(saveCatalogoItem_(body.item || {}));
    if (action === 'deleteCatalogoItem') return jsonResponse_(deleteCatalogoItem_(body.id || ''));
    if (action === 'saveCatalogoBulk')   return jsonResponse_(saveCatalogoBulk_(body.items || []));
    return jsonResponse_({ ok: false, error: 'Acción no reconocida: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

// ═══════════════════════════════════════════════════════════
// DESPACHO
// ═══════════════════════════════════════════════════════════
function guardarDespacho_(rawRecord) {
  if (!rawRecord) return { ok: false, error: 'Sin datos de despacho' };
  var record = prepareRecord_(rawRecord);
  var prefix = record.PREFIX;
  if (!prefix) return { ok: false, error: 'Falta PREFIX / cliente' };
  var cfg = CLIENTE_SHEETS[prefix];
  if (!cfg || !cfg.sheetId) return { ok: false, error: 'Cliente sin spreadsheet: ' + prefix };
  var ss = SpreadsheetApp.openById(cfg.sheetId);
  var sheet = getOrCreateWriteSheet_(ss);
  if (isDuplicateById_(sheet, record.ID_REGISTRO)) {
    return { ok: true, duplicated: true, prefix: prefix, id: record.ID_REGISTRO };
  }
  ensureHeaders_(sheet, REQUIRED_HEADERS);
  appendRowByHeader_(sheet, record);
  var central = { ok: false, skipped: true };
  if (BITACORA_SHEET_ID) {
    try {
      var ssCentral = SpreadsheetApp.openById(BITACORA_SHEET_ID);
      var shCentral = getOrCreateSheetByName_(ssCentral, BITACORA_TAB_NAME);
      ensureHeaders_(shCentral, REQUIRED_HEADERS);
      if (!isDuplicateById_(shCentral, record.ID_REGISTRO)) appendRowByHeader_(shCentral, record);
      central = { ok: true };
    } catch (e2) { central = { ok: false, error: String(e2 && e2.message || e2) }; }
  }
  return { ok: true, prefix: prefix, id: record.ID_REGISTRO, tab: WRITE_TAB_NAME, central: central };
}

function prepareRecord_(raw) {
  var tz = Session.getScriptTimeZone() || 'America/Mexico_City';
  var nowTs = Date.now();
  var ts = toNumber_(pick_(raw, ['TIMESTAMP_MS','timestamp_ms','timestamp','ts']), nowTs);
  var d = new Date(ts);
  var fechaDefault = Utilities.formatDate(d, tz, 'dd/MM/yyyy');
  var horaDefault  = Utilities.formatDate(d, tz, 'HH:mm:ss');
  var prefix = toUpper_(pick_(raw, ['PREFIX','prefix']));
  var cliente = pick_(raw, ['CLIENTE','cliente'], CLIENTE_NAMES[prefix] || prefix || '');
  var folioVale   = pick_(raw, ['FOLIO_VALE','folio_vale','folioVale','folio'], '');
  var codigoAutz  = pick_(raw, ['CODIGO_AUTZ','codigo_autz','codigoAutz','codigo'], '');
  var ticketEgas  = pick_(raw, ['TICKET_EGAS','ticket_egas','ticketEgas','ticket'], '');
  var cantidad    = toNumber_(pick_(raw, ['CANTIDAD','cantidad','litros']), 0);
  var monto       = toNumber_(pick_(raw, ['MONTO','monto','importe','total']), 0);
  var precioUnit  = toNumber_(pick_(raw, ['PRECIO_UNIT','precio_unit','precioUnit','precio_litro']), 0);
  if (!precioUnit && cantidad > 0 && monto > 0) precioUnit = round2_(monto / cantidad);
  var tipoDocumento = pick_(raw, ['TIPO_DOCUMENTO','tipo_documento','tipoDocumento'], '');
  if (!tipoDocumento) {
    if (codigoAutz) tipoDocumento = 'AUTZ';
    else if (folioVale) tipoDocumento = /^DIRECTO/i.test(String(folioVale)) ? 'DIRECTO' : 'VALE';
    else tipoDocumento = 'DIRECTO';
  }
  var idRegistro = pick_(raw, ['ID_REGISTRO','id_registro','idRegistro','id'], '');
  if (!idRegistro) idRegistro = buildRecordId_(prefix, ts);
  return {
    FECHA: pick_(raw, ['FECHA','fecha'], fechaDefault),
    HORA: pick_(raw, ['HORA','hora'], horaDefault),
    CLIENTE: cliente, PREFIX: prefix,
    FOLIO_VALE: folioVale, CODIGO_AUTZ: codigoAutz,
    TIPO_DOCUMENTO: tipoDocumento, TICKET_EGAS: ticketEgas,
    CHOFER: pick_(raw, ['CHOFER','chofer','conductor','operador'], ''),
    PLACAS: toUpper_(pick_(raw, ['PLACAS','placas','unidad','vehiculo'], '')),
    PRODUCTO: toUpper_(pick_(raw, ['PRODUCTO','producto','combustible'], '')),
    CANTIDAD: cantidad, MONTO: monto, PRECIO_UNIT: precioUnit,
    ODOMETRO: toNumber_(pick_(raw, ['ODOMETRO','odometro','km','kilometraje']), ''),
    AGENTE: toUpper_(pick_(raw, ['AGENTE','agente','despachador'], '')),
    ISLA: pick_(raw, ['ISLA','isla','islaNum','numero_isla'], ''),
    ID_REGISTRO: idRegistro,
    ORIGEN: pick_(raw, ['ORIGEN','origen'], 'APP'),
    TIMESTAMP_MS: ts,
    FOTO_PLACA:    pick_(raw, ['FOTO_PLACA','foto_placa','fotoPlaca'], ''),
    FOTO_TICKET:   pick_(raw, ['FOTO_TICKET','foto_ticket','fotoTicket'], ''),
    FIRMA_CHOFER:  pick_(raw, ['FIRMA_CHOFER','firma_chofer','firma','firmaChofer'], ''),
    FOTO_SELLO_E1: pick_(raw, ['FOTO_SELLO_E1','foto_sello_e1'], ''),
    NUM_SELLO_E1:  pick_(raw, ['NUM_SELLO_E1','num_sello_e1'], ''),
    FOTO_SELLO_E2: pick_(raw, ['FOTO_SELLO_E2','foto_sello_e2'], ''),
    NUM_SELLO_E2:  pick_(raw, ['NUM_SELLO_E2','num_sello_e2'], ''),
    FOTO_SELLO_S1: pick_(raw, ['FOTO_SELLO_S1','foto_sello_s1'], ''),
    NUM_SELLO_S1:  pick_(raw, ['NUM_SELLO_S1','num_sello_s1'], ''),
    FOTO_SELLO_S2: pick_(raw, ['FOTO_SELLO_S2','foto_sello_s2'], ''),
    NUM_SELLO_S2:  pick_(raw, ['NUM_SELLO_S2','num_sello_s2'], '')
  };
}

// ═══════════════════════════════════════════════════════════
// FOTOS A DRIVE
// ═══════════════════════════════════════════════════════════
function subirFotoDrive_(body) {
  var base64 = String(body.base64 || '');
  var filename = String(body.filename || ('foto_' + Date.now() + '.jpg'));
  var mimeType = String(body.mimeType || 'image/jpeg');
  var folderName = String(body.folder || DRIVE_FOLDER_NAME);
  if (!base64) return { ok: false, error: 'No se recibió base64' };
  var raw = base64.indexOf(',') >= 0 ? base64.split(',')[1] : base64;
  var bytes = Utilities.base64Decode(raw);
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var folder = getOrCreateDriveFolder_(folderName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  return { ok: true, fileId: fileId, url: 'https://drive.google.com/uc?export=view&id=' + fileId, name: filename };
}

function getOrCreateDriveFolder_(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

// ═══════════════════════════════════════════════════════════
// SALDOS
// ═══════════════════════════════════════════════════════════
function saveSaldos_(saldos) {
  PropertiesService.getScriptProperties().setProperty(SALDOS_PROP_KEY, JSON.stringify(saldos || {}));
  return { ok: true, total: Object.keys(saldos || {}).length };
}

function loadSaldos_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SALDOS_PROP_KEY);
  try { return { ok: true, saldos: raw ? JSON.parse(raw) : {} }; }
  catch (err) { return { ok: false, saldos: {}, error: String(err && err.message || err) }; }
}

// ═══════════════════════════════════════════════════════════
// CATÁLOGO DE UNIDADES (F2a)
// ═══════════════════════════════════════════════════════════
function loadCatalogo_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CATALOGO_PROP_KEY);
  try { return { ok: true, items: raw ? JSON.parse(raw) : [] }; }
  catch (err) { return { ok: false, items: [], error: String(err && err.message || err) }; }
}

function saveCatalogoItem_(item) {
  if (!item || !item.id || !item.placas || !item.prefix) {
    return { ok: false, error: 'Falta id, placas o prefix' };
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var current = (loadCatalogo_().items) || [];
    var now = Date.now();
    var idx = -1;
    for (var i = 0; i < current.length; i++) {
      if (current[i].id === item.id) { idx = i; break; }
    }
    item.updatedAt = now;
    if (idx >= 0) {
      current[idx] = Object.assign({}, current[idx], item);
    } else {
      item.createdAt = item.createdAt || now;
      current.push(item);
    }
    PropertiesService.getScriptProperties().setProperty(CATALOGO_PROP_KEY, JSON.stringify(current));
    var stored = idx >= 0 ? current[idx] : current[current.length - 1];
    return { ok: true, total: current.length, item: stored };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function deleteCatalogoItem_(id) {
  if (!id) return { ok: false, error: 'Falta id' };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var current = (loadCatalogo_().items) || [];
    var filtered = current.filter(function(it) { return it.id !== id; });
    PropertiesService.getScriptProperties().setProperty(CATALOGO_PROP_KEY, JSON.stringify(filtered));
    return { ok: true, removed: current.length - filtered.length, total: filtered.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function saveCatalogoBulk_(items) {
  if (!Array.isArray(items)) return { ok: false, error: 'items debe ser array' };
  PropertiesService.getScriptProperties().setProperty(CATALOGO_PROP_KEY, JSON.stringify(items));
  return { ok: true, total: items.length };
}

// ═══════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════
function bootstrapAllSheets() {
  var results = [];
  Object.keys(CLIENTE_SHEETS).forEach(function(prefix) {
    var cfg = CLIENTE_SHEETS[prefix];
    if (!cfg || !cfg.sheetId) { results.push({ prefix: prefix, action: 'omitido', reason: 'sin sheetId' }); return; }
    try {
      var ss = SpreadsheetApp.openById(cfg.sheetId);
      var sheet = ss.getSheetByName(WRITE_TAB_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(WRITE_TAB_NAME);
        sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
        results.push({ prefix: prefix, action: 'creada', tab: WRITE_TAB_NAME });
      } else {
        var changed = ensureHeaders_(sheet, REQUIRED_HEADERS);
        results.push({ prefix: prefix, action: changed ? 'actualizada' : 'sin cambios', tab: WRITE_TAB_NAME });
      }
    } catch (err) {
      results.push({ prefix: prefix, action: 'error', error: String(err && err.message || err) });
    }
  });
  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

// ═══════════════════════════════════════════════════════════
// HELPERS DE SHEETS
// ═══════════════════════════════════════════════════════════
function getOrCreateWriteSheet_(ss) {
  var sheet = ss.getSheetByName(WRITE_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(WRITE_TAB_NAME);
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
  } else {
    ensureHeaders_(sheet, REQUIRED_HEADERS);
  }
  return sheet;
}

function getOrCreateSheetByName_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureHeaders_(sheet, requiredHeaders) {
  var changed = false;
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return true;
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var existingNorm = {};
  headers.forEach(function(h, idx) { existingNorm[normalizeKey_(h)] = idx + 1; });
  requiredHeaders.forEach(function(header) {
    var n = normalizeKey_(header);
    if (!existingNorm[n]) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(header);
      existingNorm[n] = lastCol;
      changed = true;
    }
  });
  return changed;
}

function appendRowByHeader_(sheet, rowObj) {
  ensureHeaders_(sheet, REQUIRED_HEADERS);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowIdx = buildRowIndex_(rowObj);
  var values = headers.map(function(header) {
    var normHeader = normalizeKey_(header);
    if (rowIdx.hasOwnProperty(normHeader)) return sanitizeCellValue_(rowIdx[normHeader]);
    var fuzzyKey = findFuzzyKey_(normHeader, rowIdx);
    if (fuzzyKey && rowIdx.hasOwnProperty(fuzzyKey)) return sanitizeCellValue_(rowIdx[fuzzyKey]);
    return '';
  });
  sheet.appendRow(values);
}

function buildRowIndex_(rowObj) {
  var idx = {};
  Object.keys(rowObj || {}).forEach(function(k) { idx[normalizeKey_(k)] = rowObj[k]; });
  return idx;
}

function isDuplicateById_(sheet, idRegistro) {
  if (!idRegistro) return false;
  ensureHeaders_(sheet, REQUIRED_HEADERS);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = -1;
  for (var i = 0; i < headers.length; i++) {
    if (normalizeKey_(headers[i]) === 'idregistro') { col = i + 1; break; }
  }
  if (col < 1) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var vals = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  var target = String(idRegistro).trim();
  for (var r = 0; r < vals.length; r++) {
    if (String(vals[r][0] || '').trim() === target) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// FUZZY ALIASES
// ═══════════════════════════════════════════════════════════
function findFuzzyKey_(normHeader, rowIdx) {
  var aliases = {
    'fecha':        ['fechadespacho'],
    'hora':         ['time'],
    'cliente':      ['razonsocial','nombrecliente'],
    'prefix':       ['prefijo'],
    'foliovale':    ['folio','foliovalefisico'],
    'codigoautz':   ['codigo','autz','codigoautorizacion'],
    'tipodocumento':['tipovale','tipodoc','tipo'],
    'ticketegas':   ['ticket','numticket','numeroticket'],
    'chofer':       ['conductor','operador'],
    'placas':       ['unidad','vehiculo','matricula'],
    'producto':     ['combustible'],
    'cantidad':     ['litros'],
    'monto':        ['importe','total'],
    'preciounit':   ['preciounitario','preciolitro','preciolitrocapturado'],
    'odometro':     ['km','kilometraje'],
    'agente':       ['despachador'],
    'isla':         ['numerodeisla','numisla','noisla'],
    'idregistro':   ['id'],
    'origen':       ['source'],
    'timestampms':  ['timestamp','timestamp_ms'],
    'fotoplaca':    ['fotoplacab64','foto_placa','placaurl'],
    'fototicket':   ['fototicketb64','foto_ticket','ticketurl'],
    'firmachofer':  ['firmab64','firma','firma_url'],
    'fotoselloe1':  ['fotose1b64','foto_sello_e1'],
    'numselloe1':   ['num_sello_e1'],
    'fotoselloe2':  ['fotose2b64','foto_sello_e2'],
    'numselloe2':   ['num_sello_e2'],
    'fotosellos1':  ['fotoss1b64','foto_sello_s1'],
    'numsellos1':   ['num_sello_s1'],
    'fotosellos2':  ['fotoss2b64','foto_sello_s2'],
    'numsellos2':   ['num_sello_s2']
  };
  var candidates = aliases[normHeader] || [];
  for (var i = 0; i < candidates.length; i++) {
    var ck = normalizeKey_(candidates[i]);
    if (rowIdx.hasOwnProperty(ck)) return ck;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// HELPERS GENERALES
// ═══════════════════════════════════════════════════════════
function parseBody_(e) {
  try { if (e && e.postData && e.postData.contents) return JSON.parse(e.postData.contents); } catch (err) {}
  try { if (e && e.parameter) return e.parameter; } catch (err2) {}
  return {};
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function normalizeKey_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function sanitizeCellValue_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

function pick_(obj, keys, fallback) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback !== undefined ? fallback : '';
}

function toUpper_(v) { return String(v || '').trim().toUpperCase(); }

function toNumber_(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback !== undefined ? fallback : 0;
  if (typeof v === 'number') return v;
  var s = String(v).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!s) return fallback !== undefined ? fallback : 0;
  if (/\.\d{1,4}$/.test(s)) s = s.replace(/,/g, '');
  else if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[,.]/g, '');
  var n = Number(s);
  if (isNaN(n)) return fallback !== undefined ? fallback : 0;
  return n;
}

function round2_(n) { return Math.round(Number(n || 0) * 100) / 100; }

function buildRecordId_(prefix, ts) {
  var d = new Date(ts || Date.now());
  var tz = Session.getScriptTimeZone() || 'America/Mexico_City';
  var stamp = Utilities.formatDate(d, tz, 'yyyyMMdd-HHmmss');
  var rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'DES-' + (prefix || 'GEN') + '-' + stamp + '-' + rnd;
}
