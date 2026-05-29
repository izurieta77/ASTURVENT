# SUPER CHEAP — Dashboard de la tienda

Dashboard web para ver en un solo lugar las **ventas, compras, gastos y nómina** de la
tienda de conveniencia SUPER CHEAP, y sacar los números del negocio (utilidad, margen,
tendencias). Vive en una carpeta aislada (`super-cheap/`) y se despliega como un sitio
de Netlify **independiente** de la app de la gasolinera.

## ¿Cómo funciona? (en simple)

```
  SICAR (tu PC) ──[bridge]──► sc-ingest ─┐
  Foto de ticket ─[IA OCR]──► sc-ticket ─┼─► BigQuery ──► Dashboard (gráficas y números)
  Captura manual ───────────► sc-data  ──┘
```

- **Ventas**: un pequeño programa (`sicar-bridge/`) corre en tu computadora, lee la base
  de datos de SICAR y manda las ventas a la nube. (Ver `sicar-bridge/README.md`.)
- **Compras y gastos**: tomas **foto del ticket**, la IA lee total, fecha, proveedor e
  impuestos (IVA/IEPS) y tú solo confirmas.
- **Nómina**: la capturas a mano.
- Todo se guarda en **BigQuery** (Google Cloud) y se ve en el dashboard.

## Componentes

| Archivo | Qué hace |
|---|---|
| `index.html` | El dashboard (página web). |
| `netlify/functions/auth.js` | Login con PIN. |
| `netlify/functions/sc-data.js` | KPIs, listas y guardado (compras/gastos/nómina). |
| `netlify/functions/sc-ticket.js` | Lee tickets con IA (OpenAI visión) + IVA/IEPS. |
| `netlify/functions/sc-ingest.js` | Recibe las ventas que manda el bridge de SICAR. |
| `netlify/functions/_bq.js`, `_lib.js` | Cliente de BigQuery y helpers (auth/CORS). |
| `bigquery-setup.sql` | Crea el dataset y las tablas en BigQuery (una sola vez). |
| `sicar-bridge/` | Programa local que sincroniza ventas desde SICAR. |
| `CONTRACT.md` | Contrato técnico (formas de datos). No tocar a la ligera. |

## Puesta en marcha (checklist)

1. **BigQuery**: en Google Cloud, ejecuta `bigquery-setup.sql` reemplazando
   `TU_PROYECTO` por el ID de tu proyecto (BigQuery Studio o
   `bq query --use_legacy_sql=false < bigquery-setup.sql`).
2. **Service Account**: crea una cuenta de servicio con permisos
   *BigQuery Job User* + *BigQuery Data Editor* sobre el dataset; descarga su JSON.
3. **Sitio en Netlify**: nuevo sitio desde este repo con **Base directory = `super-cheap/`**.
4. **Variables de entorno** en Netlify (Site settings → Environment variables):

   | Variable | Valor |
   |---|---|
   | `SC_PIN` | PIN para entrar al dashboard (ej. `1234`). |
   | `AUTH_SECRET` | Cadena aleatoria ≥32 caracteres. |
   | `GCP_PROJECT_ID` | ID de tu proyecto de Google Cloud. |
   | `BQ_DATASET` | `super_cheap` |
   | `GCP_SA_KEY` | JSON de la cuenta de servicio, en **una sola línea**. |
   | `OPENAI_API_KEY` | Clave de OpenAI con acceso a `gpt-4o` (para leer tickets). |
   | `SICAR_INGEST_TOKEN` | Token secreto (el mismo que pondrás en el bridge). |

5. **Despliega** el sitio. Abre la URL, entra con tu `SC_PIN` y prueba a capturar un gasto.
6. **Bridge de SICAR**: sigue `sicar-bridge/README.md` en la PC de la tienda.
7. **Dominio personalizado** (opcional): al conectarlo, agrega su origen en
   `ALLOWED_ORIGINS` dentro de `netlify/functions/_lib.js` (los `*.netlify.app` ya
   funcionan sin tocar nada).

## Desarrollo local

```bash
cd super-cheap
npm install
cp .env.example .env   # y llena los valores
netlify dev            # abre http://localhost:8888
```

## Notas

- La consulta SQL del bridge (`sicar-bridge/config.example.json` → `sqlVentas`) es
  **orientativa** y casi seguro debe ajustarse al esquema real de tu SICAR. Ver el
  README del bridge para averiguar los nombres de tablas.
- Costos: BigQuery tiene capa gratuita amplia; OpenAI cobra una fracción de centavo por
  ticket leído. El volumen de una tienda de conveniencia se mantiene muy bajo.
