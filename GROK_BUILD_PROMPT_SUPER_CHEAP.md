Actua como director creativo UI/UX, arquitecto frontend senior, analista de retail/POS y diseñador de dashboards business intelligence.

Proyecto: SUPER CHEAP

Objetivo principal:
Rediseñar y mejorar una app interna de ventas de tienda conectada a SICAR. Queremos una app moderna, impresionante, clara y util para el dueño/administracion: ventas en automatico, historico, tendencias, productos top, comparativos y alertas accionables.

Contexto del sistema:
- App web publicada en Netlify: https://supercheapp.netlify.app
- Repo local principal: C:\Users\WorkStation\Downloads\ASTURVENT-supercheap-inspect
- Rama de trabajo actual: codex/super-cheap-sicar-finish
- Rama productiva usada: claude/super-cheap-dashboard-jhZyZ
- Ya existe un puente local Node.js en super-cheap/sicar-bridge.
- Ese bridge lee SICAR/MySQL local desde la PC de tienda y sube ventas a la app.
- Ya existe daemon oculto que sincroniza automaticamente hoy y dias recientes.
- Ya existe backfill historico corriendo desde 2024-05-01 hasta 2026-05-30, dia por dia, con reintentos.
- La app recibe ventas por fecha, ticket, caja, producto/articulo, cantidad, importe, precio, forma de pago, clave/codigo y posiblemente departamento/categoria.
- No queremos landing page. Queremos que la primera pantalla sea dashboard operativo real.

Reglas importantes:
- No leas, imprimas, copies ni publiques secretos: config.json, .env, tokens, contrasenas, service accounts, claves de ingesta.
- No modifiques el bridge SICAR ni ingestion backend salvo que sea estrictamente necesario y lo expliques.
- No rompas la subida automatica de ventas.
- No borres datos.
- No hagas cambios destructivos de git.
- Si haces commits, que sean pequenos y claros.
- Mantener enfoque en frontend/dashboard primero.

Lo que necesito de ti:

FASE 1 - Investigacion visual actual
Busca en la web tendencias actuales 2025-2026 de dashboards modernos, retail analytics, POS analytics, SaaS dashboards, data visualization y BI para pequenas/medianas empresas. Busca referencias de apps impresionantes, no genericas.

Quiero que revises ideas de:
- Layouts densos pero elegantes.
- Dashboards para ventas diarias y comparativos.
- Graficas modernas, microinteracciones y filtros.
- Paletas actuales para apps comerciales.
- UX mobile y desktop.
- Tendencias en data cards, trend badges, sparklines, heatmaps, cohort/period comparison, top products, payments mix.
- Buenas practicas de Recharts/ECharts/Visx/Nivo/Tremor/Shadcn/Radix/Tailwind o librerias equivalentes que encuentres en el repo.

Entregable de FASE 1:
1. 5 referencias visuales concretas con links.
2. 3 posibles direcciones visuales para SUPER CHEAP.
3. Pros/contras de cada direccion.
4. Recomendacion clara de una direccion final.

FASE 2 - Propuesta de rediseño SUPER CHEAP
Diseña una propuesta completa para la app:
- Paleta con hex codes.
- Tipografia.
- Sistema de espaciado y radios.
- Componentes principales.
- Navegacion.
- Dashboard desktop.
- Dashboard mobile.
- Filtros por fecha: hoy, ayer, 7 dias, mes, rango, historico.
- KPIs principales.
- Graficas prioritarias.
- Tablas de articulos/ventas.
- Estados vacio, cargando, error, sincronizando, ultima actualizacion.
- Vista para comparar periodos.
- Vista de productos top y productos que caen/suben.
- Vista de formas de pago.
- Alertas accionables para el dueño.

Entregable de FASE 2:
Un documento de especificacion visual y funcional listo para implementar.

FASE 3 - Implementacion en codigo
Despues de proponer la direccion, revisa el repo, identifica stack y estructura actual. Implementa el rediseño directamente si es razonable.

Prioridades de implementacion:
1. Dashboard principal operativo, no marketing.
2. KPIs: ventas hoy, ventas ayer, ventas mes, ticket promedio, tickets, unidades/articulos, tendencia vs periodo anterior.
3. Graficas: ventas por dia, ventas por hora si hay datos, top articulos, categorias/departamentos, formas de pago.
4. Filtros de fecha rapidos y rango personalizado.
5. Tabla moderna de articulos/ventas con busqueda y orden.
6. Responsive real desktop/mobile.
7. Modo claro/oscuro si el stack lo permite sin romper.
8. Estados de carga y error.
9. Pulido visual: colores modernos, contraste, iconos, cards compactas, tooltips.

Restricciones de diseño:
- No hacer hero landing page.
- No usar decoracion vacia tipo blobs/orbs.
- No saturar todo con una sola familia de color.
- Interfaz de operacion: clara, densa, elegante, rapida de leer.
- Cards con radio moderado, no exagerado.
- Evitar textos explicativos largos dentro de la app.
- Las graficas deben ayudar a tomar decisiones, no ser decorativas.

Despues de implementar:
- Ejecuta build/test/lint disponibles.
- Reporta archivos modificados.
- Reporta cualquier comando que falle.
- Resume decisiones de diseño.
- Dame siguientes mejoras recomendadas.

Primero responde con:
1. Que stack detectaste.
2. Que referencias/tendencias encontraste.
3. Tu direccion visual recomendada.
4. Plan corto de implementacion.
Luego implementa.
