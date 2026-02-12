import { useState } from 'react'
import { useAttribution } from '../hooks/useAttribution'

/* ── Column definitions for format guide ── */
const WEEKLY_COLUMNS = [
  { name: 'week', type: 'string', required: true, desc: 'ISO hafta formatı', example: '2026-W06' },
  { name: 'channel', type: 'string', required: true, desc: 'Kanal adı (10 kanal)', example: 'meta' },
  { name: 'spend', type: 'float', required: true, desc: 'Haftalık harcama (TL)', example: '2600000' },
  { name: 'impressions', type: 'int', required: true, desc: 'Gösterim sayısı', example: '4500000' },
  { name: 'clicks', type: 'int', required: true, desc: 'Tıklama sayısı', example: '85000' },
  { name: 'leads', type: 'int', required: true, desc: 'Lead (başvuru) sayısı', example: '1050' },
  { name: 'grp', type: 'float', required: false, desc: 'TV GRP değeri', example: '450' },
  { name: 'spot_count', type: 'int', required: false, desc: 'TV/Radyo spot sayısı', example: '12' },
]

const CRM_COLUMNS = [
  { name: 'lead_id', type: 'string', required: true, desc: 'Benzersiz lead kimliği', example: 'L001' },
  { name: 'timestamp', type: 'string', required: true, desc: 'Temas zamanı (ISO)', example: '2026-01-15 10:23' },
  { name: 'channel', type: 'string', required: true, desc: 'Temas kanalı', example: 'meta' },
  { name: 'touchpoint_type', type: 'string', required: true, desc: 'Temas tipi', example: 'impression' },
  { name: 'campaign', type: 'string', required: false, desc: 'Kampanya adı', example: 'S1_lead' },
  { name: 'segment', type: 'string', required: false, desc: 'Segment (S1-S4)', example: 'S1' },
  { name: 'converted', type: 'bool', required: false, desc: 'Dönüşüm (0/1)', example: '1' },
  { name: 'session_id', type: 'string', required: false, desc: 'Oturum kimliği', example: 's001' },
]

const VALID_CHANNELS = ['meta', 'google', 'tiktok', 'linkedin', 'dv360', 'youtube', 'tv_match', 'tv_news', 'radio', 'dooh']

function DownloadIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

