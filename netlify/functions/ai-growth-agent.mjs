// AI Growth Agent v2 — Super Cheap Market · SGM Mobil Metepec · AsturVent
//
// Pipeline multi-fase: intake → knowledge → strategy+generation → qa → package.
// Motores (en orden de preferencia):
//   1. Claude   (ANTHROPIC_API_KEY, modelo via AI_GROWTH_MODEL, default claude-opus-4-8)
//   2. OpenAI   (OPENAI_API_KEY, gpt-4o-mini)
//   3. Determinista local (sin API key; usa la base de conocimiento de abajo)
//
// La base de conocimiento se construyó auditando los sitios reales:
//   - https://asturvent-web.netlify.app  (AsturVent / Kömmerling)
//   - https://www.morgangasolineros.com.mx  (SGM Mobil Metepec + Super Cheap)
// Datos de contacto, claims técnicos y ofertas son los publicados en esos sitios.
//
// API:
//   GET  /api/ai-growth-agent            → health { ok, engine }
//   POST /api/ai-growth-agent            → JSON completo (default)
//   POST con { "stream": true }          → NDJSON: {type:"phase",...}* + {type:"result",data}
//
// Si el LLM falla o excede el presupuesto de tiempo (AI_TIME_BUDGET_MS, default 80s),
// el motor determinista responde de respaldo: el flujo nunca se detiene.

const AI_MODEL_DEFAULT = "claude-opus-4-8";
const OPENAI_MODEL = "gpt-4o-mini";
const MAX_TOKENS = 3000;
const KNOWLEDGE_VERSION = "2026-06-12";

/* ────────────────────────────────────────────────────────────────────────
 * BASE DE CONOCIMIENTO (datos reales publicados en los sitios)
 * ──────────────────────────────────────────────────────────────────────── */

const KB = {
  asturvent: {
    label: "AsturVent",
    legal: "Puertas y Ventanas de Asturias, S.A. de C.V.",
    positioning:
      "Fabricante y distribuidor oficial Kömmerling en México (tecnología alemana). 15+ años. Posicionamiento premium: silencio, confort y eficiencia térmica.",
    contact: {
      tel: "722 198 3004",
      whatsapp: "+52 722 421 5439",
      whatsapp_link: "https://wa.me/527224215439",
      email: "asturvent02@gmail.com",
      address: "Km 1 Capultitlán–San Felipe, Toluca, Edo. de México, CP 50260 (Showroom Capultitlán)",
      response_promise: "Respuesta en menos de 24 horas hábiles",
    },
    zone: "Toluca / Metepec / CDMX y cobertura en 9 estados: Edo. de México, Morelos, Michoacán, Hidalgo, Querétaro, Puebla, Veracruz, Guerrero y Tlaxcala",
    products: [
      "Ventanas y puertas PVC Kömmerling: KÖMMERLING76 AD Xtrem (5 cámaras, Clase 4, herrajes RC2), PremiDoor76/Lux (corredera elevadora, hasta 400 kg/hoja), EuroFutur Elegance, PremiSlide76, PremiLine",
      "Vidrio Duo Vent: doble/triple con cámara de argón y Low-E; laminado acústico",
      "6 acabados: Embero, Roble natural, Negro, Blanco, Gris antracita, Gris plata",
      "Aluminio línea española (rotura de puente térmico) y tradicional",
      "Madera fosilizada Fossilized Wood (deck, fachadas, pérgolas, saunas) — distribución única en México",
      "Fabricación propia con CNC 5 ejes en Toluca; instalación y mantenimiento",
      "Canal B2B: programa de distribuidores con precio de fábrica, capacitación Kömmerling y kit muestrario",
    ],
    claims_safe: [
      "Aislamiento acústico hasta 47 dB (sistema K76 + vidrio laminado acústico)",
      "Tecnología alemana Kömmerling, distribuidor oficial en México",
      "15+ años de trayectoria, fabricación propia en Toluca con CNC de 5 ejes",
      "Triple junta EPDM, estanqueidad clase 9A, herrajes con seguridad RC2",
      "Meses sin intereses: 3, 6 y 12 MSI con cualquier banco (sujeto a validación)",
      "Asesoría y visita técnica sin costo y sin compromiso",
    ],
    audience: "Propietarios residenciales premium con problema de ruido/temperatura, arquitectos y despachos, desarrolladores, y canal pro (vidrieros/aluminieros) para distribución",
    cta: "Solicita diagnóstico y cotización profesional por WhatsApp al +52 722 421 5439",
    needs: ["medidas aproximadas", "ubicación/ciudad", "tipo de apertura", "color", "tipo de cristal", "número de piezas", "problema principal (ruido/frío/calor/seguridad)"],
    guardrails: [
      "Mantener AsturVent 100% alineado a Kömmerling; no mencionar marcas competidoras de PVC.",
      "No inventar precios (no hay precios publicados), ni garantías en años, ni valores Uw/Rw exactos distintos a los publicados; usar 'hasta 47 dB' como claim acústico seguro.",
      "No prometer tiempos de entrega ni certificaciones no publicadas.",
      "MSI siempre con la leyenda 'sujeto a validación'.",
    ],
    site_findings: [
      "El sitio no tiene analytics ni píxeles (GA4/Meta): instalarlos es prerrequisito antes de invertir en pauta.",
      "Sin Open Graph ni schema.org: los enlaces compartidos por WhatsApp salen sin imagen/preview.",
      "El formulario solo abre WhatsApp: el lead se pierde si no completa el envío; duplicar a Netlify Forms.",
      "HTML de ~790KB con imágenes base64 e imágenes del WordPress viejo (i0.wp.com): afecta velocidad y Quality Score.",
      "Una sola URL indexable: faltan páginas SEO por ciudad (Toluca, Metepec, Querétaro, CDMX…).",
      "Sin testimonios, reseñas, horarios ni garantía explícita publicada.",
      "Email Gmail (asturvent02@gmail.com) resta percepción premium frente a dominio propio.",
    ],
  },

  sgm: {
    label: "SGM Mobil Metepec",
    legal: "Servicios Gasolineros Metepec (operador 13403) · sitio: morgangasolineros.com.mx",
    positioning:
      "Gasolinería premium Mobil (Exxon Mobil México) con tecnología Synergy. Foco comercial: flotillas y empresas (diesel UBA, prepago con descuento, facturación inmediata).",
    contact: {
      tel: "(722) 225-0814",
      whatsapp: "(729) 266-1287",
      whatsapp_link: "https://wa.me/527292661287",
      email: null,
      address: "Libramiento José María Morelos y Pavón 1711, frente a Universidad UMIN, Col. San Lorenzo Coacalco, CP 52140, Metepec, Edo. de México",
      hours: "5:00 a 23:00, los 365 días del año",
    },
    zone: "Metepec y Toluca, corredor industrial Toluca–Lerma",
    products: [
      "Gasolina Mobil Synergy Extra (87 octanos) y Synergy Supreme+ (91 octanos, 5x detergentes, ahorro de combustible estimado 2–4%)",
      "Diesel UBA ultra bajo azufre: 48 cetanos (vs 45 estándar), 97% menos azufre, compatible con DPF/SCR/EGR",
      "Lubricantes Mobil 1, Mobil Delvac (hasta 160,000 km entre cambios), Mobil Super y Prestone",
      "Programa de flotillas: tarjeta prepago con descuento de 10¢ a 30¢ por litro según volumen, monitoreo en tiempo real y facturación electrónica inmediata",
      "Reto 2 semanas para flotillas: prueba garantizada sin riesgo",
      "Facturación CFDI 24/7 en mobil.efectifactura.com",
      "Tienda Super Cheap Market dentro de la estación",
    ],
    claims_safe: [
      "Descuento por volumen para flotillas: de 10 a 30 centavos por litro con tarjeta prepago",
      "Diesel UBA 48 cetanos, 97% menos azufre, apto para motores Euro V/VI con DPF/SCR/EGR",
      "Facturación electrónica inmediata, portal disponible 24/7",
      "Reto 2 semanas: si no te convence, te quedas con tus condiciones actuales",
      "Abierto de 5:00 a 23:00 los 365 días",
      "Combustibles Mobil Synergy con aditivación detergente superior al mínimo regulatorio",
    ],
    audience: "Gerentes de flotilla, transportistas, empresas con facturación de combustible en el corredor Toluca–Metepec–Lerma; B2C local secundario",
    cta: "Cotiza el descuento de tu flotilla por WhatsApp al (729) 266-1287",
    needs: ["litros mensuales", "número de unidades", "tipo de combustible (diesel/gasolina)", "zona de operación", "forma de pago", "razón social para facturar"],
    guardrails: [
      "No prometer descuentos fuera del rango publicado (10–30¢ por litro) ni crédito sin autorización.",
      "No inventar precios de combustible por litro.",
      "No tocar temas regulatorios (auditorías, ASEA, litigios) ni precios de competidores.",
      "No enlazar la app de flotillas vieja (jade-semolina-ece7ce.netlify.app: está rota / 404).",
    ],
    site_findings: [
      "El enlace 'App de Flotillas' está roto (404) en 3 lugares del sitio: repararlo es la corrección de conversión #1.",
      "Sin analytics ni píxeles: no se puede medir ningún clic de 'Cotizar flotilla' o 'Facturar ahora'.",
      "No hay formulario de leads ni email visible: todo depende de WhatsApp.",
      "La sección Pit Stop pide 'síguenos' pero no hay ninguna red social enlazada.",
      "Una sola URL: el contenido técnico de Diesel UBA merece landing indexable propia para 'diesel flotillas Metepec/Toluca'.",
      "Doble identidad Morgan Gasolineros vs SGM Mobil Metepec: unificar para SEO local y Google Business Profile.",
    ],
  },

  supercheap: {
    label: "Super Cheap Market",
    legal: "Tienda de conveniencia dentro de la estación SGM Mobil Metepec",
    positioning:
      "Tienda de conveniencia (+500 productos) para compra rápida y antojo en el paso: café, panadería, bebidas y básicos de auto.",
    contact: {
      tel: "(722) 225-0814",
      whatsapp: "(729) 266-1287",
      whatsapp_link: "https://wa.me/527292661287",
      email: null,
      address: "Dentro de SGM Mobil Metepec: Libramiento José María Morelos y Pavón 1711, Metepec, Edo. de México",
      hours: "Lun–Vie 5:00–23:00 · Sáb–Dom 7:00–22:00",
    },
    zone: "Metepec / Toluca (tráfico de la gasolinera y vecinos inmediatos)",
    products: [
      "Café chiapaneco y cuernitos/panadería casera",
      "Bebidas: agua Member's Mark, refrescos, New Mix, té",
      "Antojo: Vuala, Hershey's, Panini, dulces",
      "Básicos de auto: desodorantes, Prestone, accesorios",
      "+500 productos de conveniencia",
    ],
    claims_safe: [
      "Compra en menos de 3 minutos mientras cargas gasolina",
      "Abierto desde las 5:00 entre semana",
      "Café recién hecho y panadería del día",
    ],
    audience: "Automovilistas que cargan en la estación, oficinistas y transportistas madrugadores, vecinos de la zona",
    cta: "Pasa hoy por Super Cheap en la gasolinera Mobil de Libramiento Morelos y pídelo en caja",
    needs: ["precio y margen del producto", "inventario disponible", "vigencia de la promo", "formato (pantalla/WhatsApp/red social)"],
    guardrails: [
      "Nunca inventar precios: usar el marcador [PRECIO] si no se proporciona.",
      "Validar margen e inventario antes de publicar cualquier promoción.",
      "Textos cortos: una pantalla se lee en 3 segundos.",
    ],
    site_findings: [
      "Super Cheap solo aparece como sección del sitio de la gasolinera: no tiene presencia digital propia (GBP, redes, WhatsApp de pedidos).",
      "Sin programa de lealtad B2C: un monedero simple de café/litros elevaría frecuencia de visita.",
    ],
  },
};

