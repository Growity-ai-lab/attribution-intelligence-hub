import { useState } from 'react'

/*
 * Full logo silhouette as background — rounded square with D-M-I network,
 * center hub, bar chart, orbiting dots and labels. Centered, contained,
 * very low opacity so it reads as a watermark behind the login card.
 */
function LogoBg() {
  const o = 0.14          // base stroke opacity
  const fo = 0.09         // fill opacity for nodes
  const to = 0.16         // text opacity

  return (
    <svg
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      style={{ width: '130vh', height: '130vh', maxWidth: '1100px', maxHeight: '1100px' }}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
    >
      {/* Rounded square frame */}
      <rect x="32" y="32" width="448" height="448" rx="96"
        stroke="#f97316" strokeOpacity={o} strokeWidth="1.2" fill="none" />

      {/* Connection lines */}
      <g stroke="#f97316" strokeOpacity={o * 0.7} strokeWidth="1" strokeLinecap="round">
        <line x1="256" y1="128" x2="256" y2="256" />
        <line x1="148" y1="320" x2="256" y2="256" />
        <line x1="364" y1="320" x2="256" y2="256" />
        <line x1="256" y1="128" x2="148" y2="320" />
        <line x1="256" y1="128" x2="364" y2="320" />
        <line x1="148" y1="320" x2="364" y2="320" />
      </g>

      {/* Center hub — double ring + bar chart */}
      <circle cx="256" cy="256" r="44" stroke="#f97316" strokeOpacity={o} strokeWidth="1" />
      <circle cx="256" cy="256" r="36" stroke="#f97316" strokeOpacity={o * 0.6} strokeWidth="0.8" />
      <rect x="240" y="250" width="8" height="22" rx="2" fill="#f97316" fillOpacity={fo} />
      <rect x="252" y="240" width="8" height="32" rx="2" fill="#f97316" fillOpacity={fo} />
      <rect x="264" y="246" width="8" height="26" rx="2" fill="#f97316" fillOpacity={fo} />

      {/* DDA node (top) */}
      <circle cx="256" cy="128" r="30" stroke="#f97316" strokeOpacity={o} strokeWidth="1" fill="#f97316" fillOpacity={fo * 0.4} />
      <text x="256" y="134" textAnchor="middle" fontFamily="Sora,Arial,sans-serif" fontWeight="600" fontSize="14" fill="#f97316" fillOpacity={to}>DDA</text>

      {/* MMM node (bottom-left) */}
      <circle cx="148" cy="320" r="30" stroke="#f97316" strokeOpacity={o} strokeWidth="1" fill="#f97316" fillOpacity={fo * 0.4} />
      <text x="148" y="326" textAnchor="middle" fontFamily="Sora,Arial,sans-serif" fontWeight="600" fontSize="14" fill="#f97316" fillOpacity={to}>MMM</text>

      {/* INC node (bottom-right) */}
      <circle cx="364" cy="320" r="30" stroke="#f97316" strokeOpacity={o} strokeWidth="1" fill="#f97316" fillOpacity={fo * 0.4} />
      <text x="364" y="326" textAnchor="middle" fontFamily="Sora,Arial,sans-serif" fontWeight="600" fontSize="14" fill="#f97316" fillOpacity={to}>INC</text>

      {/* Orbiting channel dots */}
      <circle cx="190" cy="170" r="6" fill="#f97316" fillOpacity={fo * 0.6} />
      <circle cx="322" cy="170" r="6" fill="#f97316" fillOpacity={fo * 0.6} />
      <circle cx="110" cy="260" r="5" fill="#f97316" fillOpacity={fo * 0.4} />
      <circle cx="402" cy="260" r="5" fill="#f97316" fillOpacity={fo * 0.4} />
      <circle cx="200" cy="380" r="5" fill="#f97316" fillOpacity={fo * 0.5} />
      <circle cx="312" cy="380" r="5" fill="#f97316" fillOpacity={fo * 0.5} />
    </svg>
  )
}

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onLogin(username, password)
    } catch (err) {
      setError(err.response?.data?.detail || 'Giriş başarısız')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-dark-bg bg-grid-overlay flex items-center justify-center px-4 overflow-hidden">
      <LogoBg />

      <div className="relative z-10 w-full max-w-sm">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
            Time's Hub
          </h1>
          <p className="text-sm text-slate-400 mt-1 font-medium">Attribution Intelligence</p>
        </div>

        {/* Login Card */}
        <form onSubmit={handleSubmit} className="dark-card p-6 space-y-4 backdrop-blur-sm">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Kullanıcı Adı</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-accent transition-colors"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Şifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-accent transition-colors"
              placeholder="********"
            />
          </div>

          {error && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600 mt-6">
          {'Time \u00d7 Growity'} &mdash; Güvenli Erişim
        </p>
      </div>
    </div>
  )
}
