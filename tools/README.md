# Antena auto-reconnect

Automatiza el ciclo manual de **Hades Server / Antena V1** en la PC del servidor
de la gasolinería: cada 15 min hace click en **Desconectar**, espera 1 min y
hace click en **Conectar**.

## Qué hay aquí

| Archivo                       | Para qué                                        |
|-------------------------------|-------------------------------------------------|
| `antena-auto-reconnect.ahk`   | El script que hace el ciclo                     |
| `install-startup.bat`         | Lo registra para arrancar solo con Windows      |
| `antena-auto-reconnect.log`   | Se genera al correrlo, lleva el log de clicks   |

## Instalación (una sola vez)

1. **Instalar AutoHotkey v2** desde https://www.autohotkey.com/ → "Download v2.0".
2. Copiar la carpeta `tools/` a la PC del servidor, por ejemplo a
   `C:\AntenaAutoReconnect\`.
3. Doble click en **`install-startup.bat`** → crea el acceso directo en la
   carpeta de inicio de Windows del usuario actual.
4. Doble click en **`antena-auto-reconnect.ahk`** para arrancarlo ya, sin
   esperar a reiniciar.
5. En la bandeja de Windows (al lado del reloj) aparece un ícono "H" verde.
   Eso indica que está corriendo.

## Uso

- Mientras el ícono verde esté ahí, el script hace su trabajo solo.
- Para apagarlo a mano: click derecho sobre el ícono verde → **Exit**.
- Para volverlo a prender: doble click sobre `antena-auto-reconnect.ahk`.
- Para que **no** arranque solo con Windows: borrar el acceso directo
  `AntenaAutoReconnect.lnk` de la carpeta de Inicio
  (`Win+R` → `shell:startup` → Enter).

## Cambiar los tiempos

Abrir `antena-auto-reconnect.ahk` con el Bloc de notas y editar:

```
CICLO_MIN  := 15   ; cada cuántos minutos arrancar el ciclo
ESPERA_SEG := 60   ; cuánto esperar entre Desconectar y Conectar
```

Guardar y reiniciar el script (click derecho ícono verde → **Exit** → doble
click otra vez).

## Si los clicks no funcionan

El script busca el botón por su texto ("Desconectar" / "Conectar"). Si por
alguna razón AHK no lo identifica:

1. Abrir **Window Spy** (viene con AutoHotkey, está en el menú de inicio).
2. Pasar el mouse sobre el botón **Desconectar** de la ventana Antena V1.
3. Anotar el `ClassNN`, suele ser algo como `Button9`.
4. En `antena-auto-reconnect.ahk`, reemplazar:
   ```
   ClickBoton("Desconectar")
   ```
   por:
   ```
   ClickBoton("Button9")
   ```
   (usando el número que apareció en Window Spy).
5. Hacer lo mismo para el botón **Conectar** con su `ClassNN`.

## Revisar el log

`antena-auto-reconnect.log` se crea al lado del `.ahk`. Cada línea trae fecha,
hora y qué pasó:

```
2026-05-07 11:12:03 iniciando, ciclo cada 15 min, espera 60 s
2026-05-07 11:12:03 click en Desconectar
2026-05-07 11:13:03 click en Conectar
2026-05-07 11:27:03 click en Desconectar
```

Si una línea dice `ventana 'Antena V1' no encontrada`, significa que el
Hades Server no estaba abierto en ese momento — el script salta el ciclo y
reintenta a los 15 min.
