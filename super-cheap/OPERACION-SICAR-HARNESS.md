# SUPER CHEAP - Arnes operativo SICAR

Este arnes existe para retomar el trabajo sin volver a explorar desde cero.
Guarda reglas, prefijos, comandos y el ultimo estado operativo conocido.

## Objetivo

Mantener dos automatizaciones de compras sinteticas en produccion:

1. Todo movimiento positivo de inventario SICAR se registra como compra.
2. Cada mes se agrega un ajuste por compras olvidadas:
   - 7% para productos generales.
   - 2% para vinos y licores.
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

- `general` al `7%`
- `vinos_licores` al `2%`

Si un mes no tiene vinos/licores detectados, puede quedar solo una fila.

## Reanudacion rapida

Cuando una sesion se corte, retomar asi:

1. Revisar este archivo.
2. Correr:
   ```powershell
   cd super-cheap
   .\ops\run-sicar-harness.ps1 -Action snapshot
   ```
3. Comparar `inventario`, `ajuste` y `comprasAjuste` contra `ops/state/last-sicar-harness.json`.
4. Si el ajuste no esta insertado o quedo desfasado, correr:
   ```powershell
   .\ops\run-sicar-harness.ps1 -Action generate-adjustment
   ```

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
