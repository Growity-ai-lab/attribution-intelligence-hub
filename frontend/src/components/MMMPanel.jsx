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

const fmtM = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`

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
        const res = await getDecomposition({})
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

  const decompChartData = useMemo(() => {
    if (!decomposition) return null
    const sorted = [...decomposition].sort((a, b) => b.share - a.share)
    return {
      labels: sorted.map(d => CHANNEL_LABELS[d.channel] || d.channel),
      datasets: [{
        label: 'Katki (%)',
        data: sorted.map(d => +(d.share * 100).toFixed(1)),
        backgroundColor: sorted.map(d => CHANNEL_COLORS[d.channel] || '#6B7280'),
        borderRadius: 4, barThickness: 20,
      }],
      _raw: sorted,
    }
  }, [decomposition])

  const topDecompChannel = useMemo(() => {
    if (!decomposition?.length) return null
    return [...decomposition].sort((a, b) => b.share - a.share)[0]
  }, [decomposition])

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
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `%${ctx.parsed.x.toFixed(1)}` } },
    },
    scales: {
      x: { ticks: { callback: v => `%${v}` } },
      y: { grid: { display: false }, ticks: { font: { size: 10 } } },
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

      {/* Decomposition */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Channel Decomposition</span>
          <span className="text-xs text-slate-500">Varsayilan haftalik harcamaya gore MMM katki dagilimi</span>
        </div>
        <div className="p-4">
          <div className="h-72">
            {decompChartData ? (
              <Bar data={decompChartData} options={decompOptions} />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri bekleniyor...</div>
            )}
          </div>
          {/* Rationale */}
          {topDecompChannel && (
            <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
              {'MMM modeline gore en yuksek katki saglayan kanal '}
              <strong className="text-accent">{CHANNEL_LABELS[topDecompChannel.channel] || topDecompChannel.channel}</strong>
              {` (%${(topDecompChannel.share * 100).toFixed(1)} pay). `}
              {topDecompChannel.attributed_leads > 0 &&
                `Bu kanal haftada tahmini ${topDecompChannel.attributed_leads.toFixed(0)} lead attribution'a sahip. `}
              {'Decomposition, her kanalin adstock + saturation sonrasi response modelinden hesaplanir.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
