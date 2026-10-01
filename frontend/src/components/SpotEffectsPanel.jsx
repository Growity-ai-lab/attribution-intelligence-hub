import { useState, useEffect, useCallback, useRef } from 'react'
import { useSpots } from '../hooks/useSpots'
import { fmtMoney, fmtN } from '../utils/formatters'
import SpotResults from './spots/SpotResults'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40'
const btnGhost = `${btn} bg-dark-bg border border-dark-border text-slate-300 hover:text-slate-100`
const btnAccent = `${btn} bg-accent text-white hover:bg-accent/90`
const selectCls = 'bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-slate-300'
const errText = err => err?.response?.data?.detail || err?.message || 'İşlem başarısız'

/**
 * TV & radio spot effects: the immediate web response to each airing, measured
 * against the traffic just before it, with a placebo check on spot-free days.
 * Data: a broadcast list (Excel/CSV) + minute traffic (GA4 BigQuery or a file).
 */
export default function SpotEffectsPanel({ campaign }) {
  const api = useSpots()
  const [status, setStatus] = useState(null)
  const [bq, setBq] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState([])
  const [settings, setSettings] = useState({ metric: 'sessions', medium: 'all', post_minutes: 10, pre_minutes: 15 })
  const spotInput = useRef(null)
  const trafficInput = useRef(null)
  const [spotMedium, setSpotMedium] = useState('tv')
  const cid = campaign?.id

  const ready = status?.spots?.count > 0 && status?.traffic?.minutes > 0

  const refreshStatus = useCallback(async () => {
    if (!cid) return
    try { setStatus(await api.getStatus(cid)) } catch (err) { setError(errText(err)) }
  }, [cid, api])

  useEffect(() => {
    setStatus(null); setAnalysis(null); setNotes([]); setError('')
    if (!cid) return
    refreshStatus()
    api.bqConfig(cid).then(setBq).catch(() => setBq(null))
  }, [cid]) // eslint-disable-line react-hooks/exhaustive-deps

  // (Re)measure whenever the data or the settings change.
  useEffect(() => {
    if (!cid || !ready) { setAnalysis(null); return }
    let cancelled = false
    setBusy(b => b || 'analyze')
    api.analyze(cid, settings)
      .then(res => { if (!cancelled) { setAnalysis(res); setError('') } })
      .catch(err => { if (!cancelled) { setAnalysis(null); setError(errText(err)) } })
      .finally(() => { if (!cancelled) setBusy(b => (b === 'analyze' ? '' : b)) })
    return () => { cancelled = true }
  }, [cid, ready, settings, status?.spots?.count, status?.spots?.last, status?.traffic?.minutes, status?.traffic?.last]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key, fn) => {
    setBusy(key); setError(''); setNotes([])
    try {
      const res = await fn()
      if (res?.warnings?.length) setNotes(res.warnings)
      await refreshStatus()
    } catch (err) { setError(errText(err)) }
    setBusy('')
  }

  const onFile = kind => e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(kind, () => api.upload(kind, file, cid, kind === 'spots' ? { default_medium: spotMedium } : {}))
  }

  if (!cid) {
    return <div className="dark-card p-6 text-sm text-slate-400">Spot etkisini ölçmek için önce bir kampanya seçin.</div>
  }

  const s = status?.spots
  const t = status?.traffic
  return (
    <div className="space-y-5">
      <div className="dark-card" role="region" aria-label="Spot etkisi verileri">
        <div className="card-hdr">
          <div>
            <span className="card-title">TV & Radyo Spot Etkisi</span>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Her yayının ardından sitede oluşan anlık ziyaret artışı, yayından hemen önceki trafikle karşılaştırılarak ölçülür.
            </p>
          </div>
          <button onClick={() => run('sample', () => api.loadSample(cid))} disabled={!!busy} className={btnGhost}>
            {busy === 'sample' ? 'Yükleniyor…' : 'Örnek veriyle dene'}
          </button>
        </div>
        <div className="p-4 grid md:grid-cols-2 gap-4">
          {/* Spot list */}
          <div className="bg-dark-bg/50 rounded-lg border border-dark-border p-3 space-y-2">
            <p className="text-xs font-medium text-slate-200">1. Yayın listesi (TV / radyo spotları)</p>
            {s?.count > 0 ? (
              <p className="text-[11px] text-slate-300" data-testid="spot-status">
                {s.count} spot ({s.tv} TV, {s.radio} radyo) · {s.first?.slice(0, 10)} – {s.last?.slice(0, 10)} · {fmtMoney(s.cost)} TL
                {s.source === 'sample' && <span className="ml-1 text-amber-300">(örnek)</span>}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">Adjinn / Ad-alert dökümü ya da ajans yayın listesi: tarih, saat, kanal; varsa maliyet, GRP, kreatif.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select value={spotMedium} onChange={e => setSpotMedium(e.target.value)} className={selectCls}
                aria-label="Varsayılan mecra" title="Dosyada mecra sütunu yoksa (FM/Radyo geçen kanallar yine radyo sayılır)">
                <option value="tv">TV</option>
                <option value="radio">Radyo</option>
              </select>
              <button onClick={() => spotInput.current?.click()} disabled={!!busy} className={btnAccent}>
                {busy === 'spots' ? 'Yükleniyor…' : 'Yayın listesi yükle'}
              </button>
              <button onClick={() => api.downloadTemplate('spots')} className={btnGhost}>Şablon</button>
              {s?.count > 0 && <button onClick={() => run('clear', () => api.clear(cid, 'spots'))} disabled={!!busy} className={btnGhost}>Temizle</button>}
              <input ref={spotInput} type="file" accept=".xlsx,.csv" className="hidden" onChange={onFile('spots')} data-testid="spot-file" />
            </div>
          </div>

          {/* Minute traffic */}
          <div className="bg-dark-bg/50 rounded-lg border border-dark-border p-3 space-y-2">
            <p className="text-xs font-medium text-slate-200">2. Dakikalık site trafiği</p>
            {t?.minutes > 0 ? (
              <p className="text-[11px] text-slate-300" data-testid="traffic-status">
                {fmtN(t.minutes)} dakika · {t.first?.slice(0, 10)} – {t.last?.slice(0, 10)} · {fmtN(t.sessions)} oturum
                · kaynak: {{ bigquery: 'GA4 BigQuery', file: 'dosya', sample: 'örnek' }[t.source] || t.source}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">
                GA4 BigQuery'den otomatik çekilir: ilk spottan 14 gün önceden son spota kadar (spotsuz günler güven testi için gerekli).
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => run('bq', () => api.pullBigQuery(cid))}
                disabled={!!busy || !bq?.project || !(s?.count > 0)}
                title={!bq?.project ? 'Attribution sekmesinden GA4 BigQuery bağlantısını kurun' : !(s?.count > 0) ? 'Önce yayın listesini yükleyin' : ''}
                className={btnAccent}
              >
                {busy === 'bq' ? 'Çekiliyor…' : 'GA4 BigQuery\'den çek'}
              </button>
              <button onClick={() => trafficInput.current?.click()} disabled={!!busy} className={btnGhost}>Trafik dosyası yükle</button>
              <button onClick={() => api.downloadTemplate('traffic')} className={btnGhost}>Şablon</button>
              <input ref={trafficInput} type="file" accept=".xlsx,.csv" className="hidden" onChange={onFile('traffic')} data-testid="traffic-file" />
            </div>
            {!bq?.project && (
              <p className="text-[10px] text-slate-500">Bu kampanyada kayıtlı BigQuery bağlantısı yok (Attribution → BigQuery GA4).</p>
            )}
          </div>
        </div>
        {(error || notes.length > 0) && (
          <div className="px-4 pb-4 space-y-1">
            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
            {notes.map(n => <p key={n} className="text-[11px] text-amber-300">⚠ {n}</p>)}
          </div>
        )}
        {ready && (
          <div className="px-4 pb-4 flex flex-wrap items-center gap-3 border-t border-dark-border pt-3">
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5">Ölçülen
              <select aria-label="Ölçülen metrik" value={settings.metric} className={selectCls}
                onChange={e => setSettings(v => ({ ...v, metric: e.target.value }))}>
                <option value="sessions">Tüm oturumlar</option>
                <option value="sessions_unpaid" disabled={!t?.has_unpaid}>Ücretsiz oturumlar (direct/organik)</option>
                <option value="conversions" disabled={!t?.has_conversions}>Dönüşümler</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5">Mecra
              <select aria-label="Mecra" value={settings.medium} className={selectCls}
                onChange={e => setSettings(v => ({ ...v, medium: e.target.value }))}>
                <option value="all">TV + Radyo</option>
                <option value="tv" disabled={!s?.tv}>TV</option>
                <option value="radio" disabled={!s?.radio}>Radyo</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5" title="Yayın dakikasından itibaren tepkinin sayıldığı süre">Tepki penceresi
              <select aria-label="Tepki penceresi" value={settings.post_minutes} className={selectCls}
                onChange={e => setSettings(v => ({ ...v, post_minutes: Number(e.target.value) }))}>
                {[5, 8, 10, 15, 20].map(m => <option key={m} value={m}>{m} dk</option>)}
              </select>
            </label>
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5" title="Baz çizgisi: yayından önceki bu kadar dakikanın medyanı">Baz çizgisi
              <select aria-label="Baz çizgisi" value={settings.pre_minutes} className={selectCls}
                onChange={e => setSettings(v => ({ ...v, pre_minutes: Number(e.target.value) }))}>
                {[10, 15, 20, 30].map(m => <option key={m} value={m}>önceki {m} dk</option>)}
              </select>
            </label>
            {busy === 'analyze' && <span className="text-[11px] text-slate-400">hesaplanıyor…</span>}
          </div>
        )}
      </div>

      {!ready && status && (
        <div className="dark-card p-6 text-sm text-slate-400" data-testid="spot-empty">
          {!(s?.count > 0) ? 'Ölçüm için yayın listesini yükleyin.' : 'Ölçüm için dakikalık trafik verisini çekin ya da yükleyin.'}
          {' '}Denemek için "Örnek veriyle dene"yi kullanabilirsiniz.
        </div>
      )}

      {ready && analysis && (
        <SpotResults analysis={analysis} campaignId={cid} metric={settings.metric} timeline={api.timeline} />
      )}
    </div>
  )
}
