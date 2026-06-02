import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { format, subDays, startOfMonth } from 'date-fns'

interface Props {
  token: string
  onLogout: () => void
}

type ChartGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

const MAX_TREND_POINTS = 84

function chartDate(fecha: string) {
  const value = String(fecha || '').slice(0, 10)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(fecha)
  return Number.isNaN(date.getTime()) ? null : date
}

function bucketKey(date: Date, granularity: ChartGranularity) {
  if (granularity === 'week') {
    const weekStart = new Date(date)
    const day = (weekStart.getDay() + 6) % 7
    weekStart.setDate(weekStart.getDate() - day)
    return weekStart.toISOString().slice(0, 10)
  }
  if (granularity === 'month') return date.toISOString().slice(0, 7)
  if (granularity === 'quarter') return `${date.getFullYear()}-T${Math.floor(date.getMonth() / 3) + 1}`
  if (granularity === 'year') return String(date.getFullYear())
  return date.toISOString().slice(0, 10)
}

function chartGranularityForRange(desde: string, hasta: string, seriesLen: number): ChartGranularity {
  const start = chartDate(desde)
  const end = chartDate(hasta)
  if (!start || !end) return seriesLen > MAX_TREND_POINTS ? 'week' : 'day'
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1
  if (days > 1500 || seriesLen > 900) return 'year'
  if (days > 730 || seriesLen > 360) return 'quarter'
  if (days > 200 || seriesLen > 180) return 'month'
  if (days > 50 || seriesLen > 60) return 'week'
  return 'day'
}

function capSeries<T extends { fecha: string; total: number }>(items: T[]) {
  if (items.length <= MAX_TREND_POINTS) return items
  const bucketSize = Math.ceil(items.length / MAX_TREND_POINTS)
  const compacted: Array<{ fecha: string; total: number }> = []
  for (let i = 0; i < items.length; i += bucketSize) {
    const chunk = items.slice(i, i + bucketSize)
    const first = chunk[0]
    const last = chunk[chunk.length - 1] || first
    compacted.push({
      fecha: first.fecha === last.fecha ? first.fecha : `${first.fecha}...${last.fecha}`,
      total: chunk.reduce((sum, item) => sum + Number(item.total || 0), 0)
    })
  }
  return compacted
}

function aggregateForChart(series: any[], granularity: ChartGranularity) {
  if (!series || series.length === 0) return []
  if (granularity === 'day' && series.length <= MAX_TREND_POINTS) return series

  const buckets: Record<string, { fecha: string; total: number }> = {}
  series.forEach((item: any) => {
    const date = chartDate(item.fecha)
    if (!date) return
    const key = bucketKey(date, granularity)
    if (!buckets[key]) buckets[key] = { fecha: key, total: 0 }
    buckets[key].total += Number(item.total || item.importe || 0)
  })

  return capSeries(Object.values(buckets).sort((a, b) => a.fecha.localeCompare(b.fecha)))
}

function granularityLabel(granularity: ChartGranularity) {
  return ({ day: 'por día', week: '(semanal)', month: '(mensual)', quarter: '(trimestral)', year: '(anual)' })[granularity]
}

