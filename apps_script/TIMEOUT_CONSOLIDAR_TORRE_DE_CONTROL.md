# Timeout de `consolidarTorreDeControl`

El correo de Apps Script indica que `consolidarTorreDeControl` excedio el limite de ejecucion del trigger de tiempo:

- 2026-06-02 18:58:47 CST
- 2026-06-03 03:58:47 CST
- 2026-06-03 10:58:47 CST

Esa funcion no aparece en los archivos locales versionados de APPsgm:

- `apps_script/Codigo.gs`
- `apps_script_v4.gs`
- `index.html`
- `scripts/*`

Eso significa que el trigger esta en un Apps Script externo o en codigo pegado manualmente que hoy no esta protegido por git ni por el arnes.

## Causa probable

Un trigger time-based esta intentando consolidar demasiadas pestanas/clientes/filas en una sola ejecucion. Google Apps Script corta las ejecuciones alrededor de 6 minutos, asi que una consolidacion completa puede quedar a medias y mandar correos de fallo.

Esto afecta a APPsgm aunque no sea el endpoint de escritura: la app lee historicos/consolidados y puede mostrar datos incompletos, tardios o estados de confirmacion confusos si el consolidado queda bloqueado o incompleto.

## Regla de solucion

No volver a correr una consolidacion completa en una sola ejecucion. Debe correr por lotes con:

- `LockService` para evitar ejecuciones simultaneas.
- `PropertiesService` para guardar cursor/progreso.
- limite de tiempo interno de 4.5 a 5 minutos para salir antes de que Google corte.
- reanudacion en el siguiente trigger.
- log de estado al final de cada lote.

## Patron seguro para adaptar la funcion real

Cuando se abra el Apps Script que contiene la funcion real, no cambiar la logica de negocio primero. Solo envolver el loop principal con este patron:

```javascript
var TDC_CURSOR_KEY = 'SGM_TDC_CURSOR_V1';
var TDC_MAX_MS = 270000; // 4.5 min, debajo del limite de Apps Script

function consolidarTorreDeControl() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('consolidarTorreDeControl: otra ejecucion sigue activa');
    return;
  }

  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var cursor = Number(props.getProperty(TDC_CURSOR_KEY) || 0);

  try {
    // REEMPLAZAR esta lista por la lista real de clientes/tabs que ya usa la funcion.
    var jobs = Object.keys(CLIENTE_SHEETS || {});
    var processed = 0;

    while (cursor < jobs.length && (Date.now() - started) < TDC_MAX_MS) {
      var prefix = jobs[cursor];

      // REEMPLAZAR por la unidad minima real de trabajo.
      // Ejemplo: consolidarClienteEnTorre_(prefix);
      consolidarTorreDeControlCliente_(prefix);

      cursor++;
      processed++;
      props.setProperty(TDC_CURSOR_KEY, String(cursor));
    }

    if (cursor >= jobs.length) {
      props.deleteProperty(TDC_CURSOR_KEY);
      Logger.log('consolidarTorreDeControl: ciclo completo, procesados=' + processed);
    } else {
      Logger.log('consolidarTorreDeControl: pausa segura, cursor=' + cursor + ', procesados=' + processed);
    }
  } finally {
    lock.releaseLock();
  }
}
```

## No hacer

- No borrar triggers sin revisar cual alimenta el historico.
- No duplicar el trigger con otra funcion completa.
- No mover columnas ni cambiar nombres de pestanas como parte de este fix.
- No tocar los vales impresos de Don Harina.

## Validacion local antes de deploy

Ejecutar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_appsgm_guardrails.ps1
```

El arnes debe quedar en `0 fail`. La advertencia de `consolidarTorreDeControl` desaparecera solo cuando esa funcion quede versionada dentro de `apps_script/`.
