# Auditoría de sitios — base de conocimiento del AI Growth Center

Fecha de auditoría: **2026-06-12** (`KNOWLEDGE_VERSION` de la función).
Estos hallazgos alimentan la constante `KB` de `netlify/functions/ai-growth-agent.js`.
Si algún dato cambia (teléfono, horario, oferta), actualizar ambos archivos.

---

# 1. asturvent-web.netlify.app (AsturVent)

## 1.1 Datos de negocio

**Identidad**
- Nombre comercial: **AsturVent** · Razón social: **Puertas y Ventanas de Asturias, S.A. de C.V.**
- Posicionamiento: "Distribuidor oficial Kömmerling · México" (ficha oficial en kommerling.mx/red-oficial/estado-de-mexico/asturvent)
- Trayectoria: 15+ años
- Title: "AsturVent · Tecnología alemana Kömmerling · Fabricantes de Puertas y Ventanas PVC"

**Marcas**: Kömmerling (principal), Fossilized Wood (madera fosilizada, distribución única en México), Holz-Her Epicon y Cosmec Smart 30 (maquinaria CNC), Duo Vent (vidrio).

**Sistemas Kömmerling publicados**

| Sistema | Specs publicadas |
|---|---|
| KÖMMERLING76 AD Xtrem (76mm, 5 cámaras) | Uw 0.83 (tarjeta) / 0.73 (hero/configurador) ⚠ inconsistencia · Rw 47 dB · Clase 4 · RC2 |
| PremiDoor76 / Lux (corredera elevadora) | Ud desde 0.80 · hasta 400 kg/hoja · Clase 4 / 9A |
| EuroFutur Elegance (70mm) | Uw desde 0.91 · Uf 1.30 (tarjeta); JS: Uw 1.10, Rw 42, RC1 |
| PremiSlide76 | Uw desde 0.75 (tarjeta) / 0.70 (JS) · Rw 45 dB |
| PremiLine (84mm, 3 cámaras) | Uw desde 1.48 (tarjeta) / 1.40 (JS) · Rw 34/35 dB ⚠ inconsistencia |

**Otros productos/servicios**: aluminio línea española (rotura de puente térmico) y tradicional; madera fosilizada (deck, fachadas, pisos, pérgolas, saunas); CNC 5 ejes (HSK F63 a 24,000 RPM, precisión 0.01 mm); fabricación, instalación y mantenimiento; canal B2B de distribuidores (precio fábrica, capacitación Kömmerling, kit muestrario, fichas CAD/BIM).

**Claims técnicos clave**: acústico "hasta 47 dB" (K76 + laminado acústico), estanqueidad 9A, 3 juntas EPDM, herrajes RC2, vidrio Duo argón Low-E. **No hay garantías en años publicadas. No hay precios publicados.**

**Colores PVC (6)**: Embero, Roble natural, Negro, Blanco, Gris antracita, Gris plata.

**Cobertura**: 9 estados — Edo. de México, Morelos, Michoacán, Hidalgo, Querétaro, Puebla, Veracruz, Guerrero, Tlaxcala.

**Contacto**
- Teléfono: **722 198 3004** · WhatsApp: **+52 722 421 5439** (wa.me/527224215439, 16 enlaces)
- Email: **asturvent02@gmail.com**
- Dirección: **Km 1 Capultitlán–San Felipe, Toluca, Edo. Méx. 50260** (Showroom Capultitlán)
- Horarios: ❌ no publicados · Redes sociales: ❌ ninguna
- Financiamiento: **3, 6 y 12 MSI con cualquier banco** ("sujeto a validación")
- Promesa: "Respondemos en menos de 24 horas hábiles"

## 1.2 Estructura

One-page con anclas: Hero (tabs Hogar/Arquitectos/Canal pro) → ticker → manifesto (video) → tres rutas → #sistemas → #configurador (visualizador SVG interactivo) → acústica (video) → #composicion → #aperturas → #colores → proceso ("sin costo, sin compromiso") → #ecosistema → #servicios → #proyectos → #financiamiento → #contacto.

