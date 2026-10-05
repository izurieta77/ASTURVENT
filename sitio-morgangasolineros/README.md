# morgangasolineros.com.mx — sitio público

Código fuente del sitio de **SGM Mobil Metepec (Gasolineros Morgan)**.
Hasta ahora el sitio vivía solo en el hosting; aquí queda versionado.

---

## Qué subir al hosting

Sube el contenido de esta carpeta a la raíz pública del dominio
(`public_html/` o equivalente en el panel del hosting):

```
index.html
robots.txt
sitemap.xml
img/            (carpeta completa — 8 archivos)
```

### No borrar del servidor

Estos archivos ya están en el hosting, no se tocan y **no** deben eliminarse:

| Archivo | Para qué sirve |
|---|---|
| `gemini-proxy.php` | Backend del asistente del sitio. Guarda la API key del lado del servidor. |
| `enviar.php` | Endpoint de contacto heredado. |
| `hero-drone-720.mp4` | Video del encabezado (3.2 MB). El sitio lo sigue usando. |
| `hero-drone.mp4` | Versión de 14.7 MB. Ya **no** se usa; se puede conservar o borrar. |
| `favicon.ico` | Ícono del sitio. |

`hero-bg.jpeg` ya no se referencia: el encabezado ahora usa `img/hero-estacion.jpg`.

---

## Qué cambió respecto a la versión anterior

**Peso y velocidad**
- El HTML pasó de **593 KB a 114 KB**. Las 5 imágenes venían incrustadas en
  base64 dentro del HTML (458 KB, y tres de ellas duplicadas); ahora son
  archivos reales en `img/`, en WebP con respaldo JPEG, con `width`/`height`
  declarados y carga diferida.
- El encabezado ya no arranca en negro: `hero-bg.jpeg` devolvía **404** y el
  respaldo estático nunca se veía. Ahora hay una foto real de la estación que
  carga de inmediato.
- El video de 14.7 MB dejó de ser la fuente por omisión. En escritorio se carga
  la versión de 720p **después** de la foto; en móvil, con datos limitados o con
  "reducir movimiento" activado, no se descarga video.

**Posicionamiento en buscadores**
- Datos estructurados `GasStation` (dirección, coordenadas reales, horario,
  teléfono, formas de pago, servicios) y `FAQPage` con cinco preguntas.
- Etiqueta canónica, Open Graph y Twitter Card con imagen de 1200×630.
- Se retiró `<meta name="keywords">`, que Google ignora desde hace años.

**Contenido y conversión**
- Calculadora de ahorro de flotilla: litros al mes × descuento por litro, con el
  resultado precargado en el mensaje de WhatsApp.
- Formulario de cotización que arma el mensaje de WhatsApp con los datos de la
  flota. No guarda nada en el sitio.
- La iconografía con emojis se reemplazó por un juego de íconos SVG.
- Enlace a la app de flotillas apuntando a `appsgm.netlify.app` en lugar de la
  dirección genérica de Netlify.

**Accesibilidad**
- Texto alternativo en todas las imágenes, foco visible, estados ARIA en el
  menú, y respeto a `prefers-reduced-motion`.

---

## Galería

### Contenido retirado de la vista pública

La lista `EXCLUIR_DE_GALERIA` dentro de `index.html` deja fuera diez archivos que
estaban publicados pero no son fotos de las instalaciones. Para volver a mostrar
alguno, basta con borrar su línea de esa lista.

- Dos láminas de **capacitación interna de despachadores** (incluían el
  protocolo de actuación ante inspecciones y clientes molestos).
- Una lámina de trabajo de NotebookLM.
- Los logos de Gasolineros Morgan y Super Cheap Market, que ahora aparecen en el
  encabezado y en la sección de tienda.
- Dos tomas de dron sobre un terreno.
- Tres piezas publicitarias de bebidas alcohólicas.

### Fotos que ya no cargan

**34 de las 38 imágenes de la galería de la tienda dejaron de servirse desde
Google Drive**: devuelven una página HTML en vez de la imagen, así que en el
sitio anterior aparecían como recuadros grises. El código ahora comprueba cada
foto antes de ponerla en la página, y el bloque "Dentro de la tienda" se oculta
solo si quedan menos de tres.

Para recuperarlas hay que volver a compartir esos archivos en Drive con permiso
de lectura pública. A mediano plazo conviene alojar las fotos en el propio
hosting (`img/`) en vez de depender de Drive.