/* ────────────────────────────────────────────────────────────────────────
 * CATÁLOGO DE TAREAS
 * ──────────────────────────────────────────────────────────────────────── */

const TASKS = {
  promotion: {
    label: "Promoción diaria",
    goal: "Vender un producto concreto hoy, con texto listo para pantalla y WhatsApp.",
    deliverable:
      "1) Texto de pantalla 1:1 (máx. 12 palabras grandes + precio editable). 2) Mensaje de WhatsApp/estado (2–3 líneas). 3) Pie con vigencia y condición. Usa [PRECIO] si no hay precio confirmado.",
    conversion: ["venta en caja", "respuesta de WhatsApp"],
    checks: ["Texto de pantalla legible en 3 segundos", "Precio como [PRECIO] si no fue proporcionado", "Vigencia y condición explícitas"],
  },
  google_ads: {
    label: "Campaña Google Ads",
    goal: "Capturar demanda de búsqueda con alta intención y bajo desperdicio.",
    deliverable:
      "Estructura completa: campañas por intención, grupos de anuncios, keywords exactas/frase con la zona real, negativas iniciales, 2 RSA (15 títulos ≤30 caracteres no son necesarios todos: da 6–8 títulos y 3 descripciones por anuncio), extensiones (llamada con el teléfono real, ubicación, sitelinks), presupuesto sugerido conservador, eventos de conversión a medir y nota de tracking.",
    conversion: ["clic a WhatsApp", "llamada", "envío de formulario"],
    checks: ["Keywords incluyen la zona geográfica real", "Negativas incluidas", "Teléfono/WhatsApp correctos del negocio", "Advertencia de instalar medición si el sitio no la tiene"],
  },
  meta_ads: {
    label: "Facebook / Instagram",
    goal: "Generar demanda y leads en social con creatividades de gancho claro.",
    deliverable:
      "2 conceptos creativos (gancho visual + copy primario + titular + CTA), 1 guion de historia 3 pantallas, públicos sugeridos (intereses + radio geográfico real), presupuesto inicial y evento de conversión (clic a WhatsApp).",
    conversion: ["mensaje de WhatsApp", "lead en formulario"],
    checks: ["Gancho en la primera línea", "CTA con el canal real del negocio", "Sin claims inventados"],
  },
  tiktok: {
    label: "TikTok / Reel",
    goal: "Alcance orgánico local con video corto que retiene los primeros 2 segundos.",
    deliverable:
      "Guion escena por escena (hook 0–2s, desarrollo, CTA), texto en pantalla por escena, audio sugerido (tendencia genérica, sin licencias específicas), caption con 5–8 hashtags locales y de nicho, y 2 ideas alternativas de hook.",
    conversion: ["seguidores locales", "mensajes/visitas"],
    checks: ["Hook en los primeros 2 segundos", "CTA hablado y en texto", "Hashtags locales reales"],
  },
  landing: {
    label: "Landing page",
    goal: "Convertir tráfico de pauta en leads calificados con una página enfocada.",
    deliverable:
      "Wireframe sección por sección con copy real: hero (titular + subtítulo + CTA), prueba/beneficios con claims publicados, cómo funciona, objeciones/FAQ, formulario (campos exactos a pedir) + CTA WhatsApp, cierre. Incluir eventos a medir y nota técnica (velocidad, OG tags).",
    conversion: ["formulario", "clic a WhatsApp", "llamada"],
    checks: ["Un solo objetivo de conversión", "Claims solo de la lista publicada", "Campos del formulario alineados a los datos que el negocio necesita"],
  },
  whatsapp: {
    label: "WhatsApp de venta",
    goal: "Convertir un contacto en conversación de venta con mensajes listos para enviar.",
    deliverable:
      "Secuencia de 3 toques: mensaje inicial (saludo + valor + pregunta calificadora), seguimiento a 48–72h, último toque con cierre suave. Cada mensaje listo para copiar/pegar, con los datos que el negocio debe pedir.",
    conversion: ["respuesta", "cita/cotización"],
    checks: ["Mensajes cortos (≤4 líneas)", "Una sola pregunta por mensaje", "Pide los datos correctos del negocio"],
  },
  quote_followup: {
    label: "Seguimiento de cotización",
    goal: "Reactivar a un prospecto que recibió cotización y no respondió, sin presionar.",
    deliverable:
      "Secuencia de 3 mensajes de WhatsApp (día 0 de reactivación, día 3, día 7-cierre) con motivo de valor en cada toque (no solo '¿ya lo viste?'), más nota interna de qué dato falta confirmar.",
    conversion: ["respuesta", "cierre de venta"],
    checks: ["Cada toque aporta valor nuevo", "Tono cordial sin presión", "Cierre con salida fácil"],
  },
  seo: {
    label: "Contenido SEO local",
    goal: "Posicionar búsquedas locales de alta intención con contenido indexable.",
    deliverable:
      "Cluster de keywords (principal + 6–10 secundarias con la zona real), título SEO ≤60 caracteres, meta description ≤155, outline H1/H2/H3 con puntos clave por sección, FAQ (3–5 preguntas con respuesta corta), y recomendaciones técnicas (schema.org, OG, interlinking).",
    conversion: ["tráfico orgánico local", "contacto"],
    checks: ["Keywords con geografía real", "Title y meta dentro del límite", "FAQ con respuestas basadas en claims publicados"],
  },
  sales_analysis: {
    label: "Análisis de ventas / leads",
    goal: "Convertir datos del negocio en decisiones comerciales accionables.",
    deliverable:
      "Si hay datos en el contexto: hallazgos (3–5), causas probables y acciones priorizadas con impacto/esfuerzo. Si no hay datos: framework de análisis con los indicadores exactos a recolectar para este negocio, formato de captura sugerido y decisión que habilita cada métrica.",
    conversion: ["decisión documentada"],
    checks: ["Separar hechos / inferencias / recomendaciones", "Acciones con responsable y plazo sugerido"],
  },
  calendar: {
    label: "Calendario semanal",
    goal: "Plan de contenido/promos de 7 días ejecutable por una persona.",
    deliverable:
      "Tabla Lunes–Domingo: tema/gancho del día, canal, formato, copy corto listo (1–2 líneas) y CTA. Más 2 ideas de respaldo y la métrica semanal a revisar.",
    conversion: ["publicaciones ejecutadas", "ticket promedio / leads"],
    checks: ["7 días completos", "Cada día con copy listo, no solo el tema", "Variedad de ángulos"],
  },
  audit: {
    label: "Auditoría comercial",
    goal: "Diagnóstico honesto del embudo digital del negocio con plan de 30 días.",
    deliverable:
      "Hallazgos priorizados del sitio/embudo real (usar los hallazgos de auditoría conocidos del negocio), impacto de cada uno, quick wins (semana 1), plan 30 días por semanas, y métricas para verificar avance.",
    conversion: ["plan ejecutado"],
    checks: ["Hallazgos específicos del negocio, no genéricos", "Cada acción con métrica de verificación"],
  },
  email: {
    label: "Email / newsletter",
    goal: "Reactivar y nutrir contactos existentes con un correo que sí se abre.",
    deliverable:
      "3 asuntos A/B/C (≤45 caracteres), preheader, cuerpo del correo (saludo, valor, CTA único), y P.D. con gancho secundario. Más nota de segmentación sugerida.",
    conversion: ["apertura", "clic", "respuesta"],
    checks: ["Asuntos dentro del límite", "Un solo CTA", "Tono del negocio"],
  },
  gbp: {
    label: "Google Business Profile",
    goal: "Mejorar presencia local en Maps con publicaciones y respuestas tipo.",
    deliverable:
      "1 publicación de novedad/oferta (texto ≤1500 caracteres con CTA), 3 respuestas tipo a reseñas (positiva, neutra, negativa) en el tono del negocio, y checklist de ficha (categorías, horarios reales, fotos, atributos).",
    conversion: ["llamadas/indicaciones desde Maps"],
    checks: ["Datos de contacto y horario reales", "Respuesta a reseña negativa sin confrontar"],
  },
};

