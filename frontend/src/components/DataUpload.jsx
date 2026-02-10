import { useState } from 'react'
import { useAttribution } from '../hooks/useAttribution'

export default function DataUpload() {
  const { uploadFile, runDDAFromCSV } = useAttribution()
  const [mode, setMode] = useState('weekly')
  const [result, setResult] = useState(null)
  const [ddaResult, setDdaResult] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)

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

  return (
    <div className="dark-card p-6 max-w-2xl">
      <h2 className="card-title mb-4">Veri Yukle</h2>

      <div className="flex flex-wrap gap-3 mb-4">
        <button
          onClick={() => { setMode('weekly'); setResult(null); setDdaResult(null); setError(null) }}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            mode === 'weekly'
              ? 'bg-accent text-white'
              : 'bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200'
          }`}
        >
          Haftalik Veri
        </button>
        <button
          onClick={() => { setMode('crm'); setResult(null); setDdaResult(null); setError(null) }}
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
          ? 'CSV veya Excel formatinda haftalik kanal verilerini yukleyin.'
          : 'CRM touchpoint CSV yukleyin. DDA pipeline otomatik calisacak.'}
      </p>

      <label className="block">
        <span className="sr-only">CSV/Excel dosyasi sec</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleUpload}
          disabled={uploading}
          className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent file:text-white hover:file:bg-accent-dark cursor-pointer"
        />
      </label>

      {uploading && <p className="mt-4 text-accent text-xs">Yukleniyor...</p>}

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
          <p className="font-medium text-emerald-400">Yukleme basarili!</p>
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
            <p className="font-medium text-emerald-400">DDA Analizi Tamamlandi!</p>
          </div>

          {ddaResult.journey_stats && (
            <div className="p-3 bg-dark-bg rounded-lg text-xs">
              <p className="font-medium text-slate-300 mb-2">Journey Istatistikleri</p>
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
              <p className="font-medium text-amber-400 mb-2">Cross-Validation Uyarilari</p>
              {ddaResult.cross_validation.filter(cv => cv.flagged).map(cv => (
                <p key={cv.channel} className="text-amber-300/80">
                  {cv.channel}: DDA-MMM sapmasi %{(cv.deviation * 100).toFixed(0)} (&gt;20%)
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