Formulario: **no guarda el lead** — compone un mensaje y abre wa.me. Campos: nombre, teléfono, ciudad/estado, tipo de profesional (cliente final/vidriero/aluminiero/arquitecto/constructor/desarrollador), tipo de proyecto, detalles.

Integraciones: **cero analytics/píxeles**, sin funciones, imágenes del WordPress viejo (i0.wp.com/asturvent.com ×29), 2 videos YouTube.

## 1.3 Diseño

Paleta: azul Kömmerling `#0070C0` / `#003C6B` / tinta `#0A2540`, ámbar `#FDB627`, naranja `#FC8405`; superficies claras `#FAFAF7/#F3F2ED`. Tipos: Inter, Fraunces (serif editorial con itálicas), JetBrains Mono. Estilo editorial premium de revista de arquitectura.

## 1.4 Fortalezas / debilidades

**Fortalezas**: funnel WhatsApp con 16 CTAs contextuales; segmentación B2C/arquitectos/B2B; specs verificables; visualizador interactivo diferenciador; MSI; meta tags básicos correctos.

**Debilidades**: HTML ~792KB (~530KB base64); sin OG/schema.org/canonical/favicon; una sola URL indexable; **cero medición**; lead no capturado (solo wa.me); sin horarios/testimonios/garantía/redes; email Gmail; H1 de marca y no de búsqueda; inconsistencias Uw 0.73 vs 0.83.

## 1.5 Oportunidades priorizadas

1. GA4 + Meta Pixel + eventos en los 16 CTAs de WhatsApp (prerrequisito de cualquier pauta).
2. Externalizar imágenes base64 a WebP propio (792KB → <100KB) y migrar las de i0.wp.com.
3. schema.org LocalBusiness/Product/FAQ + OG tags + canonical + favicon.
4. Duplicar formulario a Netlify Forms además de WhatsApp (capturar el lead siempre).
5. Páginas SEO por ciudad (Toluca, Metepec, Querétaro, CDMX…), aprovechando 9 estados de cobertura.
6. Testimonios, reseñas Google y casos con datos (m², sistema, dB antes/después).
7. Publicar garantía y horarios del showroom.
8. Unificar specs (Uw) y publicar fichas técnicas descargables (se prometen a arquitectos, no existen links).
9. Redes sociales + Google Business Profile con la dirección exacta.
10. Email en dominio propio y consolidación de dominio (asturvent.com apunta al WP viejo).

---

# 2. www.morgangasolineros.com.mx (SGM Mobil Metepec + Super Cheap)

## 2.1 Datos de negocio

**Identidad**
- Title: "SGM Mobil Metepec — Gasolinería Premium con Tecnología Synergy"
- Marca visible: **SGM MOBIL METEPEC** · dominio/chat: "Morgan Gasolineros" ⚠ doble identidad
- Operador de facturación: **13403 - SERVICIOS GASOLINEROS METEPEC**
- "Distribuidor Autorizado — Exxon Mobil México" · 1 estación (Metepec)

**Dirección**: Libramiento José María Morelos y Pavón 1711, frente a Universidad UMIN, Col. San Lorenzo Coacalco, CP 52140, Metepec, Edo. de México.

**Contacto**
- Teléfono oficina: **(722) 225-0814**
- WhatsApp flotillas: **(729) 266-1287** (wa.me/527292661287, 11 enlaces prellenados)
- Email: ❌ ninguno publicado · Redes sociales: ❌ ninguna

**Horarios**: gasolinera 5:00–23:00 los 365 días. Super Cheap: L–V 5:00–23:00, S–D 7:00–22:00.

