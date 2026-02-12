import { useState } from 'react'

/*
 * Animated logo silhouette background.
 *  - Dashed lines with flowing dash-offset (data flow)
 *  - Pulsing DDA / MMM / INC nodes
 *  - Small data dots travelling along the triangle edges
 *  - Wider layout so bottom nodes aren't clipped
 */
function LogoBg() {
  /* Nodes pushed wider so MMM/INC are fully inside viewport */
  const DDA  = [300, 100]   // top-center
  const MMM  = [100, 370]   // bottom-left  (was 148,320)
  const INC  = [500, 370]   // bottom-right (was 364,320)
  const HUB  = [300, 250]   // center

  /* Six triangle edges + three hub spokes */
  const lines = [
    [DDA, HUB], [MMM, HUB], [INC, HUB],
    [DDA, MMM], [DDA, INC], [MMM, INC],
  ]

  /* Data-dot travel paths (triangle perimeter) */
  const paths = [
    `M${DDA} L${MMM}`,
    `M${MMM} L${INC}`,
    `M${INC} L${DDA}`,
    `M${DDA} L${HUB}`,
    `M${MMM} L${HUB}`,
    `M${INC} L${HUB}`,
  ]

  return (
    <svg
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      style={{ width: '140vh', height: '140vh', maxWidth: '1200px', maxHeight: '1200px' }}
      viewBox="0 0 600 500"
      fill="none"
      aria-hidden="true"
    >
      {/* ── CSS animations ── */}
      <style>{`
        @keyframes dash-flow {
          to { stroke-dashoffset: -40; }
        }
        @keyframes pulse {
          0%, 100% { r: 32; opacity: 0.12; }
          50%      { r: 38; opacity: 0.20; }
        }
        @keyframes pulse-hub {
          0%, 100% { r: 44; opacity: 0.10; }
          50%      { r: 50; opacity: 0.18; }
        }
        @keyframes dot-travel {
          0%   { offset-distance: 0%; opacity: 0; }
          10%  { opacity: 0.6; }
          90%  { opacity: 0.6; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        .flow-line {
          stroke-dasharray: 8 12;
          animation: dash-flow 2.5s linear infinite;
        }
        .node-pulse { animation: pulse 3s ease-in-out infinite; }
        .hub-pulse  { animation: pulse-hub 3.5s ease-in-out infinite; }
        .data-dot   {
          offset-rotate: 0deg;
          animation: dot-travel var(--dur) linear infinite;
          animation-delay: var(--delay);
        }
      `}</style>

      {/* Rounded frame */}
      <rect x="16" y="16" width="568" height="468" rx="80"
        stroke="#f97316" strokeOpacity="0.08" strokeWidth="1" />

      {/* Dashed data-flow lines */}
      {lines.map(([[x1,y1],[x2,y2]], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          className="flow-line"
          stroke="#f97316" strokeOpacity="0.12" strokeWidth="1" strokeLinecap="round"
          style={{ animationDelay: `${i * 0.3}s` }}
        />
      ))}

      {/* Travelling data dots */}
      {paths.map((d, i) => (
        <circle key={`dot-${i}`} r="3" fill="#f97316" fillOpacity="0.5"
          className="data-dot"
          style={{
            offsetPath: `path('${d}')`,
            '--dur': `${2.5 + i * 0.4}s`,
            '--delay': `${i * 0.6}s`,
          }}
        />
      ))}

      {/* Center hub — pulsing rings + bar chart */}
      <circle cx={HUB[0]} cy={HUB[1]} className="hub-pulse"
        stroke="#f97316" strokeOpacity="0.14" strokeWidth="1" fill="none" />
      <circle cx={HUB[0]} cy={HUB[1]} r="36"
        stroke="#f97316" strokeOpacity="0.08" strokeWidth="0.8" fill="none" />
      <rect x={HUB[0]-16} y={HUB[1]-6}  width="8" height="22" rx="2" fill="#f97316" fillOpacity="0.09" />
      <rect x={HUB[0]-4}  y={HUB[1]-16} width="8" height="32" rx="2" fill="#f97316" fillOpacity="0.09" />
      <rect x={HUB[0]+8}  y={HUB[1]-10} width="8" height="26" rx="2" fill="#f97316" fillOpacity="0.09" />

      {/* DDA node (top) */}
      <circle cx={DDA[0]} cy={DDA[1]} className="node-pulse"
        stroke="#f97316" strokeOpacity="0.16" strokeWidth="1"
        fill="#f97316" fillOpacity="0.04" />
      <text x={DDA[0]} y={DDA[1]+5} textAnchor="middle"
        fontFamily="Sora,Arial,sans-serif" fontWeight="700" fontSize="16"
        fill="#f97316" fillOpacity="0.22">DDA</text>

      {/* MMM node (bottom-left) */}
      <circle cx={MMM[0]} cy={MMM[1]} className="node-pulse"
        stroke="#f97316" strokeOpacity="0.16" strokeWidth="1"
        fill="#f97316" fillOpacity="0.04"
        style={{ animationDelay: '1s' }} />
      <text x={MMM[0]} y={MMM[1]+5} textAnchor="middle"
        fontFamily="Sora,Arial,sans-serif" fontWeight="700" fontSize="16"
        fill="#f97316" fillOpacity="0.22">MMM</text>

      {/* INC node (bottom-right) */}
      <circle cx={INC[0]} cy={INC[1]} className="node-pulse"
        stroke="#f97316" strokeOpacity="0.16" strokeWidth="1"
        fill="#f97316" fillOpacity="0.04"
        style={{ animationDelay: '2s' }} />
      <text x={INC[0]} y={INC[1]+5} textAnchor="middle"
        fontFamily="Sora,Arial,sans-serif" fontWeight="700" fontSize="16"
        fill="#f97316" fillOpacity="0.22">INC</text>

      {/* Orbiting channel dots */}
      <circle cx="185" cy="170" r="5" fill="#f97316" fillOpacity="0.06" />
      <circle cx="415" cy="170" r="5" fill="#f97316" fillOpacity="0.06" />
      <circle cx="60"  cy="290" r="4" fill="#f97316" fillOpacity="0.04" />
      <circle cx="540" cy="290" r="4" fill="#f97316" fillOpacity="0.04" />
      <circle cx="170" cy="430" r="4" fill="#f97316" fillOpacity="0.05" />
      <circle cx="430" cy="430" r="4" fill="#f97316" fillOpacity="0.05" />
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
