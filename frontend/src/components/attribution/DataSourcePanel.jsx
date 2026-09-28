import { useState, useCallback } from 'react'
import axios from 'axios'
import { getChannelColor } from '../../utils/colors'
import { fmtMoney, fmtN } from '../../utils/formatters'

const API = '/api'

/** Data source picker (BigQuery GA4 / BigQuery table / CSV), preview and run controls. */
export default function DataSourcePanel({ campaign, ddaResult, setDdaResult }) {
  // BQ connection
  const [bqProject, setBqProject] = useState('')
  const [bqDataset, setBqDataset] = useState('')
  const [bqFile, setBqFile] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(null) // connection info or null
  const [connectError, setConnectError] = useState('')

  // Data source tab
  const [sourceTab, setSourceTab] = useState('bigquery') // 'bigquery' | 'csv'

  // Preview & DDA (ddaResult/setDdaResult come from props, shared with Dashboard)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [ddaLoading, setDdaLoading] = useState(false)
  const [ddaError, setDdaError] = useState('')

  // CSV fallback
  const [csvFile, setCsvFile] = useState(null)

  // Date range
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [conversionEvents, setConversionEvents] = useState('purchase')
  // Generic BQ table mapping (source-agnostic connector)
  const [gTable, setGTable] = useState('')
  const [gEntityCol, setGEntityCol] = useState('')
  const [gTimestampCol, setGTimestampCol] = useState('')
  const [gTimestampType, setGTimestampType] = useState('datetime')
  const [gChannelMode, setGChannelMode] = useState('channel') // 'channel' | 'sourcemedium'
  const [gChannelCol, setGChannelCol] = useState('')
  const [gSourceCol, setGSourceCol] = useState('')
  const [gMediumCol, setGMediumCol] = useState('')
  const [gConvMode, setGConvMode] = useState('column') // 'column' | 'event'
  const [gConvertedCol, setGConvertedCol] = useState('')
  const [gEventCol, setGEventCol] = useState('')
  const [gConversionValues, setGConversionValues] = useState('')
  const [gRevenueCol, setGRevenueCol] = useState('')

  const handleConnect = useCallback(async () => {
    if (!bqProject || !bqDataset || !bqFile) return
    setConnecting(true)
    setConnectError('')
    try {
      const formData = new FormData()
      formData.append('credentials', bqFile)
      const res = await axios.post(`${API}/integrations/bigquery/connect`, formData, {
        params: { project: bqProject, dataset: bqDataset, campaign_id: campaign?.id || null },
      })
      setConnected(res.data)
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail) {
        setConnectError(detail)
      } else if (err.code === 'ERR_NETWORK') {
        setConnectError('Backend sunucusuna ulaşılamıyor. Sunucunun çalışıyor olduğundan emin olun.')
      } else {
        setConnectError(err.message || 'Bilinmeyen hata')
      }
    }
    setConnecting(false)
  }, [bqProject, bqDataset, bqFile, campaign])

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    setDdaError('')
    try {
      const params = { project: bqProject, dataset: bqDataset, conversion_events: conversionEvents, campaign_id: campaign?.id || null }
      if (startDate) params.start_date = startDate.replace(/-/g, '')
      if (endDate) params.end_date = endDate.replace(/-/g, '')
      const res = await axios.post(`${API}/integrations/bigquery/preview`, null, { params })
      setPreview(res.data)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
    }
    setPreviewLoading(false)
  }, [bqProject, bqDataset, startDate, endDate, conversionEvents, campaign])

  // Shared poller for asynchronous (background) DDA runs.
  const pollDdaResult = useCallback(async (result_id) => {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const s = await axios.get(`${API}/dda/status/${result_id}`)
        if (s.data.status === 'complete') { setDdaResult(s.data); setDdaLoading(false); return }
        if (s.data.status === 'error') { setDdaError(s.data.detail || 'DDA analizi başarısız oldu'); setDdaLoading(false); return }
      } catch { /* retry */ }
    }
    setDdaError('DDA analizi zaman aşımına uğradı')
    setDdaLoading(false)
  }, [setDdaResult])

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
      const { result_id, status } = res.data
      if (status === 'running' && result_id) { pollDdaResult(result_id); return }
      setDdaResult(res.data)
      setDdaLoading(false)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
      setDdaLoading(false)
    }
  }, [bqProject, bqDataset, startDate, endDate, conversionEvents, campaign, pollDdaResult, setDdaResult])

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

  // Build a GenericBQMapping body from the form state (omitting unused fields).
  const buildGenericMapping = useCallback(() => {
    const m = {
      table: gTable.trim(),
      entity_col: gEntityCol.trim(),
      timestamp_col: gTimestampCol.trim(),
      timestamp_type: gTimestampType,
    }
    if (gChannelMode === 'channel') {
      m.channel_col = gChannelCol.trim()
    } else {
      m.source_col = gSourceCol.trim()
      m.medium_col = gMediumCol.trim()
    }
    if (gConvMode === 'column') {
      m.converted_col = gConvertedCol.trim()
    } else {
      m.event_col = gEventCol.trim()
      m.conversion_values = gConversionValues.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (gRevenueCol.trim()) m.revenue_col = gRevenueCol.trim()
    return m
  }, [gTable, gEntityCol, gTimestampCol, gTimestampType, gChannelMode, gChannelCol,
      gSourceCol, gMediumCol, gConvMode, gConvertedCol, gEventCol, gConversionValues, gRevenueCol])

  const handlePreviewTable = useCallback(async () => {
    setPreviewLoading(true)
    setDdaError('')
    try {
      const params = { project: bqProject, dataset: bqDataset, campaign_id: campaign?.id || null }
      if (startDate) params.start_date = startDate.replace(/-/g, '')
      if (endDate) params.end_date = endDate.replace(/-/g, '')
      const res = await axios.post(`${API}/integrations/bigquery/preview-table`, buildGenericMapping(), { params })
      setPreview(res.data)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
    }
    setPreviewLoading(false)
  }, [bqProject, bqDataset, startDate, endDate, campaign, buildGenericMapping])

  const handleRunTable = useCallback(async () => {
    setDdaLoading(true)
    setDdaError('')
    try {
      const params = { project: bqProject, dataset: bqDataset, campaign_id: campaign?.id || null }
      if (startDate) params.start_date = startDate.replace(/-/g, '')
      if (endDate) params.end_date = endDate.replace(/-/g, '')
      const res = await axios.post(`${API}/dda/run-from-bigquery-table`, buildGenericMapping(), { params })
      const { result_id, status } = res.data
      if (status === 'running' && result_id) { pollDdaResult(result_id); return }
      setDdaResult(res.data)
      setDdaLoading(false)
    } catch (err) {
      setDdaError(err.response?.data?.detail || err.message)
      setDdaLoading(false)
    }
  }, [bqProject, bqDataset, startDate, endDate, campaign, buildGenericMapping, pollDdaResult, setDdaResult])

  return (
    <>
      {/* Data Source Tabs */}
      <div className="flex gap-2" role="tablist" aria-label="Veri kaynağı seçimi">
        {[
          { id: 'bigquery', label: 'BigQuery (GA4)' },
          { id: 'bigquery-table', label: 'BigQuery (Tablo)' },
          { id: 'csv', label: 'CSV Upload' },
        ].map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sourceTab === t.id}
            onClick={() => setSourceTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
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
            BQ Bağlı: {connected.event_tables} tablo
          </span>
        )}
      </div>

      {/* BigQuery Connection */}
      {(sourceTab === 'bigquery' || sourceTab === 'bigquery-table') && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">BigQuery Bağlantısı</span>
            {connected && (
              <span className="text-[10px] font-mono text-slate-400">
                {connected.first_date} — {connected.last_date}
              </span>
            )}
          </div>
          <div className="p-4 space-y-4">
            {!connected ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Project ID</label>
                    <input
                      type="text"
                      value={bqProject}
                      onChange={e => setBqProject(e.target.value)}
                      placeholder="unicef-bagis"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Dataset</label>
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
                  <label className="text-[10px] text-slate-400 block mb-1">Service Account JSON</label>
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
                  {connecting ? 'Bağlanıyor...' : 'Bağlan'}
                </button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Event Tabloları</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{connected.event_tables}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">İlk Tarih</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{connected.first_date}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Son Tarih</p>
                    <p className="text-sm font-mono text-slate-100 mt-0.5">{connected.last_date}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Dataset</p>
                    <p className="text-sm font-mono text-accent mt-0.5">{bqDataset}</p>
                  </div>
                </div>

                {sourceTab === 'bigquery' && (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Başlangıç</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                          className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Bitiş</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                          className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Conversion Events</label>
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
                        {previewLoading ? 'Sorgu çalışıyor...' : 'Önizle'}
                      </button>
                      <button
                        onClick={handleRunDDA}
                        disabled={ddaLoading}
                        className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
                      >
                        {ddaLoading ? 'Analiz çalışıyor...' : 'Attribution Analizi Başlat'}
                      </button>
                      <button
                        onClick={() => { setConnected(null); setPreview(null); setDdaResult(null) }}
                        className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-300 transition-colors ml-auto"
                      >
                        Bağlantıyı Kes
                      </button>
                    </div>
                  </>
                )}

                {sourceTab === 'bigquery-table' && (() => {
                  const inp = "w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                  const lbl = "text-[10px] text-slate-400 block mb-1"
                  const pill = active => `px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${active ? 'bg-accent/15 border border-accent/40 text-accent' : 'bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200'}`
                  const canRun = gTable.trim() && gEntityCol.trim() && gTimestampCol.trim()
                    && (gChannelMode === 'channel' ? gChannelCol.trim() : (gSourceCol.trim() && gMediumCol.trim()))
                    && (gConvMode === 'column' ? gConvertedCol.trim() : (gEventCol.trim() && gConversionValues.trim()))
                  return (
                  <>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      GA4 dışındaki <span className="text-slate-300">herhangi bir BigQuery tablosunu</span> (CRM, server-side GTM,
                      app analytics, ad-cost, offline conversion) kolon eşlemesiyle aynı DDA motoruna bağlayın.
                    </p>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={lbl}>Tablo adı</label>
                        <input type="text" value={gTable} onChange={e => setGTable(e.target.value)} placeholder="crm_events" className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Kullanıcı / Lead kolonu</label>
                        <input type="text" value={gEntityCol} onChange={e => setGEntityCol(e.target.value)} placeholder="user_id" className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Zaman damgası kolonu</label>
                        <input type="text" value={gTimestampCol} onChange={e => setGTimestampCol(e.target.value)} placeholder="event_time" className={inp} />
                      </div>
                    </div>

                    <div>
                      <label className={lbl}>Zaman damgası tipi</label>
                      <select value={gTimestampType} onChange={e => setGTimestampType(e.target.value)} className={inp}>
                        <option value="datetime">datetime / timestamp / date</option>
                        <option value="unix_micros">unix mikrosaniye (int)</option>
                        <option value="unix_seconds">unix saniye (int)</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={lbl + ' mb-0'}>Kanal</span>
                        <button onClick={() => setGChannelMode('channel')} className={pill(gChannelMode === 'channel')}>Kanal kolonu</button>
                        <button onClick={() => setGChannelMode('sourcemedium')} className={pill(gChannelMode === 'sourcemedium')}>Source + Medium</button>
                      </div>
                      {gChannelMode === 'channel' ? (
                        <input type="text" value={gChannelCol} onChange={e => setGChannelCol(e.target.value)} placeholder="channel" className={inp} />
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <input type="text" value={gSourceCol} onChange={e => setGSourceCol(e.target.value)} placeholder="source" className={inp} />
                          <input type="text" value={gMediumCol} onChange={e => setGMediumCol(e.target.value)} placeholder="medium" className={inp} />
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={lbl + ' mb-0'}>Dönüşüm</span>
                        <button onClick={() => setGConvMode('column')} className={pill(gConvMode === 'column')}>Dönüşüm kolonu</button>
                        <button onClick={() => setGConvMode('event')} className={pill(gConvMode === 'event')}>Olay + değerler</button>
                      </div>
                      {gConvMode === 'column' ? (
                        <input type="text" value={gConvertedCol} onChange={e => setGConvertedCol(e.target.value)} placeholder="is_converted (bool/int)" className={inp} />
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <input type="text" value={gEventCol} onChange={e => setGEventCol(e.target.value)} placeholder="event_name" className={inp} />
                          <input type="text" value={gConversionValues} onChange={e => setGConversionValues(e.target.value)} placeholder="signup, purchase" className={inp} />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={lbl}>Gelir kolonu (ops.)</label>
                        <input type="text" value={gRevenueCol} onChange={e => setGRevenueCol(e.target.value)} placeholder="amount" className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Başlangıç (ops.)</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Bitiş (ops.)</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inp} />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handlePreviewTable}
                        disabled={previewLoading || !canRun}
                        className="px-4 py-2 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-300 hover:text-slate-100 transition-colors disabled:opacity-40"
                      >
                        {previewLoading ? 'Sorgu çalışıyor...' : 'Önizle'}
                      </button>
                      <button
                        onClick={handleRunTable}
                        disabled={ddaLoading || !canRun}
                        className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {ddaLoading ? 'Analiz çalışıyor...' : 'Attribution Analizi Başlat'}
                      </button>
                      <button
                        onClick={() => { setConnected(null); setPreview(null); setDdaResult(null) }}
                        className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-300 transition-colors ml-auto"
                      >
                        Bağlantıyı Kes
                      </button>
                    </div>
                  </>
                  )
                })()}
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
          <div className="p-4 space-y-4">
            <p className="text-xs text-slate-400">
              BigQuery bağlantısı olmadan da attribution analizi yapabilirsiniz. İki format desteklenir:
            </p>

            {/* Format info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-dark-bg rounded-lg p-3 border border-dark-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-emerald-400">GA4 Export (Önerilen)</span>
                  <a href="/api/data/template/ga4" download className="text-[10px] text-accent hover:text-accent-light transition-colors">
                    Şablon İndir ↓
                  </a>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  GA4 BigQuery konsolundan export edilen veri. Kanal eşleştirme otomatik yapılır.
                </p>
                <p className="text-[10px] text-slate-400 mt-1 font-mono">
                  user_pseudo_id, event_name, source, medium, ...
                </p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3 border border-dark-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-blue-400">CRM Touchpoint</span>
                  <a href="/api/data/template/crm" download className="text-[10px] text-accent hover:text-accent-light transition-colors">
                    Şablon İndir ↓
                  </a>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Manuel hazırlanmış touchpoint verisi. Kanal adları doğrudan kullanılır.
                </p>
                <p className="text-[10px] text-slate-400 mt-1 font-mono">
                  lead_id, timestamp, channel, touchpoint_type, ...
                </p>
              </div>
            </div>

            {/* GA4 SQL Helper */}
            <details className="group">
              <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-300 transition-colors select-none">
                GA4 BQ SQL Sorgusu (kopyala-yapıştır) ▸
              </summary>
              <div className="mt-2 bg-dark-bg rounded-lg p-3 border border-dark-border">
                <pre className="text-[10px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed select-all">{`SELECT
  user_pseudo_id,
  TIMESTAMP_MICROS(event_timestamp) AS event_timestamp,
  event_name,
  COALESCE(
    collected_traffic_source.manual_source,
    traffic_source.source
  ) AS source,
  COALESCE(
    collected_traffic_source.manual_medium,
    traffic_source.medium
  ) AS medium,
  traffic_source.name AS campaign,
  COALESCE(ecommerce.purchase_revenue, 0) AS revenue
FROM \`PROJECT.DATASET.events_*\`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
ORDER BY user_pseudo_id, event_timestamp`}</pre>
                <p className="text-[10px] text-slate-400 mt-2">
                  <strong className="text-slate-300">PROJECT.DATASET</strong> ve <strong className="text-slate-300">YYYYMMDD</strong> değerlerini kendi GA4 projenize göre değiştirin. Sonucu CSV olarak indirip yükleyin.
                </p>
              </div>
            </details>

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
              {ddaLoading ? 'Analiz çalışıyor...' : 'Attribution Analizi Başlat'}
            </button>
          </div>
        </div>
      )}

      {/* Preview Summary */}
      {preview && !ddaResult && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Veri Önizleme</span>
            <span className="text-[10px] font-mono text-slate-400">
              {preview.source_table || `${preview.start_date || ''} — ${preview.end_date || ''}`}
            </span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-400 uppercase">Toplam Temas</p>
                <p className="text-sm font-mono text-slate-100">{fmtN(preview.total_events)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-400 uppercase">Oturum</p>
                <p className="text-sm font-mono text-slate-100">{fmtN(preview.sessions || preview.unique_users)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-400 uppercase">Benzersiz Kullanıcı</p>
                <p className="text-sm font-mono text-slate-100">{fmtN(preview.unique_users)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-400 uppercase">Dönüşüm (kullanıcı)</p>
                <p className="text-sm font-mono text-accent">{fmtN(preview.conversions)}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-400 uppercase">Toplam Gelir</p>
                <p className="text-sm font-mono text-emerald-400">{fmtMoney(preview.total_revenue)} TL</p>
              </div>
            </div>
            {preview.channels && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Kanal Bazlı Oturum Dağılımı</p>
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
                    <span className="text-slate-400 font-mono w-16 text-right">{fmtN(count)}</span>
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

      {/* Loading */}
      {ddaLoading && (
        <div className="text-center py-12 text-slate-400 text-sm">Attribution analizi çalışıyor...</div>
      )}
    </>
  )
}
