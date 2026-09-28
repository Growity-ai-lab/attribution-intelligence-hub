import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API = '/api'

const SEVERITY = {
  critical: { label: 'Kritik', chip: 'bg-red-500/15 text-red-400 border-red-500/30', card: 'border-red-800/40 bg-red-900/10' },
  warning: { label: 'Uyarı', chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30', card: 'border-amber-800/40 bg-amber-900/10' },
}

const fmtTime = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? iso : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Proactive alerts for a campaign. The backend evaluates 5 rules after every
 * DDA run; this panel lists the open ones and lets the user mark them read.
 * `refreshKey` should change whenever a new DDA result arrives.
 */
export default function AlertsPanel({ campaignId, refreshKey }) {
  const [alerts, setAlerts] = useState([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    try {
      const res = await axios.get(`${API}/alerts`, {
        params: { campaign_id: campaignId, include_acknowledged: showAll },
      })
      setAlerts(res.data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Uyarılar yüklenemedi')
    }
    setLoading(false)
  }, [campaignId, showAll])

  useEffect(() => { load() }, [load, refreshKey])

  const acknowledge = async id => {
    try {
      const res = await axios.post(`${API}/alerts/${id}/acknowledge`)
      setAlerts(prev => showAll
        ? prev.map(a => (a.id === id ? res.data : a))
        : prev.filter(a => a.id !== id))
    } catch (err) {
      setError(err.response?.data?.detail || 'Uyarı güncellenemedi')
    }
  }

  if (!campaignId) return null
  const open = alerts.filter(a => !a.acknowledged).length

  return (
    <div className="dark-card">
      <div className="card-hdr">
        <span className="card-title flex items-center gap-2">
          Uyarılar
          {open > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-red-500/15 text-red-400 border border-red-500/30">
              {open}
            </span>
          )}
        </span>
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showAll ? 'Yalnızca açık olanlar' : 'Okunanları da göster'}
        </button>
      </div>
      <div className="p-4 space-y-2">
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!error && alerts.length === 0 && (
          <p className="text-xs text-slate-400">
            {loading
              ? 'Yükleniyor...'
              : 'Açık uyarı yok. Her attribution analizinden sonra dönüşüm düşüşü, hacim kaybı, kanal yoğunlaşması, kaybolan kanal ve sürekli düşüş kuralları otomatik kontrol edilir.'}
          </p>
        )}
        {alerts.map(a => {
          const s = SEVERITY[a.severity] || SEVERITY.warning
          return (
            <div
              key={a.id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${s.card} ${a.acknowledged ? 'opacity-50' : ''}`}
            >
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border flex-shrink-0 ${s.chip}`}>
                {s.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200">{a.title}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{a.message}</p>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">{fmtTime(a.triggered_at)}</p>
              </div>
              {!a.acknowledged && (
                <button
                  onClick={() => acknowledge(a.id)}
                  className="px-2.5 py-1 rounded-lg text-[10px] text-slate-300 bg-dark-bg border border-dark-border hover:text-slate-100 transition-colors flex-shrink-0"
                >
                  Okundu
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
