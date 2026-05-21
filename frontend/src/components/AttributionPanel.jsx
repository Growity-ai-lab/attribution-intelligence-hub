import { useState, useCallback, useRef, useEffect } from 'react'
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
// Channel colors assigned dynamically by index — no static mapping needed

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const API = '/api'

const fmtMoney = v => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}
const fmtN = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)
const fmtPct = v => `%${(v * 100).toFixed(1)}`

const PALETTE = [
  '#3b82f6', '#f97316', '#ec4899', '#8b5cf6', '#06b6d4',
  '#ef4444', '#22c55e', '#eab308', '#14b8a6', '#a855f7',
  '#f472b6', '#64748b', '#fb923c', '#84cc16', '#6366f1',
]

function InfoTip({ text }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null)

  const handleEnter = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.top - 8, left: Math.min(r.left, window.innerWidth - 300) })
    }
    setShow(true)
  }

  return (
    <span className="relative inline-flex ml-1 cursor-help" ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)}>
      <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold transition-colors ${show ? 'bg-blue-500/30 text-blue-300' : 'bg-slate-600/50 text-slate-400'}`}>i</span>
      {show && (
        <div
          className="fixed w-72 rounded-lg bg-[#0b0e12] border border-slate-500/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-100 font-normal text-left shadow-2xl shadow-black/80"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)', zIndex: 9999 }}
        >
          {text}
        </div>
      )}
    </span>
  )
}

function getChannelColor(ch, index) {
  return PALETTE[index % PALETTE.length]
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
  const [showMethodology, setShowMethodology] = useState(false)

  // Budget simulation
  const [channelSpends, setChannelSpends] = useState({})
  const [scenarioSpends, setScenarioSpends] = useState({})
  const [simResult, setSimResult] = useState(null)
  const [simLoading, setSimLoading] = useState(false)
  const [simError, setSimError] = useState('')
  const [showScenario, setShowScenario] = useState(false)

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

  const ORGANIC_KEYWORDS = ['direct', 'organic', 'referral', 'email', '(direct)', '(none)']
  const isOrganic = ch => ORGANIC_KEYWORDS.some(kw => ch.toLowerCase().includes(kw))

  const handleSimulate = useCallback(async (useScenario = false) => {
    if (!ddaResult) return
    const weights = ddaResult.hybrid_attribution || {}
    const bq = ddaResult.bq_summary || {}
    const totalRevenue = bq.total_revenue || 0
    const totalConversions = bq.total_conversions || bq.conversions || 0

    const spends = {}
    for (const ch of Object.keys(weights)) {
      if (!isOrganic(ch) && channelSpends[ch] > 0) {
        spends[ch] = Number(channelSpends[ch])
      }
    }
    if (Object.keys(spends).length === 0) {
      setSimError('En az bir kanala harcama girmeniz gerekiyor.')
      return
    }

    setSimLoading(true)
    setSimError('')
    try {
      const body = {
        channel_spends: spends,
        dda_weights: weights,
        total_revenue: totalRevenue,
        total_conversions: totalConversions,
      }
      if (useScenario) {
        const sSpends = {}
        for (const ch of Object.keys(weights)) {
          if (!isOrganic(ch) && scenarioSpends[ch] > 0) {
            sSpends[ch] = Number(scenarioSpends[ch])
          }
        }
        if (Object.keys(sSpends).length > 0) body.scenario_spends = sSpends
      }
      const res = await axios.post(`${API}/simulation/budget`, body)
      setSimResult(res.data)
      if (useScenario) setShowScenario(true)
    } catch (err) {
      setSimError(err.response?.data?.detail || err.message)
    }
    setSimLoading(false)
  }, [ddaResult, channelSpends, scenarioSpends])

  const handleCsvSpendUpload = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const lines = evt.target.result.split('\n').filter(l => l.trim())
      const newSpends = {}
      for (const line of lines.slice(1)) {
        const [ch, spend] = line.split(',').map(s => s.trim())
        if (ch && spend && !isNaN(Number(spend))) {
          newSpends[ch] = Number(spend)
        }
      }
      setChannelSpends(prev => ({ ...prev, ...newSpends }))
    }
    reader.readAsText(file)
  }, [])

  const handleResetSim = useCallback(() => {
    setChannelSpends({})
    setScenarioSpends({})
    setSimResult(null)
    setSimError('')
    setShowScenario(false)
  }, [])

  // Chart data from DDA result
  const chartData = ddaResult ? (() => {
    const hybrid = ddaResult.hybrid_attribution || {}
    const channels = Object.keys(hybrid).sort((a, b) => hybrid[b] - hybrid[a])
    return {
      labels: channels,
      datasets: [
        {
          label: 'Katkı Payı',
          data: channels.map(ch => hybrid[ch]),
          backgroundColor: channels.map((_, i) => getChannelColor(null, i) + '80'),
          borderColor: channels.map((_, i) => getChannelColor(null, i)),
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
                {Object.entries(preview.channels).slice(0, 15).map(([ch, count], i) => (
                  <div key={ch} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(ch, i) }} />
                    <span className="text-slate-300 w-40 truncate" title={ch}>{ch}</span>
                    <div className="flex-1 bg-dark-bg rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${Math.min(100, (count / preview.total_events) * 100)}%`,
                          backgroundColor: getChannelColor(ch, i),
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
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Etkileşim</p>
                <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.total_events)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Benzersiz Kullanıcı</p>
                <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.unique_users)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Dönüşüm</p>
                <p className="text-lg font-mono text-accent mt-0.5">{fmtN(ddaResult.bq_summary.conversions)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Gelir</p>
                <p className="text-lg font-mono text-emerald-400 mt-0.5">{fmtMoney(ddaResult.bq_summary.total_revenue)} TL</p>
              </div>
            </div>
          )}

          {/* Methodology Info */}
          <div className="dark-card">
            <button
              onClick={() => setShowMethodology(v => !v)}
              className="w-full card-hdr cursor-pointer hover:bg-dark-bg/30 transition-colors"
            >
              <span className="card-title">Bu skorlar nasıl hesaplanır?</span>
              <span className="text-[10px] text-slate-500">{showMethodology ? '▲ Gizle' : '▼ Göster'}</span>
            </button>
            {showMethodology && (
              <div className="px-4 pb-4 space-y-3 text-xs text-slate-300 leading-relaxed">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-900/15 border border-blue-800/20">
                  <span className="text-blue-400 font-bold mt-0.5 flex-shrink-0">1</span>
                  <div>
                    <p className="font-semibold text-slate-200">Zincir Etkisi</p>
                    <p className="text-slate-400 mt-0.5">Her kanalı sırayla dönüşüm yolculuğundan çıkarır ve dönüşüm oranının ne kadar düştüğünü ölçer. Bir kanal çıkarıldığında dönüşümler çok düşüyorsa, o kanal zincirin kritik halkasıdır.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-900/15 border border-purple-800/20">
                  <span className="text-purple-400 font-bold mt-0.5 flex-shrink-0">2</span>
                  <div>
                    <p className="font-semibold text-slate-200">Bağımsız Katkı</p>
                    <p className="text-slate-400 mt-0.5">Her kanalın tüm olası kombinasyonlardaki katkısını hesaplar. Kanalların sırasından bağımsız olarak, her birinin dönüşüme ne kadar eklediğini adil şekilde paylaştırır.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-900/15 border border-emerald-800/20">
                  <span className="text-emerald-400 font-bold mt-0.5 flex-shrink-0">3</span>
                  <div>
                    <p className="font-semibold text-slate-200">Katkı Payı</p>
                    <p className="text-slate-400 mt-0.5">Zincir Etkisi (%65) ve Bağımsız Katkı (%35) ağırlıklı ortalaması. Tek bir model yerine ikisini harmanlayarak daha güvenilir bir sonuç elde edilir.</p>
                  </div>
                </div>
                {ddaResult.unified_report && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-900/15 border border-amber-800/20">
                    <span className="text-amber-400 font-bold mt-0.5 flex-shrink-0">4</span>
                    <div>
                      <p className="font-semibold text-slate-200">Nihai Skor</p>
                      <p className="text-slate-400 mt-0.5">Kullanıcı yolculuğu analizi (Katkı Payı) ile harcama-dönüşüm modeli (MMM) birleştirilerek oluşturulan son skor. İki farklı bakış açısını tek bir değerde özetler.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Attribution Chart */}
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Kanal Katkı Payları</span>
              <span className="text-[10px] font-mono text-slate-500">
                Zincir etkisi %65 + Bağımsız katkı %35
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
              <span className="card-title">Kanal Katkı Detayı</span>
              {ddaResult.mmm_shares_source && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  ddaResult.mmm_shares_source === 'fitted_per_campaign'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-yellow-500/15 text-yellow-400'
                }`}>
                  {ddaResult.mmm_shares_source === 'fitted_per_campaign'
                    ? 'Harcama modeli: kampanyaya özel'
                    : 'Harcama modeli: genel varsayılan'}
                </span>
              )}
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-slate-400">
                    <th className="text-left py-2 px-2">Kanal</th>
                    <th className="text-right py-2 px-2">
                      Katkı Payı
                      <InfoTip text="DDA (Data-Driven Attribution) skoru. Zincir Etkisi (%65) ve Bağımsız Katkı (%35) ağırlıklı ortalamasıdır. Her kanalın dönüşüme toplam katkısını gösterir." />
                    </th>
                    <th className="text-right py-2 px-2">
                      Zincir Etkisi
                      <InfoTip text="Markov Zinciri modeli. Kanalı dönüşüm yolculuğundan çıkarır ve dönüşüm oranının ne kadar düştüğünü ölçer. Yüksekse kanal zincirin vazgeçilmez halkasıdır." />
                    </th>
                    <th className="text-right py-2 px-2">
                      Bağımsız Katkı
                      <InfoTip text="Shapley Value modeli. Kanalın tüm olası kanal kombinasyonlarındaki marjinal katkısını hesaplar. Sıradan bağımsız, adil bir dağılım yapar." />
                    </th>
                    {ddaResult.unified_report && (
                      <th className="text-right py-2 px-2">
                        Nihai Skor
                        <InfoTip text="Unified Score. Kullanıcı yolculuğu analizi (DDA) ile harcama-dönüşüm modeli (MMM — Marketing Mix Model) birleştirilerek oluşturulan son skor." />
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ddaResult.hybrid_attribution || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([ch, weight], idx) => {
                      const markov = ddaResult.markov?.attribution_weights?.[ch] || 0
                      const shapley = ddaResult.shapley_dda?.[ch] || 0
                      const unified = ddaResult.unified_report?.[ch]?.unified_score
                      return (
                        <tr key={ch} className="border-b border-dark-border/50 hover:bg-dark-bg/30">
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(ch, idx) }} />
                              <span className="text-slate-200">{ch}</span>
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

          {/* Assisted Conversion Report */}
          {ddaResult.assist_report?.length > 0 && (() => {
            const hasAssists = ddaResult.assist_report.some(r => r.assists > 0)
            const avgTp = ddaResult.journey_stats?.avg_path_length || ddaResult.journey_stats?.avg_touchpoints || 0
            const isSingleTouch = avgTp <= 1.2
            return (
              <div className="dark-card">
                <div className="card-hdr">
                  <span className="card-title">Asist Analizi</span>
                  <span className="text-[10px] font-mono text-slate-500">
                    İlk temas / Asist / Son temas kırılımı
                  </span>
                </div>
                {isSingleTouch && (
                  <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-900/20 border border-amber-800/30">
                    <p className="text-xs text-amber-300 leading-relaxed">
                      <span className="font-semibold">Tek temaslı yolculuklar:</span>{' '}
                      Ortalama temas noktası {avgTp.toFixed(1)} — kullanıcılar tek oturumda dönüşüm yapıyor veya
                      GA4 çapraz oturum takibi (User-ID / Google Signals) aktif değil.
                      Asist verisi bu nedenle sınırlı, aşağıdaki tablo yalnızca son temas dağılımını gösteriyor.
                    </p>
                  </div>
                )}
                <div className="p-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-dark-border text-slate-400">
                        <th className="text-left py-2 px-2">Kanal</th>
                        {!isSingleTouch && (
                          <th className="text-right py-2 px-2">
                            İlk Temas
                            <InfoTip text="First Touch. Bu kanalın kullanıcının markayı ilk kez keşfettiği temas noktası olarak kaç kez göründüğü." />
                          </th>
                        )}
                        {!isSingleTouch && (
                          <th className="text-right py-2 px-2">
                            Asist
                            <InfoTip text="Assisted Conversion. Kanalın son temas olmadan dönüşüme katkı sağladığı — yani yolculukta ara adım olarak yer aldığı — sayı." />
                          </th>
                        )}
                        <th className="text-right py-2 px-2">
                          Son Temas
                          <InfoTip text="Last Touch. Kullanıcının dönüşüm yapmadan hemen önce son etkileşimde bulunduğu kanal. Genelde dönüşümü 'kapatan' kanal olarak yorumlanır." />
                        </th>
                        {!isSingleTouch && (
                          <th className="text-right py-2 px-2">
                            Toplam
                            <InfoTip text="Total Involvement. Asist + Son Temas toplamı. Kanalın dönüşüm sürecine toplam katılım sayısı." />
                          </th>
                        )}
                        {!isSingleTouch && (
                          <th className="text-right py-2 px-2">
                            Asist Oranı
                            <InfoTip text="Assist Ratio = Asist / Toplam. Yüksekse kanal genellikle arka planda çalışıyor (farkındalık); düşükse doğrudan dönüşüm sağlıyor." />
                          </th>
                        )}
                        <th className="text-right py-2 px-2">
                          {isSingleTouch ? 'Pay' : 'Rol'}
                          <InfoTip text={isSingleTouch
                            ? 'Kanalın toplam dönüşümler içindeki yüzde payı.'
                            : 'Farkındalık: asist oranı yüksek (üst huni). Dönüştürücü: son temas ağırlıklı (alt huni). Hibrit: ikisinin karışımı.'
                          } />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ddaResult.assist_report.map((r, idx) => {
                        const ratio = r.assist_ratio
                        const totalConv = ddaResult.assist_report.reduce((s, x) => s + x.last_touch, 0)
                        const share = totalConv > 0 ? r.last_touch / totalConv : 0

                        const rolLabel = isSingleTouch
                          ? fmtPct(share)
                          : ratio >= 0.55 ? 'Farkındalık' : ratio <= 0.25 ? 'Dönüştürücü' : 'Hibrit'
                        const rolColor = isSingleTouch
                          ? 'bg-slate-500/15 text-slate-300'
                          : ratio >= 0.55
                            ? 'bg-amber-500/15 text-amber-400'
                            : ratio <= 0.25
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-blue-500/15 text-blue-400'
                        return (
                          <tr key={r.channel} className="border-b border-dark-border/50 hover:bg-dark-bg/30">
                            <td className="py-2 px-2">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(r.channel, idx) }} />
                                <span className="text-slate-200">{r.channel}</span>
                              </div>
                            </td>
                            {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-400">{r.first_touch}</td>}
                            {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-400">{r.assists}</td>}
                            <td className="py-2 px-2 text-right font-mono text-slate-100">{r.last_touch}</td>
                            {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-300">{r.total_involvement}</td>}
                            {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-100">{fmtPct(ratio)}</td>}
                            <td className="py-2 px-2 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${rolColor}`}>
                                {rolLabel}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* Çıkarımlar / Insights */}
          {ddaResult.insights?.length > 0 && (
            <div className="dark-card">
              <div className="card-hdr">
                <span className="card-title">Çıkarımlar</span>
                <span className="text-[10px] font-mono text-slate-500">
                  Otomatik analiz
                </span>
              </div>
              <div className="p-4 space-y-2">
                {ddaResult.insights.map((insight, i) => {
                  const bg = insight.type === 'warning'
                    ? 'bg-amber-900/20 border-amber-800/30'
                    : insight.type === 'success'
                      ? 'bg-emerald-900/20 border-emerald-800/30'
                      : 'bg-blue-900/20 border-blue-800/30'
                  return (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${bg}`}>
                      <span className="text-base flex-shrink-0">{insight.icon}</span>
                      <p className="text-xs text-slate-200 leading-relaxed">{insight.text}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bütçe & Gelir Simülasyonu */}
          {ddaResult.hybrid_attribution && (
            <div className="dark-card">
              <div className="card-hdr">
                <span className="card-title">
                  Bütçe & Gelir Simülasyonu
                  <InfoTip text="DDA katkı paylarını kullanarak kanal bazlı ROAS ve CPA hesaplar. Harcama verisi manuel girilir veya CSV ile yüklenir. Senaryo modunda bütçe değişikliklerinin gelire etkisini simüle edebilirsiniz." />
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Lineer projeksiyon
                </span>
              </div>
              <div className="p-4 space-y-4">
                {/* Spend input table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-700/50">
                        <th className="text-left py-2 px-2">Kanal</th>
                        <th className="text-right py-2 px-2">
                          Katkı Payı
                          <InfoTip text="DDA analizi sonucunda hesaplanan kanal katkı oranı." />
                        </th>
                        <th className="text-right py-2 px-2">
                          Harcama (₺)
                          <InfoTip text="Bu kanala yapılan toplam harcamayı girin. Organik kanallar için harcama girilemez." />
                        </th>
                        {showScenario && (
                          <th className="text-right py-2 px-2">
                            Senaryo (₺)
                            <InfoTip text="What-if analizi için yeni bütçe değerlerini girin." />
                          </th>
                        )}
                        {simResult && <th className="text-right py-2 px-2">ROAS</th>}
                        {simResult && <th className="text-right py-2 px-2">CPA (₺)</th>}
                        {simResult?.recommendations && <th className="text-center py-2 px-2">Aksiyon</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(ddaResult.hybrid_attribution)
                        .sort((a, b) => b[1] - a[1])
                        .map(([ch, weight]) => {
                          const organic = isOrganic(ch)
                          const curCh = simResult?.current?.channels?.[ch]
                          const rec = simResult?.recommendations?.find(r => r.channel === ch)
                          const actionColor = rec?.action === 'artir'
                            ? 'text-emerald-400'
                            : rec?.action === 'azalt'
                              ? 'text-red-400'
                              : rec?.action === 'degerlendirmeli'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                          return (
                            <tr key={ch} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                              <td className="py-1.5 px-2 text-slate-200 font-medium">{ch}</td>
                              <td className="py-1.5 px-2 text-right text-slate-300 font-mono">{fmtPct(weight)}</td>
                              <td className="py-1.5 px-2 text-right">
                                {organic ? (
                                  <span className="text-slate-600 text-[10px]">organik</span>
                                ) : (
                                  <input
                                    type="number"
                                    min="0"
                                    className="w-24 bg-slate-800/50 border border-slate-700 rounded px-2 py-1 text-right text-xs text-slate-200 font-mono focus:border-blue-500 focus:outline-none"
                                    placeholder="0"
                                    value={channelSpends[ch] || ''}
                                    onChange={e => setChannelSpends(prev => ({ ...prev, [ch]: e.target.value }))}
                                  />
                                )}
                              </td>
                              {showScenario && (
                                <td className="py-1.5 px-2 text-right">
                                  {organic ? (
                                    <span className="text-slate-600 text-[10px]">—</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      className="w-24 bg-amber-900/20 border border-amber-700/50 rounded px-2 py-1 text-right text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none"
                                      placeholder={channelSpends[ch] || '0'}
                                      value={scenarioSpends[ch] || ''}
                                      onChange={e => setScenarioSpends(prev => ({ ...prev, [ch]: e.target.value }))}
                                    />
                                  )}
                                </td>
                              )}
                              {simResult && (
                                <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                                  {curCh?.roas != null ? `${curCh.roas.toFixed(1)}x` : '—'}
                                </td>
                              )}
                              {simResult && (
                                <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                                  {curCh?.cpa != null ? `${fmtMoney(curCh.cpa)}` : '—'}
                                </td>
                              )}
                              {simResult?.recommendations && (
                                <td className={`py-1.5 px-2 text-center text-[10px] font-medium ${actionColor}`}>
                                  {rec ? `${rec.icon} ${rec.action === 'artir' ? 'Artır' : rec.action === 'azalt' ? 'Azalt' : rec.action === 'koru' ? 'Koru' : 'Değerlendir'}` : '—'}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Recommendation tooltips */}
                {simResult?.recommendations?.length > 0 && (
                  <div className="space-y-1.5">
                    {simResult.recommendations.filter(r => r.action !== 'koru').map((rec, i) => {
                      const bg = rec.action === 'artir'
                        ? 'bg-emerald-900/20 border-emerald-800/30'
                        : rec.action === 'azalt'
                          ? 'bg-red-900/20 border-red-800/30'
                          : 'bg-amber-900/20 border-amber-800/30'
                      return (
                        <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border ${bg}`}>
                          <span className="text-sm flex-shrink-0">{rec.icon}</span>
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            <span className="font-medium text-slate-100">{rec.channel}</span>: {rec.reason}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleSimulate(false)}
                    disabled={simLoading}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {simLoading ? 'Hesaplanıyor...' : 'Simüle Et'}
                  </button>
                  <button
                    onClick={() => {
                      if (!showScenario) {
                        const copy = {}
                        for (const ch of Object.keys(channelSpends)) copy[ch] = channelSpends[ch]
                        setScenarioSpends(copy)
                        setShowScenario(true)
                      } else {
                        handleSimulate(true)
                      }
                    }}
                    disabled={simLoading || !simResult}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {showScenario ? 'Senaryoyu Simüle Et' : 'Senaryo Ekle'}
                  </button>
                  <label className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer">
                    CSV ile Yükle
                    <input type="file" accept=".csv" className="hidden" onChange={handleCsvSpendUpload} />
                  </label>
                  <button
                    onClick={handleResetSim}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    Sıfırla
                  </button>
                </div>

                {simError && (
                  <p className="text-xs text-red-400">{simError}</p>
                )}

                {/* Summary KPIs */}
                {simResult && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-500 uppercase">Toplam Harcama</p>
                      <p className="text-sm font-mono text-slate-100">{fmtMoney(simResult.current.total_spend)} ₺</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-500 uppercase">Toplam Gelir</p>
                      <p className="text-sm font-mono text-slate-100">{fmtMoney(simResult.current.total_revenue)} ₺</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-500 uppercase">Karma ROAS</p>
                      <p className="text-sm font-mono text-slate-100">{simResult.current.blended_roas != null ? `${simResult.current.blended_roas.toFixed(1)}x` : '—'}</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-500 uppercase">Dönüşüm</p>
                      <p className="text-sm font-mono text-slate-100">{fmtN(simResult.current.total_conversions)}</p>
                    </div>
                  </div>
                )}

                {/* Scenario comparison */}
                {simResult?.scenario && showScenario && (
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-amber-300">Senaryo Sonucu</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Projeksiyon Gelir</p>
                        <p className="text-sm font-mono text-amber-200">{fmtMoney(simResult.scenario.projected_revenue)} ₺</p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Gelir Farkı</p>
                        <p className={`text-sm font-mono ${simResult.scenario.delta_revenue >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {simResult.scenario.delta_revenue >= 0 ? '+' : ''}{fmtMoney(simResult.scenario.delta_revenue)} ₺
                          <span className="text-[10px] ml-1">({simResult.scenario.delta_revenue_pct >= 0 ? '+' : ''}{simResult.scenario.delta_revenue_pct}%)</span>
                        </p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Yeni ROAS</p>
                        <p className="text-sm font-mono text-amber-200">{simResult.scenario.blended_roas != null ? `${simResult.scenario.blended_roas.toFixed(1)}x` : '—'}</p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">ROAS Değişim</p>
                        <p className={`text-sm font-mono ${(simResult.scenario.delta_roas || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {simResult.scenario.delta_roas != null ? `${simResult.scenario.delta_roas >= 0 ? '+' : ''}${simResult.scenario.delta_roas.toFixed(1)}x` : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Top Conversion Paths */}
          {ddaResult.top_paths && ddaResult.top_paths.length > 0 && (
            <div className="dark-card">
              <div className="card-hdr">
                <span className="card-title">En Sık Dönüşüm Yolları</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {ddaResult.journey_stats?.total_journeys || '?'} yolculuk
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
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700/50 text-slate-300"
                          >
                            {ch}
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
                <p className="text-[10px] text-slate-500 uppercase">
                  Toplam Yolculuk
                  <InfoTip text="Benzersiz kullanıcı yolculuğu sayısı. Her kullanıcının tüm temas noktaları bir yolculuk oluşturur." />
                </p>
                <p className="text-sm font-mono text-slate-100">{fmtN(ddaResult.journey_stats.total_journeys)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">
                  Dönüşüm Yapan
                  <InfoTip text="Dönüşüm (purchase/bağış) gerçekleştiren yolculuk sayısı." />
                </p>
                <p className="text-sm font-mono text-accent">{fmtN(ddaResult.journey_stats.converted)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">
                  Dönüşüm Oranı
                  <InfoTip text="Conversion Rate = Dönüşüm Yapan / Toplam Yolculuk." />
                </p>
                <p className="text-sm font-mono text-slate-100">{fmtPct(ddaResult.journey_stats.conversion_rate)}</p>
              </div>
              <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-500 uppercase">
                  Ort. Temas Noktası
                  <InfoTip text="Avg. Touchpoints. Dönüşüm öncesi ortalama kanal etkileşim sayısı. 1.0 ise kullanıcılar tek adımda dönüşüyor demektir." />
                </p>
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
