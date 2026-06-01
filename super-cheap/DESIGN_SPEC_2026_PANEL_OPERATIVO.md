# SUPER CHEAP — Especificación de Rediseño UI/UX 2026
## Panel Operativo (Primera Pantalla)

**Fecha:** 2026-06
**Enfoque:** Dashboard operativo de ventas (SICAR) — denso, elegante, accionable. Sin landing.

---

## 1. Dirección Visual Elegida
**Modern Operational (Elevated Brand Light + Excelente Dark Mode)**

- Mantiene identidad navy (#1e3a8a) + orange (#f97316) de marca, pero los usa con disciplina.
- Paleta neutra limpia 2026 (slate/zinc).
- Dark mode de primera clase (persiste en localStorage).
- Radios moderados (10-12px), sombras sutiles, alta densidad sin ruido.
- Tipografía: Inter + Montserrat (ya presente).

**Referencias principales usadas:**
- Be Confidency POS Sales Analytics (Dribbble)
- AI-POS Retail Dashboard 2026
- Retail POS Analytics + Inventory (2026)
- Modern AI SaaS Analytics (glass + claridad)

---

## 2. Sistema de Diseño (tokens principales)

**Colores**
- `--bg`: #f8fafc (light) / #0f172a (dark)
- Navy y Orange solo en acentos y CTAs
- Semánticos: verde crecimiento, rojo/ámbar alerta

**Radios:** `--r: 12px`, `--r-sm: 8px`

**Espaciado:** Tailwind scale + sistema existente

**Componentes clave:**
- `kpi-modern`: tarjetas con delta + spark potencial
- Tabla top productos con badges de tendencia
- Barras de mix de pago
- Alertas accionables (warn/info/positive)
- Range pills globales + toggle de comparación

---

## 3. Estructura del Panel Operativo (default view)

1. **Controles globales persistentes** (en header)
   - Pills: Hoy | Ayer | 7d | Mes | Rango
   - Toggle "Comparar con período anterior"
   - Dark toggle + Refresh + Logout

2. **Hero KPIs (6 cards responsive)**
   - Ventas (con delta vs anterior)
   - Ticket promedio + # tickets
   - Unidades vendidas
   - Utilidad neta
   - Margen %

3. **Tendencia principal**
   - Línea de ventas por día
   - Overlay de período anterior cuando "Comparar" está activo

4. **Dos columnas:**
   - Top 8 artículos (nombre, cantidad, importe, delta %)
   - Mix de formas de pago (barras + % + insight)

5. **Alertas accionables** (derivadas de datos)
   - Caídas fuertes, concentración de pagos, etc.

6. **Estado inferior:** última actualización + "forzar sincronización"

---

## 4. Filtros y Comportamiento

- Filtros globales actualizan **todo** el Panel.
- Comparación calcula período anterior de misma longitud.
- Agregaciones de Top Productos y Pagos se hacen en cliente a partir de `?action=lista&tabla=ventas` (sin tocar backend).

---

## 5. Estados

- Skeletons en KPIs y secciones al cargar
- Empty states claros
- Error con mensaje + retry (botón refrescar)
- Banner sutil de "Sincronización automática SICAR"

---

## 6. Responsive

- Desktop: grids densos (6 KPIs, 7+5 columnas)
- Mobile: stack vertical, KPIs en 2 columnas, tablas con scroll horizontal

---

## 7. Restricciones Respetadas

- Primera pantalla = Panel Operativo real (sin hero/landing)
- Sin blobs, orbs ni decoración vacía
- Gráficas útiles para decidir (no decorativas)
- No se modificó sicar-bridge, ingestion, ni ningún secreto
- Stack vanilla + CDNs mantenido (Tailwind Play CDN añadido para velocidad de modernización)

---

## 8. Archivos Modificados

Único archivo tocado:
- `super-cheap/index.html` (frontend completo)

Cambios son aditivos y no destructivos para flujos existentes (login, otras pestañas, export, IA de tickets, etc.).

---

## 9. Próximas Mejoras Recomendadas (post este rediseño)

1. Sparkline reales dentro de las tarjetas KPI (mini Chart.js instances).
2. Filtro por caja / forma de pago en el propio Panel.
3. "Por hora" chart si los datos de SICAR traen hora con buena cobertura.
4. Comparación real YoY (no solo período anterior inmediato).
5. Export PDF del Panel completo con jsPDF o similar.
6. (Opcional futuro) Migración progresiva a Vite + React + Tremor si el negocio escala.
7. Persistir el último rango elegido del usuario.

---

**Listo para desplegar.** Abre el `index.html` localmente o haz deploy en Netlify (base dir = `super-cheap/`).

El Panel ahora es la herramienta diaria del dueño.
