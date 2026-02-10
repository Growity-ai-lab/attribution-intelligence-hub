import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'
import { formatPercent } from '../utils/formatters'
import InfoTip from './InfoTip'
import SegmentPill from './SegmentPill'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const SAMPLE_PATHS = [
  { path: ['meta', 'google', 'meta'], conversions: 45, rate: 0.72, segment: 'S1' },
  { path: ['google', 'linkedin', 'google'], conversions: 32, rate: 0.65, segment: 'S1' },
  { path: ['tiktok', 'meta', 'google'], conversions: 28, rate: 0.58, segment: 'S2' },
  { path: ['youtube', 'meta'], conversions: 22, rate: 0.55, segment: 'S2' },
  { path: ['dv360', 'google', 'meta', 'google'], conversions: 18, rate: 0.48, segment: 'S3' },
]

export default function MTAPanel({ ddaResult }) {
  const markovData = ddaResult?.markov
  const shapleyData = ddaResult?.shapley_dda
  const hybridData = ddaResult?.hybrid_attribution

  const removalChartData = useMemo(() => {
    if (!markovData?.removal_effects) return null
    const entries = Object.entries(markovData.removal_effects)
      .sort(([, a], [, b]) => b - a)
    return {
      labels: entries.map(([ch]) => CHANNEL_LABELS[ch] || ch),
      datasets: [{
        label: 'Removal Effect',
        data: entries.map(([, v]) => (v * 100).toFixed(1)),
        backgroundColor: entries.map(([ch]) => CHANNEL_COLORS[ch] || '#6B7280'),
        borderRadius: 4,
        barThickness: 20,
      }],
    }
  }, [markovData])

  const shapleyChartData = useMemo(() => {
    if (!shapleyData) return null
    const entries = Object.entries(shapleyData)
      .sort(([, a], [, b]) => b - a)
    return {
      labels: entries.map(([ch]) => CHANNEL_LABELS[ch] || ch),
      datasets: [{
        label: 'Shapley Value',
        data: entries.map(([, v]) => (v * 100).toFixed(1)),
        backgroundColor: entries.map(([ch]) => CHANNEL_COLORS[ch] || '#6B7280'),
        borderRadius: 4,
        barThickness: 20,
      }],
    }
  }, [shapleyData])

  const barOptions = {
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
      <InfoTip>
        <strong>DDA (Data-Driven Attribution):</strong> {'Markov Chain (\u00d70.65) + Shapley Value (\u00d70.35) blend.'}
        {' CRM touchpoint verisi uzerinden kanal bazli atif dagilimi hesaplar.'}
      </InfoTip>

      {/* Journey Paths */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Top Conversion Paths</span>
        </div>
        <div className="p-4 space-y-3">
          {SAMPLE_PATHS.map((p, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="text-slate-500 font-mono w-5">#{i + 1}</span>
              <div className="flex items-center gap-1 flex-wrap flex-1">
                {p.path.map((ch, j) => (
                  <span key={j} className="flex items-center gap-1">
                    <span
                      className="px-2 py-0.5 rounded-full text-white text-xs"
                      style={{ backgroundColor: CHANNEL_COLORS[ch] || '#6B7280' }}
                    >
                      {CHANNEL_LABELS[ch] || ch}
                    </span>
                    {j < p.path.length - 1 && <span className="text-slate-600">{'\u2192'}</span>}
                  </span>
                ))}
              </div>
              <span className="font-mono text-emerald-400">{p.conversions}</span>
              <span className="font-mono text-slate-400">{formatPercent(p.rate)}</span>
              <SegmentPill segment={p.segment} />
            </div>
          ))}
        </div>
      </div>

      {!ddaResult && (
        <div className="dark-card p-6 text-center">
          <p className="text-slate-500 text-sm">
            DDA sonuclari icin Unified Rapor sekmesinden &quot;Ornek Veri ile Analiz Et&quot; butonunu kullanin.
          </p>
        </div>
      )}

      {ddaResult && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Markov Removal Effects</span>
            </div>
            <div className="p-4">
              <div className="h-56">
                {removalChartData ? (
                  <Bar data={removalChartData} options={barOptions} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri yok</div>
                )}
              </div>
            </div>
          </div>

          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Shapley Value Attribution</span>
            </div>
            <div className="p-4">
              <div className="h-56">
                {shapleyChartData ? (
                  <Bar data={shapleyChartData} options={barOptions} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm">Veri yok</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {hybridData && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Blended DDA Attribution</span>
            <span className="text-xs text-slate-500">{'Markov\u00d70.65 + Shapley\u00d70.35'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Kanal</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Markov</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Shapley</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Blend</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(hybridData)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ch, blend]) => (
                    <tr key={ch} className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors">
                      <td className="px-4 py-2.5 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch] || '#6B7280' }} />
                        <span className="text-xs text-slate-300">{CHANNEL_LABELS[ch] || ch}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-400">
                        {markovData?.removal_effects?.[ch] ? formatPercent(markovData.removal_effects[ch]) : '\u2014'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-400">
                        {shapleyData?.[ch] ? formatPercent(shapleyData[ch]) : '\u2014'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-accent">
                        {formatPercent(blend)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
