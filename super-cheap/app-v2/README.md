# SUPER CHEAP — Dashboard v2 (Moderno)

Versión moderna en React + TypeScript + Tailwind + Recharts.

## Cómo correr localmente

```bash
cd super-cheap/app-v2
npm install
npm run dev
```

Abre http://localhost:5174

El proxy está configurado para hablar con las Netlify Functions cuando corras `netlify dev` en la carpeta `super-cheap`.

## Características actuales (idénticas al Panel Operativo v1)

- Filtros rápidos de fecha (hoy, 7d, mes, rango)
- Toggle de comparación de períodos
- KPIs densos y claros
- Gráfica principal de tendencia con Recharts (hermosa)
- Top artículos + Mix de pagos
- Dark mode nativo y elegante
- Diseño 2026 de alto nivel (Linear + Tremor aesthetic)

## Próximos pasos recomendados

- Conectar autenticación real (usar el mismo token)
- Añadir sparklines reales y hourly chart
- Implementar export PDF profesional con jsPDF
- Añadir filtros por caja y forma de pago (ya existen en v1)
- Cuando esté lista, cambiar el deploy de Netlify para servir esta carpeta

Esta es la evolución natural del dashboard actual.
