import { useState, useEffect } from 'react'
import { Dashboard } from './components/Dashboard'

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [pin, setPin] = useState('')

  // Simple PIN login (same as current production)
  const handleLogin = async () => {
    try {
      const res = await fetch('/.netlify/functions/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      })
      const data = await res.json()
      if (data.ok && data.token) {
        setToken(data.token)
        localStorage.setItem('sc_token', data.token)
      } else {
        alert('PIN incorrecto')
      }
    } catch (e) {
      alert('Error de conexión')
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('sc_token')
    if (saved) setToken(saved)
  }, [])

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-8 border border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white font-black text-xl">SC</div>
            <div>
              <div className="font-black text-2xl tracking-tighter text-white">SUPER <span className="text-orange-500">CHEAP</span></div>
              <div className="text-[10px] text-slate-500 tracking-[2px] -mt-1">MARKET</div>
            </div>
          </div>
          <p className="text-slate-400 text-sm mb-6">Ingresa tu PIN para acceder al Panel Operativo</p>

          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-2xl tracking-[6px] text-center font-mono focus:outline-none focus:border-orange-500"
            placeholder="••••"
            maxLength={8}
          />
          <button
            onClick={handleLogin}
            className="mt-4 w-full bg-orange-600 hover:bg-orange-500 transition text-white font-semibold py-3 rounded-xl"
          >
            Entrar al Panel
          </button>
        </div>
      </div>
    )
  }

  return <Dashboard token={token} onLogout={() => { localStorage.removeItem('sc_token'); setToken(null) }} />
}

export default App
