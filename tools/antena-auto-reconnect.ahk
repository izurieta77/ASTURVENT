#Requires AutoHotkey v2.0
#SingleInstance Force
SetTitleMatchMode 2
A_IconTip := "Antena auto-reconnect"

CICLO_MIN  := 15
ESPERA_SEG := 60
WIN_TITLE  := "Antena V1"
LOG_FILE   := A_ScriptDir "\antena-auto-reconnect.log"

Log(msg) {
    global LOG_FILE
    FileAppend FormatTime(, "yyyy-MM-dd HH:mm:ss") " " msg "`n", LOG_FILE
}

ClickBoton(textoBoton) {
    global WIN_TITLE
    if !WinExist(WIN_TITLE) {
        Log "ventana '" WIN_TITLE "' no encontrada, salto ciclo"
        return false
    }
    try {
        ControlClick textoBoton, WIN_TITLE
        Log "click en " textoBoton
        return true
    } catch as e {
        Log "error click " textoBoton ": " e.Message
        return false
    }
}

Ciclo() {
    global ESPERA_SEG
    if !ClickBoton("Desconectar")
        return
    Sleep ESPERA_SEG * 1000
    ClickBoton("Conectar")
}

Log "iniciando, ciclo cada " CICLO_MIN " min, espera " ESPERA_SEG " s"
Ciclo()
SetTimer Ciclo, CICLO_MIN * 60 * 1000
