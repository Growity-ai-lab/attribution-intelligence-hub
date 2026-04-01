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

const DEFAULT_PATHS = [
  { path: ['meta', 'google', 'meta'], conversions: 45, rate: 0.72, segment: 'S1' },
  { path: ['google', 'linkedin', 'google'], conversions: 32, rate: 0.65, segment: 'S1' },
  { path: ['tiktok', 'meta', 'google'], conversions: 28, rate: 0.58, segment: 'S2' },
  { path: ['youtube', 'meta'], conversions: 22, rate: 0.55, segment: 'S2' },
  { path: ['dv360', 'google', 'meta', 'google'], conversions: 18, rate: 0.48, segment: 'S3' },
]

const PATH_TEMPLATES = [
  { pathFn: (chs) => [chs[0], chs[1] || chs[0], chs[0]], conversions: 45, rate: 0.72, segment: 'S1' },
  { pathFn: (chs) => [chs[1] || chs[0], chs[2] || chs[0], chs[1] || chs[0]], conversions: 32, rate: 0.65, segment: 'S1' },
  { pathFn: (chs) => [chs[2] || chs[1] || chs[0], chs[0], chs[1] || chs[0]], conversions: 28, rate: 0.58, segment: 'S2' },
  { pathFn: (chs) => [chs[3] || chs[1] || chs[0], chs[0]], conversions: 22, rate: 0.55, segment: 'S2' },
  { pathFn: (chs) => [chs[4] || chs[2] || chs[0], chs[1] || chs[0], chs[0], chs[1] || chs[0]], conversions: 18, rate: 0.48, segment: 'S3' },
]

function buildSamplePaths(campaign) {
  const channels = campaign?.channels
  if (!channels || channels.length === 0) return DEFAULT_PATHS
  return PATH_TEMPLATES.map(t => ({
    path: t.pathFn(channels),
    conversions: t.conversions,
    rate: t.rate,
    segment: t.segment,
  }))
}

