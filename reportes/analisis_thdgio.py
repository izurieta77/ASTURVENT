#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Análisis de cargas (consumo de combustible) de THD GIO por placa y por chofer,
en tres periodos semanales (lunes a sábado). Fuente: Google Sheet del cliente
TGIO, pestaña 'Despachos_SGM_APP' (la misma que alimenta la app appsgm).

Genera:
  - reportes/resumen_thdgio.md        (tablas por periodo)
  - reportes/consumo_por_chofer.png   (litros por chofer por periodo)
  - reportes/consumo_por_placa.png    (litros por placa por periodo)
  - reportes/totales_por_periodo.png  (litros / monto / despachos por periodo)
"""
import json, os, re, datetime, unicodedata, urllib.request
from collections import defaultdict

API_KEY = "AIzaSyATotw-cM7Y7J8IXH59m89xzaksKwgaABY"
SHEET_ID = "1xLF7C5A6p7dxlXDx7EiuQiR1MtEnwGeWRargX0tL5qE"
TAB = "Despachos_SGM_APP"
REFERER = "https://appsgm.netlify.app"
HERE = os.path.dirname(os.path.abspath(__file__))

# Periodos lunes a sábado (definición acordada con el usuario, 15-jun-2026)
PERIODOS = [
    ("P1 · 1–6 jun",  datetime.date(2026, 6, 1),  datetime.date(2026, 6, 6)),
    ("P2 · 8–13 jun", datetime.date(2026, 6, 8),  datetime.date(2026, 6, 13)),
    ("P3 · 15 jun+",  datetime.date(2026, 6, 15), datetime.date(2026, 6, 21)),
]

# Consolidación de variantes de nombre de chofer (typos / abreviaturas)
ALIAS_CHOFER = {
    "GIO": "GIOVANNI",
    "DANIEL JIMENEZ FLORES": "DANIEL JIMENEZ",
    "ALFREDO NASARIO": "ALFREDO NAZARIO",
    "EMANUEL MORENO": "EMMANUEL MORENO",
    "PEDRO GIMENEZ": "PEDRO JIMENEZ",
    "JOSE EDUARDO CORONA": "JOSE EDUARDO",
    "JHONATAN GUZMAN MALDONADO": "JHONATAN GUZMAN",
    "JONATHAN GUZMAN MALDONADO": "JHONATAN GUZMAN",
    "ENRIQUE DELGADO": "ENRIQUE DEGOLLADO",
    "SR MIGUEL": "MIGUEL APOLINAR",
}


def fetch():
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"/values/{TAB}!A1:M999?key={API_KEY}&valueRenderOption=UNFORMATTED_VALUE")
    req = urllib.request.Request(url, headers={"Referer": REFERER})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["values"]


def serial_to_date(n):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(n))


def strip_accents(s):
    s = (s or "").strip().upper()
    s = "".join(c for c in unicodedata.normalize("NFD", s)
                if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def norm_chofer(s):
    s = strip_accents(s)
    return ALIAS_CHOFER.get(s, s)


def norm_placa(s):
    return re.sub(r"[^A-Z0-9]", "", strip_accents(s))


def to_float(x):
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def periodo_de(d):
    for nombre, ini, fin in PERIODOS:
        if ini <= d <= fin:
            return nombre
    return None


def main():
    rows = fetch()[1:]
    # acumuladores: {periodo: {clave: [litros, monto, despachos]}}
    chofer = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))
    placa = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))
    tot = defaultdict(lambda: [0.0, 0.0, 0])

    for r in rows:
        if not r or not isinstance(r[0], (int, float)):
            continue
        d = serial_to_date(r[0])
        p = periodo_de(d)
        if not p:
            continue
        ch = norm_chofer(r[8]) if len(r) > 8 else ""
        pl = norm_placa(r[9]) if len(r) > 9 else ""
        lit = to_float(r[11]) if len(r) > 11 else 0.0
        mon = to_float(r[12]) if len(r) > 12 else 0.0
        if ch:
            a = chofer[p][ch]; a[0] += lit; a[1] += mon; a[2] += 1
        if pl:
            a = placa[p][pl]; a[0] += lit; a[1] += mon; a[2] += 1
        t = tot[p]; t[0] += lit; t[1] += mon; t[2] += 1

    nombres = [p[0] for p in PERIODOS]
    _charts(chofer, placa, tot, nombres)
    _markdown(chofer, placa, tot, nombres)
    _variacion(chofer, placa, tot, nombres)
    print("OK. Archivos en", HERE)


# --- Variación: ¿subió o bajó el consumo? (compara los 2 periodos con datos) ---
def _periodos_con_datos(tot_like):
    return [n for n in tot_like if any(v[0] for v in tot_like[n].values())]


def _deltas(data, na, nb, solo_ambos=False):
    """Lista (clave, lit_a, lit_b, delta, pct) ordenada por delta desc.
    solo_ambos=True -> solo claves con carga en AMBOS periodos (sin rotación)."""
    claves = set(data.get(na, {})) | set(data.get(nb, {}))
    out = []
    for k in claves:
        a = data.get(na, {}).get(k, [0, 0, 0])[0]
        b = data.get(nb, {}).get(k, [0, 0, 0])[0]
        if solo_ambos and (a <= 0 or b <= 0):
            continue
        delta = b - a
        pct = (delta / a * 100) if a else (float("inf") if b else 0.0)
        out.append((k, a, b, delta, pct))
    return sorted(out, key=lambda r: r[3], reverse=True)


def _diverging(deltas, na, nb, titulo, archivo):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rows = [r for r in deltas if r[3] != 0] or deltas
    rows = sorted(rows, key=lambda r: r[3])  # de menor (baja) a mayor (sube)
    labels = [r[0] for r in rows]
    vals = [r[3] for r in rows]
    colors = ["#D7263D" if v < 0 else "#00A86B" for v in vals]
    fig, ax = plt.subplots(figsize=(10, max(4.5, len(rows) * 0.42)))
    y = range(len(rows))
    ax.barh(list(y), vals, color=colors)
    ax.axvline(0, color="#333", lw=1)
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, fontsize=9)
    for i, (k, a, b, d, pct) in enumerate(rows):
        etq = f"{d:+,.0f} L"
        if a and b:
            etq += f"  ({pct:+.0f}%)"
        elif not a and b:
            etq += "  (nuevo)"
        elif a and not b:
            etq += "  (sin carga)"
        ax.text(d + (max(abs(v) for v in vals) * 0.01) * (1 if d >= 0 else -1),
                i, etq, va="center", ha="left" if d >= 0 else "right", fontsize=7.5)
    ax.set_title(titulo, fontsize=11.5, fontweight="bold")
    ax.set_xlabel(f"Δ litros  ·  {na}  →  {nb}   (verde = subió, rojo = bajó)")
    ax.grid(axis="x", alpha=0.25)
    ax.spines[["top", "right"]].set_visible(False)
    mx = max(abs(v) for v in vals) * 1.35
    ax.set_xlim(-mx, mx)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, archivo), dpi=150)
    plt.close(fig)


def _tabla_var(deltas, encab):
    out = [f"| {encab} | P1 (L) | P2 (L) | Δ L | Δ % | Tendencia |",
           "|---|---|---|---|---|---|"]
    for k, a, b, d, pct in deltas:
        if not a and b:
            pcts, tend = "nuevo", "🆕 subió"
        elif a and not b:
            pcts, tend = "-100%", "🔻 sin carga"
        else:
            pcts = f"{pct:+.0f}%"
            tend = "🟢 subió" if d > 0 else ("🔴 bajó" if d < 0 else "➖ igual")
        out.append(f"| {k} | {a:,.0f} | {b:,.0f} | {d:+,.0f} | {pcts} | {tend} |")
    return "\n".join(out)


def _comparativo_semanas(tot, na, nb):
    """Dos barras: semana previa vs semana reciente, resaltando la baja."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    la, lb = tot[na][0], tot[nb][0]
    pct = (lb - la) / la * 100 if la else 0
    fig, ax = plt.subplots(figsize=(7.5, 5.4))
    bars = ax.bar([f"Semana antepasada\n{na.split('·')[-1].strip()}\n(la que fue MÁS)",
                   f"Semana pasada\n{nb.split('·')[-1].strip()}\n(BAJÓ)"],
                  [la, lb], width=0.55, color=["#0057B8", "#D7263D"])
    for b, v, cargas in zip(bars, [la, lb], [tot[na][2], tot[nb][2]]):
        ax.text(b.get_x() + b.get_width() / 2, v,
                f"{v:,.0f} L\n{cargas} cargas",
                ha="center", va="bottom", fontsize=12, fontweight="bold")
    ax.annotate(f"▼ {pct:.0f}%  ({lb-la:,.0f} L)",
                xy=(1, lb), xytext=(0.5, max(la, lb) * 1.06),
                ha="center", fontsize=16, fontweight="bold", color="#D7263D")
    ax.set_title("THD GIO · La semana pasada (8–13 jun) BAJÓ el consumo\n"
                 "vs. la antepasada (1–6 jun)",
                 fontsize=13, fontweight="bold")
    ax.set_ylabel("Litros de diésel")
    ax.set_ylim(0, max(la, lb) * 1.18)
    ax.grid(axis="y", alpha=0.25)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "comparativo_semanas.png"), dpi=150)
    plt.close(fig)