/* ────────────────────────────────────────────────────────────────────────
 * VALIDACIÓN Y UTILIDADES
 * ──────────────────────────────────────────────────────────────────────── */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

function validate(body) {
  const errors = [];
  if (!body || typeof body !== "object") errors.push("Body JSON requerido.");
  else {
    if (!KB[body.business]) errors.push(`business inválido. Usa: ${Object.keys(KB).join(", ")}.`);
    if (!TASKS[body.task_type]) errors.push(`task_type inválido. Usa: ${Object.keys(TASKS).join(", ")}.`);
    if (!String(body.user_instruction || "").trim()) errors.push("user_instruction es obligatorio.");
    if (String(body.user_instruction || "").length > 4000) errors.push("user_instruction demasiado largo (máx 4000).");
  }
  return errors;
}

function normalizeContext(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  return { _raw_context: String(raw).slice(0, 2000) };
}

function contextLines(ctx) {
  const entries = Object.entries(ctx || {});
  if (!entries.length) return "Sin contexto adicional.";
  return entries
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

/* ────────────────────────────────────────────────────────────────────────
 * MOTOR LLM (Claude → OpenAI), con salida JSON estructurada y streaming
 * ──────────────────────────────────────────────────────────────────────── */

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary", "recommendation", "copy_ready", "variants", "risks",
    "next_actions", "kpis", "ab_tests", "missing_inputs", "quality_checks",
  ],
  properties: {
    summary: { type: "string", description: "Resumen ejecutivo en 2-3 frases de qué se generó y por qué funcionará." },
    recommendation: { type: "string", description: "Estrategia razonada: objetivo, público, ángulo elegido y por qué, canal y conversión principal. Varios párrafos cortos." },
    copy_ready: { type: "string", description: "El entregable completo listo para usar, siguiendo la especificación de la tarea. Es la pieza central: completo, concreto y en español de México." },
    variants: { type: "array", items: { type: "string" }, description: "3 variantes alternativas del mensaje/ángulo principal, cada una lista para usar." },
    risks: { type: "array", items: { type: "string" }, description: "Riesgos y validaciones pendientes antes de publicar." },
    next_actions: { type: "array", items: { type: "string" }, description: "Siguientes pasos concretos en orden, con plazo sugerido." },
    kpis: { type: "array", items: { type: "string" }, description: "3-5 métricas para medir esta pieza, con meta inicial realista." },
    ab_tests: { type: "array", items: { type: "string" }, description: "2-3 hipótesis A/B concretas (qué cambiar, qué medir, qué esperar)." },
    missing_inputs: { type: "array", items: { type: "string" }, description: "Datos que faltan y mejorarían el resultado." },
    quality_checks: { type: "array", items: { type: "string" }, description: "Checks de calidad ya aplicados al entregable." },
  },
};