export default function MTAPanel({ ddaResult, campaign }) {
  const samplePaths = useMemo(() => buildSamplePaths(campaign), [campaign])
  const topPaths = ddaResult?.top_paths
  const displayPaths = topPaths?.length > 0 ? topPaths : samplePaths
  const hasRealPaths = topPaths?.length > 0
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
        {' CRM touchpoint verisi üzerinden kanal bazlı atıf dağılımı hesaplar.'}
      </InfoTip>

      {/* Journey Paths */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Top Conversion Paths</span>
          {!hasRealPaths && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
              {'\u00d6'}rnek Veri
            </span>
          )}
          {hasRealPaths && (
            <span className="text-xs text-slate-500 font-mono">
              {topPaths.length} path
            </span>
          )}
        </div>
        <div className="p-4 space-y-2">
          {/* Header row */}
          <div className="flex items-center gap-3 text-[10px] text-slate-500 uppercase tracking-wide pb-1 border-b border-dark-border/30">
            <span className="w-5" />
            <span className="flex-1">Path</span>
            <span className="w-10 text-right">D{'\u00f6'}n.</span>
            {hasRealPaths && <span className="w-10 text-right">Top.</span>}
            <span className="w-12 text-right">Oran</span>
            <span className="w-10 text-center">Seg.</span>
          </div>
          {displayPaths.map((p, i) => (
            <div key={i} className="flex items-center gap-3 text-xs group hover:bg-dark-hover/30 rounded-lg px-1 py-1.5 transition-colors">
              <span className="text-slate-500 font-mono w-5">#{i + 1}</span>
              <div className="flex items-center gap-1 flex-wrap flex-1">
                {p.path.map((ch, j) => (
                  <span key={j} className="flex items-center gap-1">
                    <span
                      className="px-2 py-0.5 rounded-full text-white text-[11px]"
                      style={{ backgroundColor: CHANNEL_COLORS[ch] || '#6B7280' }}
                    >
                      {CHANNEL_LABELS[ch] || ch}
                    </span>
                    {j < p.path.length - 1 && <span className="text-slate-600">{'\u2192'}</span>}
                  </span>
                ))}
              </div>
              <span className="font-mono text-emerald-400 w-10 text-right">{p.conversions}</span>
              {hasRealPaths && <span className="font-mono text-slate-500 w-10 text-right">{p.total}</span>}
              <span className="font-mono text-slate-400 w-12 text-right">{formatPercent(p.rate)}</span>
              <span className="w-10 text-center"><SegmentPill segment={p.segment} /></span>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4">
          <div className="p-3 bg-dark-bg rounded-lg border border-dark-border/50">
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="text-slate-300 font-medium">Nas{'\u0131'}l yorumlan{'\u0131'}r:</span> Her sat{'\u0131'}r, lead'lerin d{'\u00f6'}n{'\u00fc'}{'\u015f'}{'\u00fc'}m {'\u00f6'}ncesinde izledi{'\u011f'}i kanal s{'\u0131'}ras{'\u0131'}n{'\u0131'} g{'\u00f6'}sterir.
              {hasRealPaths
                ? ` D${'\u00f6'}n. = d${'\u00f6'}n${'\u00fc'}${'\u015f'}en lead say${'\u0131'}s${'\u0131'}, Top. = toplam lead, Oran = d${'\u00f6'}n${'\u00fc'}${'\u015f'}${'\u00fc'}m oran${'\u0131'}. Y${'\u00fc'}ksek d${'\u00f6'}n${'\u00fc'}${'\u015f'}${'\u00fc'}m oranl${'\u0131'} path'ler kampanya optimizasyonunda ${'\u00f6'}nceliklendirilmelidir.`
                : ` Bu veriler ${'\u00f6'}rnek i${'\u00e7'}eriktir. Ger${'\u00e7'}ek path analizi i${'\u00e7'}in Unified Rapor sekmesinden CRM touchpoint verisi y${'\u00fc'}kleyin.`
              }
            </p>
          </div>
        </div>
      </div>

      {!ddaResult && (
        <div className="dark-card p-6 text-center">
          <p className="text-slate-500 text-sm">
            DDA sonuçları için Unified Rapor sekmesinden &quot;Örnek Veri ile Analiz Et&quot; butonunu kullanın.
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
            <div className="px-4 pb-4">
              <div className="p-3 bg-dark-bg rounded-lg border border-dark-border/50">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-medium">Rasyonel:</span> Markov zincirinden her kanal sırayla çıkarılır;
                  kalan dönüşüm oranındaki düşüş o kanalın &quot;removal effect&quot; değeridir.
                  Yüksek removal effect = o kanal olmadan dönüşüm oranı ciddi şekilde düşer, yani kanal kritik bir role sahiptir.
                </p>
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
            <div className="px-4 pb-4">
              <div className="p-3 bg-dark-bg rounded-lg border border-dark-border/50">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-medium">Rasyonel:</span> Shapley değeri, oyun teorisinden türetilmiş adil bir kredi dağılım yöntemidir.
                  Her kanalın tüm olası koalisyonlardaki marjinal katkısının ortalamasını alarak,
                  hiçbir kanalı haksız yere ödüllendirmez veya cezalandırmaz.
                </p>
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
          <div className="px-4 pb-4">
            <div className="p-3 bg-dark-bg rounded-lg border border-dark-border/50">
              <p className="text-xs text-slate-400 leading-relaxed">
                <span className="text-slate-300 font-medium">Nasıl yorumlanır:</span> Blend sütunu,
                Markov ({'\u00d7'}0.65) ve Shapley ({'\u00d7'}0.35) ağırlıklı ortalamasıdır.
                Markov, yolculuk sırasına dayalı geçiş olasılıklarını; Shapley ise koalisyon bazlı adil dağılımı temsil eder.
                İki yöntemin birleşimi, hem sıra etkisini hem de marjinal katkıyı dengeli şekilde yansıtır.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