def _variacion(chofer, placa, tot, nombres):
    con_datos = _periodos_con_datos(chofer)
    if len(con_datos) < 2:
        return
    na, nb = con_datos[-2], con_datos[-1]  # previa -> reciente (los 2 con datos)
    # Solo quienes operaron en AMBAS semanas (sin rotación / sin cargas en cero)
    dch = _deltas(chofer, na, nb, solo_ambos=True)
    dpl = _deltas(placa, na, nb, solo_ambos=True)
    sub = (f"Solo quienes operaron ambas semanas  ·  flota {tot[na][0]:,.0f}→"
           f"{tot[nb][0]:,.0f} L ({(tot[nb][0]-tot[na][0])/tot[na][0]*100:+.0f}%)")
    _comparativo_semanas(tot, na, nb)
    _diverging(dch, na, nb,
               "THD GIO · ¿Subió o bajó el consumo por CHOFER?\n" + sub,
               "variacion_por_chofer.png")
    _diverging(dpl, na, nb,
               "THD GIO · ¿Subió o bajó el consumo por PLACA?\n" + sub,
               "variacion_por_placa.png")
    netch = sum(r[3] for r in dch)
    L = [f"# THD GIO — Variación de consumo {na} → {nb}\n",
         f"_Generado: {datetime.date.today():%d/%m/%Y}. Solo se incluyen choferes/placas "
         f"con carga en **ambas** semanas (se excluye rotación y unidades sin carga). "
         f"P3 (15 jun+) aún sin cargas._\n",
         f"**Total de la flota:** semana previa {tot[na][0]:,.0f} L → "
         f"semana reciente {tot[nb][0]:,.0f} L "
         f"(**{(tot[nb][0]-tot[na][0])/tot[na][0]*100:+.0f}%**, bajó). "
         f"Entre quienes operaron ambas semanas el neto fue **{netch:+,.0f} L**.\n",
         "## Variación por CHOFER (litros)\n", _tabla_var(dch, "Chofer"),
         "\n## Variación por PLACA (litros)\n", _tabla_var(dpl, "Placa")]
    with open(os.path.join(HERE, "variacion_thdgio.md"), "w") as f:
        f.write("\n".join(L) + "\n")


