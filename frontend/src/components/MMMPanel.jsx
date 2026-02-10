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
import InfoTip from './InfoTip'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const CHANNELS = ['meta', 'google', 'tiktok', 'linkedin', 'dv360', 'youtube', 'tv_match', 'tv_news', 'radio', 'dooh']
const SAMPLE_SPEND = [1_000_000, 800_000, 600_000, 400_000, 200_000, 100_000, 50_000, 25_000]

export default function MMMPanel() {
  const { getAdstock, getSaturation, getDecomposition } = useAttribution()
  const [selectedChannel, setSelectedChannel] = useState('meta')
  const [adstockData, setAdstockData] = useState(null)
  const [saturationData, setSaturationData] = useState(null)
  const [decomposition, setDecomposition] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [adRes, satRes] = await Promise.all([
          getAdstock(selectedChannel, SAMPLE_SPEND),
          getSaturation(selectedChannel, Array.from({ length: 20 }, (_, i) => i * 100_000)),
        ])
        if (!cancelled) {
          setAdstockData(adRes)
          setSaturationData(satRes)
        }
      } catch {
        // silently handle
      }
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
      } catch {
        // silently handle
      }
    }
    loadDecomp()
    return () => { cancelled = true }
  }, [getDecomposition])

  const adstockChartData = useMemo(() => {
    if (!adstockData) return null
    const labels = SAMPLE_SPEND.map((_, i) => `W${i + 1}`)
    return {
      labels,
      datasets: [
        {
          label: 'Ham Harcama',
          data: SAMPLE_SPEND,
          borderColor: 'rgba(148, 163, 184, 0.5)',
          backgroundColor: 'rgba(148, 163, 184, 0.1)',
          borderDash: [4, 4],
          fill: false,
          tension: 0.3,
          pointRadius: 3,
        },
        {
          label: 'Adstocked',
          data: adstockData.adstocked,
          borderColor: CHANNEL_COLORS[selectedChannel],
          backgroundColor: CHANNEL_COLORS[selectedChannel] + '20',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    }
  }, [adstockData, selectedChannel])

  const saturationChartData = useMemo(() => {
    if (!saturationData) return null
    const inputs = Array.from({ length: 20 }, (_, i) => i * 100_000)
    return {
      labels: inputs.map(v => `${(v / 1_000_000).toFixed(1)}M`),
      datasets: [
        {
          label: 'Saturation Response',
          data: saturationData.saturated_values,
          borderColor: CHANNEL_COLORS[selectedChannel],
          backgroundColor: CHANNEL_COLORS[selectedChannel] + '20',
          fill: true,
          tension: 0.4,
          pointRadius: 2,
        },
      ],
    }
  }, [saturationData, selectedChannel])

  const decompChartData = useMemo(() => {
    if (!decomposition) return null
    const sorted = [...decomposition].sort((a, b) => b.contribution - a.contribution)
    return {
      labels: sorted.map(d => CHANNEL_LABELS[d.channel] || d.channel),
      datasets: [
        {
          label: 'Katki (%)',
          data: sorted.map(d => (d.contribution * 100).toFixed(1)),
          backgroundColor: sorted.map(d => CHANNEL_COLORS[d.channel] || '#6B7280'),
          borderRadius: 4,
          barThickness: 20,
        },
      ],
    }
  }, [decomposition])

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12 } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => `${(v / 1_000_000).toFixed(1)}M` } },
    },
  }

  const decompOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `%${ctx.parsed.x}` } },
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
            {loading && <span className="text-xs text-slate-500">Yukleniyor...</span>}
          </div>
          <div className="p-4">
            <InfoTip>
              <strong>Adstock formulu:</strong> adstock[t] = spend[t] + \u03bb \u00d7 adstock[t-1] \u2014 Harcamanin zaman icinde tasma etkisi.
            </InfoTip>
            <div className="h-56 mt-3">
              {adstockChartData ? (
                <Line data={adstockChartData} options={lineOptions} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri bekleniyor...</div>
              )}
            </div>
          </div>
        </div>

        {/* Saturation Chart */}
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Saturation (Hill Function)</span>
          </div>
          <div className="p-4">
            <InfoTip>
              <strong>Hill formulu:</strong> saturation(x) = x^\u03b3 / (\u03b1^\u03b3 + x^\u03b3) \u2014 Azalan getiri egrisi.
            </InfoTip>
            <div className="h-56 mt-3">
              {saturationChartData ? (
                <Line data={saturationChartData} options={{
                  ...lineOptions,
                  scales: {
                    ...lineOptions.scales,
                    y: { ticks: { callback: v => v.toFixed(2) } },
                  },
                }} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri bekleniyor...</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Decomposition */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Channel Decomposition</span>
        </div>
        <div className="p-4">
          <div className="h-72">
            {decompChartData ? (
              <Bar data={decompChartData} options={decompOptions} />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri bekleniyor...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
