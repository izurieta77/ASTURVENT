# SUPER CHEAP - Arnes operativo SICAR

Este arnes existe para retomar el trabajo sin volver a explorar desde cero.
Guarda reglas, prefijos, comandos y el ultimo estado operativo conocido.

## Objetivo

Mantener dos automatizaciones de compras sinteticas en produccion:

1. Todo movimiento positivo de inventario SICAR se registra como compra.
2. Cada mes se agrega un ajuste por compras olvidadas:
   - 2% para productos generales.
   - 1% para vinos y licores.
3. Todo articulo con existencia negativa en SICAR se registra como compra sintetica aparte.

## Prefijos de idempotencia

- `sicar_inventory:`
  Compra automatica creada desde un aumento positivo de inventario SICAR.
- `sicar_inventory_forgotten:`
  Ajuste por compras olvidadas calculado sobre la base `sicar_inventory:`. En el mes en curso se puede materializar prorrateado por dia.
- `sicar_negative_stock:`
  Compra automatica creada desde existencias negativas detectadas en SICAR.

Estos prefijos permiten re-ejecutar procesos sin duplicar compras.

## Endpoints utiles

- `GET /sc-data?action=resumen_inventario_sicar&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&agrupar=mes|dia`
- `GET /sc-data?action=resumen_ajuste_inventario_olvidado&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
- `POST /sc-data { "action":"generar_ajuste_inventario_olvidado","desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD" }`
- `POST /sc-data { "action":"eliminar_inventario_sicar","desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD" }`

## Script de continuidad

Archivo: `ops/run-sicar-harness.ps1`

Acciones:

- `snapshot`
  Lee inventario SICAR, calcula el ajuste esperado y verifica compras mensuales ya insertadas.
- `generate-adjustment`
  Regenera el ajuste mensual de compras olvidadas de forma idempotente.
- `verify-adjustment`
  Igual que `snapshot`, pero se usa como nombre operativo para verificacion posterior.

Ejemplos:

```powershell
cd super-cheap
.\ops\run-sicar-harness.ps1
.\ops\run-sicar-harness.ps1 -Action generate-adjustment
.\ops\run-sicar-harness.ps1 -Action verify-adjustment -Desde 2023-06-01 -Hasta 2026-06-04
```

Salidas del script:

- `ops/state/last-sicar-harness.json`
- `ops/state/history/sicar-harness-YYYYMMDD-HHMMSS.json`

## Estado validado

Fecha de referencia: `2026-06-04`

- Rango historico cargado para compras SICAR: `2023-06-01` a `2026-06-04`
- Compras por inventario SICAR: `46,733`
- Total base inventario SICAR: `$8,164,655.55`
- Ajuste materializado por compras olvidadas: `76` filas
- Total ajuste mensual: `$956,718.19`
- Junio 2026 quedo prorrateado en `4` compras diarias de `$527.78`

Nota:
El ajuste mensual puede tener 2 filas por mes:

- `general` al `2%`
- `vinos_licores` al `1%`

Si un mes no tiene vinos/licores detectados, puede quedar solo una fila.

## Estado app y plan semanal validado

Fecha de referencia: `2026-06-08`

- Sitio produccion: `https://supercheapp.netlify.app`
- Branch de trabajo: `codex/super-cheap-sicar-finish`
- Commits recientes clave:
  - `ec9ba63` - grafica compras vs ventas.
  - `b54818d` - analisis agregado para rangos largos, evita graficas infinitas/tickets sueltos.
  - `5aaf3c8` - prorrateo del mes actual y compras sinteticas por existencia negativa.
  - `26e67d6` / `22512f9` - ajuste compras olvidadas bajado a 2% general y 1% vinos/licores.
  - `9684822` - plan semanal de compras por producto desde `ventas_articulos`.
  - `23580ef` - exportacion Excel corregida: SheetJS `xlsx@0.18.5` y fallback `.xls`.
  - `4d315b5` - plan semanal editable: seleccionar/quitar, editar piezas, mover orden, costo semanal y exportar pedido.