def _topkeys(dicts, n=12):
    """Top-N claves por litros totales sumando todos los periodos; resto -> OTROS."""
    tot = defaultdict(float)
    for per in dicts.values():
        for k, v in per.items():
            tot[k] += v[0]
    ordenadas = [k for k, _ in sorted(tot.items(), key=lambda kv: -kv[1])]
    return ordenadas[:n], ordenadas[n:]


def _grouped_bar(data, nombres, titulo, archivo, n=12):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    top, resto = _topkeys(data, n)
    labels = list(top) + (["OTROS"] if resto else [])
    x = np.arange(len(labels))
    w = 0.26
    colores = ["#0057B8", "#00A86B", "#F2A900"]  # azul / verde / ámbar
    fig, ax = plt.subplots(figsize=(max(11, len(labels) * 0.95), 6.2))
    for i, per in enumerate(nombres):
        vals = []
        for k in top:
            vals.append(data.get(per, {}).get(k, [0, 0, 0])[0])
        if resto:
            vals.append(sum(data.get(per, {}).get(k, [0, 0, 0])[0] for k in resto))
        bars = ax.bar(x + (i - 1) * w, vals, w, label=per, color=colores[i])
        for b, val in zip(bars, vals):
            if val > 0:
                ax.text(b.get_x() + b.get_width() / 2, val, f"{val:,.0f}",
                        ha="center", va="bottom", fontsize=7, rotation=90)
    ax.set_title(titulo, fontsize=14, fontweight="bold")
    ax.set_ylabel("Litros")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=40, ha="right", fontsize=9)
    ax.legend(title="Periodo (lun–sáb)")
    ax.grid(axis="y", alpha=0.25)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, archivo), dpi=150)
    plt.close(fig)


