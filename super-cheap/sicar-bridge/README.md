# Puente SICAR → SUPER CHEAP (para SICAR 4 en Windows)

Este pequeño programa corre en la **computadora donde está instalado SICAR** y manda
las **ventas** del día a tu panel `https://supercheapp.netlify.app` de forma automática.

> Solo **lee** las ventas de SICAR. No modifica ni borra nada de tu SICAR.

Se hace en **2 etapas**:
- **Etapa A (una vez):** "descubrir" cómo se llaman las tablas de tu SICAR y armar la consulta.
- **Etapa B (diario):** sincronizar las ventas (se puede dejar automático).

---

## Requisitos previos

1. **Node.js** instalado en esa PC. Descárgalo de https://nodejs.org (botón verde **LTS**,
   siguiente-siguiente-instalar). Para comprobar: abre `cmd` y escribe `node --version`
   (debe salir v18 o mayor).
2. La carpeta **`sicar-bridge`** copiada en la PC (por ejemplo en `C:\super-cheap\sicar-bridge`).
3. **SICAR abierto** (así su base de datos MariaDB está encendida).

---

## ETAPA A — Descubrir tu base (una sola vez)

### 1. Abrir la terminal en la carpeta
- Abre la carpeta `sicar-bridge` en el Explorador de Windows.
- En la barra de dirección de arriba escribe **`cmd`** y presiona Enter. Se abre una
  ventana negra (la terminal) ya ubicada en esa carpeta.

### 2. Instalar el programa (una vez)
```
npm install
```

### 3. Crear tu archivo de configuración
- Copia `config.example.json` y pégalo en la misma carpeta.
- Renombra la copia a **`config.json`**.
- Ábrelo con el Bloc de notas. Para **SICAR 4** normalmente queda así:
  - `host`: `127.0.0.1`  ·  `port`: `3306`  ·  `user`: `root`  ·  `database`: `auto`
  - `password`: la que puso el instalador de SICAR. **Si no la sabes, déjala vacía `""`** y prueba.
  - `siteUrl`: ya viene puesto (`https://supercheapp.netlify.app`).
  - `ingestToken`: **pega aquí el token** que te dio el asistente en el chat
    (es el mismo `SICAR_INGEST_TOKEN` de Netlify).

### 4. Correr el descubridor
```
node descubrir.js
```
Imprime un reporte con las bases, tablas y columnas de ventas de tu SICAR.
**Copia TODO ese texto y envíaselo al asistente.** Con eso te arma la consulta exacta
y te da el valor final de `sqlVentas` para pegar en `config.json`.

> ¿Salió **"Access denied"**? La contraseña no es la correcta. Prueba vacía `""`; si no,
> consíguela con el soporte de SICAR.
> ¿Salió **"connect ECONNREFUSED"**? Abre SICAR y reintenta (la base solo está encendida
> con SICAR abierto).

---

## ETAPA B — Sincronizar las ventas (diario)

Cuando el asistente te dé la consulta `sqlVentas` y la pegues en `config.json`:

```
node sync.js                 (sincroniza las ventas de HOY)
node sync.js 2026-05-28      (sincroniza un día específico)
```
Si todo va bien verás `[OK] Sincronización terminada correctamente.` y las ventas
aparecerán en el panel. Es **idempotente**: correrlo dos veces no duplica ventas.

### Dejarlo automático (Programador de tareas de Windows)
1. Menú Inicio → busca **"Programador de tareas"** → ábrelo.
2. **Crear tarea básica** → nombre "Sincronizar ventas SUPER CHEAP" → Siguiente.
3. Desencadenador: **Diariamente**, a la hora de cierre (ej. 11:00 PM) → Siguiente.
4. Acción: **Iniciar un programa**:
   - Programa o script: `node`  (si no lo encuentra, usa `C:\Program Files\nodejs\node.exe`)
   - Agregar argumentos: `sync.js`
   - Iniciar en: la ruta de tu carpeta (ej. `C:\super-cheap\sicar-bridge`)
5. Siguiente → Finalizar. Cada noche subirá las ventas del día solo.

---

## Archivos de esta carpeta
- `descubrir.js` — explora tu base de SICAR y te da el reporte (Etapa A). Solo lee.
- `sync.js` — sincroniza las ventas al panel (Etapa B).
- `config.example.json` — plantilla de configuración (cópiala a `config.json`).
- `config.json` — **tu** configuración real (no se sube a internet; está protegida por `.gitignore`).

## Problemas comunes
- **"No encontré config.json"** → copia `config.example.json` a `config.json` y llénalo.
- **"Access denied"** → contraseña de MySQL incorrecta (prueba `""` o pídela a SICAR).
- **"connect ECONNREFUSED"** → abre SICAR para que encienda su base de datos.
- **"La consulta SQL falló"** → los nombres de tablas/columnas no coinciden; corre
  `node descubrir.js` otra vez y mándame el reporte.
- **HTTP 401/403** → el `ingestToken` no coincide con `SICAR_INGEST_TOKEN` en Netlify.