function buildSystemPrompt(kb, task) {
  return `Eres el AI Growth Center: director(a) senior de growth marketing para tres negocios mexicanos reales. Generas piezas comerciales listas para usar, en español de México, con criterio de negocio (margen, conversión, medición) y cero invención de datos.

## Negocio activo: ${kb.label}
${kb.positioning}
Razón social / operación: ${kb.legal}
Zona: ${kb.zone}
Público: ${kb.audience}
CTA principal: ${kb.cta}

### Contacto real (usa EXACTAMENTE estos datos cuando el entregable lleve contacto)
- Teléfono: ${kb.contact.tel}
- WhatsApp: ${kb.contact.whatsapp} (${kb.contact.whatsapp_link})
${kb.contact.email ? `- Email: ${kb.contact.email}` : "- Email: no publicar (no hay email oficial)"}
- Dirección: ${kb.contact.address}
${kb.contact.hours ? `- Horario: ${kb.contact.hours}` : ""}

### Productos y servicios
${kb.products.map((p) => `- ${p}`).join("\n")}

### Claims seguros (los ÚNICOS datos duros que puedes afirmar)
${kb.claims_safe.map((c) => `- ${c}`).join("\n")}

### Datos que el negocio siempre debe confirmar con el cliente
${kb.needs.map((n) => `- ${n}`).join("\n")}

### Hallazgos de auditoría del sitio web (úsalos en auditorías, recomendaciones y notas de medición)
${kb.site_findings.map((f) => `- ${f}`).join("\n")}

## Reglas inquebrantables (guardrails)
${kb.guardrails.map((g) => `- ${g}`).join("\n")}
- Si falta un dato (precio, medida, litros), usa un marcador editable como [PRECIO] o [MEDIDAS] y repórtalo en missing_inputs.
- Nunca inventes estadísticas, certificaciones, garantías ni testimonios.
- Separa hechos (claims seguros) de inferencias y recomendaciones.

## Tarea solicitada: ${task.label}
Objetivo: ${task.goal}
Especificación del entregable (copy_ready DEBE cumplirla completa):
${task.deliverable}
Eventos de conversión típicos: ${task.conversion.join(", ")}
Checklist de calidad a auto-aplicar: ${task.checks.join(" · ")}

## Metodología (aplícala internamente antes de escribir)
1. INTAKE: entiende la instrucción y el contexto; detecta datos faltantes.
2. ESTRATEGIA: elige objetivo, público, ángulo y conversión; razona el porqué en "recommendation".
3. GENERACIÓN: escribe el entregable completo en "copy_ready" (es la pieza central, sé generoso y concreto).
4. QA: verifica guardrails y checklist; documenta en "quality_checks".
5. EMPAQUE: variantes, riesgos, próximas acciones, KPIs e hipótesis A/B.

Responde ÚNICAMENTE con el JSON del esquema indicado.`;
}

function buildUserPrompt(payload) {
  return `Instrucción del negocio:
${payload.user_instruction}

Contexto adicional proporcionado:
${contextLines(payload.optional_context)}

Genera la pieza ahora.`;
}

// Lee un stream SSE y entrega cada bloque "data: {...}" parseado.
async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch { /* fragmento no-JSON, ignorar */ }
    }
  }
}

async function callClaude(payload, kb, task, signal, onProgress) {
  const model = process.env.AI_GROWTH_MODEL || AI_MODEL_DEFAULT;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: [{ type: "text", text: buildSystemPrompt(kb, task), cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: buildUserPrompt(payload) }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  let text = "";
  let usage = null;
  for await (const ev of sseEvents(res)) {
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      text += ev.delta.text;
      onProgress(text.length);
    } else if (ev.type === "message_delta" && ev.usage) {
      usage = ev.usage;
    } else if (ev.type === "message_start" && ev.message?.stop_reason === "refusal") {
      throw new Error("El modelo rechazó la solicitud (refusal).");
    }
  }
  return { text, usage, model, engine: "claude" };
}

async function callOpenAI(payload, kb, task, signal, onProgress) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      stream: true,
      max_tokens: MAX_TOKENS,
      temperature: 0.5,
      response_format: {
        type: "json_schema",
        json_schema: { name: "growth_output", strict: false, schema: OUTPUT_SCHEMA },
      },
      messages: [
        { role: "system", content: buildSystemPrompt(kb, task) },
        { role: "user", content: buildUserPrompt(payload) },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  let text = "";
  for await (const ev of sseEvents(res)) {
    const delta = ev.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onProgress(text.length);
    }
  }
  return { text, usage: null, model: OPENAI_MODEL, engine: "openai" };
}