def _charts(chofer, placa, tot, nombres):
    _grouped_bar(chofer, nombres,
                 "THD GIO · Consumo de diésel por CHOFER por periodo",
                 "consumo_por_chofer.png")
    _grouped_bar(placa, nombres,
                 "THD GIO · Consumo de diésel por PLACA por periodo",
                 "consumo_por_placa.png")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    x = np.arange(len(nombres))
    litros = [tot[p][0] for p in nombres]
    monto = [tot[p][1] for p in nombres]
    desp = [tot[p][2] for p in nombres]
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4))
    for ax, vals, tit, fmt, col in zip(
            axes, [litros, monto, desp],
            ["Litros totales", "Monto total ($)", "N.º de cargas"],
            ["{:,.0f}", "${:,.0f}", "{:,.0f}"],
            ["#0057B8", "#00A86B", "#F2A900"]):
        b = ax.bar(x, vals, color=col, width=0.6)
        ax.set_title(tit, fontweight="bold")
        ax.set_xticks(x); ax.set_xticklabels(nombres, fontsize=8)
        ax.grid(axis="y", alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
        for bb, v in zip(b, vals):
            ax.text(bb.get_x() + bb.get_width() / 2, v, fmt.format(v),
                    ha="center", va="bottom", fontsize=9, fontweight="bold")
    fig.suptitle("THD GIO · Totales por periodo (lun–sáb)", fontsize=14, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(os.path.join(HERE, "totales_por_periodo.png"), dpi=150)
    plt.close(fig)


def _tabla(data, nombres, encab):
    keys_tot = defaultdict(float)
    for per in data.values():
        for k, v in per.items():
            keys_tot[k] += v[0]
    orden = [k for k, _ in sorted(keys_tot.items(), key=lambda kv: -kv[1])]
    out = ["| " + encab + " | " + " | ".join(f"{n} (L)" for n in nombres) +
           " | Total L | Total $ | Cargas |",
           "|" + "---|" * (len(nombres) + 4)]
    for k in orden:
        celdas, tl, tm, tc = [], 0.0, 0.0, 0
        for n in nombres:
            v = data.get(n, {}).get(k, [0, 0, 0])
            celdas.append(f"{v[0]:,.0f}" if v[0] else "—")
            tl += v[0]; tm += v[1]; tc += v[2]
        out.append(f"| {k} | " + " | ".join(celdas) +
                   f" | {tl:,.0f} | ${tm:,.0f} | {tc} |")
    return "\n".join(out)


def _markdown(chofer, placa, tot, nombres):
    L = []
    L.append("# THD GIO — Análisis de cargas de diésel (3 periodos)\n")
    L.append(f"_Generado: {datetime.date.today():%d/%m/%Y} · "
             f"Fuente: Google Sheet TGIO › `Despachos_SGM_APP` (app appsgm)._\n")
    L.append("**Periodos (lunes a sábado):** "
             "P1 = 1–6 jun · P2 = 8–13 jun · P3 = 15–21 jun (en curso).")
    L.append("> Nota: al ser semanas lun–sáb, los domingos (7 y 14 jun) quedan fuera. "
             "Los datos más recientes en la hoja llegan al **sáb 13 jun**, por lo que "
             "**P3 aún no tiene cargas registradas**.\n")
    L.append("## Totales por periodo\n")
    L.append("| Métrica | " + " | ".join(nombres) + " |")
    L.append("|---|" + "---|" * len(nombres))
    L.append("| Litros | " + " | ".join(f"{tot[p][0]:,.0f}" for p in nombres) + " |")
    L.append("| Monto $ | " + " | ".join(f"${tot[p][1]:,.0f}" for p in nombres) + " |")
    L.append("| Cargas | " + " | ".join(f"{tot[p][2]}" for p in nombres) + " |")
    L.append("| L/carga | " + " | ".join(
        f"{(tot[p][0]/tot[p][2]) if tot[p][2] else 0:,.0f}" for p in nombres) + " |")
    L.append("\n## Consumo por CHOFER (litros)\n")
    L.append(_tabla(chofer, nombres, "Chofer"))
    L.append("\n## Consumo por PLACA (litros)\n")
    L.append(_tabla(placa, nombres, "Placa"))
    with open(os.path.join(HERE, "resumen_thdgio.md"), "w") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
