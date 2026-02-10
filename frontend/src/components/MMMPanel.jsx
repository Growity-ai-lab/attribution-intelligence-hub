import { useState, useEffect, useMemo } from 'react'
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

const CHANNELS = ['meta', 'google', 'tiktok', 'linkedin', 'dv360', 'youtube', 'tv_match', 'tv_news', 'radio', 'dooh']
const SAMPLE_SPEND = [1_000_000, 800_000, 600_000, 400_000, 200_000, 100_000, 50_000, 25_000]
const SAT_INPUTS = Array.from({ length: 30 }, (_, i) => i * 100_000)

// Default weekly spend values (matches backend _compute_default_mmm_shares)
const DEFAULT_SPEND = {
  meta: 2_600_000, google: 300_000, tiktok: 800_000,
  linkedin: 500_000, dv360: 400_000, youtube: 600_000,
  tv_match: 0, tv_news: 0, radio: 0, dooh: 150_000,
}

const fmtM = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`
const fmtTL = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : v.toFixed(0)

export default function MMMPanel() {
  const { getAdstock, getSaturation, getDecomposition, config } = useAttribution()
  const [selectedChannel, setSelectedChannel] = useState('meta')
  const [adstockData, setAdstockData] = useState(null)
  const [saturationData, setSaturationData] = useState(null)
  const [decomposition, setDecomposition] = useState(null)
  const [loading, setLoading] = useState(false)

  const decay = config?.adstock_params?.[selectedChannel] || 0
  const satAlpha = config?.saturation_params?.[selectedChannel]?.alpha || 0
  const satGamma = config?.saturation_params?.[selectedChannel]?.gamma || 0
  const channelLabel = CHANNEL_LABELS[selectedChannel] || selectedChannel

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [adRes, satRes] = await Promise.all([
          getAdstock(selectedChannel, SAMPLE_SPEND),
          getSaturation(selectedChannel, SAT_INPUTS),
        ])
        if (!cancelled) { setAdstockData(adRes); setSaturationData(satRes) }
      } catch { /* silently handle */ }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [selectedChannel, getAdstock, getSaturation])

  useEffect(() => {
    let cancelled = false
    const loadDecomp = async () => {
      try {
        const res = await getDecomposition(DEFAULT_SPEND)
        if (!cancelled) setDecomposition(res)
      } catch { /* silently handle */ }
    }
    loadDecomp()
    return () => { cancelled = true }
  }, [getDecomposition])

  // --- Adstock: find peak carry-over point ---
  const adstockPeak = useMemo(() => {
    if (!adstockData?.adstocked) return null
    const vals = adstockData.adstocked
    let maxIdx = 0
    for (let i = 1; i < vals.length; i++) { if (vals[i] > vals[maxIdx]) maxIdx = i }
    return { idx: maxIdx, value: vals[maxIdx], raw: SAMPLE_SPEND[maxIdx] }
  }, [adstockData])

  // --- Saturation: find half-saturation point ---
  const satHalf = useMemo(() => {
    if (!saturationData?.saturated_values) return null
    const vals = saturationData.saturated_values
    const maxSat = Math.max(...vals)
    const halfTarget = maxSat / 2
    let closestIdx = 0
    let closestDist = Math.abs(vals[0] - halfTarget)
    for (let i = 1; i < vals.length; i++) {
      const dist = Math.abs(vals[i] - halfTarget)
      if (dist < closestDist) { closestIdx = i; closestDist = dist }
    }
    return { idx: closestIdx, spend: SAT_INPUTS[closestIdx], value: vals[closestIdx], maxSat }
  }, [saturationData])

  // --- Adstock rationale ---
  const adstockRationale = useMemo(() => {
    if (!adstockPeak) return null
    const carryoverPct = ((adstockPeak.value / adstockPeak.raw - 1) * 100).toFixed(0)
    const halfLife = decay > 0 && decay < 1 ? Math.ceil(Math.log(0.5) / Math.log(decay)) : 0
    return { carryoverPct, halfLife }
  }, [adstockPeak, decay])

  // --- Chart data ---
  const adstockChartData = useMemo(() => {
    if (!adstockData) return null
    const peakIdx = adstockPeak?.idx ?? -1
    const color = CHANNEL_COLORS[selectedChannel]
    return {
      labels: SAMPLE_SPEND.map((_, i) => `W${i + 1}`),
      datasets: [
        {
          label: 'Ham Harcama',
          data: SAMPLE_SPEND,
          borderColor: 'rgba(148, 163, 184, 0.5)',
          backgroundColor: 'rgba(148, 163, 184, 0.1)',
          borderDash: [4, 4],
          fill: false, tension: 0.3, pointRadius: 3,
        },
        {
          label: 'Adstocked',
          data: adstockData.adstocked,
          borderColor: color,
          backgroundColor: color + '20',
          fill: true, tension: 0.3,
          pointRadius: adstockData.adstocked.map((_, i) => i === peakIdx ? 9 : 3),
          pointBackgroundColor: adstockData.adstocked.map((_, i) => i === peakIdx ? '#fff' : color),
          pointBorderColor: color,
          pointBorderWidth: adstockData.adstocked.map((_, i) => i === peakIdx ? 3 : 1),
        },
      ],
    }
  }, [adstockData, selectedChannel, adstockPeak])

  const saturationChartData = useMemo(() => {
    if (!saturationData) return null
    const halfIdx = satHalf?.idx ?? -1
    const color = CHANNEL_COLORS[selectedChannel]
    return {
      labels: SAT_INPUTS.map(v => `${(v / 1_000_000).toFixed(1)}M`),
      datasets: [{
        label: 'Saturation Response',
        data: saturationData.saturated_values,
        borderColor: color,
        backgroundColor: color + '20',
        fill: true, tension: 0.4,
        pointRadius: saturationData.saturated_values.map((_, i) => i === halfIdx ? 9 : 2),
        pointBackgroundColor: saturationData.saturated_values.map((_, i) => i === halfIdx ? '#fff' : color),
        pointBorderColor: color,
        pointBorderWidth: saturationData.saturated_values.map((_, i) => i === halfIdx ? 3 : 1),
      }],
    }
  }, [saturationData, selectedChannel, satHalf])

  // --- Decomposition: enriched analysis ---
  const decompAnalysis = useMemo(() => {
    if (!decomposition?.length) return null
    const totalSpend = decomposition.reduce((s, d) => s + d.spend, 0)
    const totalLeads = decomposition.reduce((s, d) => s + d.attributed_leads, 0)
    const ranked = [...decomposition]
      .filter(d => d.spend > 0)
      .map(d => ({
        ...d,
        label: CHANNEL_LABELS[d.channel] || d.channel,
        color: CHANNEL_COLORS[d.channel] || '#6B7280',
        sharePct: +(d.share * 100).toFixed(1),
        spendPct: totalSpend > 0 ? +((d.spend / totalSpend) * 100).toFixed(1) : 0,
        efficiency: d.spend > 0 ? +((d.attributed_leads / d.spend) * 1_000_000).toFixed(1) : 0,
        roi: d.spend > 0 && totalSpend > 0
          ? +(((d.share * 100) / ((d.spend / totalSpend) * 100))).toFixed(2)
          : 0,
      }))
      .sort((a, b) => b.share - a.share)
    const zeroSpend = [...decomposition].filter(d => d.spend === 0)
    const bestEfficiency = ranked.length ? [...ranked].sort((a, b) => b.efficiency - a.efficiency)[0] : null
    const worstEfficiency = ranked.length > 1 ? [...ranked].sort((a, b) => a.efficiency - b.efficiency)[0] : null
    return { ranked, zeroSpend, totalSpend, totalLeads, bestEfficiency, worstEfficiency }
  }, [decomposition])

  const decompChartData = useMemo(() => {
    if (!decompAnalysis) return null
    const { ranked } = decompAnalysis
    return {
      labels: ranked.map(d => d.label),
      datasets: [
        {
          label: 'Harcama Payi (%)',
          data: ranked.map(d => d.spendPct),
          backgroundColor: ranked.map(d => d.color + '40'),
          borderColor: ranked.map(d => d.color),
          borderWidth: 1,
          borderRadius: 3, barThickness: 14,
        },
        {
          label: 'Lead Payi (%)',
          data: ranked.map(d => d.sharePct),
          backgroundColor: ranked.map(d => d.color),
          borderRadius: 3, barThickness: 14,
        },
      ],
    }
  }, [decompAnalysis])

  const efficiencyChartData = useMemo(() => {
    if (!decompAnalysis) return null
    const byEff = [...decompAnalysis.ranked].sort((a, b) => b.efficiency - a.efficiency)
    return {
      labels: byEff.map(d => d.label),
      datasets: [{
        label: 'Lead / M TL',
        data: byEff.map(d => d.efficiency),
        backgroundColor: byEff.map(d => d.color),
        borderRadius: 3, barThickness: 14,
      }],
    }
  }, [decompAnalysis])

  // --- Chart options ---
  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y
            return `${ctx.dataset.label}: ${fmtM(v)}`
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => fmtM(v) } },
    },
  }

  const satOptions = {
    ...lineOptions,
    plugins: {
      ...lineOptions.plugins,
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}`,
          title: ctx => `Harcama: ${ctx[0].label}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
      y: { ticks: { callback: v => v.toFixed(2) } },
    },
  }

  const decompOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: %${ctx.parsed.x.toFixed(1)}` } },
    },
    scales: {
      x: { ticks: { callback: v => `%${v}` }, grid: { color: '#1e293b' } },
      y: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  }

  const efficiencyOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.parsed.x.toFixed(1)} lead / M TL` } },
    },
    scales: {
      x: { ticks: { callback: v => v.toFixed(0) }, grid: { color: '#1e293b' } },
      y: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  }

  return (
    <div className="space-y-6">
      {/* Channel Selector */}
      <div className="flex flex-wrap gap-2">
        {CHANNELS.map(ch => (
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Adstock Chart */}
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Adstock (Carry-over)</span>
            <span className="text-xs font-mono text-slate-500">
              {channelLabel} | {'\u03bb'} = {decay}
            </span>
          </div>
          <div className="p-4">
            <div className="h-56">
              {adstockChartData ? (
                <Line data={adstockChartData} options={lineOptions} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                  {loading ? 'Yukleniyor...' : 'Veri bekleniyor...'}
                </div>
              )}
            </div>
            {/* Breakpoint KPIs */}
            {adstockPeak && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Peak Carry-over</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtM(adstockPeak.value)}</p>
                  <p className="text-[10px] text-slate-500">W{adstockPeak.idx + 1}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Carry-over Orani</p>
                  <p className="text-sm font-mono text-accent mt-0.5">+%{adstockRationale?.carryoverPct || 0}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Half-life</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">{adstockRationale?.halfLife || 0} hafta</p>
                </div>
              </div>
            )}
            {/* Rationale */}
            {adstockRationale && (
              <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">{channelLabel}</strong>
                {' kanalinda '}{'\u03bb'}={decay}{' decay parametresi ile harcama etkisi '}
                <strong className="text-accent">{adstockRationale.halfLife} haftada</strong>
                {' yarisina duser. '}
                {decay >= 0.5
                  ? 'Yuksek carry-over: bu kanalin etkisi haftalarca devam eder, butce tasarrufu icin uygun.'
                  : decay >= 0.25
                    ? 'Orta carry-over: etki birkac hafta surer, duzgun harcama ritmi onerilir.'
                    : 'Dusuk carry-over: etki hemen sonumlenir, surekli harcama gerektirir.'}
              </div>
            )}
          </div>
        </div>

        {/* Saturation Chart */}
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Saturation (Hill Function)</span>
            <span className="text-xs font-mono text-slate-500">
              {channelLabel} | {'\u03b1'}={fmtM(satAlpha)} {'\u03b3'}={satGamma}
            </span>
          </div>
          <div className="p-4">
            <div className="h-56">
              {saturationChartData ? (
                <Line data={saturationChartData} options={satOptions} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                  {loading ? 'Yukleniyor...' : 'Veri bekleniyor...'}
                </div>
              )}
            </div>
            {/* Breakpoint KPIs */}
            {satHalf && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Half-Saturation</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtM(satHalf.spend)}</p>
                  <p className="text-[10px] text-slate-500">response = {satHalf.value.toFixed(3)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Max Response</p>
                  <p className="text-sm font-mono text-accent mt-0.5">{satHalf.maxSat.toFixed(3)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Doygunluk Esigi</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtM(satAlpha)}</p>
                </div>
              </div>
            )}
            {/* Rationale */}
            {satHalf && (
              <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">{channelLabel}</strong>
                {' kanalinda '}
                <strong className="text-accent">{fmtM(satHalf.spend)}</strong>
                {' harcamada yarim doygunluga ulasilir (grafikte beyaz nokta). '}
                {satHalf.spend <= 500_000
                  ? 'Dusuk butceyle hizla doyuma ulasiyor - butce artisi sinirli getiri saglar.'
                  : satHalf.spend <= 1_500_000
                    ? 'Orta seviye doygunluk - mevcut butcede makul verimlilik.'
                    : 'Yuksek doygunluk esigi - butce artisi hala verimli, olceklendirmeye uygun kanal.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Decomposition Report */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Channel Decomposition Raporu</span>
          <span className="text-xs text-slate-500">Haftalik harcama bazli MMM katki analizi</span>
        </div>
        <div className="p-4 space-y-4">
          {/* KPI Summary */}
          {decompAnalysis && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-dark-bg rounded-lg p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Harcama</p>
                <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtTL(decompAnalysis.totalSpend)}{' TL'}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Tahmini Lead</p>
                <p className="text-lg font-mono text-accent mt-0.5">{decompAnalysis.totalLeads.toFixed(0)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">En Etkili Kanal</p>
                <p className="text-sm font-semibold text-slate-100 mt-1">{decompAnalysis.ranked[0]?.label}</p>
                <p className="text-[10px] text-slate-500">%{decompAnalysis.ranked[0]?.sharePct} pay</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">En Verimli Kanal</p>
                <p className="text-sm font-semibold text-slate-100 mt-1">{decompAnalysis.bestEfficiency?.label}</p>
                <p className="text-[10px] text-slate-500">{decompAnalysis.bestEfficiency?.efficiency} lead/M TL</p>
              </div>
            </div>
          )}

          {/* Charts: Share comparison + Efficiency */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium">{'Harcama vs Lead Payi'}</p>
              <div className="h-64">
                {decompChartData ? (
                  <Bar data={decompChartData} options={decompOptions} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri bekleniyor...</div>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium">{'Verimlilik (Lead / M TL)'}</p>
              <div className="h-64">
                {efficiencyChartData ? (
                  <Bar data={efficiencyChartData} options={efficiencyOptions} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri bekleniyor...</div>
                )}
              </div>
            </div>
          </div>

          {/* Detailed Table */}
          {decompAnalysis && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-slate-400">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Kanal</th>
                    <th className="text-right py-2 px-2">Harcama</th>
                    <th className="text-right py-2 px-2">Harcama %</th>
                    <th className="text-right py-2 px-2">Lead</th>
                    <th className="text-right py-2 px-2">Lead %</th>
                    <th className="text-right py-2 px-2">Lead/M TL</th>
                    <th className="text-right py-2 px-2">ROI Skoru</th>
                    <th className="text-left py-2 px-2">Performans</th>
                  </tr>
                </thead>
                <tbody>
                  {decompAnalysis.ranked.map((d, i) => (
                    <tr key={d.channel} className="border-b border-dark-border/50 hover:bg-dark-bg/30">
                      <td className="py-2 px-2 text-slate-500">{i + 1}</td>
                      <td className="py-2 px-2">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                          <span className="text-slate-200">{d.label}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtTL(d.spend)}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400">%{d.spendPct}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-200">{d.attributed_leads.toFixed(0)}</td>
                      <td className="py-2 px-2 text-right font-mono text-accent">%{d.sharePct}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-300">{d.efficiency}</td>
                      <td className="py-2 px-2 text-right font-mono">
                        <span className={d.roi >= 1.2 ? 'text-green-400' : d.roi >= 0.8 ? 'text-slate-300' : 'text-red-400'}>
                          {d.roi}x
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        {d.roi >= 1.5
                          ? <span className="text-green-400 font-medium">{'Yuksek verim'}</span>
                          : d.roi >= 1.0
                            ? <span className="text-emerald-400">{'Iyi'}</span>
                            : d.roi >= 0.8
                              ? <span className="text-yellow-400">{'Ortalama'}</span>
                              : <span className="text-red-400">{'Dusuk verim'}</span>
                        }
                      </td>
                    </tr>
                  ))}
                  {decompAnalysis.zeroSpend.length > 0 && (
                    <tr className="border-b border-dark-border/50">
                      <td colSpan={9} className="py-2 px-2 text-slate-500 italic">
                        {'Harcama yapilmayan kanallar: '}
                        {decompAnalysis.zeroSpend.map(d => CHANNEL_LABELS[d.channel] || d.channel).join(', ')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Rationale */}
          {decompAnalysis && decompAnalysis.ranked.length > 0 && (
            <div className="p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed space-y-1.5">
              <p>
                <strong className="text-slate-300">{'Ozet:'}</strong>
                {' MMM modeline gore en yuksek katki saglayan kanal '}
                <strong className="text-accent">{decompAnalysis.ranked[0].label}</strong>
                {` (%${decompAnalysis.ranked[0].sharePct} pay, ${decompAnalysis.ranked[0].attributed_leads.toFixed(0)} lead). `}
                {decompAnalysis.bestEfficiency && (
                  <>
                    {'En verimli kanal '}
                    <strong className="text-green-400">{decompAnalysis.bestEfficiency.label}</strong>
                    {` (${decompAnalysis.bestEfficiency.efficiency} lead/M TL). `}
                  </>
                )}
              </p>
              <p>
                <strong className="text-slate-300">{'ROI Skoru:'}</strong>
                {' Lead Payi / Harcama Payi orani. '}
                {'1.0x = harcama ile orantili getiri. '}
                <span className="text-green-400">{'1.0x ustu'}</span>
                {' = butce payindan daha fazla lead ureten kanallar. '}
                <span className="text-red-400">{'1.0x alti'}</span>
                {' = harcamaya gore dusuk getiri.'}
              </p>
              {decompAnalysis.worstEfficiency && decompAnalysis.bestEfficiency &&
                decompAnalysis.bestEfficiency.channel !== decompAnalysis.worstEfficiency.channel && (
                <p>
                  <strong className="text-slate-300">{'Oneri:'}</strong>
                  {' '}
                  <span className="text-red-400">{decompAnalysis.worstEfficiency.label}</span>
                  {` (${decompAnalysis.worstEfficiency.efficiency} lead/M TL) butcesinin bir kismini `}
                  <span className="text-green-400">{decompAnalysis.bestEfficiency.label}</span>
                  {` (${decompAnalysis.bestEfficiency.efficiency} lead/M TL) kanalina kaydirmak toplam lead'i artirabilir.`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
