# CONTINUIDAD EJECUTIVA - SUPER CHEAP - 2026-06-08

## Alcance y regla de seguridad

Este documento es una compactacion para retomar SUPER CHEAP sin reexplorar el repo.
No contiene secretos, tokens, PINes, llaves de servicio ni configuraciones reales de
SICAR. El checkout tiene cambios ajenos al momento de esta nota; no revertir ni
normalizar archivos fuera del alcance.

## Estado actual

- Proyecto local: `C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect`
- App: `super-cheap/`
- Sitio produccion: `https://supercheapp.netlify.app`
- Remote git: `origin https://github.com/izurieta77/ASTURVENT.git`
- Branch actual: `codex/super-cheap-sicar-finish`
- Estado git observado: `super-cheap/sicar-bridge/package-lock.json` modificado y
  `tmp-drive-design/` sin trackear. Tratar ambos como cambios de otros salvo que el
  usuario pida tocarlos.
- Base Netlify esperada: `super-cheap/`
- Build Netlify: `npm install`; publish `.`; funciones en `netlify/functions`.

## Commits recientes clave

- `4d315b5` - Plan semanal de compras editable.
- `23580ef` - Correccion de exportacion Excel del plan semanal.
- `9684822` - Alta del plan semanal de compras.
- `b54818d` - Analisis agregado para rangos largos, evitando graficas infinitas.
- `ec9ba63` - Grafica/auditoria compras vs ventas.
- `26e67d6` y `22512f9` - Ajuste de compras olvidadas reducido a 2% general y 1%
  vinos/licores.
- `5aaf3c8` - Prorrateo del mes actual y compras por existencia negativa SICAR.
- `b776e8d` - Arnes de continuidad SICAR.
- Historia previa util: `343a4dc` ingesta aumentos de inventario como compras,
  `f97f3a8` filtrado de movimientos, `b49e2d6` limpieza de inventario.

## Contrato operativo del sitio

SUPER CHEAP es un dashboard independiente para ventas, compras, gastos y nomina. La
ruta principal es `index.html`; las funciones clave son:

- `auth.js`: login por PIN.
- `sc-data.js`: KPIs, listas, analitica, plan semanal, ajustes y operaciones CRUD.
- `sc-ticket.js`: OCR de tickets con OpenAI y subida de imagenes cuando aplica.
- `sc-ingest.js` y `_ventas_ingest.js`: ventas desde SICAR o Excel.
- `sc-inventory-ingest.js`: compras sinteticas desde inventario SICAR.
- `_bq.js`, `_gcs.js`, `_lib.js`: BigQuery, Storage y helpers CORS/auth.

Variables requeridas en Netlify existen como nombres contractuales, pero este archivo
no debe incluir sus valores: `SC_PIN`, `AUTH_SECRET`, `GCP_PROJECT_ID`, `BQ_DATASET`,
`GCP_SA_KEY`, `OPENAI_API_KEY`, `SICAR_INGEST_TOKEN`.

## Reglas SICAR

- El bridge local `sicar-bridge/sync.js` corre en la PC donde esta SICAR y solo lee
  datos; no modifica SICAR.
- Ventas: se mandan a `/.netlify/functions/sc-ingest`; la deduplicacion usa llave de
  ticket/fuente.
- Plan B ventas: exportar Excel/CSV desde SICAR y correr `node sync.js --excel archivo.xlsx`.
- Inventario positivo: `sqlInventarioMovimientos` debe devolver fecha, producto,
  cantidad o delta, costo y opcionalmente proveedor/categoria. Solo aumentos positivos
  se convierten en compras.
- Idempotencia inventario: compras con `raw_ocr` prefijo `sicar_inventory:`.
- Compras olvidadas: ajuste mensual sobre inventario SICAR con prefijo
  `sicar_inventory_forgotten:`. Reglas vigentes: 2% general y 1% vinos/licores; el mes
  actual puede prorratearse por dia.
- Existencias negativas: `sqlExistenciasNegativas` alimenta compras sinteticas con
  prefijo `sicar_negative_stock:` y modo `replace_negative_stock`, reemplazando el
  snapshot para no duplicar negativos viejos.
- Fallbacks cuando SICAR no trae datos: proveedor `Inventario SICAR` o `Existencia
  negativa SICAR`; categoria `inventario` o `existencia_negativa`.

## Plan semanal editable

Endpoint: `GET /.netlify/functions/sc-data?action=plan_compras_semanal&limite=3000`.

Comportamiento validado en codigo/UI:

- Calcula productos desde ventas historicas por articulo.
- Usa piezas vendidas por semana como base y sugiere compra semanal.
- Aplica colchon limitado: productos de rotacion y precio promedio no mayor a $100
  pueden recibir +1 o +2 piezas segun velocidad.
- Busca ultimo costo unitario legible en `compras.conceptos`; si no existe, deja el
  producto como pendiente de costo.
- En UI de Compras permite alcance: Alta y media, Solo alta, Todos con compra, Solo
  seleccionados.
