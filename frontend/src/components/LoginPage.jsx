import { useState } from 'react'

/* Large background silhouette of the D-M-I triangle network */
function NetworkBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 800 800"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      {/* Connection lines */}
      <g stroke="#f97316" strokeOpacity="0.06" strokeWidth="1.5" strokeLinecap="round">
        <line x1="400" y1="160" x2="400" y2="400" />
        <line x1="180" y1="560" x2="400" y2="400" />
        <line x1="620" y1="560" x2="400" y2="400" />
        <line x1="400" y1="160" x2="180" y2="560" />
        <line x1="400" y1="160" x2="620" y2="560" />
        <line x1="180" y1="560" x2="620" y2="560" />
      </g>

      {/* Center hub */}
      <circle cx="400" cy="400" r="48" stroke="#f97316" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle cx="400" cy="400" r="28" stroke="#f97316" strokeOpacity="0.05" strokeWidth="1" />

      {/* Three pillar nodes */}
      <circle cx="400" cy="160" r="36" stroke="#f97316" strokeOpacity="0.07" strokeWidth="1.5" />
      <circle cx="180" cy="560" r="36" stroke="#f97316" strokeOpacity="0.07" strokeWidth="1.5" />
      <circle cx="620" cy="560" r="36" stroke="#f97316" strokeOpacity="0.07" strokeWidth="1.5" />

      {/* Orbiting dots */}
      <circle cx="270" cy="300" r="6" fill="#f97316" fillOpacity="0.04" />
      <circle cx="530" cy="300" r="6" fill="#f97316" fillOpacity="0.04" />
      <circle cx="120" cy="420" r="5" fill="#f97316" fillOpacity="0.03" />
      <circle cx="680" cy="420" r="5" fill="#f97316" fillOpacity="0.03" />
      <circle cx="260" cy="640" r="5" fill="#f97316" fillOpacity="0.03" />
      <circle cx="540" cy="640" r="5" fill="#f97316" fillOpacity="0.03" />
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
      <NetworkBg />

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
