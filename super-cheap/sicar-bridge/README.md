# Puente SICAR → SUPER CHEAP (sicar-bridge)

Este pequeño programa toma las **ventas del día** que guarda tu sistema **SICAR**
(que usa una base de datos MySQL en tu computadora) y las **envía al panel SUPER CHEAP**
en internet. Así no tienes que capturar las ventas a mano: se sincronizan solas.

Está pensado para correr en la **misma PC donde está instalado SICAR**.

> **NOTA IMPORTANTE (léela):** La consulta de ventas (`sqlVentas` en `config.json`)
> es solo un **ejemplo orientativo**. Cada versión de SICAR puede tener nombres de
> tablas y columnas distintos. Es **muy probable que tengas que ajustar esa consulta**
> al esquema real de tu base. Más abajo te explicamos cómo averiguar esos nombres.

---

## 1. Instalar Node.js (una sola vez)

1. Entra a https://nodejs.org
2. Descarga la versión **LTS** (botón verde grande).
3. Instálala con "Siguiente, Siguiente, Siguiente" (deja todo por defecto).
4. Para comprobar que quedó bien, abre el **Símbolo del sistema** (busca "cmd" en el menú Inicio)
   y escribe:

   ```
   node --version
   ```

   Debe aparecer algo como `v20.x.x`. Necesitas **versión 18 o mayor**.

---

## 2. Preparar la carpeta del puente

1. Copia toda la carpeta `sicar-bridge` a un lugar fácil de tu PC, por ejemplo:
   `C:\super-cheap\sicar-bridge`
2. Abre el Símbolo del sistema **dentro de esa carpeta**. Truco fácil:
   abre la carpeta en el Explorador, haz clic en la barra de dirección,
   escribe `cmd` y presiona Enter.
3. Instala lo que necesita el programa (una sola vez):

   ```
   npm install
   ```

   Esto descarga el conector de MySQL (`mysql2`). Tardará un momento.

---

## 3. Crear y llenar tu `config.json`

1. En la carpeta verás un archivo `config.example.json`. **Cópialo** y renombra la copia a
   `config.json` (sin "example").
2. Ábrelo con el Bloc de notas y llena tus datos:

   - **mysql.host**: normalmente `127.0.0.1` (la misma PC).
   - **mysql.port**: normalmente `3306`.
   - **mysql.user** y **mysql.password**: el usuario y contraseña de MySQL de SICAR.
     (Si no los conoces, pregúntale a quien instaló SICAR; a veces el usuario es `root`.)
   - **mysql.database**: el nombre de la base de datos de SICAR (ver paso 4).
   - **siteUrl**: la dirección de tu panel en internet, ej. `https://super-cheap.netlify.app`
   - **ingestToken**: una clave secreta. **Debe ser EXACTAMENTE LA MISMA** que pusiste en
     Netlify en la variable `SICAR_INGEST_TOKEN`.
   - **sqlVentas**: la consulta SQL (ver paso 5).

> El archivo `config.json` **no se sube a internet** y queda solo en tu PC.

---

## 4. Averiguar el nombre de la base y de las tablas de SICAR

Como cada SICAR puede ser distinto, necesitas ver qué nombres usa el tuyo.
Abre el Símbolo del sistema y entra a MySQL (ajusta usuario/contraseña):

```
mysql -u root -p
```

Te pedirá la contraseña. Una vez dentro (verás `mysql>`):

1. **Ver todas las bases de datos:**

   ```sql
   SHOW DATABASES;
   ```

   Busca la que parezca de SICAR (suele llamarse algo como `sicar`, `sicardb`,
   `sicar_xxx`, etc.). Ese nombre va en `mysql.database` del `config.json`.

2. **Entrar a esa base** (cambia el nombre por el tuyo):

   ```sql
   USE sicar;
   ```

3. **Ver las tablas:**

   ```sql
   SHOW TABLES;
   ```

   Busca tablas relacionadas con ventas (ej. `venta`, `ventas`, `ticket`, `detalle_venta`,
   `forma_pago`...).

