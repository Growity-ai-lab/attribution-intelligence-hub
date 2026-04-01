import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import { useAttribution } from '../hooks/useAttribution'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler, annotationPlugin)

const OFFLINE = ['tv_match', 'tv_news', 'radio', 'dooh']
const WEEK_OPTIONS = [4, 8, 12, 16, 20, 24]

const SCENARIO_PRESETS = {
  minimum: { label: 'Minimum', icon: '↓', decay_mult: 0.6, grp_mult: 0.5 },
  optimum: { label: 'Optimum', icon: '◎', decay_mult: 1.0, grp_mult: 1.0 },
  maksimum: { label: 'Maksimum', icon: '↑', decay_mult: 1.2, grp_mult: 1.5 },
}

const DEFAULT_CPP = {
  tv_match: 25000, tv_news: 15000, radio: 5000, dooh: 3000,
}

const fmtN = v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)
const fmtMoney = v => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}

export default function MediaPlanningPanel({ campaign }) {
  const {
    simulateMediaPlan, getMediaPlanPresets,
    saveMediaPlan, listSavedMediaPlans, getSavedMediaPlan, deleteSavedMediaPlan,
  } = useAttribution()
  const [selectedChannel, setSelectedChannel] = useState('tv_match')
  const [numWeeks, setNumWeeks] = useState(12)
  const [weeklyGrps, setWeeklyGrps] = useState(Array(12).fill(0))
  const [scenario, setScenario] = useState('optimum')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeChartTab, setActiveChartTab] = useState('adstock')
  const [reachFilter, setReachFilter] = useState('all') // 'all', 'r1', 'r2', 'r3'
  const debounceRef = useRef(null)

  // CPP state
  const [cpp, setCpp] = useState(DEFAULT_CPP.tv_match)

  // Save/Load state
  const [savedPlans, setSavedPlans] = useState([])
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showSavedList, setShowSavedList] = useState(false)

  // Load presets when channel changes
  useEffect(() => {
    setCpp(DEFAULT_CPP[selectedChannel] || 5000)
    let cancelled = false
    ;(async () => {
      try {
        const presets = await getMediaPlanPresets(selectedChannel)
        if (cancelled) return
        const grps = presets.preset_grps || []
        const filled = Array(numWeeks).fill(0).map((_, i) => grps[i] || 0)
        setWeeklyGrps(filled)
        setResult(null)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [selectedChannel, getMediaPlanPresets]) // eslint-disable-line react-hooks/exhaustive-deps

  // Adjust array length when numWeeks changes
  useEffect(() => {
    setWeeklyGrps(prev => {
      if (prev.length === numWeeks) return prev
      if (numWeeks > prev.length) return [...prev, ...Array(numWeeks - prev.length).fill(0)]
      return prev.slice(0, numWeeks)
    })
  }, [numWeeks])

  // Auto-simulate with debounce
  const runSimulation = useCallback(async (grps) => {
    if (!grps.some(g => g > 0)) { setResult(null); return }
    setLoading(true)
    try {
      const res = await simulateMediaPlan(selectedChannel, grps)
      setResult(res)
    } catch { /* ignore */ }
    setLoading(false)
  }, [simulateMediaPlan, selectedChannel])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSimulation(weeklyGrps), 500)
    return () => clearTimeout(debounceRef.current)
  }, [weeklyGrps, runSimulation])

  const handleGrpChange = (idx, value) => {
    setWeeklyGrps(prev => {
      const next = [...prev]
      next[idx] = Math.max(0, Number(value) || 0)
      return next
    })
  }

  const applyScenario = (key) => {
    setScenario(key)
    const mult = SCENARIO_PRESETS[key].grp_mult
    setWeeklyGrps(prev => prev.map(g => Math.round((g || 200) * mult / 10) * 10))
  }

  const loadPresets = async () => {
    try {
      const presets = await getMediaPlanPresets(selectedChannel)
      const grps = presets.preset_grps || []
      setWeeklyGrps(Array(numWeeks).fill(0).map((_, i) => grps[i] || 0))
    } catch { /* ignore */ }
  }

  // Save simulation
  const handleSave = async () => {
    if (!saveName.trim() || !result) return
    try {
      await saveMediaPlan(saveName.trim(), selectedChannel, weeklyGrps, result, campaign?.id || null)
      setShowSaveModal(false)
      setSaveName('')
      refreshSavedPlans()
    } catch { /* ignore */ }
  }

  const refreshSavedPlans = async () => {
    try {
      const plans = await listSavedMediaPlans(campaign?.id || null)
      setSavedPlans(plans)
    } catch { /* ignore */ }
  }

  const handleLoadPlan = async (id) => {
    try {
      const plan = await getSavedMediaPlan(id)
      setSelectedChannel(plan.channel)
      const grps = plan.weekly_grps || []
      setNumWeeks(grps.length)
      setWeeklyGrps(grps)
      setShowSavedList(false)
    } catch { /* ignore */ }
  }

  const handleDeletePlan = async (id) => {
    try {
      await deleteSavedMediaPlan(id)
      refreshSavedPlans()
    } catch { /* ignore */ }
  }

  // CSV Export
  const exportCSV = () => {
    if (!result) return
    const headers = ['Hafta', 'GRP', 'Adstocked GRP', 'Carry-over', 'Saturation', 'Tahmini Lead', 'Marjinal Lead']
    if (result.reach_curve?.length) headers.push('1+ Reach %', '2+ Reach %', '3+ Reach %')
    if (cpp > 0) headers.push('Tahmini Harcama (TL)')

    const rows = result.weekly_details.map((d, i) => {
      const row = [
        `W${d.week}`, d.grp, d.adstocked_grp.toFixed(1),
        Math.max(0, d.adstocked_grp - d.grp).toFixed(1),
        d.saturated.toFixed(4), d.estimated_leads.toFixed(1), d.marginal_leads.toFixed(1),
      ]
      if (result.reach_curve?.length) {
        const rc = result.reach_curve[i]
        row.push(rc?.r1.toFixed(1) || '', rc?.r2.toFixed(1) || '', rc?.r3.toFixed(1) || '')
      }
      if (cpp > 0) row.push((d.grp * cpp).toFixed(0))
      return row
    })

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `medya_plan_${selectedChannel}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Derived data
  const channelColor = CHANNEL_COLORS[selectedChannel] || '#f97316'
  const channelLabel = CHANNEL_LABELS[selectedChannel] || selectedChannel
  const totalGrp = weeklyGrps.reduce((s, g) => s + g, 0)

  // CPP derived values
  const totalSpend = cpp > 0 ? totalGrp * cpp : 0
  const cpl = result && totalSpend > 0 && result.summary.total_leads > 0
    ? totalSpend / result.summary.total_leads : 0

  // --- Chart Data ---
  const adstockChartData = useMemo(() => {
    if (!result) return null
    const details = result.weekly_details
    return {
      labels: details.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Ham GRP',
          data: details.map(d => d.grp),
          borderColor: 'rgba(148,163,184,0.5)',
          backgroundColor: 'rgba(148,163,184,0.08)',
          borderDash: [4, 4],
          fill: false, tension: 0.3, pointRadius: 3,
        },
        {
          label: 'Adstocked GRP',
          data: details.map(d => d.adstocked_grp),
          borderColor: channelColor,
          backgroundColor: channelColor + '20',
          fill: true, tension: 0.3, pointRadius: 4,
        },
        {
          type: 'bar',
          label: 'Carry-over',
          data: details.map(d => Math.max(0, d.adstocked_grp - d.grp)),
          backgroundColor: channelColor + '30',
          borderColor: channelColor + '50',
          borderWidth: 1, borderRadius: 2,
        },
      ],
    }
  }, [result, channelColor])

  const saturationChartData = useMemo(() => {
    if (!result?.saturation_curve) return null
    const { grp_values, saturated_values } = result.saturation_curve
    const avgGrp = result.optimal?.current_avg_grp || 0
    const optGrp = result.optimal?.optimal_weekly_grp || 0
    return {
      labels: grp_values.map(v => v.toFixed(0)),
      datasets: [{
        label: 'Saturation Response',
        data: saturated_values,
        borderColor: channelColor,
        backgroundColor: channelColor + '15',
        fill: true, tension: 0.4, pointRadius: 0,
      }],
      _avgGrp: avgGrp,
      _optGrp: optGrp,
    }
  }, [result, channelColor])

  const REACH_SERIES = {
    r1: { label: '1+ Reach %', color: '#3b82f6' },
    r2: { label: '2+ Reach %', color: '#f97316' },
    r3: { label: '3+ Reach %', color: '#10b981' },
  }

  const reachChartData = useMemo(() => {
    if (!result?.reach_curve?.length) return null
    const rc = result.reach_curve
    const labels = rc.map((_, i) => `W${i + 1}`)

    const visibleKeys = reachFilter === 'all'
      ? ['r1', 'r2', 'r3']
      : [reachFilter]

    const datasets = visibleKeys.map(key => ({
      label: REACH_SERIES[key].label,
      data: rc.map(d => d[key]),
      borderColor: REACH_SERIES[key].color,
      backgroundColor: REACH_SERIES[key].color + '20',
      fill: visibleKeys.length === 1,
      tension: 0.3,
      pointRadius: 4,
      borderWidth: visibleKeys.length === 1 ? 2.5 : 2,
    }))

    return { labels, datasets }
  }, [result, reachFilter])

  const responseChartData = useMemo(() => {
    if (!result) return null
    const details = result.weekly_details
    return {
      labels: details.map(d => `W${d.week}`),
      datasets: [{
        label: 'Tahmini Lead',
        data: details.map(d => d.estimated_leads),
        backgroundColor: channelColor + '80',
        borderColor: channelColor,
        borderWidth: 1, borderRadius: 3,
      }],
    }
  }, [result, channelColor])

  // --- Chart Options ---
  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => fmtN(v) } },
    },
  }

  // D2: Adstock chart options with effective level reference lines
  const adstockOpts = useMemo(() => {
    if (!result?.optimal) return lineOpts
    const optGrp = result.optimal.optimal_weekly_grp
    const satGrp = result.optimal.saturation_threshold_grp
    return {
      ...lineOpts,
      plugins: {
        ...lineOpts.plugins,
        annotation: {
          annotations: {
            optimalLine: {
              type: 'line', yMin: optGrp, yMax: optGrp,
              borderColor: 'rgba(74, 222, 128, 0.6)', borderWidth: 1.5, borderDash: [6, 3],
              label: { display: true, content: `Optimal: ${optGrp}`, position: 'start', backgroundColor: 'rgba(74, 222, 128, 0.15)', color: '#4ade80', font: { size: 10 }, padding: 3 },
            },
            saturationLine: {
              type: 'line', yMin: satGrp, yMax: satGrp,
              borderColor: 'rgba(250, 204, 21, 0.5)', borderWidth: 1.5, borderDash: [6, 3],
              label: { display: true, content: `Doygunluk: ${satGrp}`, position: 'end', backgroundColor: 'rgba(250, 204, 21, 0.15)', color: '#facc15', font: { size: 10 }, padding: 3 },
            },
          },
        },
      },
    }
  }, [result, lineOpts])

  const satOpts = {
    ...lineOpts,
    plugins: {
      ...lineOpts.plugins,
      tooltip: { callbacks: { label: ctx => `Response: ${ctx.parsed.y.toFixed(4)}`, title: ctx => `GRP: ${ctx[0].label}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
      y: { ticks: { callback: v => v.toFixed(2) } },
    },
  }

  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => v.toFixed(0) } },
    },
  }

  const reachOpts = {
    ...lineOpts,
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => `%${v}` }, min: 0, max: 100 },
    },
  }

  // Compute half-life from decay
  const halfLife = result?.decay > 0 && result.decay < 1
    ? Math.ceil(Math.log(0.5) / Math.log(result.decay))
    : 0

  return (
    <div className="space-y-5">
      {/* Row 1: Channel selector + Scenario buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {OFFLINE.map(ch => (
            <button
              key={ch}
              onClick={() => setSelectedChannel(ch)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedChannel === ch
                  ? 'text-white'
                  : 'bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200'
              }`}
              style={selectedChannel === ch ? { backgroundColor: CHANNEL_COLORS[ch] } : undefined}
            >
              {CHANNEL_LABELS[ch] || ch}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-dark-border mx-1" />

        {/* Scenario buttons */}
        <div className="flex gap-1.5">
          {Object.entries(SCENARIO_PRESETS).map(([key, s]) => (
            <button
              key={key}
              onClick={() => applyScenario(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                scenario === key
                  ? 'bg-accent/15 border border-accent/40 text-accent'
                  : 'bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: GRP Input Card + Parameters side-by-side */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">GRP Girişi</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">
              Toplam: {totalGrp.toLocaleString('tr-TR')} GRP
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-slate-500">CPP</label>
              <input
                type="number"
                value={cpp || ''}
                onChange={e => setCpp(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs font-mono text-slate-300 text-right focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-slate-600">TL</span>
            </div>
            <select
              value={numWeeks}
              onChange={e => setNumWeeks(Number(e.target.value))}
              className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-slate-300"
            >
              {WEEK_OPTIONS.map(w => <option key={w} value={w}>{w} hafta</option>)}
            </select>
            <button
              onClick={loadPresets}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              Preset
            </button>
            <button
              onClick={() => { refreshSavedPlans(); setShowSavedList(!showSavedList) }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              Yükle
            </button>
            {result && (
              <button
                onClick={() => setShowSaveModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 transition-colors"
              >
                Kaydet
              </button>
            )}
          </div>
        </div>

        {/* Save Modal */}
        {showSaveModal && (
          <div className="px-4 py-3 bg-dark-bg/50 border-b border-dark-border flex items-center gap-2">
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Simülasyon adı..."
              className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
              autoFocus
            />
            <button onClick={handleSave} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium">
              Kaydet
            </button>
            <button onClick={() => setShowSaveModal(false)} className="px-3 py-1.5 bg-dark-card border border-dark-border text-slate-400 rounded-lg text-xs">
              İptal
            </button>
          </div>
        )}

        {/* Saved Plans List */}
        {showSavedList && (
          <div className="px-4 py-3 bg-dark-bg/50 border-b border-dark-border">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Kayıtlı Planlar</p>
            {savedPlans.length === 0 ? (
              <p className="text-xs text-slate-500">Henüz kayıtlı plan yok.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {savedPlans.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-dark-card rounded-lg border border-dark-border group">
                    <button onClick={() => handleLoadPlan(p.id)} className="flex-1 text-left">
                      <span className="text-xs text-slate-200 font-medium">{p.name}</span>
                      <span className="ml-2 text-[10px] text-slate-500 font-mono">{CHANNEL_LABELS[p.channel] || p.channel}</span>
                      <span className="ml-2 text-[10px] text-slate-600">{p.created_at?.slice(0, 10)}</span>
                    </button>
                    <button
                      onClick={() => handleDeletePlan(p.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all ml-2"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="p-4">
          {/* GRP inputs grid */}
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 gap-2">
            {weeklyGrps.map((g, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <label className="text-[10px] text-slate-500 text-center font-mono">W{i + 1}</label>
                <input
                  type="number"
                  value={g || ''}
                  onChange={e => handleGrpChange(i, e.target.value)}
                  placeholder="0"
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 text-center focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            ))}
          </div>

          {/* Parametre göstergesi */}
          {result && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 font-mono">
              <span>λ = {result.decay}</span>
              <span>α = {result.alpha}</span>
              <span>γ = {result.gamma}</span>
              <span>Half-life = {halfLife} hafta</span>
              <span>Max Lift = {result.max_lift} lead/hafta</span>
            </div>
          )}
        </div>
      </div>

      {/* Results — only when simulation has data */}
      {result && (
        <>
          {/* KPI Cards */}
          <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${cpp > 0 ? 'lg:grid-cols-7' : 'lg:grid-cols-5'}`}>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam GRP</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{result.summary.total_grp.toLocaleString('tr-TR')}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Ort. Haftalık GRP</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{result.summary.avg_grp.toFixed(0)}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Tahmini Lead</p>
              <p className="text-lg font-mono text-accent mt-0.5">{result.summary.total_leads.toFixed(0)}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Lead / 100 GRP</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{result.summary.leads_per_100_grp.toFixed(2)}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Peak Hafta</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">W{result.summary.peak_week}</p>
            </div>
            {cpp > 0 && (
              <>
                <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Tahmini Harcama</p>
                  <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtMoney(totalSpend)} &#8378;</p>
                </div>
                <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">CPL</p>
                  <p className="text-lg font-mono text-slate-100 mt-0.5">{cpl > 0 ? `${fmtMoney(cpl)} ₺` : '-'}</p>
                </div>
              </>
            )}
          </div>

          {/* Chart Tabs */}
          <div className="dark-card">
            <div className="card-hdr">
              <div className="flex gap-1">
                {[
                  { id: 'adstock', label: 'Carryover & Adstock' },
                  { id: 'saturation', label: 'Saturation' },
                  { id: 'reach', label: 'GRP & Reach' },
                  { id: 'response', label: 'Haftalık Lead' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveChartTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeChartTab === t.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="text-xs font-mono text-slate-500">
                {channelLabel} | λ={result.decay}
              </span>
            </div>
            <div className="p-4">
              {/* Adstock Tab */}
              {activeChartTab === 'adstock' && (
                <>
                  <div className="h-72">
                    {adstockChartData && <Line data={adstockChartData} options={adstockOpts} />}
                  </div>
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">{channelLabel}</strong>
                    {' kanalında λ='}{result.decay}{' decay parametresi ile reklam etkisi '}
                    <strong className="text-accent">{halfLife} haftada</strong>
                    {' yarısına düşer. '}
                    {result.decay >= 0.6
                      ? 'Yüksek carry-over: burst sonrası etki haftalarca devam eder, flight stratejisi kullanılabilir.'
                      : result.decay >= 0.3
                        ? 'Orta carry-over: düzgün ve sürekli GRP dağılımı önerilir.'
                        : 'Düşük carry-over: etki hemen sönümlenir, her hafta yayın şarttır.'}
                  </div>
                </>
              )}

              {/* Saturation Tab */}
              {activeChartTab === 'saturation' && (
                <>
                  <div className="h-72">
                    {saturationChartData && <Line data={saturationChartData} options={satOpts} />}
                  </div>
                  {result.optimal && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Optimal GRP</p>
                        <p className="text-sm font-mono text-green-400 mt-0.5">{result.optimal.optimal_weekly_grp}</p>
                      </div>
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Doygunluk Eşiği</p>
                        <p className="text-sm font-mono text-yellow-400 mt-0.5">{result.optimal.saturation_threshold_grp}</p>
                      </div>
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Mevcut Ort.</p>
                        <p className="text-sm font-mono text-slate-100 mt-0.5">{result.optimal.current_avg_grp}</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Saturation:</strong>
                    {' α='}{result.alpha}{' (yarı-doygunluk noktası), γ='}{result.gamma}{' (eğri şekli). '}
                    {'GRP arttıkça marjinal getiri azalır. Optimal noktadan sonraki her ek GRP biriminin katkısı düşer.'}
                  </div>
                </>
              )}

              {/* Reach Tab */}
              {activeChartTab === 'reach' && (
                <>
                  {/* Reach filter buttons */}
                  <div className="flex items-center gap-1.5 mb-3">
                    {[
                      { id: 'all', label: 'Hepsi' },
                      { id: 'r1', label: '1+ Reach' },
                      { id: 'r2', label: '2+ Reach' },
                      { id: 'r3', label: '3+ Reach' },
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setReachFilter(f.id)}
                        className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                          reachFilter === f.id
                            ? 'text-white'
                            : 'bg-dark-bg border border-dark-border text-slate-500 hover:text-slate-300'
                        }`}
                        style={reachFilter === f.id
                          ? { backgroundColor: f.id === 'all' ? '#64748b' : REACH_SERIES[f.id]?.color || '#64748b' }
                          : undefined
                        }
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="h-72">
                    {reachChartData && <Line data={reachChartData} options={reachOpts} />}
                  </div>

                  {/* Dynamic KPI cards based on filter */}
                  {result.reach_curve?.length > 0 && (() => {
                    const last = result.reach_curve[result.reach_curve.length - 1]
                    const cards = [
                      { label: 'Kümülatif GRP', value: last.cumulative_grp.toLocaleString('tr-TR'), color: 'text-slate-100' },
                    ]
                    if (reachFilter === 'all' || reachFilter === 'r1') {
                      cards.push({ label: '1+ Reach', value: `%${last.r1.toFixed(1)}`, color: 'text-blue-400' })
                    }
                    if (reachFilter === 'all' || reachFilter === 'r2') {
                      cards.push({ label: '2+ Reach', value: `%${last.r2.toFixed(1)}`, color: 'text-orange-400' })
                    }
                    if (reachFilter === 'all' || reachFilter === 'r3') {
                      cards.push({ label: '3+ Reach', value: `%${last.r3.toFixed(1)}`, color: 'text-emerald-400' })
                    }
                    return (
                      <div className={`mt-3 grid gap-2`} style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}>
                        {cards.map(c => (
                          <div key={c.label} className="bg-dark-bg rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">{c.label}</p>
                            <p className={`text-sm font-mono mt-0.5 ${c.color}`}>{c.value}</p>
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">GRP & Reach:</strong>
                    {' Coverguide verisine dayalı erişim tahmini. '}
                    {reachFilter === 'r1' && '1+ Reach: en az 1 kez gören kitle oranı. Geniş bilinirlik kampanyaları için hedefleyin.'}
                    {reachFilter === 'r2' && '2+ Reach: en az 2 kez gören kitle. Maliyet-etkinlik açısından en dengeli metrik — hedef %45-55 arası.'}
                    {reachFilter === 'r3' && '3+ Reach: en az 3 kez gören kitle (efektif erişim). Mesajın yerleşmesi için minimum frekans eşiği.'}
                    {reachFilter === 'all' && '1+ Reach: geniş bilinirlik, 2+ Reach: optimal denge (%45-55 hedef), 3+ Reach: efektif erişim (mesaj yerleşimi).'}
                  </div>
                </>
              )}

              {/* Response Tab */}
              {activeChartTab === 'response' && (
                <>
                  <div className="h-72">
                    {responseChartData && <Bar data={responseChartData} options={barOpts} />}
                  </div>
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Haftalık Lead Tahmini:</strong>
                    {' GRP → Adstock → Saturation → Response pipeline sonucu tahmini haftalık lead sayısı. '}
                    {'Peak hafta: W'}{result.summary.peak_week}
                    {' ('}{result.weekly_details[result.summary.peak_week - 1]?.estimated_leads.toFixed(0)}{' lead).'}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Optimal GRP Recommendation */}
          {result.optimal && (
            <div className="dark-card border-accent/30">
              <div className="card-hdr">
                <span className="card-title">Optimal GRP Önerisi</span>
                {(() => {
                  const avg = result.optimal.current_avg_grp
                  const opt = result.optimal.optimal_weekly_grp
                  const thr = result.optimal.saturation_threshold_grp
                  const status = avg < opt * 0.8 ? 'low' : avg > thr ? 'high' : 'good'
                  const statusConfig = {
                    low: { color: 'text-blue-400', bg: 'bg-blue-500/15', label: 'Artırılabilir' },
                    good: { color: 'text-green-400', bg: 'bg-green-500/15', label: 'Optimal' },
                    high: { color: 'text-yellow-400', bg: 'bg-yellow-500/15', label: 'Doygunluk' },
                  }
                  const sc = statusConfig[status]
                  return (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.color} ${sc.bg}`}>
                      {sc.label}
                    </span>
                  )
                })()}
              </div>
              <div className="p-4">
                <p className="text-sm text-slate-300 leading-relaxed">{result.optimal.recommendation}</p>
              </div>
            </div>
          )}

          {/* Weekly Detail Table */}
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Haftalık Detay</span>
              <button
                onClick={exportCSV}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 transition-colors"
              >
                CSV İndir
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-slate-400">
                    <th className="text-left py-2 px-2">Hafta</th>
                    <th className="text-right py-2 px-2">GRP</th>
                    <th className="text-right py-2 px-2">Adstocked</th>
                    <th className="text-right py-2 px-2">Carry-over</th>
                    <th className="text-right py-2 px-2">Saturation</th>
                    <th className="text-right py-2 px-2">Lead</th>
                    <th className="text-right py-2 px-2">Marjinal Lead</th>
                    {result.reach_curve?.length > 0 && (
                      <th className="text-right py-2 px-2">1+ Reach</th>
                    )}
                    {cpp > 0 && (
                      <th className="text-right py-2 px-2">Harcama</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {result.weekly_details.map((d, i) => {
                    const isPeak = d.week === result.summary.peak_week
                    return (
                      <tr
                        key={d.week}
                        className={`border-b border-dark-border/50 ${isPeak ? 'bg-accent/5' : 'hover:bg-dark-bg/30'}`}
                      >
                        <td className="py-2 px-2 font-mono text-slate-300">
                          W{d.week}
                          {isPeak && <span className="ml-1 text-[9px] text-accent font-semibold">PEAK</span>}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-200">{d.grp}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-300">{d.adstocked_grp.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-500">
                          {Math.max(0, d.adstocked_grp - d.grp).toFixed(1)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-400">{d.saturated.toFixed(4)}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-100">{d.estimated_leads.toFixed(1)}</td>
                        <td className={`py-2 px-2 text-right font-mono ${d.marginal_leads > 0 ? 'text-green-400' : 'text-slate-500'}`}>
                          {d.marginal_leads > 0 ? '+' : ''}{d.marginal_leads.toFixed(1)}
                        </td>
                        {result.reach_curve?.length > 0 && (
                          <td className="py-2 px-2 text-right font-mono text-blue-400">
                            %{result.reach_curve[i]?.r1.toFixed(1) || '-'}
                          </td>
                        )}
                        {cpp > 0 && (
                          <td className="py-2 px-2 text-right font-mono text-slate-400">
                            {fmtMoney(d.grp * cpp)} ₺
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Loading indicator */}
      {loading && !result && (
        <div className="text-center py-12 text-slate-500 text-sm">Simülasyon çalışıyor...</div>
      )}

      {/* Empty state */}
      {!loading && !result && (
        <div className="text-center py-12 text-slate-500 text-sm">
          Haftalık GRP değerlerini girerek simülasyonu başlatın.
        </div>
      )}
    </div>
  )
}
