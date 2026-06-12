# Harness del AI Growth Agent

## Endpoint

`/api/ai-growth-agent` (definido por `config.path` en la función; no usa `/.netlify/functions/...`).

### GET — health

```json
{
  "ok": true,
  "service": "ai-growth-agent",
  "version": 2,
  "engine": "claude | openai | deterministic",
  "model": "claude-opus-4-8 | gpt-4o-mini | null",
  "knowledge_version": "2026-06-12",
  "businesses": ["asturvent", "sgm", "supercheap"],
  "tasks": ["promotion", "google_ads", "..."]
}
```

### POST — request

```json
{
  "business": "asturvent | sgm | supercheap",
  "task_type": "promotion | google_ads | meta_ads | tiktok | landing | whatsapp | quote_followup | seo | sales_analysis | calendar | audit | email | gbp",
  "user_instruction": "obligatorio, ≤4000 caracteres",
  "optional_context": { "cualquier": "dato" },
  "output_format": "text | json",
  "stream": true
}
```

- Sin `stream` (o `false`): responde un JSON completo (modo compatibilidad/tests).
  Con LLM activo puede acercarse al timeout de la plataforma: integraciones serias deben usar stream.
- Con `stream: true`: responde `application/x-ndjson`, una línea JSON por evento:
  - `{"type":"phase","id":"...","name":"...","status":"running|done","detail":"..."}`
  - `{"type":"result","data":{ ...respuesta completa... }}`
  - `{"type":"error","error":"..."}`

### Respuesta (`data` del evento result, o body del modo JSON)

```json
{
  "ok": true,
  "mode": "claude | openai | deterministic",
  "model": "claude-opus-4-8 | null",
  "business": "asturvent",
  "business_label": "AsturVent",
  "task_type": "google_ads",
  "task_label": "Campaña Google Ads",
  "summary": "resumen ejecutivo",
  "recommendation": "estrategia razonada",
  "copy_ready": "entregable completo listo para usar",
  "variants": ["...", "...", "..."],
  "risks": ["⚠ alertas de QA primero", "guardrails después"],
  "next_actions": ["..."],
  "kpis": ["..."],
  "ab_tests": ["..."],
  "usage": { "output_tokens": 0 },
  "diagnostics": {
    "mode": "claude",
    "knowledge_version": "2026-06-12",
    "missing_inputs": ["..."],
    "conversion_events": ["..."],
    "quality_checks": ["..."],
    "phases": [{ "id": "intake", "name": "...", "status": "done", "detail": "..." }]
  }
}
```

Errores de validación → `400 {"ok":false,"error":"..."}`.

## Pipeline (6 fases)

1. **intake** — valida body, normaliza `optional_context` (JSON inválido → `_raw_context`).
2. **knowledge** — carga el perfil del negocio (KB auditada del sitio real: contacto exacto,
   productos, claims seguros, guardrails, hallazgos de auditoría) y la especificación de la tarea.
3. **strategy** — define objetivo/público/ángulo/conversión (en el LLM va embebida en el prompt;
   en el motor local se deriva de la KB).
4. **generation** — Claude u OpenAI con **salida JSON estructurada** (json_schema) en streaming;
   progreso emitido cada ~500 caracteres. Presupuesto de tiempo `AI_TIME_BUDGET_MS` (80 s default)
   con `AbortController`; si falla/expira → motor determinista de respaldo y nota en `risks`.
5. **qa** — checks deterministas aplicados SIEMPRE (también a la salida del LLM):
   - AsturVent: sin marcas competidoras de PVC, sin garantías en años inventadas.
   - SGM: descuentos solo en el rango publicado 10–30¢/L, sin precios de combustible,
     sin enlazar la app rota (jade-semolina).
   - Super Cheap: sin precios fijos no proporcionados (deben ir como `[PRECIO]`).
   - Todos: el número de WhatsApp corresponde al negocio correcto.
   Las alertas se anteponen a `risks` con prefijo `⚠`.
6. **package** — ensambla la respuesta final con diagnostics.

## Guardrails clave de la KB

- Solo se afirman los **claims seguros** publicados en cada sitio (p. ej. "hasta 47 dB",
  "10–30¢ por litro", "48 cetanos", "MSI sujeto a validación").
- Datos faltantes → marcadores editables (`[PRECIO]`, `[MEDIDAS]`) + reporte en `missing_inputs`.
- Los datos de contacto provienen de la auditoría (`agents/SITE_REVIEW.md`) y viven en la
  constante `KB` de la función. **Si el negocio cambia teléfono/horario/oferta, actualizar ahí
  y subir `KNOWLEDGE_VERSION`.**

## Tests

```bash
node scripts/test-ai-growth-agent.mjs                          # local (netlify dev)
AGENT_URL=https://asturvent-web.netlify.app node scripts/test-ai-growth-agent.mjs
```

Validan: contrato de campos, ≥4 fases en diagnostics, reglas de marca por negocio y
errores 400 de validación.