- El plan semanal se calcula con ventas YTD por producto:
  - base: `ceil(piezas vendidas por semana)`;
  - colchon maximo `+2` solo si precio promedio vendido no excede `$100` y el producto rota;
  - de 1 a menos de 2 piezas/semana recibe `+1`; desde 2 piezas/semana recibe `+2`; menos de 1 no recibe colchon.
- En la UI de Compras el pedido semanal es editable:
  - alcance: Alta y media, Solo alta, Todos con compra, Solo seleccionados;
  - checkbox para poner/quitar;
  - cantidad editable por producto;
  - flechas para ordenar;
  - exporta el pedido seleccionado, no toda la base.
- Costos del plan:
  - `sc-data?action=plan_compras_semanal` busca el ultimo `costo_unitario` disponible en `compras.conceptos`;
  - si no hay costo legible, el producto queda como pendiente y no se inventa costo.
- Mejora posterior por agentes, `2026-06-08`:
  - el selector de alcance ya no borra el pedido armado; solo filtra la vista;
  - seleccionar/quitar visibles actua solo sobre filas realmente visibles;
  - se agrego filtro de costo (`con costo` / `sin costo`);
  - exportacion agrega proveedor, metodo/confianza y hoja `Pendientes costo`;
  - el backend deduplica lineas de `ventas_articulos` por `fecha + ticket_id + linea_key`;
  - el costo por nombre solo se usa si no hay clave y el nombre no parece ambiguo;
  - cada producto devuelve `costo_confianza` (`alta`, `media`, `baja`, `sin_costo`).
- Ultima verificacion real del endpoint publicado tras la ronda de agentes:
  - deploy Netlify: `6a273c89ce26e36ce2cf6465`;
  - productos: `1769`;
  - productos sugeridos: `1110`;
  - con costo: `1067`;
  - sin costo sugerido: `43`;
  - costo semanal estimado: `$51,448.34`.
- HTML publicado verificado con:
  - `plan-alcance`;
  - `Costo semanal`;
  - `moverPlan`;
  - `exportarXlsFallback`;
  - `xlsx@0.18.5/dist/xlsx.full.min.js`.

## Reanudacion rapida

Cuando una sesion se corte, retomar asi:

1. Revisar este archivo.
2. Verificar estado git y no revertir cambios ajenos:
   ```powershell
   git status --short --branch
   ```
   Pendientes conocidos que pueden ser ajenos: `super-cheap/sicar-bridge/package-lock.json` y `tmp-drive-design/`.
3. Correr:
   ```powershell
   cd super-cheap
   .\ops\run-sicar-harness.ps1 -Action snapshot
   ```
4. Comparar `inventario`, `ajuste` y `comprasAjuste` contra `ops/state/last-sicar-harness.json`.
5. Si el ajuste no esta insertado o quedo desfasado, correr:
   ```powershell
   .\ops\run-sicar-harness.ps1 -Action generate-adjustment
   ```
6. Para cambios del dashboard, validar antes de deploy:
   ```powershell
   node --check super-cheap\netlify\functions\sc-data.js
   node -e "const fs=require('fs'); const html=fs.readFileSync('super-cheap/index.html','utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n'); new Function(scripts); console.log('inline script syntax ok');"
   ```
7. Desplegar desde `super-cheap/`:
   ```powershell
   cd super-cheap
   npx netlify deploy --prod --dir .
   ```
   Si Netlify genera `super-cheap/package-lock.json`, limpiarlo antes de commit si no era parte del cambio.

## Deploy

Sitio de produccion:

- `https://supercheapp.netlify.app`

Comandos de deploy:

```powershell
cd super-cheap
npx netlify status
npx netlify deploy --prod
```

## Riesgos conocidos

- Hay movimientos SICAR con cantidades muy grandes que parecen capturas masivas reales. No se eliminaron porque vienen como cantidades explicitas y no como codigos de barras mal parseados.
- El clasificador de vinos/licores se basa en palabras clave en `categoria`, `clasificacion` y `conceptos`. Si aparece una marca nueva que no matchee el patron, se ira al segmento general hasta ajustar la lista.
