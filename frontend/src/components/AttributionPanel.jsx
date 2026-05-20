import { useState, useCallback } from 'react'
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
import axios from 'axios'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const API = '/api'

const fmtMoney = v => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}
const fmtN = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)
const fmtPct = v => `%${(v * 100).toFixed(1)}`

const ALL_CHANNEL_LABELS = {
  ...CHANNEL_LABELS,
  direct: 'Direct',
  organic_search: 'Organic Search',
  referral: 'Referral',
  email: 'Email',
  organic_social: 'Organic Social',
  affiliate: 'Affiliate',
  other: 'Other',
}

const ALL_CHANNEL_COLORS = {
  ...CHANNEL_COLORS,
  direct: '#64748b',
  organic_search: '#22c55e',
  referral: '#06b6d4',
  email: '#eab308',
  organic_social: '#f472b6',
  affiliate: '#a78bfa',
  other: '#475569',
}

export default function AttributionPanel({ campaign }) {
  // BQ connection
  const [bqProject, setBqProject] = useState('')
  const [bqDataset, setBqDataset] = useState('')
  const [bqFile, setBqFile] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(null) // connection info or null
  const [connectError, setConnectError] = useState('')

  // Data source tab
  const [sourceTab, setSourceTab] = useState('bigquery') // 'bigquery' | 'csv'

  // Preview & DDA
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [ddaResult, setDdaResult] = useState(null)
  const [ddaLoading, setDdaLoading] = useState(false)
  const [ddaError, setDdaError] = useState('')

  // CSV fallback
  const [csvFile, setCsvFile] = useState(null)

  // Date range
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [conversionEvents, setConversionEvents] = useState('purchase')

  const handleConnect = useCallback(async () => {
    if (!bqProject || !bqDataset || !bqFile) return
    setConnecting(true)
    setConnectError('')
    try {
      const formData = new FormData()
      formData.append('credentials', bqFile)
      const res = await axios.post(`${API}/integrations/bigquery/connect`, formData, {
        params: { project: bqProject, dataset: bqDataset },
      })
      setConnected(res.data)
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail) {
        setConnectError(detail)
      } else if (err.code === 'ERR_NETWORK') {
        setConnectError('Backend sunucusuna ulasilamiyor. Sunucunun calisiyor oldugundan emin olun.')
      } else {
        setConnectError(err.message || 'Bilinmeyen hata')
      }
    }
    setConnecting(false)
  }, [bqProject, bqDataset, bqFile])

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    setDdaError('')
    try {
      const params = { project: bqProject, dataset: bqDataset, conversion_events: conversionEvents }
      if (startDate) params.start_date = startDate.replace(/-/g, '')
      if (endDate) params.end_date = endDate.replace(/-/g, '')
      const res = await axios.post(`${API}/integrations/bigquery/preview`, null, { params })
      setPreview(res.data)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
    }
    setPreviewLoading(false)
  }, [bqProject, bqDataset, startDate, endDate, conversionEvents])

  const handleRunDDA = useCallback(async () => {
    setDdaLoading(true)
    setDdaError('')
    try {
      const params = {
        project: bqProject,
        dataset: bqDataset,
        conversion_events: conversionEvents,
        campaign_id: campaign?.id || null,
      }
      if (startDate) params.start_date = startDate.replace(/-/g, '')
      if (endDate) params.end_date = endDate.replace(/-/g, '')
      const res = await axios.post(`${API}/dda/run-from-bigquery`, null, { params })
      setDdaResult(res.data)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
    }
    setDdaLoading(false)
  }, [bqProject, bqDataset, startDate, endDate, conversionEvents, campaign])

  const handleRunCSV = useCallback(async () => {
    if (!csvFile) return
    setDdaLoading(true)
    setDdaError('')
    try {
      const formData = new FormData()
      formData.append('file', csvFile)
      const params = {}
      if (campaign?.id) params.campaign_id = campaign.id
      const res = await axios.post(`${API}/dda/run-from-csv`, formData, { params })
      setDdaResult(res.data)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
    }
    setDdaLoading(false)
  }, [csvFile, campaign])

  // Chart data from DDA result
  const chartData = ddaResult ? (() => {
    const hybrid = ddaResult.hybrid_attribution || {}
    const channels = Object.keys(hybrid).sort((a, b) => hybrid[b] - hybrid[a])
    return {
      labels: channels.map(ch => ALL_CHANNEL_LABELS[ch] || ch),
      datasets: [
        {
          label: 'DDA Weight',
          data: channels.map(ch => hybrid[ch]),
          backgroundColor: channels.map(ch => (ALL_CHANNEL_COLORS[ch] || '#64748b') + '80'),
          borderColor: channels.map(ch => ALL_CHANNEL_COLORS[ch] || '#64748b'),
          borderWidth: 1, borderRadius: 3,
        },
      ],
    }
  })() : null

  const barOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => fmtPct(ctx.parsed.x) } },
    },
    scales: {
      x: { ticks: { callback: v => fmtPct(v) }, max: 1 },
      y: { grid: { display: false } },
    },
  }

  return (
    <div className="space-y-5">
      {/* Data Source Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'bigquery', label: 'BigQuery (GA4)' },
          { id: 'csv', label: 'CSV Upload' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSourceTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              sourceTab === t.id
                ? 'bg-accent/15 border border-accent/40 text-accent'
                : 'bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
        {connected && (
          <span className="ml-auto px-2.5 py-1 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 self-center">
            BQ Bagli: {connected.event_tables} tablo
          </span>
        )}
      </div>

      {/* BigQuery Connection */}
      {sourceTab === 'bigquery' && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">BigQuery Baglantisi</span>
            {connected && (
              <span className="text-[10px] font-mono text-slate-500">
                {connected.first_date} — {connected.last_date}
              </span>
            )}
          </div>
          <div className="p-4 space-y-4">
            {!connected ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Project ID</label>
                    <input
                      type="text"
                      value={bqProject}
                      onChange={e => setBqProject(e.target.value)}
                      placeholder="unicef-bagis"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Dataset</label>
                    <input
                      type="text"
                      value={bqDataset}
                      onChange={e => setBqDataset(e.target.value)}
                      placeholder="analytics_358380518"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Service Account JSON</label>
                  <input
                    type="file"
                    accept=".json"
                    onChange={e => setBqFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-dark-border file:bg-dark-bg file:text-slate-300 file:text-xs file:cursor-pointer"
                  />
                </div>
                {connectError && (
                  <p className="text-xs text-red-400">{connectError}</p>
                )}
                <button
                  onClick={handleConnect}
                  disabled={connecting || !bqProject || !bqDataset || !bqFile}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {connecting ? 'Baglaniyor...' : 'Baglan'}
                </button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-500 uppercase">Event Tablolari</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{connected.event_tables}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-500 uppercase">Ilk Tarih</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{connected.first_date}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-500 uppercase">Son Tarih</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{connected.last_date}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-500 uppercase">Dataset</p>
                    <p className="text-sm font-mono text-accent mt-0.5">{bqDataset}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Baslangic</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Bitis</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Conversion Events</label>
                    <input type="text" value={conversionEvents} onChange={e => setConversionEvents(e.target.value)}
                      placeholder="purchase"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handlePreview}
                    disabled={previewLoading}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-300 hover:text-slate-100 transition-colors disabled:opacity-40"
                  >
                    {previewLoading ? 'Sorgu calisiyor...' : 'Onizle'}
                  </button>
                  <button
                    onClick={handleRunDDA}
                    disabled={ddaLoading}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
                  >
                    {ddaLoading ? 'Analiz calisiyor...' : 'Attribution Analizi Baslat'}
                  </button>
                  <button
                    onClick={() => { setConnected(null); setPreview(null); setDdaResult(null) }}
                    className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-colors ml-auto"
                  >
                    Baglantıyı Kes
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* CSV Fallback */}
      {sourceTab === 'csv' && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">CSV Touchpoint Upload</span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-500">
              BigQuery baglantisi yoksa, CRM/analytics touchpoint CSV dosyasini yukleyebilirsiniz.
            </p>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={e => setCsvFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-dark-border file:bg-dark-bg file:text-slate-300 file:text-xs file:cursor-pointer"
            />
            <button
              onClick={handleRunCSV}
              disabled={ddaLoading || !csvFile}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {ddaLoading ? 'Analiz calisiyor...' : 'Attribution Analizi Baslat'}
            </button>
          </div>
        </div>
      )}

      {/* Preview Summary */}
      {preview && !ddaResult && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Veri Onizleme</span>
            <span className="text-[10px] font-mono text-slate-500">
              {preview.start_date} — {preview.end_date}
            </span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Toplam Event</p>
                <p className="text-sm font-mono text-slate-100">{fmtN(preview.total_events)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Benzersiz Kullanici</p>
                <p className="text-sm font-mono text-slate-100">{fmtN(preview.unique_users)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Donusum</p>
                <p className="text-sm font-mono text-accent">{fmtN(preview.conversions)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Toplam Gelir</p>
                <p className="text-sm font-mono text-emerald-400">{fmtMoney(preview.total_revenue)} TL</p>
              </div>
            </div>
            {preview.channels && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Kanal Dagilimi</p>
                {Object.entries(preview.channels).slice(0, 10).map(([ch, count]) => (
                  <div key={ch} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ALL_CHANNEL_COLORS[ch] || '#64748b' }} />
                    <span className="text-slate-300 w-28">{ALL_CHANNEL_LABELS[ch] || ch}</span>
                    <div className="flex-1 bg-dark-bg rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${Math.min(100, (count / preview.total_events) * 100)}%`,
                          backgroundColor: ALL_CHANNEL_COLORS[ch] || '#64748b',
                        }}
                      />
                    </div>
                    <span className="text-slate-500 font-mono w-16 text-right">{fmtN(count)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {ddaError && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
          {ddaError}
        </div>
      )}

      {/* DDA Results */}
      {ddaResult && (
        <>
          {/* BQ Summary KPIs */}
          {ddaResult.bq_summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Event</p>
                <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.total_events)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Benzersiz Kullanici</p>
                <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.unique_users)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Donusum</p>
                <p className="text-lg font-mono text-accent mt-0.5">{fmtN(ddaResult.bq_summary.conversions)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Gelir</p>
                <p className="text-lg font-mono text-emerald-400 mt-0.5">{fmtMoney(ddaResult.bq_summary.total_revenue)} TL</p>
              </div>
            </div>
          )}

          {/* Attribution Chart */}
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Kanal Attribution (DDA)</span>
              <span className="text-[10px] font-mono text-slate-500">
                Markov %65 + Shapley %35 blend
                {ddaResult.data_source === 'bigquery' && ' | BigQuery'}
              </span>
            </div>
            <div className="p-4">
              {chartData && (
                <div style={{ height: Math.max(200, Object.keys(ddaResult.hybrid_attribution || {}).length * 32) }}>
                  <Bar data={chartData} options={barOpts} />
                </div>
              )}
            </div>
          </div>

          {/* Attribution Table */}
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Attribution Detay</span>
              {ddaResult.mmm_shares_source && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  ddaResult.mmm_shares_source === 'fitted_per_campaign'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-yellow-500/15 text-yellow-400'
                }`}>
                  MMM: {ddaResult.mmm_shares_source}
                </span>
              )}
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-slate-400">
                    <th className="text-left py-2 px-2">Kanal</th>
                    <th className="text-right py-2 px-2">DDA Weight</th>
                    <th className="text-right py-2 px-2">Markov</th>
                    <th className="text-right py-2 px-2">Shapley</th>
                    {ddaResult.unified_report && <th className="text-right py-2 px-2">Unified Score</th>}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ddaResult.hybrid_attribution || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([ch, weight]) => {
                      const markov = ddaResult.markov?.attribution_weights?.[ch] || 0
                      const shapley = ddaResult.shapley_dda?.[ch] || 0
                      const unified = ddaResult.unified_report?.[ch]?.unified_score
                      return (
                        <tr key={ch} className="border-b border-dark-border/50 hover:bg-dark-bg/30">
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ALL_CHANNEL_COLORS[ch] || '#64748b' }} />
                              <span className="text-slate-200">{ALL_CHANNEL_LABELS[ch] || ch}</span>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-slate-100">{fmtPct(weight)}</td>
                          <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtPct(markov)}</td>
                          <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtPct(shapley)}</td>
                          {ddaResult.unified_report && (
                            <td className="py-2 px-2 text-right font-mono text-accent">
                              {unified != null ? fmtPct(unified) : '-'}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Conversion Paths */}
          {ddaResult.top_paths && ddaResult.top_paths.length > 0 && (
            <div className="dark-card">
              <div className="card-hdr">
                <span className="card-title">En Sik Donusum Yollari</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {ddaResult.journey_stats?.total_journeys || '?'} journey
                </span>
              </div>
              <div className="p-4 space-y-2">
                {ddaResult.top_paths.slice(0, 10).map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="text-slate-500 font-mono w-6 text-right">#{i + 1}</span>
                    <div className="flex items-center gap-1 flex-1 flex-wrap">
                      {p.path.map((ch, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-slate-600">→</span>}
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              backgroundColor: (ALL_CHANNEL_COLORS[ch] || '#64748b') + '20',
                              color: ALL_CHANNEL_COLORS[ch] || '#94a3b8',
                            }}
                          >
                            {ALL_CHANNEL_LABELS[ch] || ch}
                          </span>
                        </span>
                      ))}
                    </div>
                    <span className="text-slate-400 font-mono">{p.total || p.count}</span>
                    <span className="text-accent font-mono">{fmtPct(p.rate ?? p.conversion_rate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Journey Stats */}
          {ddaResult.journey_stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Toplam Journey</p>
                <p className="text-sm font-mono text-slate-100">{fmtN(ddaResult.journey_stats.total_journeys)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Donusum Yapan</p>
                <p className="text-sm font-mono text-accent">{fmtN(ddaResult.journey_stats.converted)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Donusum Orani</p>
                <p className="text-sm font-mono text-slate-100">{fmtPct(ddaResult.journey_stats.conversion_rate)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">Ort. Touchpoint</p>
                <p className="text-sm font-mono text-slate-100">{ddaResult.journey_stats.avg_path_length?.toFixed(1) || ddaResult.journey_stats.avg_touchpoints?.toFixed(1)}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {ddaLoading && (
        <div className="text-center py-12 text-slate-500 text-sm">Attribution analizi calisiyor...</div>
      )}
    </div>
  )
}