- Permite seleccionar/quitar productos, editar cantidad, mover orden y exportar solo
  el pedido seleccionado.
- Ultimo estado operativo documentado: 1,767 productos, 1,109 sugeridos, 1,066 con
  costo, 43 sin costo, costo semanal estimado $51,400.80. Revalidar contra produccion
  si la decision depende de cifras exactas.
- Ronda posterior con agentes, validada en produccion:
  - el alcance del plan ya no sobrescribe el pedido armado; solo filtra la vista;
  - existen botones explicitos para seleccionar alta/media o solo alta;
  - `Poner visibles` / `Quitar visibles` opera solo sobre filas realmente mostradas;
  - se agrego filtro `Con costo` / `Sin costo`;
  - exportacion incluye proveedor, metodo/confianza de costo y hoja `Pendientes costo`;
  - backend deduplica ventas por `fecha + ticket_id + linea_key`;
  - costo por nombre solo se usa si no hay clave y el nombre no parece ambiguo;
  - endpoint publicado revisado: 1,769 productos, 1,110 sugeridos, 1,067 con costo,
    43 sugeridos sin costo, costo semanal estimado $51,448.34.

## Costos

- BigQuery: volumen esperado bajo; la capa gratuita suele cubrir una tienda chica, pero
  confirmar en facturacion GCP si sube el historico o la frecuencia.
- OpenAI OCR: costo por ticket escaneado; no afecta ventas SICAR importadas sin foto.
- Google Cloud Storage: solo para imagenes/fotos de tickets cuando se suben.
- Plan semanal: el costo estimado usa costos historicos encontrados en compras; no
  inventa costo para productos sin dato.

## Exportacion

- La UI carga SheetJS desde `xlsx@0.18.5`.
- Exporta Excel del plan semanal seleccionado.
- Hay fallback `.xls` por HTML (`exportarXlsFallback`) cuando XLSX no esta disponible.
- En el plan editable, la exportacion debe respetar seleccion, cantidades editadas y
  orden manual.

## Comandos utiles

Estado:

```powershell
git -C C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect status --short --branch
git -C C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect log --oneline --decorate -12
```

Validacion local rapida:

```powershell
cd C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect
node --check super-cheap\netlify\functions\sc-data.js
node --check super-cheap\netlify\functions\sc-inventory-ingest.js
node -e "const fs=require('fs'); const html=fs.readFileSync('super-cheap/index.html','utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n'); new Function(scripts); console.log('inline script syntax ok');"
```

Arnes SICAR:

```powershell
cd C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect\super-cheap
.\ops\run-sicar-harness.ps1 -Action snapshot
.\ops\run-sicar-harness.ps1 -Action generate-adjustment
.\ops\run-sicar-harness.ps1 -Action verify-adjustment -Desde 2023-06-01 -Hasta 2026-06-04
```

Bridge SICAR en la PC remota:

```powershell
cd C:\super-cheap\sicar-bridge
node sync.js
node sync.js --inventario-only --dry-run
node sync.js --inventario-only
node sync.js --existencias-negativas-only --dry-run
node sync.js --existencias-negativas-only
node sync.js --excel ventas-sicar.xlsx --dry-run
```

Deploy:

```powershell
cd C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect\super-cheap
npx netlify status
npx netlify deploy --prod
```

Si Netlify genera `super-cheap/package-lock.json` y no era parte del cambio, no
mezclarlo automaticamente en commits.

## Pendientes conocidos

- Revalidar produccion antes de decisiones numericas: cifras del plan semanal y costos
  pueden cambiar al entrar nuevas ventas/compras.
- Hay movimientos SICAR con cantidades grandes que se dejaron porque parecen capturas
  masivas reales, no codigos mal parseados.
- El clasificador vinos/licores depende de palabras clave; marcas o categorias nuevas
  pueden caer como general hasta ajustar patrones.
- Productos sin costo en plan semanal requieren ticket/compra con costo legible o una
  carga correctiva.
- `app-v2/` existe como frente futuro, pero el deploy actual sirve `index.html` desde
  `super-cheap/`.
- No tocar `CONTRACT.md`, `index.html`, `sc-data.js` ni archivos existentes para una
  tarea de continuidad si el usuario solo pidio documentar.

## Como retomar

1. Leer este archivo y `OPERACION-SICAR-HARNESS.md`.
2. Revisar `git status --short --branch`; separar cambios propios de cambios ajenos.
3. Si el tema es SICAR, correr primero snapshot del arnes y leer
   `ops/state/last-sicar-harness.json`.
4. Si el tema es plan semanal, verificar `sc-data?action=plan_compras_semanal` y buscar
   en UI `plan-alcance`, `moverPlan`, `Costo semanal` y `exportarXlsFallback`.
5. Si el tema es bridge remoto, usar `C:\super-cheap\sicar-bridge`, logs locales,
   TeamViewer File Transfer y checks de API; evitar teclear comandos largos por UI
   remota si se puede transferir archivo/script.
6. Antes de deploy, correr checks de sintaxis y confirmar que el cambio no arrastra
   archivos ajenos.