export default function DataUpload() {
  const { uploadFile, runDDAFromCSV, downloadFile } = useAttribution()
  const [mode, setMode] = useState('weekly')
  const [result, setResult] = useState(null)
  const [ddaResult, setDdaResult] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [showFormat, setShowFormat] = useState(false)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)
    setDdaResult(null)

    try {
      if (mode === 'weekly') {
        const data = await uploadFile(file)
        setResult(data)
      } else {
        const data = await runDDAFromCSV(file)
        setDdaResult(data)
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setUploading(false)
    }
  }

  const columns = mode === 'weekly' ? WEEKLY_COLUMNS : CRM_COLUMNS

  return (
    <div className="space-y-4">
      {/* ── Main Upload Card ── */}
      <div className="dark-card p-6">
        <h2 className="card-title mb-4">Veri Yükle</h2>

        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={() => { setMode('weekly'); setResult(null); setDdaResult(null); setError(null); setShowFormat(false) }}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === 'weekly'
                ? 'bg-accent text-white'
                : 'bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200'
            }`}
          >
            Haftalık Veri
          </button>
          <button
            onClick={() => { setMode('crm'); setResult(null); setDdaResult(null); setError(null); setShowFormat(false) }}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === 'crm'
                ? 'bg-accent text-white'
                : 'bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200'
            }`}
          >
            CRM Touchpoint
          </button>
        </div>

        <p className="text-slate-500 text-xs mb-4">
          {mode === 'weekly'
            ? 'CSV veya Excel formatında haftalık kanal verilerini yükleyin. Her hafta için 10 kanal satırı beklenir.'
            : 'CRM touchpoint CSV yükleyin. DDA pipeline (Markov + Shapley) otomatik çalışacak.'}
        </p>

        {/* ── Download Buttons ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => downloadFile(
              mode === 'weekly' ? '/data/template/weekly' : '/data/template/crm',
              mode === 'weekly' ? 'weekly_input_template.csv' : 'crm_touchpoints_template.csv'
            )}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
          >
            <DownloadIcon />
            Boş Şablon İndir
          </button>
          <button
            onClick={() => downloadFile(
              mode === 'weekly' ? '/data/sample/weekly' : '/data/sample/journeys',
              mode === 'weekly' ? 'week_01_sample.csv' : 'journeys_sample.csv'
            )}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:text-blue-300 hover:border-blue-400/40 transition-colors"
          >
            <DownloadIcon />
            Dolu Örnek Veri İndir
          </button>
          <button
            onClick={() => setShowFormat(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
          >
            <InfoIcon />
            {showFormat ? 'Formatı Gizle' : 'Veri Formatı'}
          </button>
        </div>

        {/* ── File Input ── */}
        <label className="block">
          <span className="sr-only">CSV/Excel dosyası seç</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleUpload}
            disabled={uploading}
            className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent file:text-white hover:file:bg-accent-dark cursor-pointer"
          />
        </label>

        {uploading && <p className="mt-4 text-accent text-xs">Yükleniyor...</p>}

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
            <p className="font-medium text-emerald-400">Yükleme başarılı!</p>
            <ul className="mt-2 text-emerald-300/80 space-y-1">
              <li>Dosya: {result.filename}</li>
              <li>Satir: {result.rows}</li>
              <li>Haftalar: {result.weeks?.join(', ')}</li>
              <li>Kanallar: {result.channels?.join(', ')}</li>
            </ul>
          </div>
        )}

        {ddaResult && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
              <p className="font-medium text-emerald-400">DDA Analizi Tamamlandı!</p>
            </div>

            {ddaResult.journey_stats && (
              <div className="p-3 bg-dark-bg rounded-lg text-xs">
                <p className="font-medium text-slate-300 mb-2">Journey İstatistikleri</p>
                <div className="grid grid-cols-2 gap-2 text-slate-400">
                  <span>Toplam Journey: {ddaResult.journey_stats.total_journeys}</span>
                  <span>Conversion: {ddaResult.journey_stats.converted}</span>
                  <span>Conversion Rate: %{((ddaResult.journey_stats.conversion_rate || 0) * 100).toFixed(1)}</span>
                  <span>Ort. Touchpoint: {(ddaResult.journey_stats.avg_journey_length || 0).toFixed(1)}</span>
                </div>
              </div>
            )}

            {ddaResult.hybrid_attribution && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs">
                <p className="font-medium text-blue-400 mb-2">Hybrid Attribution</p>
                <div className="space-y-1">
                  {Object.entries(ddaResult.hybrid_attribution)
                    .sort(([, a], [, b]) => b - a)
                    .map(([ch, val]) => (
                      <div key={ch} className="flex justify-between text-blue-300/80">
                        <span>{ch}</span>
                        <span className="font-mono">%{(val * 100).toFixed(1)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {ddaResult.cross_validation?.some(cv => cv.flagged) && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs">
                <p className="font-medium text-amber-400 mb-2">Cross-Validation Uyarıları</p>
                {ddaResult.cross_validation.filter(cv => cv.flagged).map(cv => (
                  <p key={cv.channel} className="text-amber-300/80">
                    {cv.channel}: DDA-MMM sapması %{(cv.deviation * 100).toFixed(0)} (&gt;20%)
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Format Guide (collapsible) ── */}
      {showFormat && (
        <div className="dark-card p-6">
          <h3 className="card-title mb-1">
            {mode === 'weekly' ? 'Haftalık Veri Formatı' : 'CRM Touchpoint Formatı'}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            {mode === 'weekly'
              ? 'Her hafta için 10 kanal satırı içeren CSV dosyası. MMM modeli bu veriyi kullanır.'
              : 'Her lead\'in tüm temas noktalarını içeren CSV. DDA pipeline (Markov + Shapley) bu veriyi kullanır.'}
          </p>

          {/* Column Table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-border">
                  <th className="text-left py-2 pr-3 text-slate-500 font-medium">Kolon</th>
                  <th className="text-left py-2 pr-3 text-slate-500 font-medium">Tip</th>
                  <th className="text-center py-2 pr-3 text-slate-500 font-medium">Zorunlu</th>
                  <th className="text-left py-2 pr-3 text-slate-500 font-medium">Açıklama</th>
                  <th className="text-left py-2 text-slate-500 font-medium">Örnek</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col.name} className="border-b border-dark-border/50">
                    <td className="py-2 pr-3 font-mono text-accent">{col.name}</td>
                    <td className="py-2 pr-3 text-slate-500">{col.type}</td>
                    <td className="py-2 pr-3 text-center">
                      {col.required
                        ? <span className="text-emerald-400">*</span>
                        : <span className="text-slate-600">-</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{col.desc}</td>
                    <td className="py-2 font-mono text-slate-400">{col.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Example CSV Preview */}
          <div className="mb-4">
            <p className="text-xs text-slate-400 font-medium mb-2">Örnek CSV:</p>
            <div className="bg-dark-bg rounded-lg p-3 overflow-x-auto">
              {mode === 'weekly' ? (
                <pre className="text-[11px] text-slate-400 font-mono leading-relaxed">{
`week,channel,spend,impressions,clicks,leads,grp,spot_count
2026-W05,meta,2600000,4500000,85000,1050,0,0
2026-W05,google,300000,800000,24000,520,0,0
2026-W05,tiktok,800000,3200000,48000,280,0,0
2026-W05,tv_match,0,0,0,0,450,12
2026-W05,radio,0,0,0,0,0,36`
                }</pre>
              ) : (
                <pre className="text-[11px] text-slate-400 font-mono leading-relaxed">{
`lead_id,timestamp,channel,touchpoint_type,campaign,segment,converted,session_id
L001,2026-01-15 10:23,meta,impression,S1_lead,S1,0,s001
L001,2026-01-16 14:05,google,click,brand_search,S1,0,s002
L001,2026-01-16 14:08,form,submit,lp_filo,S1,1,s002
L002,2026-01-15 09:00,tiktok,view,S1_video,S1,0,s003
L002,2026-01-17 11:30,meta,click,S1_retarget,S1,0,s004`
                }</pre>
              )}
            </div>
          </div>

          {/* Valid Channels */}
          <div className="mb-4">
            <p className="text-xs text-slate-400 font-medium mb-2">Geçerli Kanallar (10):</p>
            <div className="flex flex-wrap gap-1.5">
              {VALID_CHANNELS.map(ch => (
                <span key={ch} className="px-2 py-0.5 rounded bg-dark-bg border border-dark-border text-[11px] font-mono text-slate-300">
                  {ch}
                </span>
              ))}
            </div>
          </div>

          {/* Mode-specific notes */}
          <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg">
            <p className="text-xs text-amber-400/80 font-medium mb-1">
              {mode === 'weekly' ? 'Haftalık Veri Notları:' : 'CRM Touchpoint Notları:'}
            </p>
            {mode === 'weekly' ? (
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
                <li>Her hafta için <strong className="text-slate-300">10 kanal satırı</strong> beklenir (online + offline)</li>
                <li>TV ve radyo kanallarında <code className="text-accent/80">grp</code> ve <code className="text-accent/80">spot_count</code> alanlarını doldurun, spend 0 olabilir</li>
                <li>Hafta formatı ISO 8601: <code className="text-accent/80">YYYY-Www</code> (ör. 2026-W06)</li>
                <li>Birden fazla hafta aynı dosyada olabilir (ör. W05 + W06 = 20 satır)</li>
                <li>Maksimum dosya boyutu: 10 MB, maksimum satır: 50.000</li>
              </ul>
            ) : (
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
                <li>Her lead'in <strong className="text-slate-300">tüm temas noktaları</strong> kronolojik sırada olmalıdır</li>
                <li>Dönüşüm satırında <code className="text-accent/80">converted=1</code> ve kanal <code className="text-accent/80">form</code> / <code className="text-accent/80">landing_page</code> olmalı</li>
                <li>Sistem form/landing_page/website/app kanallarını filtreleyerek sadece pazarlama kanallarını analiz eder</li>
                <li><code className="text-accent/80">touchpoint_type</code>: impression, click, view, submit vb.</li>
                <li>DDA pipeline otomatik çalışır: Markov (x0.65) + Shapley (x0.35) blend</li>
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
