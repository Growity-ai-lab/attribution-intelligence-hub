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
  { name: 'segment', type: 'string', required: false, desc: 'Segment kodu (S1-S4)', example: 'S1' },
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

const SALES_STOCK_COLUMNS = [
  { name: 'week', type: 'string', required: true, desc: 'ISO hafta formatı', example: '2026-W06' },
  { name: 'channel', type: 'string', required: false, desc: 'Atribüsyon kanalı', example: 'meta' },
  { name: 'product', type: 'string', required: false, desc: 'Ürün / SKU adı', example: 'AutoMatic Filo Standart' },
  { name: 'region', type: 'string', required: false, desc: 'Bölge / şehir', example: 'Istanbul' },
  { name: 'sales_units', type: 'int', required: false, desc: 'Satılan adet', example: '45' },
  { name: 'sales_revenue', type: 'float', required: false, desc: 'Satış geliri (TL)', example: '675000' },
  { name: 'stock_units', type: 'int', required: false, desc: 'Stok adedi', example: '120' },
  { name: 'stock_value', type: 'float', required: false, desc: 'Stok değeri (TL)', example: '1800000' },
  { name: 'returns', type: 'int', required: false, desc: 'İade adedi', example: '2' },
  { name: 'new_customers', type: 'int', required: false, desc: 'Yeni müşteri', example: '38' },
  { name: 'repeat_customers', type: 'int', required: false, desc: 'Tekrar müşteri', example: '7' },
  { name: 'segment', type: 'string', required: false, desc: 'Segment kodu (S1-S4)', example: 'S1' },
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

export default function DataUpload({ campaign, isDemo, onDataUploaded }) {
  const { uploadFile, runDDAFromCSV, uploadSalesStock, downloadFile } = useAttribution()
  const [mode, setMode] = useState('weekly')
  const [result, setResult] = useState(null)
  const [ddaResult, setDdaResult] = useState(null)
  const [salesResult, setSalesResult] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [showFormat, setShowFormat] = useState(false)

  const campaignId = campaign?.id || null

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)
    setDdaResult(null)
    setSalesResult(null)

    try {
      if (mode === 'weekly') {
        const data = await uploadFile(file, campaignId)
        setResult(data)
      } else if (mode === 'crm') {
        const data = await runDDAFromCSV(file, 0.5, campaignId)
        setDdaResult(data)
        if (onDataUploaded) onDataUploaded(data)
      } else {
        const data = await uploadSalesStock(file, campaignId)
        setSalesResult(data)
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setUploading(false)
    }
  }

  const columns = mode === 'weekly' ? WEEKLY_COLUMNS : mode === 'crm' ? CRM_COLUMNS : SALES_STOCK_COLUMNS

  return (
    <div className="space-y-4">
      {/* ── Demo banner ── */}
      {isDemo && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300 leading-relaxed">
          <strong>Demo modunda yükleme:</strong> Verileriniz otomatik olarak{' '}
          <span className="font-mono">&quot;Demo Sandbox&quot;</span> alanına yazılır ve seed örnek datayı bozmaz.
          Gerçek kampanya yönetimi için lütfen giriş yapın.
        </div>
      )}
      {!campaignId && (
        <div className="p-3 bg-slate-500/10 border border-slate-500/20 rounded-lg text-xs text-slate-400">
          <strong>Not:</strong> Kampanya bağlamı yok — yükleme yalnızca doğrulama yapacak, veri kalıcı olmayacak.
          Kalıcı kayıt için bir kampanya seçin.
        </div>
      )}

      {/* ── Main Upload Card ── */}
      <div className="dark-card p-6">
        <h2 className="card-title mb-4">Veri Yükle</h2>

        <div className="flex flex-wrap gap-3 mb-4">
          {['weekly', 'crm', 'sales-stock'].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setResult(null); setDdaResult(null); setSalesResult(null); setError(null); setShowFormat(false) }}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mode === m
                  ? 'bg-accent text-white'
                  : 'bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'weekly' ? 'Haftalık Veri' : m === 'crm' ? 'CRM Touchpoint' : 'Satış / Stok'}
            </button>
          ))}
        </div>

        <p className="text-slate-500 text-xs mb-4">
          {mode === 'weekly'
            ? 'CSV veya Excel formatında haftalık kanal verilerini yükleyin. Her hafta için 10 kanal satırı beklenir.'
            : mode === 'crm'
            ? 'CRM touchpoint CSV yükleyin. DDA pipeline (Markov + Shapley) otomatik çalışacak.'
            : 'Haftalık satış, stok ve müşteri verilerini yükleyin. Ürün/bölge bazlı kırılım desteklenir.'}
        </p>

        {/* ── Download Buttons ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => downloadFile(
              mode === 'weekly' ? '/data/template/weekly' : mode === 'crm' ? '/data/template/crm' : '/data/template/sales-stock',
              mode === 'weekly' ? 'weekly_input_template.csv' : mode === 'crm' ? 'crm_touchpoints_template.csv' : 'sales_stock_template.csv'
            )}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
          >
            <DownloadIcon />
            Boş Şablon İndir
          </button>
          <button
            onClick={() => downloadFile(
              mode === 'weekly' ? '/data/sample/weekly' : mode === 'crm' ? '/data/sample/journeys' : '/data/template/sales-stock',
              mode === 'weekly' ? 'week_01_sample.csv' : mode === 'crm' ? 'journeys_sample.csv' : 'sales_stock_sample.csv'
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

        {salesResult && (
          <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
            <p className="font-medium text-emerald-400">Satış/Stok verisi yüklendi!</p>
            <ul className="mt-2 text-emerald-300/80 space-y-1">
              <li>Dosya: {salesResult.filename}</li>
              <li>Satır: {salesResult.rows}</li>
              <li>Haftalar: {salesResult.weeks?.join(', ')}</li>
              {salesResult.products?.length > 0 && <li>Ürünler: {salesResult.products.join(', ')}</li>}
              {salesResult.regions?.length > 0 && <li>Bölgeler: {salesResult.regions.join(', ')}</li>}
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
            {mode === 'weekly' ? 'Haftalık Veri Formatı' : mode === 'crm' ? 'CRM Touchpoint Formatı' : 'Satış / Stok Veri Formatı'}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            {mode === 'weekly'
              ? 'Her hafta için 10 kanal satırı içeren CSV dosyası. MMM modeli bu veriyi kullanır.'
              : mode === 'crm'
              ? 'Her lead\'in tüm temas noktalarını içeren CSV. DDA pipeline (Markov + Shapley) bu veriyi kullanır.'
              : 'Haftalık satış, stok ve müşteri verisi. Ürün/bölge/kanal bazlı kırılım ile attribution modelini satışa bağlar.'}
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
`week,channel,spend,impressions,clicks,leads,grp,spot_count,segment
2026-W05,meta,2600000,4500000,85000,1050,0,0,S1
2026-W05,google,300000,800000,24000,520,0,0,S1
2026-W05,meta,800000,1500000,28000,320,0,0,S2
2026-W05,tv_match,0,0,0,0,450,12,
2026-W05,radio,0,0,0,0,0,36,`
                }</pre>
              ) : mode === 'crm' ? (
                <pre className="text-[11px] text-slate-400 font-mono leading-relaxed">{
`lead_id,timestamp,channel,touchpoint_type,campaign,segment,converted,session_id
L001,2026-01-15 10:23,meta,impression,S1_lead,S1,0,s001
L001,2026-01-16 14:05,google,click,brand_search,S1,0,s002
L001,2026-01-16 14:08,form,submit,lp_filo,S1,1,s002
L002,2026-01-15 09:00,tiktok,view,S1_video,S1,0,s003
L002,2026-01-17 11:30,meta,click,S1_retarget,S1,0,s004`
                }</pre>
              ) : (
                <pre className="text-[11px] text-slate-400 font-mono leading-relaxed">{
`week,channel,product,region,sales_units,sales_revenue,stock_units,stock_value,returns,new_customers,repeat_customers
2026-W06,meta,AutoMatic Filo Standart,Istanbul,45,675000,120,1800000,2,38,7
2026-W06,google,AutoMatic Filo Standart,Istanbul,28,420000,120,1800000,1,22,6
2026-W06,meta,AutoMatic Filo Premium,Istanbul,12,360000,50,1500000,0,10,2
2026-W06,,AutoMatic Filo Standart,Izmir,10,150000,80,1200000,1,8,2`
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
              {mode === 'weekly' ? 'Haftalık Veri Notları:' : mode === 'crm' ? 'CRM Touchpoint Notları:' : 'Satış/Stok Veri Notları:'}
            </p>
            {mode === 'weekly' ? (
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
                <li>Her hafta için <strong className="text-slate-300">10 kanal satırı</strong> beklenir (online + offline)</li>
                <li>TV ve radyo kanallarında <code className="text-accent/80">grp</code> ve <code className="text-accent/80">spot_count</code> alanlarını doldurun, spend 0 olabilir</li>
                <li>Hafta formatı ISO 8601: <code className="text-accent/80">YYYY-Www</code> (ör. 2026-W06)</li>
                <li>Birden fazla hafta aynı dosyada olabilir (ör. W05 + W06 = 20 satır)</li>
                <li>Maksimum dosya boyutu: 10 MB, maksimum satır: 50.000</li>
                <li><code className="text-accent/80">segment</code> opsiyonel: S1, S2, S3, S4. Doldurulursa segment bazlı doygunluk analizi yapılır</li>
              </ul>
            ) : mode === 'crm' ? (
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
                <li>Her lead'in <strong className="text-slate-300">tüm temas noktaları</strong> kronolojik sırada olmalıdır</li>
                <li>Dönüşüm satırında <code className="text-accent/80">converted=1</code> ve kanal <code className="text-accent/80">form</code> / <code className="text-accent/80">landing_page</code> olmalı</li>
                <li>Sistem form/landing_page/website/app kanallarını filtreleyerek sadece pazarlama kanallarını analiz eder</li>
                <li><code className="text-accent/80">touchpoint_type</code>: impression, click, view, submit vb.</li>
                <li>DDA pipeline otomatik çalışır: Markov (x0.65) + Shapley (x0.35) blend</li>
              </ul>
            ) : (
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
                <li><code className="text-accent/80">week</code> zorunlu, diğer alanlar opsiyonel (boş bırakılabilir)</li>
                <li><code className="text-accent/80">channel</code> doldurulursa satış doğrudan kanala atfedilir (attribution bağlantısı)</li>
                <li><strong className="text-slate-300">Ürün ve bölge</strong> bazlı kırılım desteklenir (ör. AutoMatic Filo Standart / Premium)</li>
                <li><code className="text-accent/80">new_customers</code> ve <code className="text-accent/80">repeat_customers</code> müşteri yaşam döngüsü analizi için</li>
                <li>Stok verileri tedarik zinciri optimizasyonu ve talep tahmini için kullanılır</li>
                <li>İade oranı otomatik hesaplanır: <code className="text-accent/80">returns / sales_units</code></li>
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