4. **Ver las columnas de una tabla** (ej. la de ventas):

   ```sql
   DESCRIBE venta;
   ```

   Con esto sabrás los nombres reales de las columnas (fecha, total, etc.).

5. Para salir de MySQL escribe `exit;`.

---

## 5. Ajustar la consulta de ventas (`sqlVentas`)

El panel SUPER CHEAP necesita recibir cada venta con **estos nombres de columna exactos**:

| Columna      | Qué es                                            |
|--------------|---------------------------------------------------|
| `fecha`      | Fecha de la venta (AAAA-MM-DD)                    |
| `ticket_id`  | Número/folio único del ticket                     |
| `total`      | Total cobrado de la venta                          |
| `forma_pago` | Efectivo, tarjeta, etc.                            |
| `items`      | Cuántos artículos llevó esa venta                 |

Por eso, en la consulta usamos **alias** (`AS`) para que las columnas salgan con esos
nombres aunque en tu base se llamen distinto. También usamos el texto `:fecha` donde
queremos filtrar por día; el programa lo reemplaza automáticamente por la fecha que pidas.

Ejemplo orientativo (ya viene en `config.example.json`):

```sql
SELECT DATE(v.fecha)            AS fecha,
       v.idVenta                AS ticket_id,
       v.total                  AS total,
       fp.nombre                AS forma_pago,
       COUNT(d.idDetalle)       AS items
FROM venta v
LEFT JOIN detalle_venta d ON d.idVenta = v.idVenta
LEFT JOIN forma_pago   fp ON fp.idFormaPago = v.idFormaPago
WHERE DATE(v.fecha) = :fecha
GROUP BY v.idVenta
```

**Cambia los nombres de tablas y columnas** por los que viste en el paso 4.
Recuerda que el `config.json` necesita la consulta en **una sola línea** (es un texto JSON).

---

## 6. Ejecutarlo manualmente

Dentro de la carpeta, en el Símbolo del sistema:

- Sincronizar las ventas de **HOY**:

  ```
  node sync.js
  ```

- Sincronizar las ventas de un **día específico** (formato AAAA-MM-DD):

  ```
  node sync.js 2026-05-28
  ```

También puedes usar:

```
npm start
```

Si todo salió bien verás algo como:
`[OK] Listo. Recibidos: 42, insertados (nuevos): 42.`

El envío es **idempotente**: si lo corres dos veces el mismo día, no se duplican las ventas.

---

## 7. Programarlo para que corra solo cada día (Windows)

Para que las ventas se suban automáticamente (ej. todas las noches):

1. Abre el menú Inicio y busca **"Programador de tareas"**.
2. Clic derecho en **"Biblioteca del Programador de tareas" → "Crear tarea básica..."**.
3. Nombre: `Sincronizar ventas SUPER CHEAP`. Clic en **Siguiente**.
4. Desencadenador: **Diariamente** → Siguiente. Elige una hora (ej. 11:00 PM,
   cuando ya cerraste la tienda). Siguiente.
5. Acción: **Iniciar un programa** → Siguiente.
6. En **Programa o script** escribe:

   ```
   node
   ```

   En **Agregar argumentos** escribe:

   ```
   sync.js
   ```

   En **Iniciar en (opcional)** pon la ruta de la carpeta, por ejemplo:

   ```
   C:\super-cheap\sicar-bridge
   ```

7. Siguiente → **Finalizar**.

> Si Windows no encuentra `node`, en el paso 6 usa la ruta completa de Node, normalmente:
> `C:\Program Files\nodejs\node.exe`

Listo. A partir de ahí, cada noche se subirán las ventas del día solas.

---

## Problemas comunes

- **"No encontré config.json"** → copia `config.example.json` a `config.json` y llénalo.
- **"No pude conectar a MySQL"** → revisa usuario/contraseña/base y que SICAR/MySQL estén encendidos.
- **"La consulta SQL falló"** → casi siempre los nombres de tablas/columnas no coinciden;
  vuelve al paso 4 y 5.
- **HTTP 401/403** → el `ingestToken` no coincide con `SICAR_INGEST_TOKEN` en Netlify.