**Productos**
- Mobil Synergy Extra (87 oct) y Supreme+ (91 oct, "5× detergentes", ahorro 2–4%)
- **Diesel UBA**: 48 cetanos (vs 45), 97% menos azufre, compatible DPF/SCR/EGR, refinería ExxonMobil Beaumont
- Lubricantes Mobil 1 (–50°C a 200°C), Delvac (hasta 160,000 km), Prestone
- **Flotillas**: tarjeta prepago con descuento **10¢–30¢/litro** por volumen, monitoreo en tiempo real, facturación inmediata, **"Reto 2 semanas" garantizado**
- Facturación CFDI 24/7: mobil.efectifactura.com
- Tienda **Super Cheap Market** (+500 productos)

## 2.2 Estructura

One-page (593KB): #hero (video drone) → banner facturación → #synergy → #diesel → #lubricantes → #flotillas → #galeria (80 fotos/45 videos desde Google Drive) → #pitstop → #supercheap → #ubicacion → #agentes.

- **Sin formularios** (solo chat IA). Cero captura de leads; todo se deriva a WhatsApp.
- Chat IA vía `gemini-proxy.php` (funciona), pero **el system prompt completo está expuesto en el HTML** (políticas internas y temas prohibidos visibles).
- **Enlace roto crítico**: "App de Flotillas" → jade-semolina-ece7ce.netlify.app devuelve **404** (aparece 3 veces).
- Sin analytics ni píxeles.

## 2.3 Diseño

Rojo Mobil `#e00020`, fondos oscuros `#080808–#272727`, Inter única tipografía, estilo dark premium/cinematográfico con video drone y branding F1/Pit Stop.

## 2.4 Fortalezas / debilidades

**Fortalezas**: propuesta B2B cuantificada (10–30¢/L + Reto 2 Semanas sin riesgo); contenido técnico diferenciador (cetanos, Synergy, Delvac); facturación 24/7 prominente; chat IA con escalación a WhatsApp; horarios y ubicación claros.

**Debilidades**: app de flotillas rota (404 ×3); cero medición; sin formulario ni email; sin redes (Pit Stop pide "síguenos" sin destino); SEO pobre (sin OG/JSON-LD GasStation/canonical, one-page); HTML 593KB con base64 y galería dependiente de Google Drive; doble identidad Morgan/SGM; prompt del chat expuesto; dos links de Maps distintos.

## 2.5 Oportunidades priorizadas

1. Reparar/republicar la App de Flotillas (404) — corrección de conversión #1.
2. Formulario de cotización de flotillas (empresa, unidades, combustible, litros/mes, contacto) a CRM/email, no solo WhatsApp.
3. GA4 + Meta Pixel + conversiones de WhatsApp antes de invertir en pauta.
4. Landing indexable de Diesel UBA para transportistas con calculadora de ahorro.
5. JSON-LD GasStation + OG + canonical; unificar dirección y un solo link de Maps.
6. One-pager PDF del "Reto 2 Semanas" como lead magnet B2B.
7. Email corporativo visible + remarketing al segmento que factura.
8. Crear y enlazar redes sociales; publicar la galería oculta de Google Drive.
9. Programa de lealtad B2C simple sobre la infraestructura de prepago.
10. Externalizar imágenes base64, autohospedar galería y mover el prompt del chat al servidor.

---

# 3. Implicaciones para el agente (resumen ejecutivo)

- **Claims seguros por negocio** (lo único que el agente puede afirmar): ver `KB.claims_safe` en la función.
- **Guardrails**: sin precios inventados (ninguno de los dos sitios publica precios), sin garantías en años (AsturVent no publica ninguna), descuentos SGM solo 10–30¢/L, sin marcas competidoras (AsturVent), sin temas regulatorios (SGM), precios de Super Cheap siempre `[PRECIO]`.
- **Números de WhatsApp distintos por negocio**: AsturVent 722 421 5439 · SGM/Super Cheap 729 266 1287. El QA automático verifica que no se crucen.
- **Hallazgo transversal**: ninguno de los sitios mide nada (sin GA4/píxeles). Toda recomendación de pauta del agente incluye la advertencia de instalar medición primero.
