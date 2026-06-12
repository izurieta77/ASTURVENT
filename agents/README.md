# AI Growth Center v2

Centro de crecimiento con IA para **Super Cheap Market**, **SGM Mobil Metepec** y **AsturVent**.
Genera piezas comerciales listas para usar (campañas, copys, landings, seguimientos, auditorías)
con una base de conocimiento construida auditando los sitios reales de cada negocio.

## Componentes

| Archivo | Qué es |
|---|---|
| `ai-growth-center.html` | UI: brief → pipeline de fases en vivo → resultado por secciones + historial |
| `netlify/functions/ai-growth-agent.js` | Agente serverless: pipeline intake → knowledge → strategy → generation → qa → package |
| `scripts/test-ai-growth-agent.mjs` | Tests de contrato y reglas de calidad |
| `agents/HARNESS.md` | Contrato de la API y detalles del pipeline |
| `agents/SITE_REVIEW.md` | Auditorías completas de asturvent-web.netlify.app y morgangasolineros.com.mx |
| `agents/examples.json` | Payloads de ejemplo por negocio |
| `agents/ai-growth-center-harness.mmd` | Diagrama Mermaid del pipeline |

## Motores (en orden de preferencia)

1. **Claude** — si existe `ANTHROPIC_API_KEY`. Modelo por defecto `claude-opus-4-8`,
   configurable con `AI_GROWTH_MODEL` (p. ej. `claude-sonnet-4-6` o `claude-haiku-4-5` si
   tu plan de Netlify corta el stream antes de terminar).
2. **OpenAI** — si existe `OPENAI_API_KEY` (modelo `gpt-4o-mini`).
3. **Motor determinista local** — sin API key. Plantillas inteligentes por tarea con los
   datos reales de cada negocio (teléfonos, claims, ofertas, hallazgos de auditoría).
   El flujo nunca se detiene: si el LLM falla o se agota el presupuesto de tiempo
   (`AI_TIME_BUDGET_MS`, default 80000 ms), responde el motor local.

## Configuración en Netlify

`Site settings → Environment variables`:

```
ANTHROPIC_API_KEY = sk-ant-...        # recomendado
AI_GROWTH_MODEL   = claude-opus-4-8   # opcional
OPENAI_API_KEY    = sk-proj-...       # fallback opcional
```

Sin variables, el agente funciona en modo local (la UI lo indica en el pill de estado).

## Uso local

```bash
netlify dev                                # levanta UI + función en :8888
node scripts/test-ai-growth-agent.mjs      # corre los tests de contrato
```

## Por qué la respuesta es streaming

Las funciones síncronas de Netlify tienen timeout de 10 s (26 s en Pro). El agente responde
en **NDJSON streaming**: el primer byte sale de inmediato (eventos de fase) y la generación
del LLM se transmite conforme avanza. La UI usa esto para pintar el pipeline en vivo.
El modo JSON simple (sin `"stream": true`) existe para tests e integraciones.
