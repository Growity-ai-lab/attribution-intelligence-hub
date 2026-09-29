import { useState, useMemo } from 'react'
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
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../../utils/colors'
import { fmtMoney, fmtN } from '../../utils/formatters'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler, annotationPlugin)

/** Media-plan simulation results: KPIs, benchmark check, charts, optimum, weekly table, CSV export. */
export default function PlanResults({ result, campaign, benchmarks, channelBenchmark, selectedChannel, numWeeks, weeklySpends }) {
  // Traffic (awareness) campaigns plan for reach and visits; the lead model's outputs don't apply.
  const traffic = campaign?.objective === 'traffic'
  const lastReach = result.funnel_curve?.[result.funnel_curve.length - 1]?.reach_pct
  const [activeChartTab, setActiveChartTab] = useState('funnel')
  // CSV Export
  const exportCSV = () => {
    if (!result) return
    const headers = ['Hafta', 'Spend (TL)', 'Adstocked Spend', 'Saturation', 'Model Lead', 'Funnel Lead', 'Impressions', 'Clicks', 'Reach %', 'CPL (TL)']
    const rows = result.weekly_details.map((d, i) => {
      const f = result.funnel_curve?.[i]
      const cplW = d.estimated_leads > 0 ? (d.spend / d.estimated_leads).toFixed(0) : '-'
      return [
        `W${d.week}`, d.spend, d.adstocked_spend.toFixed(0), d.saturated.toFixed(4),
        d.estimated_leads.toFixed(1), f?.estimated_leads_funnel?.toFixed(1) || '-',
        f?.impressions?.toFixed(0) || '-', f?.clicks?.toFixed(0) || '-',
        f?.reach_pct?.toFixed(1) || '-', cplW,
      ]
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dijital_plan_${selectedChannel}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Derived data
  const channelColor = CHANNEL_COLORS[selectedChannel] || '#f97316'
  const channelLabel = CHANNEL_LABELS[selectedChannel] || selectedChannel
  const totalSpend = weeklySpends.reduce((s, v) => s + v, 0)
  const deviationPct = result?.summary?.funnel_vs_mmm_deviation_pct || 0
  const deviationHigh = Math.abs(deviationPct) > 30

  // Half-life
  const halfLife = result?.decay > 0 && result.decay < 1
    ? Math.ceil(Math.log(0.5) / Math.log(result.decay))
    : 0

  // --- Chart Data ---
  const adstockChartData = useMemo(() => {
    if (!result) return null
    const details = result.weekly_details
    return {
      labels: details.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Ham Spend',
          data: details.map(d => d.spend),
          borderColor: 'rgba(148,163,184,0.5)',
          backgroundColor: 'rgba(148,163,184,0.08)',
          borderDash: [4, 4],
          fill: false, tension: 0.3, pointRadius: 3,
        },
        {
          label: 'Adstocked Spend',
          data: details.map(d => d.adstocked_spend),
          borderColor: channelColor,
          backgroundColor: channelColor + '20',
          fill: true, tension: 0.3, pointRadius: 4,
        },
        {
          type: 'bar',
          label: 'Carry-over',
          data: details.map(d => Math.max(0, d.adstocked_spend - d.spend)),
          backgroundColor: channelColor + '30',
          borderColor: channelColor + '50',
          borderWidth: 1, borderRadius: 2,
        },
      ],
    }
  }, [result, channelColor])

  const saturationChartData = useMemo(() => {
    if (!result?.saturation_curve) return null
    const { spend_values, saturated_values } = result.saturation_curve
    return {
      labels: spend_values.map(v => fmtMoney(v)),
      datasets: [{
        label: 'Saturation Response',
        data: saturated_values,
        borderColor: channelColor,
        backgroundColor: channelColor + '15',
        fill: true, tension: 0.4, pointRadius: 0,
      }],
    }
  }, [result, channelColor])

  const funnelChartData = useMemo(() => {
    if (!result?.funnel_curve?.length || !result?.weekly_details?.length) return null
    const fc = result.funnel_curve
    const wd = result.weekly_details
    return {
      labels: fc.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Gösterim',
          data: fc.map(d => d.impressions),
          backgroundColor: '#3b82f620',
          borderColor: '#3b82f6',
          borderWidth: 1.5, borderRadius: 2,
          yAxisID: 'y',
        },
        {
          label: traffic ? 'Tıklama (site trafiği)' : 'Tıklama',
          data: fc.map(d => d.clicks),
          backgroundColor: '#14b8a620',
          borderColor: '#14b8a6',
          borderWidth: 1.5, borderRadius: 2,
          // Own axis: clicks are ~1% of impressions, so a shared axis hides one or the other.
          yAxisID: 'yClicks',
        },
        {
          type: 'line',
          label: 'Model Lead',
          data: wd.map(d => d.estimated_leads),
          borderColor: channelColor,
          backgroundColor: channelColor + '20',
          fill: false, tension: 0.3, pointRadius: 4, borderWidth: 2.5,
          yAxisID: 'y1',
        },
        {
          type: 'line',
          label: 'Funnel Lead',
          data: fc.map(d => d.estimated_leads_funnel),
          borderColor: '#8b5cf6',
          borderDash: [5, 3],
          fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2,
          yAxisID: 'y1',
        },
      // Traffic campaigns plan for impressions/clicks only; the lead lines don't apply.
      ].filter(ds => !traffic || ds.yAxisID !== 'y1'),
    }
  }, [result, channelColor, traffic])

  const reachChartData = useMemo(() => {
    if (!result?.funnel_curve?.length) return null
    const fc = result.funnel_curve
    return {
      labels: fc.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Reach %',
          data: fc.map(d => d.reach_pct),
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true, tension: 0.3, pointRadius: 4, borderWidth: 2.5,
          yAxisID: 'y',
        },
        {
          label: 'Eff. Frequency',
          data: fc.map(d => d.frequency),
          borderColor: '#f97316',
          borderDash: [5, 3],
          fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2,
          yAxisID: 'y1',
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
        label: 'Tahmini Lead (Yanit Modeli)',
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

  // When marginal return never drops below 10% within the scan, the threshold is only the scan limit.
  const satFound = result?.optimal?.saturation_threshold_found !== false
  const satLabel = result?.optimal
    ? `${satFound ? '' : '>'}${fmtMoney(result.optimal.saturation_threshold_spend)}`
    : ''

  const adstockOpts = useMemo(() => {
    // Optimal/saturation come from the lead response curve; meaningless for traffic campaigns.
    if (!result?.optimal || traffic) return lineOpts
    const optSpend = result.optimal.optimal_weekly_spend
    const satSpend = result.optimal.saturation_threshold_spend
    return {
      ...lineOpts,
      plugins: {
        ...lineOpts.plugins,
        annotation: {
          annotations: {
            optimalLine: {
              type: 'line', yMin: optSpend, yMax: optSpend,
              borderColor: 'rgba(74, 222, 128, 0.6)', borderWidth: 1.5, borderDash: [6, 3],
              label: { display: true, content: `Optimal: ${fmtMoney(optSpend)}`, position: 'start', backgroundColor: 'rgba(74, 222, 128, 0.15)', color: '#4ade80', font: { size: 10 }, padding: 3 },
            },
            saturationLine: {
              type: 'line', yMin: satSpend, yMax: satSpend,
              borderColor: 'rgba(250, 204, 21, 0.5)', borderWidth: 1.5, borderDash: [6, 3],
              label: { display: true, content: `Doygunluk: ${satLabel}`, position: 'end', backgroundColor: 'rgba(250, 204, 21, 0.15)', color: '#facc15', font: { size: 10 }, padding: 3 },
            },
          },
        },
      },
    }
  }, [result, lineOpts, traffic, satLabel])

  const satOpts = {
    ...lineOpts,
    plugins: {
      ...lineOpts.plugins,
      tooltip: { callbacks: { label: ctx => `Response: ${ctx.parsed.y.toFixed(4)}`, title: ctx => `Spend: ${ctx[0].label}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
      y: { ticks: { callback: v => v.toFixed(2) } },
    },
  }

  const funnelOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtN(ctx.parsed.y)}` } },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        position: 'left',
        ticks: { callback: v => fmtN(v), color: '#3b82f6' },
        title: { display: true, text: 'Gösterim', font: { size: 10 }, color: '#3b82f6' },
      },
      yClicks: {
        position: 'right',
        ticks: { callback: v => fmtN(v), color: '#14b8a6' },
        title: { display: true, text: 'Tıklama', font: { size: 10 }, color: '#14b8a6' },
        grid: { drawOnChartArea: false },
      },
      y1: {
        display: !traffic,
        position: 'right',
        ticks: { callback: v => v.toFixed(0) },
        title: { display: true, text: 'Lead', font: { size: 10 }, color: '#64748b' },
        grid: { drawOnChartArea: false },
      },
    },
  }

  const reachOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        position: 'left',
        ticks: { callback: v => `%${v.toFixed(0)}` },
        min: 0, max: 100,
        title: { display: true, text: 'Reach %', font: { size: 10 }, color: '#64748b' },
      },
      y1: {
        position: 'right',
        ticks: { callback: v => v.toFixed(1) },
        title: { display: true, text: 'Eff. Frequency', font: { size: 10 }, color: '#64748b' },
        grid: { drawOnChartArea: false },
      },
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

  return (
    <>
      {result.assumed_metrics && (
        <p className="text-[11px] text-amber-300 bg-amber-900/15 border border-amber-800/30 rounded-lg px-3 py-2">
          ⚠ Bu kanalın CPM/CTR/kitle değerleri <strong>yer tutucu</strong>dur, piyasa verisi değildir. Gelişmiş Ayarlar'dan
          ajansın CPM'ini girin ya da Excel planına CPM veya planlanan gösterim sütunu ekleyin.
        </p>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Toplam Harcama</p>
          <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtMoney(result.summary?.total_spend || totalSpend)} TL</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Ort. Haftalık</p>
          <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtMoney(result.summary?.avg_spend || totalSpend / numWeeks)} TL</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Impressions</p>
          <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(result.summary?.total_impressions || 0)}</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Clicks</p>
          <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(result.summary?.total_clicks || 0)}</p>
        </div>
        {traffic ? (
          <>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Erişim (son hafta)</p>
              <p className="text-lg font-mono text-accent mt-0.5">{lastReach != null ? `%${lastReach.toFixed(1)}` : '-'}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Ort. CPM</p>
              <p className="text-lg font-mono text-violet-400 mt-0.5">{result.summary?.avg_cpm > 0 ? `${fmtMoney(result.summary.avg_cpm)} TL` : '-'}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Ort. CPC</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{result.summary?.avg_cpc > 0 ? `${fmtMoney(result.summary.avg_cpc)} TL` : '-'}</p>
            </div>
          </>
        ) : (
        <>
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Model Lead</p>
          <p className="text-lg font-mono text-accent mt-0.5">{result.summary?.total_leads_mmm?.toFixed(0) ?? '-'}</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Funnel Lead</p>
          <p className="text-lg font-mono text-violet-400 mt-0.5">{result.summary?.total_leads_funnel?.toFixed(0) ?? '-'}</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">CPL (Model)</p>
          <p className="text-lg font-mono text-slate-100 mt-0.5">
            {result.summary?.avg_cpl_mmm > 0 ? `${fmtMoney(result.summary.avg_cpl_mmm)} TL` : '-'}
          </p>
        </div>
        </>
        )}
      </div>

      {/* Deviation badge */}
      {!traffic && result.summary?.funnel_vs_mmm_deviation_pct != null && (
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium ${
            deviationHigh
              ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          }`}>
            Model vs Funnel Sapma: %{Math.abs(deviationPct).toFixed(0)}
          </span>
          {!deviationHigh && (
            <span className="text-[10px] text-slate-400">Modeller uyumlu</span>
          )}
        </div>
      )}

      {/* GA4/DDA Benchmark — validates the assumption-based plan against real data */}
      {channelBenchmark && (
        <div className="dark-card p-4 border border-emerald-500/20">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="card-title">GA4 Gerçek Veri — Sağlama</span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {channelLabel} · {benchmarks.data_source === 'bigquery' ? 'BigQuery GA4 export' : 'CRM/CSV'} ·
                {benchmarks.run_date ? ` ${new Date(benchmarks.run_date).toLocaleDateString('tr-TR')}` : ''}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              Gözleme Dayalı
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-dark-bg rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">DDA Katkı Payı</p>
              <p className="text-sm font-mono text-emerald-400 mt-0.5">%{(channelBenchmark.dda_weight * 100).toFixed(1)}</p>
            </div>
            <div className="bg-dark-bg rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Asist Oranı</p>
              <p className="text-sm font-mono text-slate-100 mt-0.5">%{(channelBenchmark.assist_ratio * 100).toFixed(0)}</p>
            </div>
            <div className="bg-dark-bg rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Son Temas</p>
              <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtN(channelBenchmark.last_touch || 0)}</p>
            </div>
            <div className="bg-dark-bg rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Touchpoint</p>
              <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtN(channelBenchmark.touchpoints || 0)}</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
            Yukarıdaki plan tahminleri sektör varsayımı parametreleriyle (CPM/CTR/Lead Rate) hesaplanır.
            Bu satır ise gerçek GA4 kullanıcı yolculuklarından gelen DDA sinyalidir — kanalın dönüşüme
            gerçek katkısını gösterir. Plan ile gerçeğin tutarlılığını buradan denetleyebilirsiniz.
            {channelBenchmark.dda_weight > 0 && benchmarks.overall_conversion_rate > 0 && (
              <> {' '}Kampanya geneli dönüşüm oranı: <span className="text-slate-300">%{(benchmarks.overall_conversion_rate * 100).toFixed(1)}</span>.</>
            )}
          </p>
        </div>
      )}

      {campaign?.id && benchmarks && !benchmarks.available && (
        <div className="dark-card p-3 border border-dark-border">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            <span className="text-yellow-400">⚠ Sağlama verisi yok.</span> Bu kampanya için henüz DDA çalıştırılmadı.
            Attribution sekmesinden GA4/CSV verisiyle DDA çalıştırınca, plan varsayımları gerçek veriyle
            karşılaştırılabilir hale gelir. Şu an plan tamamen varsayım bazlıdır.
          </p>
        </div>
      )}

      {/* Chart Tabs */}
      <div className="dark-card">
        <div className="card-hdr">
          <div className="flex gap-1">
            {[
              { id: 'funnel', label: 'Funnel Projeksiyon' },
              { id: 'adstock', label: 'Carryover & Adstock' },
              { id: 'saturation', label: 'Saturation' },
              { id: 'reach', label: 'Reach & Frequency' },
              ...(traffic ? [] : [{ id: 'response', label: 'Haftalık Lead' }]),
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveChartTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeChartTab === t.id
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono text-slate-400">
            {channelLabel} | {'λ'}={result.decay}
          </span>
        </div>
        <div className="p-4">
          {/* Funnel Tab */}
          {activeChartTab === 'funnel' && (
            <>
              <div className="h-72">
                {funnelChartData && <Bar data={funnelChartData} options={funnelOpts} />}
              </div>
              <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">Funnel Projeksiyon:</strong>
                {traffic
                  ? ` Harcama → Gösterim (harcama ÷ CPM ${fmtMoney(result.digital_metrics?.cpm)} TL × 1000) → Tıklama / site trafiği (gösterim × CTR %${((result.digital_metrics?.ctr || 0) * 100).toFixed(2)}). Gösterim sol, tıklama sağ eksende; CTR sabit varsayıldığı için iki çubuk aynı oranda hareket eder. Erişim ve frekans için Reach & Frequency sekmesine bakın.`
                  : <>
                      {` Harcama → Gösterim (CPM ${fmtMoney(result.digital_metrics?.cpm)} TL) → Tıklama (CTR %${((result.digital_metrics?.ctr || 0) * 100).toFixed(2)}) → Lead (lead oranı). Gösterim sol, tıklama ve lead sağ eksenlerde; CTR sabit varsayıldığı için gösterim ve tıklama çubukları aynı oranda hareket eder. `}
                      {'Yanıt modeli ve funnel lead tahminleri paralel gösterilir — ikisi farklı varsayımlara dayanır; sapma %30\'u aşarsa varsayımlar birbiriyle tutarsızdır.'}
                    </>}
              </div>
            </>
          )}

          {/* Adstock Tab */}
          {activeChartTab === 'adstock' && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                  ⚠ Varsayım Bazlı Model
                </span>
                <span className="text-[10px] text-slate-400">λ decay parametresi sektör ortalamasıdır, gerçek veriye fit edilmemiştir</span>
              </div>
              <div className="h-72">
                {adstockChartData && <Line data={adstockChartData} options={adstockOpts} />}
              </div>
              <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">{channelLabel}</strong>
                {' kanalinda λ='}{result.decay}{' decay parametresi ile reklam etkisi '}
                <strong className="text-accent">{halfLife} haftada</strong>
                {' yarısına düşer. '}
                {result.decay >= 0.3
                  ? 'Orta-yüksek carry-over: harcama durdurulsa bile etki birden sıfırlanmaz.'
                  : 'Düşük carry-over: etki hemen sönümlenir, sürekli harcama önemlidir.'}
              </div>
            </>
          )}

          {/* Saturation Tab */}
          {activeChartTab === 'saturation' && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                  ⚠ Varsayım Bazlı Model
                </span>
                <span className="text-[10px] text-slate-400">α/γ Hill parametreleri sektör ortalamasıdır; 8+ haftalık veriyle kalibre edilebilir</span>
              </div>
              <div className="h-72">
                {saturationChartData && <Line data={saturationChartData} options={satOpts} />}
              </div>
              {result.optimal && !traffic && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">Optimal Spend</p>
                    <p className="text-sm font-mono text-green-400 mt-0.5">{fmtMoney(result.optimal.optimal_weekly_spend)} TL</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">Doygunluk Esigi</p>
                    <p className="text-sm font-mono text-yellow-400 mt-0.5">{satLabel} TL</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">Mevcut Ort.</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtMoney(result.optimal.current_avg_spend)} TL</p>
                  </div>
                </div>
              )}
              <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">Saturation:</strong>
                {' α='}{fmtMoney(result.alpha)}{' TL (yari-doygunluk noktasi), γ='}{result.gamma}{' (egri sekli). '}
                {'Harcama arttikca marjinal getiri azalir. Optimal noktadan sonra her ek TL\'nin katkisi duser.'}
              </div>
            </>
          )}

          {/* Reach Tab */}
          {activeChartTab === 'reach' && (
            <>
              <div className="h-72">
                {reachChartData && <Line data={reachChartData} options={reachOpts} />}
              </div>
              {result.funnel_curve?.length > 0 && (() => {
                const last = result.funnel_curve[result.funnel_curve.length - 1]
                return (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Son Hafta Reach</p>
                      <p className="text-sm font-mono text-blue-400 mt-0.5">%{last.reach_pct?.toFixed(1)}</p>
                    </div>
                    <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Eff. Frequency</p>
                      <p className="text-sm font-mono text-orange-400 mt-0.5">{last.frequency?.toFixed(1)}</p>
                    </div>
                    <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Hedef Kitle</p>
                      <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtN(result.digital_metrics?.target_audience || 0)}</p>
                    </div>
                  </div>
                )
              })()}
              <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">Reach & Frequency:</strong>
                {' Poisson 1+ reach modeli: reach = 1 - e^(-impressions/audience). '}
                {'Effective frequency, freq_cap ile sinirlandirilir. Reach arttikca marjinal erisim azalir.'}
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
                <strong className="text-slate-300">Haftalık Lead Tahmini (Yanıt Modeli):</strong>
                {' Spend → Adstock → Saturation → Response pipeline sonucu tahmini haftalık lead sayısı. '}
                {'Peak hafta: W'}{result.summary?.peak_week}
                {' ('}{result.weekly_details[result.summary?.peak_week - 1]?.estimated_leads.toFixed(0)}{' lead).'}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Optimal Spend Recommendation */}
      {result.optimal && !traffic && (
        <div className="dark-card border-accent/30">
          <div className="card-hdr">
            <span className="card-title">Optimal Harcama Onerisi</span>
            {(() => {
              const avg = result.optimal.current_avg_spend
              const opt = result.optimal.optimal_weekly_spend
              const thr = result.optimal.saturation_threshold_spend
              const status = avg < opt * 0.8 ? 'low' : satFound && avg > thr ? 'high' : 'good'
              const statusConfig = {
                low: { color: 'text-blue-400', bg: 'bg-blue-500/15', label: 'Arttirilabilir' },
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
        <div className="p-4 scroll-hint">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-dark-border text-slate-400">
                <th className="text-left py-2 px-2">Hafta</th>
                <th className="text-right py-2 px-2">Spend (TL)</th>
                <th className="text-right py-2 px-2">Adstocked</th>
                <th className="text-right py-2 px-2">Impressions</th>
                <th className="text-right py-2 px-2">Clicks</th>
                {!traffic && <th className="text-right py-2 px-2">Model Lead</th>}
                {!traffic && <th className="text-right py-2 px-2">Funnel Lead</th>}
                <th className="text-right py-2 px-2">Reach %</th>
                <th className="text-right py-2 px-2">{traffic ? 'CPC' : 'CPL'}</th>
              </tr>
            </thead>
            <tbody>
              {result.weekly_details.map((d, i) => {
                const f = result.funnel_curve?.[i]
                const isPeak = d.week === result.summary?.peak_week
                const cplW = d.estimated_leads > 0 ? d.spend / d.estimated_leads : 0
                const cpcW = f?.clicks > 0 ? d.spend / f.clicks : 0
                return (
                  <tr
                    key={d.week}
                    className={`border-b border-dark-border/50 ${isPeak ? 'bg-accent/5' : 'hover:bg-dark-bg/30'}`}
                  >
                    <td className="py-2 px-2 font-mono text-slate-300">
                      W{d.week}
                      {isPeak && <span className="ml-1 text-[9px] text-accent font-semibold">PEAK</span>}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-slate-200">{fmtMoney(d.spend)}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtMoney(d.adstocked_spend)}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtN(f?.impressions || 0)}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtN(f?.clicks || 0)}</td>
                    {!traffic && <td className="py-2 px-2 text-right font-mono text-slate-100">{d.estimated_leads.toFixed(1)}</td>}
                    {!traffic && <td className="py-2 px-2 text-right font-mono text-violet-400">{f?.estimated_leads_funnel?.toFixed(1) || '-'}</td>}
                    <td className="py-2 px-2 text-right font-mono text-blue-400">%{f?.reach_pct?.toFixed(1) || '-'}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-400">
                      {traffic
                        ? (cpcW > 0 ? `${fmtMoney(cpcW)} TL` : '-')
                        : (cplW > 0 ? `${fmtMoney(cplW)} TL` : '-')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