export function Dashboard({ token, onLogout }: Props) {
  const [desde, setDesde] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [hasta, setHasta] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [compareMode, setCompareMode] = useState<'off' | 'prev' | 'yoy'>('off')
  const [kpis, setKpis] = useState<any>({})
  const [series, setSeries] = useState<any[]>([])
  const [topProducts, setTopProducts] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [hourly, setHourly] = useState<any[]>([])
  const [cajas, setCajas] = useState<string[]>([])
  const [pagos, setPagos] = useState<string[]>([])
  const [filtroCaja, setFiltroCaja] = useState('')
  const [filtroPago, setFiltroPago] = useState('')
  const [loading, setLoading] = useState(true)
  const [soloVentas, setSoloVentas] = useState(false)

  const chartGranularity = useMemo(() => {
    return chartGranularityForRange(desde, hasta, series.length)
  }, [desde, hasta, series])

  const aggregatedSeries = useMemo(() => {
    return aggregateForChart(series, chartGranularity)
  }, [series, chartGranularity])

  const apiFetch = async (url: string) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.json()
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [resumen, lista] = await Promise.all([
        apiFetch(`/.netlify/functions/sc-data?action=resumen&desde=${desde}&hasta=${hasta}`),
        apiFetch(`/.netlify/functions/sc-data?action=lista&tabla=ventas&desde=${desde}&hasta=${hasta}`)
      ])

      setKpis(resumen.kpis || {})
      setSeries(resumen.serie_ventas || [])

      const filas = lista.filas || []

      // Unique cajas and pagos for filters
      const uniqueCajas = Array.from(new Set(filas.map((r:any) => r.caja).filter(Boolean))).sort()
      const uniquePagos = Array.from(new Set(filas.map((r:any) => r.forma_pago || r.pago).filter(Boolean))).sort()
      setCajas(uniqueCajas as string[])
      setPagos(uniquePagos as string[])

      // Apply filters for top products
      const filteredFilas = filas.filter((r: any) => {
        const okCaja = !filtroCaja || r.caja === filtroCaja
        const pago = r.forma_pago || r.pago || ''
        const okPago = !filtroPago || pago === filtroPago
        return okCaja && okPago
      })

      // Top products from filtered
      const byProd: Record<string, {cant:number, imp:number}> = {}
      filteredFilas.forEach((r: any) => {
        const name = r.producto || r.descripcion || r.articulo || r.clave || 'Sin nombre'
        const imp = Number(r.importe) || Number(r.total) || 0
        if (!byProd[name]) byProd[name] = { cant: 0, imp: 0 }
        byProd[name].cant += Number(r.cantidad) || 1
        byProd[name].imp += imp
      })
      const top = Object.entries(byProd).sort((a,b) => b[1].imp - a[1].imp).slice(0,8)
      setTopProducts(top.map(([name, v]) => ({ name, ...v })))

      // Payment mix (from filtered)
      const byPay: Record<string, number> = {}
      filteredFilas.forEach((r: any) => {
        const p = r.forma_pago || r.pago || 'Efectivo'
        byPay[p] = (byPay[p] || 0) + (Number(r.total) || 0)
      })
      const totalPay = Object.values(byPay).reduce((a,b)=>a+b,0) || 1
      setPayments(Object.entries(byPay).map(([name, val]) => ({ name, value: Math.round((val/totalPay)*100) })))

      // Hourly data (best effort)
      const hourMap: Record<string, number> = {}
      filteredFilas.forEach((r:any) => {
        let h = r.hora ? String(r.hora).slice(0,2) : null
        if (!h && r.fecha_hora) h = String(r.fecha_hora).slice(11,13)
        if (h) {
          const val = Number(r.total) || Number(r.importe) || 0
          hourMap[h] = (hourMap[h] || 0) + val
        }
      })
      const hourlyData = Object.keys(hourMap).sort().map(h => ({ hora: h + ':00', total: hourMap[h] }))
      setHourly(hourlyData)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [desde, hasta, compareMode])

  const quickRanges = [
    { label: 'Hoy', fn: () => [format(new Date(), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd')] },
    { label: 'Ayer', fn: () => { const d = subDays(new Date(),1); return [format(d,'yyyy-MM-dd'), format(d,'yyyy-MM-dd')] } },
    { label: '7 días', fn: () => [format(subDays(new Date(),6),'yyyy-MM-dd'), format(new Date(),'yyyy-MM-dd')] },
    { label: 'Este mes', fn: () => [format(startOfMonth(new Date()),'yyyy-MM-dd'), format(new Date(),'yyyy-MM-dd')] },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white font-black">SC</div>
            <div>
              <span className="font-black tracking-tighter text-xl">SUPER</span>
              <span className="font-black tracking-tighter text-xl text-orange-500">CHEAP</span>
            </div>
            <div className="text-[10px] px-2 py-0.5 bg-slate-800 rounded text-orange-400 tracking-widest">PANEL v2</div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={() => setSoloVentas(!soloVentas)}
              className={`px-4 py-1.5 text-xs rounded-lg border transition ${soloVentas ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-700 hover:bg-slate-900'}`}
            >
              {soloVentas ? 'Modo Completo' : 'Solo Ventas'}
            </button>
            <button onClick={onLogout} className="px-4 py-1.5 text-xs rounded-lg border border-slate-700 hover:bg-slate-900">Salir</button>
          </div>
        </div>

        {/* Global Filters - Modern & Dense */}
        <div className="border-t border-slate-800 bg-slate-900">
          <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
            {quickRanges.map(r => (
              <button key={r.label} onClick={() => {
                const [d,h] = r.fn()
                setDesde(d); setHasta(h)
              }} className="px-4 py-1.5 text-sm font-medium rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-orange-500/20">
                {r.label}
              </button>
            ))}

            <div className="flex items-center gap-2 text-sm ml-2">
              <input type="date" value={desde} onChange={e=>setDesde(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm" />
              <span className="text-slate-500">→</span>
              <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm" />
            </div>

            <button
              onClick={() => {
                const next = compareMode === 'off' ? 'prev' : compareMode === 'prev' ? 'yoy' : 'off'
                setCompareMode(next)
              }}
              className={`ml-2 px-4 py-1.5 rounded-xl text-sm font-semibold transition ${compareMode !== 'off' ? 'bg-orange-500 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
            >
              {compareMode === 'yoy' ? 'YoY' : compareMode === 'prev' ? 'Período ant.' : 'Comparar'}
            </button>

            {/* Filtros caja y pago */}
            <select value={filtroCaja} onChange={e => { setFiltroCaja(e.target.value); setTimeout(loadData, 10) }} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todas cajas</option>
              {cajas.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filtroPago} onChange={e => { setFiltroPago(e.target.value); setTimeout(loadData, 10) }} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todos pagos</option>
              {pagos.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            <button onClick={loadData} className="ml-auto px-4 py-1.5 text-sm font-medium rounded-xl border border-slate-700 hover:bg-slate-800">
              Actualizar
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs tracking-[2px] text-orange-500 font-semibold">OPERATIVO • VENTAS EN TIEMPO REAL</div>
            <h1 className="text-4xl font-black tracking-tighter">Panel de Ventas</h1>
          </div>
          <div className="text-xs text-slate-500">{desde} → {hasta}</div>
        </div>

        {/* KPIs - Beautiful & Dense */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Ventas", value: kpis.ventas },
            { label: "Ticket Promedio", value: kpis.ventas && kpis.ventas / (series.length || 1) },
            { label: "Unidades", value: "—" },
            { label: "Tickets", value: "—" },
            { label: "Utilidad", value: kpis.utilidad },
            { label: "Margen", value: kpis.margen + "%" },
          ].map((kpi, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-xs font-medium text-slate-400 tracking-wider">{kpi.label}</div>
              <div className="text-3xl font-black tabular-nums mt-1 text-white">
                {typeof kpi.value === 'number' ? kpi.value.toLocaleString('es-MX') : kpi.value || '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Main Trend Chart - Recharts (gorgeous) - smart aggregation for long periods */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
          <div className="font-semibold mb-4 flex items-center justify-between">
            <span>Ventas {granularityLabel(chartGranularity)} {chartGranularity !== 'day' && <span className="text-emerald-400 text-xs ml-2">({aggregatedSeries.length} puntos)</span>}</span>
            <span className="text-xs text-slate-400">con comparación</span>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={aggregatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="fecha" minTickGap={24} tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e2937', border: 'none', borderRadius: 8 }} />
                <Line type="monotone" dataKey="total" stroke="#f97316" strokeWidth={3} dot={false} />
                {compareMode !== 'off' && <Line type="monotone" dataKey="total" stroke="#64748b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hourly Chart - hide for long ranges where it doesn't make sense as daily pattern */}
        {hourly.length > 3 && chartGranularity === 'day' && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <div className="font-semibold mb-3">Ventas por hora</div>
            <div className="h-[180px]">
              <ResponsiveContainer>
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="hora" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#f97316" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top Products + Payments */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <div className="font-semibold mb-4">Top Artículos</div>
            <div className="space-y-2 text-sm">
              {topProducts.map((p, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                  <div className="font-medium">{p.name}</div>
                  <div className="tabular-nums text-right">
                    {p.imp.toLocaleString('es-MX')} <span className="text-slate-500 text-xs">({p.cant} u)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <div className="font-semibold mb-4">Mix de Pagos</div>
            <div className="space-y-3">
              {payments.map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{p.name}</span>
                    <span className="font-semibold">{p.value}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500" style={{ width: `${p.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-slate-500 pt-4">
          SUPER CHEAP • Datos en tiempo real desde SICAR • Versión Moderna 2026
        </div>
      </main>
    </div>
  )
}
