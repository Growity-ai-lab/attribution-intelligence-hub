import { useState, useEffect, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import { Line } from 'react-chartjs-2'
import { fmtMoney, fmtN, fmtPct } from '../../utils/formatters'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, annotationPlugin)

const BREAKDOWNS = [
  { key: 'by_station', label: 'Kanal' },
  { key: 'by_daypart', label: 'Kuşak' },
  { key: 'by_creative', label: 'Kreatif' },
  { key: 'by_weekday', label: 'Gün' },
  { key: 'by_medium', label: 'Mecra' },
]
const MEDIUM = { tv: 'TV', radio: 'Radyo' }
const STATUS = { measured: '', no_data: 'trafik verisi yok', no_baseline: 'baz çizgisi yok' }
const legend = { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } }
// Cost per visit spans a few TL to thousands: show it whole, not as "1K".
const fmtTL = v => (typeof v === 'number' ? `${Math.round(v).toLocaleString('tr-TR')} TL` : '—')
const fmt1 = v => (typeof v === 'number' ? v.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '—')

/** Measured spot effects: KPIs, trust check, response curve, breakdowns, day view, spot list. */
export default function SpotResults({ analysis, campaignId, metric, timeline }) {
  const t = analysis.totals
  const p = analysis.placebo
  const unit = analysis.metric?.key === 'conversions' ? 'dönüşüm' : 'ziyaret'
  const unitCap = unit === 'dönüşüm' ? 'Dönüşüm' : 'Ziyaret'
  const [tab, setTab] = useState('by_station')
  const [showAll, setShowAll] = useState(false)
  const [sort, setSort] = useState('time')

  const kpis = [
    { label: 'Ölçülen spot', value: `${t.spots_measured} / ${t.spots_total}` },
    { label: 'Maliyet (ölçülen)', value: `${fmtMoney(t.cost)} TL` },
    { label: `Ek ${unit}`, value: fmt1(t.visits), accent: true },
    { label: `Spot başı ek ${unit}`, value: fmt1(t.visits_per_spot) },
    { label: `Ek ${unit} başı maliyet`, value: fmtTL(t.cost_per_visit) },
    ...(t.conversions != null && unit === 'ziyaret' ? [{ label: 'Ek dönüşüm', value: fmt1(t.conversions) }] : []),
    { label: 'Anlamlı tepki veren spot', value: fmtPct(t.significant_share) },
    { label: 'Toplam trafikteki payı', value: fmtPct(t.effect_share_of_traffic) },
  ]

  const curve = analysis.response_curve || []
  const curveData = {
    labels: curve.map(c => (c.minute === 0 ? 'Yayın' : `${c.minute > 0 ? '+' : ''}${c.minute} dk`)),
    datasets: [
      { label: `Spot sonrası (baz üstü ${unit}/dk)`, data: curve.map(c => c.spot), borderColor: '#f97316', backgroundColor: '#f9731620', fill: true, tension: 0.25, pointRadius: 2, borderWidth: 2 },
      { label: 'Spotsuz günler aynı saat (güven testi)', data: curve.map(c => c.placebo), borderColor: '#64748b', borderDash: [5, 3], tension: 0.25, pointRadius: 0, borderWidth: 1.5 },
    ],
  }
  const curveOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend,
      annotation: { annotations: { onAir: { type: 'line', xMin: curve.findIndex(c => c.minute === 0), xMax: curve.findIndex(c => c.minute === 0), borderColor: 'rgba(249,115,22,0.5)', borderWidth: 1, borderDash: [4, 4] } } },
    },
    scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { ticks: { callback: v => fmt1(v) } } },
  }

  const spots = useMemo(() => {
    const rows = [...analysis.spots]
    if (sort === 'effect') rows.sort((a, b) => (b.visits ?? -1e9) - (a.visits ?? -1e9))
    if (sort === 'cpv') rows.sort((a, b) => (a.cost_per_visit ?? 1e18) - (b.cost_per_visit ?? 1e18))
    return rows
  }, [analysis.spots, sort])

  const downloadCsv = () => {
    const header = ['Yayın', 'Mecra', 'Kanal', 'Program', 'Kreatif', 'Kuşak', 'Maliyet (TL)', 'GRP', `Baz (${unit}/dk)`, `Ek ${unit}`, `Ek ${unit} başı maliyet`, 'Ek dönüşüm', 'z', 'Anlamlı', 'Blok spot sayısı', 'Durum']
    const lines = analysis.spots.map(r => [r.aired_at.replace('T', ' '), MEDIUM[r.medium] || r.medium, r.station, r.program, r.creative, r.daypart,
      r.cost, r.grp ?? '', r.baseline_per_min ?? '', r.visits ?? '', r.cost_per_visit ?? '', r.conversions ?? '', r.z ?? '',
      r.significant ? 'evet' : 'hayır', r.block_size, STATUS[r.status] || 'ölçüldü'])
    const csv = [header, ...lines].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'spot_etkisi.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const calibrated = p.ok && p.false_positive_rate != null && p.false_positive_rate <= 0.06
  return (
    <div className="space-y-5">
      {analysis.is_sample && (
        <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300" data-testid="sample-banner">
          <strong>Örnek (sentetik) veri:</strong> spot listesi ve trafik üretilmiş veridir, her spota bilinen bir etki eklenmiştir.
          Ekranları denemek içindir; gerçek kampanya sonucu değildir.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="dark-card p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{k.label}</p>
            <p className={`text-lg font-mono mt-0.5 ${k.accent ? 'text-accent' : 'text-slate-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className={`px-4 py-3 rounded-xl border text-xs leading-relaxed ${calibrated ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}
        data-testid="trust-check">
        <strong>Güven testi:</strong>{' '}
        {p.ok
          ? <>Aynı hesap, spot olmayan {p.windows} anda (spotsuz günlerde aynı saatler) yapıldı. Bu anların
            {' '}{fmtPct(p.false_positive_rate)}'i "anlamlı etki" çıktı (beklenen ~%2–3); tipik gürültü pencere başına ±{fmt1(p.noise_sd_per_window)} {unit}.
            {calibrated ? ' Yöntem bu veride kalibre görünüyor.' : ' Sahte etki oranı yüksek: sonuçları dikkatle okuyun.'}</>
          : <>Spotsuz karşılaştırma dönemi yetersiz ({p.windows} pencere). Etkiler hesaplandı ama hangisinin gerçek olduğu ayırt edilemiyor.</>}
      </div>

      {analysis.warnings?.length > 0 && (
        <div className="space-y-1">
          {analysis.warnings.map(w => <p key={w} className="text-[11px] text-amber-300">⚠ {w}</p>)}
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-5">
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Ortalama tepki (tek spotlu yayınlar)</span>
          </div>
          <div className="p-4">
            <div className="h-64">{curve.some(c => c.spot != null) ? <Line data={curveData} options={curveOpts} /> : <p className="text-xs text-slate-400">Tek spotlu yayın yok.</p>}</div>
            <p className="mt-2 text-[10px] text-slate-500">
              Yayın dakikası etrafında baz çizgisinin üstündeki {unit}. Turuncu çizginin yayından sonra yükselip gri çizginin sıfır civarında
              kalması gerçek bir tepkiyi gösterir.
            </p>
          </div>
        </div>
        <DayView analysis={analysis} campaignId={campaignId} metric={metric} timeline={timeline} unit={unit} />
      </div>

      <div className="dark-card" role="region" aria-label="Kırılımlar">
        <div className="card-hdr">
          <div className="flex gap-1 flex-wrap">
            {BREAKDOWNS.map(b => (
              <button key={b.key} onClick={() => setTab(b.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === b.key ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-300'}`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 scroll-hint">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-dark-border text-slate-400">
                <th className="text-left py-2 px-2">{BREAKDOWNS.find(b => b.key === tab).label}</th>
                <th className="text-right py-2 px-2">Spot</th>
                <th className="text-right py-2 px-2">Maliyet</th>
                <th className="text-right py-2 px-2">Ek {unit}</th>
                <th className="text-right py-2 px-2">Spot başı</th>
                <th className="text-right py-2 px-2">{unitCap} başı maliyet</th>
                {unit === 'ziyaret' && <th className="text-right py-2 px-2">Ek dönüşüm</th>}
                <th className="text-right py-2 px-2">Anlamlı</th>
              </tr>
            </thead>
            <tbody>
              {(analysis[tab] || []).map(g => (
                <tr key={g.name} className="border-b border-dark-border/50">
                  <td className="py-2 px-2 text-slate-200">{MEDIUM[g.name] || g.name}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{g.spots}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtMoney(g.cost)}</td>
                  <td className="py-2 px-2 text-right font-mono text-accent">{fmt1(g.visits)}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{fmt1(g.visits_per_spot)}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtTL(g.cost_per_visit)}</td>
                  {unit === 'ziyaret' && <td className="py-2 px-2 text-right font-mono text-slate-300">{fmt1(g.conversions)}</td>}
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtPct(g.significant_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dark-card" role="region" aria-label="Spot listesi">
        <div className="card-hdr">
          <span className="card-title">Spotlar</span>
          <div className="flex items-center gap-2">
            <select aria-label="Sıralama" value={sort} onChange={e => setSort(e.target.value)}
              className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-slate-300">
              <option value="time">Yayın saatine göre</option>
              <option value="effect">En çok {unit} getirene göre</option>
              <option value="cpv">En ucuz {unit}e göre</option>
            </select>
            <button onClick={downloadCsv} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-300 hover:text-slate-100">CSV İndir</button>
          </div>
        </div>
        <div className="p-4 scroll-hint">
          <table className="w-full text-xs min-w-[980px]">
            <thead>
              <tr className="border-b border-dark-border text-slate-400">
                <th className="text-left py-2 px-2">Yayın</th>
                <th className="text-left py-2 px-2">Kanal</th>
                <th className="text-left py-2 px-2">Program / kreatif</th>
                <th className="text-left py-2 px-2">Kuşak</th>
                <th className="text-right py-2 px-2">Maliyet</th>
                <th className="text-right py-2 px-2">Baz/dk</th>
                <th className="text-right py-2 px-2">Ek {unit}</th>
                <th className="text-right py-2 px-2">{unitCap} başı maliyet</th>
                <th className="text-right py-2 px-2" title="Etki / gürültü; 2 ve üstü anlamlı">z</th>
              </tr>
            </thead>
            <tbody>
              {(showAll ? spots : spots.slice(0, 50)).map(r => (
                <tr key={`${r.id}-${r.aired_at}-${r.station}`} className="border-b border-dark-border/50">
                  <td className="py-1.5 px-2 font-mono text-slate-300 whitespace-nowrap">{r.aired_at.replace('T', ' ')}</td>
                  <td className="py-1.5 px-2 text-slate-200 whitespace-nowrap">
                    {r.station} <span className="text-[9px] text-slate-500">{MEDIUM[r.medium] || r.medium}</span>
                    {r.block_size > 1 && <span className="ml-1 text-[9px] text-slate-500" title="Tepki penceresi çakışan spotlarla birlikte ölçüldü">blok ×{r.block_size}</span>}
                  </td>
                  <td className="py-1.5 px-2 text-slate-400">{[r.program, r.creative].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">{r.daypart}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtMoney(r.cost)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-400">{fmt1(r.baseline_per_min)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${r.significant ? 'text-accent' : 'text-slate-300'}`}>
                    {r.status === 'measured' ? fmt1(r.visits) : <span className="text-slate-500">{STATUS[r.status]}</span>}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtTL(r.cost_per_visit)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-400">{r.z != null ? r.z.toFixed(1) : '—'}{r.significant && ' ✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {spots.length > 50 && (
            <button onClick={() => setShowAll(v => !v)} className="mt-2 text-[11px] text-slate-400 hover:text-slate-200">
              {showAll ? 'İlk 50 spotu göster' : `Tümünü göster (${spots.length})`}
            </button>
          )}
        </div>
      </div>

      <details className="dark-card p-4 text-xs text-slate-400 leading-relaxed">
        <summary className="cursor-pointer text-slate-300">Nasıl hesaplanıyor?</summary>
        <ol className="mt-2 list-decimal pl-5 space-y-1">
          <li>Baz çizgisi: yayından önceki {analysis.params.pre_minutes} dakikadaki trafiğin medyanı (başka bir yayının tepki dakikaları hariç).</li>
          <li>Etki: yayın dakikasından itibaren {analysis.params.post_minutes} dakikalık trafik − baz çizgisi × süre.</li>
          <li>Tepki pencereleri çakışan spotlar (aynı reklam arası, farklı kanallar) tek blok olarak ölçülür; etki GRP'ye, yoksa maliyete, o da yoksa eşit bölünür.</li>
          <li>Güven testi: aynı hesap, spotsuz günlerde aynı saatlerde yapılır. Ortalaması yöntemin sapmasıdır (her etkiden düşülür), dağılımı gürültüdür; z = etki / gürültü, 2 ve üstü anlamlı.</li>
          <li>Ölçülen, yayının hemen ardından gelen ziyarettir; sonraki günlere yayılan marka etkisi bu yöntemin kapsamında değildir.</li>
        </ol>
      </details>
    </div>
  )
}

/** One day's minute traffic with the spots that aired that day. */
function DayView({ analysis, campaignId, metric, timeline, unit }) {
  const days = useMemo(() => [...new Set(analysis.spots.filter(s => s.status === 'measured').map(s => s.aired_at.slice(0, 10)))], [analysis.spots])
  const [day, setDay] = useState(days[0] || '')
  const [data, setData] = useState(null)
  useEffect(() => { if (!days.includes(day)) setDay(days[0] || '') }, [days]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!day) { setData(null); return }
    let cancelled = false
    timeline(campaignId, day, metric).then(d => { if (!cancelled) setData(d) }).catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [campaignId, day, metric, timeline])

  const labels = Array.from({ length: 1440 }, (_, i) => `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`)
  const annotations = Object.fromEntries((data?.spots || []).map((s, i) => [`s${i}`, {
    type: 'line', xMin: s.minute, xMax: s.minute, borderColor: s.medium === 'radio' ? 'rgba(56,189,248,0.6)' : 'rgba(249,115,22,0.7)', borderWidth: 1,
    label: { display: true, content: s.station, position: i % 2 ? 'start' : 'end', font: { size: 9 }, padding: 2, backgroundColor: 'rgba(15,23,42,0.8)', color: '#cbd5e1' },
  }]))
  return (
    <div className="dark-card">
      <div className="card-hdr">
        <span className="card-title">Gün görünümü</span>
        <select aria-label="Gün" value={day} onChange={e => setDay(e.target.value)}
          className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-slate-300">
          {days.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="p-4">
        <div className="h-64">
          {data?.has_data
            ? <Line data={{ labels, datasets: [{ label: `${unit[0].toUpperCase()}${unit.slice(1)}/dk`, data: data.visits, borderColor: '#94a3b8', borderWidth: 1, pointRadius: 0, tension: 0 }] }}
                options={{ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, annotation: { annotations } },
                  scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { ticks: { callback: v => fmtN(v) } } } }} />
            : <p className="text-xs text-slate-400">Bu gün için trafik verisi yok.</p>}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">Dikey çizgiler o gün yayınlanan spotlar (turuncu TV, mavi radyo).</p>
      </div>
    </div>
  )
}
