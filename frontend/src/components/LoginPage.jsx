import { useState } from 'react'

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
      setError(err.response?.data?.detail || 'Giris basarisiz')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-dark-bg bg-grid-overlay flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-accent to-orange-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
            AH
          </div>
          <h1 className="text-lg font-semibold text-slate-100">Attribution Intelligence Hub</h1>
          <p className="text-xs text-slate-500 mt-1">PO AutoMatic Filo — Multi-Channel Attribution</p>
        </div>

        {/* Login Card */}
        <form onSubmit={handleSubmit} className="dark-card p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Kullanici Adi</label>
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
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Sifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-accent transition-colors"
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
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
            {loading ? 'Giris yapiliyor...' : 'Giris Yap'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600 mt-6">
          Growity \u00d7 Atlas &mdash; Guvenli Erisim
        </p>
      </div>
    </div>
  )
}