function parseLLMJson(text) {
  // El modelo puede envolver el JSON en texto; aislar el primer objeto completo.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Salida del modelo sin JSON.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  for (const key of OUTPUT_SCHEMA.required) {
    if (!(key in parsed)) throw new Error(`Salida del modelo incompleta: falta ${key}.`);
  }
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  return {
    summary: String(parsed.summary || ""),
    recommendation: String(parsed.recommendation || ""),
    copy_ready: String(parsed.copy_ready || ""),
    variants: arr(parsed.variants),
    risks: arr(parsed.risks),
    next_actions: arr(parsed.next_actions),
    kpis: arr(parsed.kpis),
    ab_tests: arr(parsed.ab_tests),
    missing_inputs: arr(parsed.missing_inputs),
    quality_checks: arr(parsed.quality_checks),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * MOTOR DETERMINISTA v2 (sin API key) — usa la base de conocimiento real
 * ──────────────────────────────────────────────────────────────────────── */

function deterministicGenerate(payload, kb, task) {
  const ctx = payload.optional_context || {};
  const inst = payload.user_instruction;
  const biz = payload.business;
  const W = kb.contact.whatsapp;
  const TEL = kb.contact.tel;
  const top3 = kb.claims_safe.slice(0, 3);
  const missing = kb.needs.filter((n) => !JSON.stringify(ctx).toLowerCase().includes(n.split(" ")[0].toLowerCase()));

  const generators = {
    google_ads: () => [
      `ESTRUCTURA DE CAMPAÑAS — ${kb.label}`,
      ``,
      `Campaña 1 · Alta intención (Search)`,
      `  Grupo A — Producto directo:`,
      biz === "asturvent"
        ? `    [ventanas pvc] [ventanas kömmerling] [ventanas de pvc precio] "ventanas pvc ${kb.zone.split("/")[0].trim().toLowerCase()}"`
        : biz === "sgm"
        ? `    [diesel para flotillas] [gasolinera para empresas] [combustible facturacion] "diesel metepec" "gasolinera flotillas toluca"`
        : `    [tienda de conveniencia metepec] "cafe cerca de mi" (nota: para Super Cheap prioriza GBP/local antes que Search pagado)`,
      `  Grupo B — Problema/solución:`,
      biz === "asturvent"
        ? `    [ventanas acusticas] [ventanas antiruido] [ventanas termicas] [doble vidrio]`
        : biz === "sgm"
        ? `    [descuento combustible flotillas] [tarjeta combustible empresas] [diesel ultra bajo azufre]`
        : `    [desayuno rapido metepec] [cafe para llevar]`,
      `  Grupo C — Local: agregar "+ Toluca / Metepec / CDMX" a las anteriores.`,
      ``,
      `Negativas iniciales: empleo, gratis, curso, manual, usado, segunda mano, reparación casera, mayoreo china.`,
      ``,
      `Anuncio RSA 1 (titulares ≤30c):`,
      ...(biz === "asturvent"
        ? [
            `  - Ventanas PVC Kömmerling`,
            `  - Hasta 47 dB Menos Ruido`,
            `  - Tecnología Alemana`,
            `  - 15+ Años de Experiencia`,
            `  - 3, 6 y 12 MSI`,
            `  - Cotización Sin Costo`,
            `  Descripciones: "Fabricación propia en Toluca con CNC de 5 ejes. Distribuidor oficial Kömmerling." / "Diagnóstico y cotización profesional sin compromiso. Respuesta en menos de 24 h hábiles." / "Aislamiento térmico y acústico real. Agenda tu visita al showroom Capultitlán."`,
          ]
        : biz === "sgm"
        ? [
            `  - Diesel UBA 48 Cetanos`,
            `  - 10¢–30¢ Menos Por Litro`,
            `  - Facturación Inmediata`,
            `  - Reto 2 Semanas Sin Riesgo`,
            `  - Mobil Synergy Metepec`,
            `  - Abierto 365 Días`,
            `  Descripciones: "Tarjeta prepago para flotillas con descuento por volumen y monitoreo en tiempo real." / "Diesel ultra bajo azufre apto para DPF/SCR/EGR. Prueba 2 semanas garantizada." / "CFDI al instante 24/7. Cotiza tu flotilla por WhatsApp ${W}."`,
          ]
        : [
            `  - Café Recién Hecho 5 AM`,
            `  - +500 Productos`,
            `  - En Tu Carga de Gasolina`,
            `  Descripciones: "Café chiapaneco y pan del día en SGM Mobil Metepec. Entra y sal en 3 minutos."`,
          ]),
      ``,
      `Extensiones: llamada (${TEL}), ubicación (${kb.contact.address}), sitelinks según secciones del sitio.`,
      `Presupuesto sugerido: iniciar $150–$350 MXN/día solo en Search exacta/frase; escalar únicamente con conversiones medidas.`,
      `Conversiones a configurar: clic en WhatsApp, llamada desde anuncio, envío de formulario.`,
      `⚠ Medición: ${kb.site_findings[0] || "verificar que el sitio tenga GA4 y eventos antes de invertir."}`,
    ].join("\n"),

    meta_ads: () => [
      `CONCEPTO 1 — Dolor directo`,
      `  Gancho visual: ${biz === "asturvent" ? "ventana abierta con ruido de tráfico → se cierra y silencio absoluto" : biz === "sgm" ? "tablero de camión con costo por km bajando" : "café humeante + cuernito en el mostrador, reloj marcando 6:55 AM"}`,
      `  Copy primario: ${inst}. ${top3[0]}.`,
      `  Titular: ${biz === "asturvent" ? "El silencio se nota desde el primer día" : biz === "sgm" ? "Tu flotilla puede pagar menos por litro" : "El antojo que te espera en tu carga"}`,
      `  CTA: Enviar mensaje → WhatsApp ${W}.`,
      ``,
      `CONCEPTO 2 — Prueba/confianza`,
      `  Gancho visual: ${biz === "asturvent" ? "instalación real en obra con equipo uniformado" : biz === "sgm" ? "factura CFDI generándose en el celular en segundos" : "estantes llenos + precio visible"}`,
      `  Copy primario: ${top3[1] || top3[0]} ${kb.cta}.`,
      ``,
      `HISTORIA (3 pantallas): 1) Hook con pregunta directa. 2) Beneficio + dato seguro (${top3[0]}). 3) CTA deslizar/WhatsApp.`,
      ``,
      `Público sugerido: ${kb.audience}. Radio: ${kb.zone}.`,
      `Presupuesto inicial: $100–$200 MXN/día, objetivo mensajes.`,
      `Evento de conversión: conversación iniciada en WhatsApp ${W}.`,
    ].join("\n"),

    tiktok: () => [
      `GUION DE VIDEO (30–40 s)`,
      `0–2 s HOOK: "${biz === "asturvent" ? "Esto es lo que pasa cuando cierras una ventana alemana" : biz === "sgm" ? "Así le bajas hasta 30 centavos a cada litro de tu flotilla" : "El secreto de los que madrugan en Metepec"}" (texto grande en pantalla).`,
      `2–15 s DESARROLLO: mostrar ${biz === "asturvent" ? "el antes/después del ruido (medidor de dB o reacción)" : biz === "sgm" ? "la tarjeta prepago + factura saliendo al instante" : "el café sirviéndose + cuernito + total en caja"}; narrar 1 dato seguro: ${top3[0]}.`,
      `15–25 s PRUEBA: ${top3[1] || "mostrar el producto/servicio real en uso"}.`,
      `25–35 s CTA: "${kb.cta}" — hablado + texto en pantalla.`,
      ``,
      `Texto en pantalla por escena: hook → dato → CTA (máx. 6 palabras por pantalla).`,
      `Audio: tendencia tranquila/energética según escena (sin marcar canción específica).`,
      `Caption: ${inst.slice(0, 80)}… ${biz === "asturvent" ? "#VentanasPVC #Kommerling #Toluca #Metepec #CDMX #Remodelacion" : biz === "sgm" ? "#Flotillas #Diesel #Metepec #Toluca #Transporte #Mobil" : "#Metepec #Cafe #Antojo #Toluca"}`,
      ``,
      `Hooks alternativos: 1) Pregunta de dolor ("¿${biz === "asturvent" ? "No puedes dormir por el ruido de la avenida" : biz === "sgm" ? "Sabes cuánto pierde tu flotilla por litro" : "Saliste sin desayunar otra vez"}?"). 2) Dato sorpresa con el claim: "${top3[0]}".`,
    ].join("\n"),

    promotion: () => [
      `PANTALLA (1:1, letras grandes):`,
      `  ${inst.replace(/crear |promo |promoción /gi, "").slice(0, 60).toUpperCase()}`,
      `  HOY ${ctx.precio && ctx.precio !== "editable" ? `· $${ctx.precio}` : "· [PRECIO]"}`,
      `  ${kb.label.toUpperCase()}`,
      ``,
      `WHATSAPP / ESTADO:`,
      `  ${inst} 😋 Hoy en ${kb.label} ${ctx.precio && ctx.precio !== "editable" ? `por $${ctx.precio}` : "a precio especial [PRECIO]"}. ${kb.cta}`,
      ``,
      `PIE: Válido hoy ${ctx.vigencia ? `(${ctx.vigencia})` : "[VIGENCIA]"} · hasta agotar existencias.`,
      ``,
      `CHECKLIST ANTES DE PUBLICAR: margen validado ✔/✘ · inventario suficiente ✔/✘ · precio autorizado ✔/✘.`,
    ].join("\n"),

    landing: () => [
      `WIREFRAME DE LANDING — objetivo único: ${task.conversion[0]}`,
      ``,
      `1. HERO`,
      `   H1: ${biz === "asturvent" ? "Ventanas PVC Kömmerling: hasta 47 dB menos ruido en tu casa" : biz === "sgm" ? "Tu flotilla con descuento de 10¢ a 30¢ por litro y factura al instante" : "Todo lo que necesitas, en tu carga de gasolina"}`,
      `   Sub: ${inst}`,
      `   CTA primario: "${kb.cta}" → ${kb.contact.whatsapp_link}`,
      ``,
      `2. PRUEBA / BENEFICIOS (3 tarjetas con claims publicados):`,
      ...top3.map((c) => `   • ${c}`),
      ``,
      `3. CÓMO FUNCIONA (3 pasos): contacto → ${biz === "asturvent" ? "visita técnica y medición sin costo" : biz === "sgm" ? "alta de tarjeta prepago y condiciones" : "visita la tienda"} → ${biz === "asturvent" ? "cotización formal en <24 h hábiles" : biz === "sgm" ? "carga con descuento y factura inmediata" : "compra en 3 minutos"}.`,
      ``,
      `4. OBJECIONES / FAQ: precio (sin precios públicos: explicar cotización personalizada), tiempos, cobertura (${kb.zone}).`,
      ``,
      `5. FORMULARIO (capturar SIEMPRE, además de WhatsApp): ${kb.needs.slice(0, 5).join(", ")} + teléfono.`,
      ``,
      `6. CIERRE: dirección real (${kb.contact.address})${kb.contact.hours ? ` · ${kb.contact.hours}` : ""} · Tel ${TEL}.`,
      ``,
      `MEDICIÓN: evento por clic a WhatsApp, envío de formulario y llamada. Nota técnica: agregar OG tags + schema.org LocalBusiness; comprimir imágenes (el sitio actual carga pesado).`,
    ].join("\n"),

    whatsapp: () => [
      `TOQUE 1 (hoy):`,
      `  Hola 👋, soy de ${kb.label}. ${inst.slice(0, 120)}. ${top3[0]}. ¿Te comparto la información? Para darte algo exacto solo necesito: ${kb.needs.slice(0, 3).join(", ")}.`,
      ``,
      `TOQUE 2 (48–72 h, si no responde):`,
      `  Hola de nuevo 🙂 Te dejo un dato útil mientras lo piensas: ${top3[1] || top3[0]}. Si me pasas ${kb.needs[0]}, te preparo ${biz === "asturvent" ? "una cotización formal sin costo" : biz === "sgm" ? "la simulación de ahorro de tu flotilla" : "el detalle de la promo"} hoy mismo.`,
      ``,
      `TOQUE 3 (día 7, cierre suave):`,
      `  ¿Seguimos en contacto? Si por ahora no es buen momento, no hay problema — me dices y te busco más adelante. Y si quieres avanzar, ${kb.cta.toLowerCase()}`,
      ``,
      `NOTA INTERNA: registrar respuesta/no respuesta y dato faltante (${missing.slice(0, 3).join(", ") || "ninguno"}) en tu control de leads.`,
    ].join("\n"),

    quote_followup: () => [
      `DÍA 0 — Reactivación con valor:`,
      `  Hola${ctx.nombre_cliente ? ` ${ctx.nombre_cliente}` : ""} 👋 Soy de ${kb.label}. Te envié la cotización ${ctx.piezas ? `de las ${ctx.piezas} piezas ` : ""}hace unos días y quería contarte algo que no incluí: ${top3[0]}. ¿Tienes alguna duda que pueda resolverte?`,
      ``,
      `DÍA 3 — Facilitar la decisión:`,
      `  Para ayudarte a decidir: ${biz === "asturvent" ? "manejamos 3, 6 y 12 MSI con cualquier banco (sujeto a validación) y la visita técnica no tiene costo" : top3[1] || top3[0]}. Si algo de la cotización no te cuadró (medida, color, precio), lo ajustamos sin problema.`,
      ``,
      `DÍA 7 — Cierre con salida fácil:`,
      `  No quiero saturarte 🙂 ¿Lo dejamos para más adelante o te aparto ${biz === "asturvent" ? "fecha de instalación" : "las condiciones"} de una vez? Cualquiera de las dos está perfecta, solo dime.`,
      ``,
      `NOTA INTERNA: confirmar antes del día 3 → ${missing.slice(0, 3).join(", ") || "datos completos"}.`,
    ].join("\n"),

    seo: () => [
      `KEYWORD PRINCIPAL: ${biz === "asturvent" ? "ventanas de pvc en toluca" : biz === "sgm" ? "diesel para flotillas en metepec" : "tienda de conveniencia metepec"}`,
      `SECUNDARIAS: ${biz === "asturvent"
        ? "ventanas kömmerling méxico · ventanas acústicas toluca · ventanas pvc metepec · ventanas pvc cdmx precio · pvc vs aluminio ventanas · ventanas antiruido · doble vidrio argón"
        : biz === "sgm"
        ? "gasolinera para empresas toluca · diesel ultra bajo azufre · tarjeta de combustible para flotillas · facturación gasolina metepec · gasolinera mobil metepec · descuento diesel volumen"
        : "café cerca de mí metepec · tienda 24 horas libramiento · desayuno rápido metepec"}`,
      ``,
      `TITLE (≤60c): ${biz === "asturvent" ? "Ventanas PVC Kömmerling en Toluca | AsturVent" : biz === "sgm" ? "Diesel para Flotillas en Metepec | SGM Mobil" : "Super Cheap Market | Tienda en Metepec"}`,
      `META (≤155c): ${biz === "asturvent" ? "Fabricantes de ventanas PVC Kömmerling con hasta 47 dB de aislamiento. 15+ años, MSI y cotización sin costo en Toluca, Metepec y CDMX." : biz === "sgm" ? "Diesel UBA 48 cetanos y descuento de 10¢–30¢ por litro para flotillas. Facturación inmediata 24/7 en Metepec. Cotiza por WhatsApp." : "Café, panadería y +500 productos dentro de la gasolinera Mobil de Metepec. Abierto desde las 5:00 AM."}`,
      ``,
      `OUTLINE:`,
      `  H1: keyword principal natural`,
      `  H2: el problema del cliente (${biz === "asturvent" ? "ruido/frío/calor" : biz === "sgm" ? "costo por litro y control de consumo" : "tiempo"}) · H2: la solución con claims seguros · H2: cómo funciona el proceso · H2: zona de servicio (${kb.zone}) · H2: FAQ`,
      ``,
      `FAQ sugerida:`,
      `  - ¿${biz === "asturvent" ? "Cuánto cuestan las ventanas de PVC?" : biz === "sgm" ? "Cuál es el descuento para flotillas?" : "A qué hora abren?"} → responder con el proceso real (sin inventar cifras).`,
      `  - ¿Dónde están ubicados? → ${kb.contact.address}.`,
      `  - ¿Cómo cotizo? → ${kb.cta}.`,
      ``,
      `TÉCNICO: agregar schema.org ${biz === "sgm" ? "GasStation" : "LocalBusiness"} + FAQPage, Open Graph, canonical, y crear esta página como URL propia (hoy el sitio es one-page).`,
    ].join("\n"),

    sales_analysis: () => [
      `FRAMEWORK DE ANÁLISIS — ${kb.label}`,
      ``,
      `Datos recibidos: ${Object.keys(ctx).length ? contextLines(ctx) : "ninguno (se entrega framework de captura)."}`,
      ``,
      `MÉTRICAS A RECOLECTAR (mínimo viable):`,
      ...(biz === "asturvent"
        ? [
            `  1. Leads por canal/semana (WhatsApp, llamada, formulario) → decide dónde invertir.`,
            `  2. % leads con cotización enviada y días hasta enviarla → mide fricción interna.`,
            `  3. % cotizaciones cerradas y ticket promedio por proyecto → mide calidad de lead.`,
            `  4. Motivo de no-cierre (precio, tiempo, competencia, silencio) → alimenta seguimiento.`,
          ]
        : biz === "sgm"
        ? [
            `  1. Litros/mes por cliente de flotilla y total → base del descuento por volumen.`,
            `  2. Altas nuevas de tarjeta prepago/mes y origen (WhatsApp, visita, referido).`,
            `  3. % clientes del Reto 2 Semanas que se quedan → valida la oferta estrella.`,
            `  4. Facturas emitidas/mes (proxy de clientes empresa) → segmento para remarketing.`,
          ]
        : [
            `  1. Ticket promedio y artículos por ticket → objetivo de combos.`,
            `  2. Ventas por franja horaria → cuándo promocionar café vs antojo.`,
            `  3. Top 10 productos por margen (no solo volumen) → qué empujar en pantalla.`,
          ]),
      ``,
      `FORMATO DE CAPTURA: hoja simple semanal (fecha, canal, lead/venta, monto, estado, motivo).`,
      `DECISIONES QUE HABILITA: presupuesto de pauta por canal, promociones por horario, y seguimiento priorizado.`,
    ].join("\n"),

    calendar: () => {
      const days = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"];
      const themes =
        biz === "asturvent"
          ? [
              ["Dolor: ruido", "Reel: medidor de dB junto a ventana", `"¿La avenida no te deja dormir? Hasta 47 dB menos ruido."`],
              ["Educativo", "Carrusel: PVC vs aluminio (sin marcas)", `"5 diferencias que tu bolsillo nota en 5 años."`],
              ["Obra real", "Foto/video de instalación", `"Hoy en obra: ${"corredera PremiSlide76"} en ${kb.zone.split("/")[0].trim()}."`],
              ["Confianza", "Post: fabricación CNC en Toluca", `"Fabricación propia, precisión de 0.01 mm."`],
              ["Oferta", "Historia: MSI", `"3, 6 y 12 MSI con cualquier banco. Cotiza sin costo."`],
              ["Social proof", "Antes/después", `"El cambio se escucha. Pide tu diagnóstico."`],
              ["CTA suave", "Post: showroom", `"Domingo de proyecto: agenda visita al showroom Capultitlán."`],
            ]
          : biz === "sgm"
          ? [
              ["Oferta estrella", "Post: Reto 2 Semanas", `"Prueba 2 semanas. Si no te convence, te quedas como estás."`],
              ["Técnico", "Carrusel: Diesel UBA 48 cetanos", `"97% menos azufre. Tu DPF te lo agradece."`],
              ["Facturación", "Historia: CFDI en segundos", `"Factura 24/7 sin filas: mobil.efectifactura.com"`],
              ["Flotillas", "Video: tarjeta prepago", `"De 10¢ a 30¢ menos por litro según tu volumen."`],
              ["Lubricantes", "Post: Delvac", `"Hasta 160,000 km entre cambios con Delvac."`],
              ["B2C", "Reel: Synergy Supreme+", `"Motor más limpio, 2–4% de ahorro estimado."`],
              ["Comunidad", "Foto equipo/estación", `"Abiertos los 365 días, de 5 a 23 h."`],
            ]
          : [
              ["Café madrugador", "Historia 6 AM", `"Café chiapaneco listo desde las 5. [PRECIO]"`],
              ["Combo", "Pantalla: café + cuernito", `"El combo del camino: café + cuernito [PRECIO]"`],
              ["Antojo", "Post: Vuala/Hershey's", `"Se te antoja a media tarde. Lo sabemos."`],
              ["Auto", "Post: Prestone/accesorios", `"Tu coche también tiene antojos."`],
              ["Viernes", "Pantalla: New Mix", `"Viernes. New Mix frío. [PRECIO]"`],
              ["Sábado", "Historia: desayuno", `"Sábado de pan del día desde las 7."`],
              ["Domingo", "Post: surtido", `"+500 productos para el domingo de flojera."`],
            ];
      return [
        `CALENDARIO SEMANAL — ${kb.label}`,
        ``,
        ...days.map((d, i) => `${d}\n  Tema: ${themes[i][0]} · Formato: ${themes[i][1]}\n  Copy: ${themes[i][2]}\n  CTA: ${kb.cta}`),
        ``,
        `RESPALDO: 1) Pregunta a la audiencia sobre su problema principal. 2) Detrás de cámaras del equipo.`,
        `MÉTRICA SEMANAL: ${biz === "supercheap" ? "ticket promedio y ventas del producto promocionado" : "conversaciones de WhatsApp iniciadas"}.`,
      ].join("\n");
    },

    audit: () => [
      `AUDITORÍA COMERCIAL — ${kb.label} (hallazgos del sitio real)`,
      ``,
      `HALLAZGOS PRIORIZADOS:`,
      ...kb.site_findings.map((f, i) => `  ${i + 1}. ${f}`),
      ``,
      `QUICK WINS (semana 1):`,
      `  • Instalar GA4 + Meta Pixel y eventos en todos los CTAs de WhatsApp (sin esto, nada se puede optimizar).`,
      `  • ${biz === "sgm" ? "Reparar el enlace roto de la App de Flotillas (404 en 3 lugares)." : biz === "asturvent" ? "Agregar Open Graph + favicon para que los enlaces compartidos por WhatsApp se vean profesionales." : "Crear ficha de Google Business Profile propia de la tienda."}`,
      `  • Publicar horarios${biz === "asturvent" ? " y testimonios/reseñas" : ""} de forma visible.`,
      ``,
      `PLAN 30 DÍAS:`,
      `  Semana 1: medición + quick wins de arriba.`,
      `  Semana 2: captura de leads duplicada (formulario que guarda el dato + WhatsApp), no solo wa.me.`,
      `  Semana 3: ${biz === "asturvent" ? "página SEO por ciudad principal (Toluca/Metepec/CDMX)" : biz === "sgm" ? "landing indexable de Diesel UBA para flotillas con calculadora de ahorro" : "promo de lealtad simple (tarjeta de sellos de café)"}.`,
      `  Semana 4: primera campaña pagada pequeña con conversiones ya medibles; revisar resultados.`,
      ``,
      `MÉTRICAS DE VERIFICACIÓN: leads/semana por canal, costo por conversación de WhatsApp, % de leads con datos completos (${kb.needs.slice(0, 3).join(", ")}).`,
    ].join("\n"),

    email: () => [
      `ASUNTOS A/B/C (≤45c):`,
      `  A) ${biz === "asturvent" ? "El ruido no entra. El confort sí." : biz === "sgm" ? "Tu flotilla puede pagar menos por litro" : "Tu café de las 6 AM ya está listo"}`,
      `  B) ${biz === "asturvent" ? "MSI en ventanas Kömmerling" : biz === "sgm" ? "Reto 2 semanas: pruébanos sin riesgo" : "Combo del camino: [PRECIO]"}`,
      `  C) ${inst.slice(0, 42)}`,
      `PREHEADER: ${top3[0]}`,
      ``,
      `CUERPO:`,
      `  Hola [NOMBRE],`,
      `  ${inst}`,
      `  ${top3[0]}. ${top3[1] || ""}`,
      `  👉 ${kb.cta}`,
      `  ${kb.contact.hours ? `Horario: ${kb.contact.hours}. ` : ""}${kb.contact.address}`,
      ``,
      `P.D.: ${biz === "asturvent" ? "La visita técnica y la cotización no tienen costo ni compromiso." : biz === "sgm" ? "La factura sale en segundos, 24/7, en mobil.efectifactura.com." : "Pregunta en caja por la promo del día."}`,
      ``,
      `SEGMENTACIÓN: enviar primero a contactos que pidieron cotización en los últimos 90 días.`,
    ].join("\n"),

    gbp: () => [
      `PUBLICACIÓN GBP:`,
      `  ${inst}. ${top3[0]}. ${kb.cta} 📍 ${kb.contact.address}${kb.contact.hours ? ` · ${kb.contact.hours}` : ""}.`,
      ``,
      `RESPUESTAS TIPO A RESEÑAS:`,
      `  ★★★★★ → "¡Mil gracias por tu confianza! Nos da gusto que ${biz === "asturvent" ? "notes la diferencia en silencio y confort" : biz === "sgm" ? "tu experiencia en la estación fuera buena" : "encontraras lo que buscabas"}. Te esperamos pronto."`,
      `  ★★★ → "Gracias por tomarte el tiempo. Nos encantaría saber qué podemos mejorar: escríbenos al ${W} y lo revisamos contigo."`,
      `  ★ → "Lamentamos que tu experiencia no fuera la esperada. Queremos corregirlo: por favor contáctanos al ${TEL} o WhatsApp ${W} y lo atendemos directamente." (nunca discutir en público).`,
      ``,
      `CHECKLIST DE FICHA: categoría correcta (${biz === "sgm" ? "Gasolinera" : biz === "asturvent" ? "Fábrica de ventanas / Contratista" : "Tienda de conveniencia"}), horario real${kb.contact.hours ? ` (${kb.contact.hours})` : ""}, teléfono ${TEL}, fotos recientes (mín. 10), atributos y zona de servicio (${kb.zone}).`,
    ].join("\n"),
  };

  const copy = (generators[payload.task_type] || generators.promotion)();

  return {
    summary: `${kb.label} · ${task.label}: ${inst.slice(0, 140)}${inst.length > 140 ? "…" : ""}`,
    recommendation: [
      `Objetivo: ${task.goal}`,
      `Público: ${kb.audience}.`,
      `Ángulos con datos seguros: ${top3.join(" | ")}.`,
      `Conversión principal: ${task.conversion[0]} → ${kb.cta}.`,
      `Contexto recibido:\n${contextLines(ctx)}`,
    ].join("\n"),
    copy_ready: copy,
    variants: [
      `Variante A (dolor): abre con el problema del cliente y cierra con "${kb.cta}".`,
      `Variante B (prueba): abre con el dato fuerte "${top3[0]}" y cierra con una pregunta.`,
      `Variante C (urgencia honesta): vigencia/cupo real + CTA directo (sin urgencia falsa).`,
    ],
    risks: [...kb.guardrails],
    next_actions: [
      `Completar los marcadores editables ([PRECIO], medidas, vigencia) antes de publicar.`,
      `Confirmar datos faltantes: ${missing.slice(0, 4).join(", ") || "ninguno detectado"}.`,
      `Configurar medición del evento "${task.conversion[0]}" (hoy el sitio no mide nada).`,
      `Publicar, registrar resultados 7 días y ajustar con las hipótesis A/B.`,
    ],
    kpis:
      biz === "sgm"
        ? ["Conversaciones de WhatsApp de flotillas/semana (meta inicial: 5)", "Altas de tarjeta prepago/mes (meta: 2)", "Costo por lead si hay pauta (< $150 MXN)"]
        : biz === "asturvent"
        ? ["Conversaciones de WhatsApp calificadas/semana (meta inicial: 8)", "Cotizaciones enviadas/semana (meta: 4)", "% cotización→venta (línea base a medir)", "Costo por lead en pauta (< $250 MXN)"]
        : ["Ventas del producto promocionado vs día normal (+20%)", "Ticket promedio semanal", "Respuestas al estado de WhatsApp"],
    ab_tests: [
      `A/B de gancho: dolor ("${biz === "asturvent" ? "ruido" : biz === "sgm" ? "costo por litro" : "antojo"}") vs dato duro ("${top3[0]}"). Medir respuestas a 7 días.`,
      `A/B de CTA: "${kb.cta}" vs CTA con pregunta ("¿Te cotizo hoy?"). Medir tasa de respuesta.`,
    ],
    missing_inputs: missing,
    quality_checks: [...task.checks, "Datos de contacto verificados contra el sitio publicado", "Sin precios, garantías ni estadísticas inventadas"],
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * QA DETERMINISTA (se aplica también a la salida del LLM)
 * ──────────────────────────────────────────────────────────────────────── */

function runQA(result, payload, kb) {
  const issues = [];
  const text = `${result.copy_ready}\n${result.variants.join("\n")}`;

  if (payload.business === "asturvent") {
    if (/veka|rehau|deceuninck|aluplast/i.test(text)) issues.push("⚠ Menciona marca competidora de PVC: eliminar antes de publicar.");
    if (/garant[ií]a de \d+\s*años/i.test(text)) issues.push("⚠ Afirma garantía en años no publicada: verificar con dirección.");
  }
  if (payload.business === "sgm") {
    if (/jade-semolina/i.test(text)) issues.push("⚠ Enlaza la app de flotillas rota (404): quitar el enlace.");
    if (/(4[0-9]|[5-9][0-9])\s*[¢c]/.test(text) && !/10|30/.test(text)) issues.push("⚠ Posible descuento fuera del rango publicado 10–30¢/litro.");
    if (/litro a \$\d/i.test(text)) issues.push("⚠ Posible precio de combustible inventado: verificar.");
  }
  if (payload.business === "supercheap") {
    const hasFixedPrice = /\$\s?\d+(\.\d{1,2})?/.test(text);
    const priceProvided = JSON.stringify(payload.optional_context || {}).match(/precio["':\s]+\d/);
    if (hasFixedPrice && !priceProvided) issues.push("⚠ Contiene precio fijo no proporcionado: cambiar a [PRECIO] o confirmar.");
  }
  const wrongWa = { asturvent: /729\s?266|7292661287/, sgm: /722\s?421|7224215439/, supercheap: /722\s?421|7224215439/ }[payload.business];
  if (wrongWa && wrongWa.test(text)) issues.push("⚠ El copy usa el WhatsApp de otro negocio: corregir número.");

  if (issues.length) {
    result.risks = [...issues, ...result.risks];
    result.quality_checks = [...result.quality_checks, `QA automático: ${issues.length} alerta(s) detectada(s) y reportada(s) en riesgos.`];
  } else {
    result.quality_checks = [...result.quality_checks, "QA automático: sin alertas (números de contacto, rangos de oferta y marcas verificados)."];
  }
  return result;
}

/* ────────────────────────────────────────────────────────────────────────
 * PIPELINE
 * ──────────────────────────────────────────────────────────────────────── */

function detectEngine() {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "deterministic";
}

async function runPipeline(payload, emit) {
  const phases = [];
  const phase = (id, name, status, detail = "") => {
    const entry = { id, name, status, detail };
    const idx = phases.findIndex((p) => p.id === id);
    if (idx >= 0) phases[idx] = entry;
    else phases.push(entry);
    emit({ type: "phase", ...entry });
  };

  // 1 · INTAKE
  phase("intake", "Intake y validación", "running");
  payload.optional_context = normalizeContext(payload.optional_context);
  phase("intake", "Intake y validación", "done", `Instrucción de ${payload.user_instruction.length} caracteres, ${Object.keys(payload.optional_context).length} datos de contexto.`);

  // 2 · KNOWLEDGE
  phase("knowledge", "Carga de conocimiento del negocio", "running");
  const kb = KB[payload.business];
  const task = TASKS[payload.task_type];
  phase("knowledge", "Carga de conocimiento del negocio", "done", `${kb.label} · ${task.label} · KB ${KNOWLEDGE_VERSION} (datos auditados del sitio real).`);

  // 3 · STRATEGY + GENERATION
  let result = null;
  let engine = detectEngine();
  let model = null;
  let usage = null;
  let fallbackNote = null;

  phase("strategy", "Estrategia", "running", engine === "deterministic" ? "Motor local (sin API key configurada)." : `Motor ${engine}.`);
  phase("strategy", "Estrategia", "done", "Objetivo, público, ángulo y conversión definidos.");
  phase("generation", "Generación de la pieza", "running");

  if (engine !== "deterministic") {
    const budget = Number(process.env.AI_TIME_BUDGET_MS) || 80000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    let lastEmit = 0;
    const onProgress = (chars) => {
      if (chars - lastEmit >= 500) {
        lastEmit = chars;
        emit({ type: "phase", id: "generation", name: "Generación de la pieza", status: "running", detail: `${chars} caracteres generados…` });
      }
    };
    try {
      const call = engine === "claude" ? callClaude : callOpenAI;
      const out = await call(payload, kb, task, controller.signal, onProgress);
      result = parseLLMJson(out.text);
      model = out.model;
      usage = out.usage;
    } catch (e) {
      fallbackNote = `El motor ${engine} no respondió (${String(e.message || e).slice(0, 160)}); se usó el motor local de respaldo.`;
      engine = "deterministic";
      result = null;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!result) {
    result = deterministicGenerate(payload, kb, task);
    if (fallbackNote) result.risks = [fallbackNote, ...result.risks];
  }
  phase("generation", "Generación de la pieza", "done", model ? `Modelo ${model}.` : "Motor determinista con base de conocimiento real.");

  // 4 · QA
  phase("qa", "Control de calidad (guardrails)", "running");
  result = runQA(result, payload, kb);
  phase("qa", "Control de calidad (guardrails)", "done", result.risks.some((r) => r.startsWith("⚠")) ? "Con alertas: revisar riesgos." : "Sin alertas.");

  // 5 · PACKAGE
  phase("package", "Empaque final", "done");

  return {
    ok: true,
    mode: engine,
    model,
    business: payload.business,
    business_label: kb.label,
    task_type: payload.task_type,
    task_label: task.label,
    summary: result.summary,
    recommendation: result.recommendation,
    copy_ready: result.copy_ready,
    variants: result.variants,
    risks: result.risks,
    next_actions: result.next_actions,
    kpis: result.kpis,
    ab_tests: result.ab_tests,
    usage,
    diagnostics: {
      mode: engine,
      knowledge_version: KNOWLEDGE_VERSION,
      missing_inputs: result.missing_inputs,
      conversion_events: task.conversion,
      quality_checks: result.quality_checks,
      phases,
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * HANDLER (Netlify Functions v2)
 * ──────────────────────────────────────────────────────────────────────── */

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "ai-growth-agent",
      version: 2,
      engine: detectEngine(),
      model: detectEngine() === "claude" ? process.env.AI_GROWTH_MODEL || AI_MODEL_DEFAULT : detectEngine() === "openai" ? OPENAI_MODEL : null,
      knowledge_version: KNOWLEDGE_VERSION,
      businesses: Object.keys(KB),
      tasks: Object.keys(TASKS),
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const errors = validate(body);
  if (errors.length) return json({ ok: false, error: errors.join(" ") }, 400);

  const payload = {
    business: body.business,
    task_type: body.task_type,
    user_instruction: String(body.user_instruction).trim(),
    optional_context: body.optional_context,
    output_format: body.output_format === "json" ? "json" : "text",
  };

  // Modo stream (NDJSON): fases en vivo + resultado final. Lo usa la UI.
  if (body.stream === true) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          const result = await runPipeline(payload, emit);
          emit({ type: "result", data: result });
        } catch (e) {
          emit({ type: "error", error: String(e.message || e) });
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  // Modo JSON simple (compatibilidad / tests). Con LLM puede acercarse al
  // timeout de la plataforma: la UI usa siempre stream:true.
  try {
    const result = await runPipeline(payload, () => {});
    return json(result);
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
};

export const config = {
  path: "/api/ai-growth-agent",
};
