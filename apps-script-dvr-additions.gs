// ════════════════════════════════════════════════════════════════════════════
// AÑADIDOS AL APPS SCRIPT (no versionado — pegar manualmente en el Web App
// existente, el mismo cuyo URL /exec ya usa la app para despachos).
//
// 1) Crear (si no existen) dos hojas en el spreadsheet del Web App:
//      - DVR_Observaciones
//      - DVR_Reportes_Diarios
//
// 2) Agregar la propiedad de script DVR_TOKEN con el mismo valor que
//    APPS_SCRIPT_TOKEN en Netlify. Archivo → Propiedades del proyecto → Script.
//
// 3) Dentro de doPost(e), antes del switch/if existente, agregar el bloque
//    DISPATCH DVR de abajo. Si tu doPost actual usa otra estructura, copia
//    solo las funciones y enrútalas a sus actions correspondientes.
// ════════════════════════════════════════════════════════════════════════════

// --- DISPATCH (al inicio de doPost) ---------------------------------------
// var data = JSON.parse(e.postData.contents);
// switch (data.action) {
//   case 'logDVRObservation':       return logDVRObservation_(data);
//   case 'getDVRObservations':      return _json(getDVRObservations_(data));
//   case 'getDVRLatestObservations':return _json(getDVRLatestObservations_(data));
//   case 'saveDVRDailyReport':      return saveDVRDailyReport_(data);
//   case 'getDVRDailyReport':       return _json(getDVRDailyReport_(data));
//   case 'listDVRDailyReports':     return _json(listDVRDailyReports_(data));
//   // ... resto del switch existente (despachos, etc.)
// }

// --- Helpers ---------------------------------------------------------------
function _dvrAuth_(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('DVR_TOKEN') || '';
  if (!expected || String(data._token || '') !== expected) {
    throw new Error('Token DVR inválido');
  }
}
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function _dvrSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === 'DVR_Observaciones') {
      sh.appendRow(['timestamp','fecha','camera_ch','camera_label','personas','empleados','clientes','actividad','luces','cortina','observacion','raw_json']);
    } else if (name === 'DVR_Reportes_Diarios') {
      sh.appendRow(['fecha','generado_en','apertura','cierre','barrido_min','trapeado_min','polvo_min','inactividad_min','total_obs','narrativa','reporte_json']);
    }
  }
  return sh;
}

// --- Actions ---------------------------------------------------------------
function logDVRObservation_(data) {
  _dvrAuth_(data);
  var p = (data.analysis && data.analysis.parsed) || {};
  var ts = data.timestamp || new Date().toISOString();
  var fecha = String(ts).slice(0,10);
  _dvrSheet_('DVR_Observaciones').appendRow([
    ts,
    fecha,
    data.camera_ch || '',
    data.camera_label || '',
    Number(p.personas_detectadas || 0),
    Number(p.empleados_visibles || 0),
    Number(p.clientes_visibles || 0),
    String(p.actividad || ''),
    !!p.luces_encendidas,
    !!p.cortina_abierta,
    String(p.observacion_breve || ''),
    JSON.stringify(p),
  ]);
  return _json({ ok:true });
}

function getDVRObservations_(data) {
  _dvrAuth_(data);
  var fecha = String(data.fecha || '').slice(0,10);
  var sh = _dvrSheet_('DVR_Observaciones');
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  var idx = {};
  header.forEach(function(h,i){ idx[h] = i; });
  var rows = values
    .filter(function(r){ return String(r[idx.fecha]) === fecha; })
    .map(function(r){
      var parsed = {};
      try { parsed = JSON.parse(r[idx.raw_json] || '{}'); } catch(_){}
      return {
        timestamp:    r[idx.timestamp],
        camera_ch:    r[idx.camera_ch],
        camera_label: r[idx.camera_label],
        parsed:       parsed,
      };
    });
  return rows;
}

function getDVRLatestObservations_(data) {
  _dvrAuth_(data);
  var limit = Math.min(Number(data.limit) || 20, 200);
  var sh = _dvrSheet_('DVR_Observaciones');
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  var idx = {};
  header.forEach(function(h,i){ idx[h] = i; });
  var rows = values.slice(-limit).reverse().map(function(r){
    var parsed = {};
    try { parsed = JSON.parse(r[idx.raw_json] || '{}'); } catch(_){}
    return {
      timestamp:    r[idx.timestamp],
      camera_ch:    r[idx.camera_ch],
      camera_label: r[idx.camera_label],
      parsed:       parsed,
    };
  });
  return rows;
}

function saveDVRDailyReport_(data) {
  _dvrAuth_(data);
  var fecha = String(data.fecha || '').slice(0,10);
  var r = data.reporte || {};
  var sh = _dvrSheet_('DVR_Reportes_Diarios');
  // Upsert: si existe la fila, sobrescribir
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  var idx = {};
  header.forEach(function(h,i){ idx[h] = i; });
  var row = [
    fecha,
    r.generado_en || new Date().toISOString(),
    (r.resumen && r.resumen.apertura) || '',
    (r.resumen && r.resumen.cierre) || '',
    (r.resumen && r.resumen.limpieza && r.resumen.limpieza.barrido_min) || 0,
    (r.resumen && r.resumen.limpieza && r.resumen.limpieza.trapeado_min) || 0,
    (r.resumen && r.resumen.limpieza && r.resumen.limpieza.polvo_min) || 0,
    (r.resumen && r.resumen.inactividad_min) || 0,
    r.total_observaciones || 0,
    r.narrativa || '',
    JSON.stringify(r),
  ];
  var existingRow = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idx.fecha]) === fecha) { existingRow = i + 2; break; }
  }
  if (existingRow > 0) {
    sh.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return _json({ ok:true });
}

function getDVRDailyReport_(data) {
  _dvrAuth_(data);
  var fecha = String(data.fecha || '').slice(0,10);
  var sh = _dvrSheet_('DVR_Reportes_Diarios');
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  var idx = {};
  header.forEach(function(h,i){ idx[h] = i; });
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][idx.fecha]) === fecha) {
      try { return JSON.parse(values[i][idx.reporte_json] || '{}'); }
      catch(_) { return null; }
    }
  }
  return null;
}

function listDVRDailyReports_(data) {
  _dvrAuth_(data);
  var limit = Math.min(Number(data.limit) || 30, 90);
  var sh = _dvrSheet_('DVR_Reportes_Diarios');
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  var idx = {};
  header.forEach(function(h,i){ idx[h] = i; });
  return values.slice(-limit).reverse().map(function(r){
    return {
      fecha:            r[idx.fecha],
      apertura:         r[idx.apertura],
      cierre:           r[idx.cierre],
      barrido_min:      r[idx.barrido_min],
      trapeado_min:     r[idx.trapeado_min],
      polvo_min:        r[idx.polvo_min],
      inactividad_min:  r[idx.inactividad_min],
      total_obs:        r[idx.total_obs],
    };
  });
}
