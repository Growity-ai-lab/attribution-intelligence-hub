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
import { useAttribution } from '../hooks/useAttribution'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const OFFLINE = ['tv_match', 'tv_news', 'radio', 'dooh']
const WEEK_OPTIONS = [4, 8, 12, 16, 20, 24]

const SCENARIO_PRESETS = {
  minimum: { label: 'Minimum', icon: '↓', decay_mult: 0.6, grp_mult: 0.5 },
  optimum: { label: 'Optimum', icon: '◎', decay_mult: 1.0, grp_mult: 1.0 },
  maksimum: { label: 'Maksimum', icon: '↑', decay_mult: 1.2, grp_mult: 1.5 },
}

const fmtN = v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)

export default function MediaPlanningPanel({ campaign }) {
  const { simulateMediaPlan, getMediaPlanPresets } = useAttribution()
  const [selectedChannel, setSelectedChannel] = useState('tv_match')
  const [numWeeks, setNumWeeks] = useState(12)
  const [weeklyGrps, setWeeklyGrps] = useState(Array(12).fill(0))
  const [scenario, setScenario] = useState('optimum')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeChartTab, setActiveChartTab] = useState('adstock')
  const debounceRef = useRef(null)

  // Load presets when channel changes
  useEffect(() => {
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

  // Derived data
  const channelColor = CHANNEL_COLORS[selectedChannel] || '#f97316'
  const channelLabel = CHANNEL_LABELS[selectedChannel] || selectedChannel
  const totalGrp = weeklyGrps.reduce((s, g) => s + g, 0)

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

  const reachChartData = useMemo(() => {
    if (!result?.reach_curve?.length) return null
    const rc = result.reach_curve
    return {
      labels: rc.map(d => `W${rc.indexOf(d) + 1}`),
      datasets: [
        {
          label: '1+ Reach %',
          data: rc.map(d => d.r1),
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true, tension: 0.3, pointRadius: 3,
        },
        {
          label: '2+ Reach %',
          data: rc.map(d => d.r2),
          borderColor: '#f97316',
          backgroundColor: '#f9731620',
          fill: true, tension: 0.3, pointRadius: 3,
        },
        {
          label: '3+ Reach %',
          data: rc.map(d => d.r3),
          borderColor: '#10b981',
          backgroundColor: '#10b98120',
          fill: true, tension: 0.3, pointRadius: 3,
        },
      ],
    }
  }, [result])

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
              Preset Yükle
            </button>
          </div>
        </div>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
                    {adstockChartData && <Line data={adstockChartData} options={lineOpts} />}
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
                  <div className="h-72">
                    {reachChartData && <Line data={reachChartData} options={reachOpts} />}
                  </div>
                  {result.reach_curve?.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Kümülatif GRP</p>
                        <p className="text-sm font-mono text-slate-100 mt-0.5">
                          {result.reach_curve[result.reach_curve.length - 1].cumulative_grp.toLocaleString('tr-TR')}
                        </p>
                      </div>
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">1+ Reach</p>
                        <p className="text-sm font-mono text-blue-400 mt-0.5">
                          %{result.reach_curve[result.reach_curve.length - 1].r1.toFixed(1)}
                        </p>
                      </div>
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">3+ Reach</p>
                        <p className="text-sm font-mono text-emerald-400 mt-0.5">
                          %{result.reach_curve[result.reach_curve.length - 1].r3.toFixed(1)}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">GRP & Reach:</strong>
                    {' Coverguide verisine dayalı erişim tahmini. 1+ Reach: en az 1 kez gören kitle oranı, '}
                    {'3+ Reach: en az 3 kez gören kitle (efektif erişim). '}
                    {'Hedef: 2+ Reach %45-55 aralığında optimal maliyet-etkinlik dengesi.'}
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
