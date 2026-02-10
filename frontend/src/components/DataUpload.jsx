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
    <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Veri Yukle</h2>

      {/* Mode Selection */}
      <div className="flex flex-wrap gap-4 mb-4">
        <button
          onClick={() => { setMode('weekly'); setResult(null); setDdaResult(null); setError(null) }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'weekly'
              ? 'bg-po-dark text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Haftalik Veri
        </button>
        <button
          onClick={() => { setMode('crm'); setResult(null); setDdaResult(null); setError(null) }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'crm'
              ? 'bg-po-dark text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          CRM Touchpoint
        </button>
      </div>

      <p className="text-gray-500 text-sm mb-4">
        {mode === 'weekly'
          ? 'CSV veya Excel formatinda haftalik kanal verilerini yukleyin. Sablon icin data/templates/weekly_input_template.csv dosyasini kullanin.'
          : 'CRM touchpoint CSV yukleyin. DDA pipeline otomatik calisacak ve unified attribution skorlari hesaplanacak.'
        }
      </p>

      <label className="block">
        <span className="sr-only">CSV/Excel dosyasi sec</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleUpload}
          disabled={uploading}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-po-dark file:text-white hover:file:bg-po-blue cursor-pointer"
        />
      </label>

      {uploading && <p className="mt-4 text-blue-600 text-sm">Yukleniyor...</p>}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Weekly upload result */}
      {result && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded text-sm">
          <p className="font-medium text-green-800">Yukleme basarili!</p>
          <ul className="mt-2 text-green-700 space-y-1">
            <li>Dosya: {result.filename}</li>
            <li>Satir: {result.rows}</li>
            <li>Haftalar: {result.weeks?.join(', ')}</li>
            <li>Kanallar: {result.channels?.join(', ')}</li>
          </ul>
        </div>
      )}

      {/* DDA result */}
      {ddaResult && (
        <div className="mt-4 space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded text-sm">
            <p className="font-medium text-green-800">DDA Analizi Tamamlandi!</p>
          </div>

          {/* Journey Stats */}
          {ddaResult.journey_stats && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded text-sm">
              <p className="font-medium text-gray-800 mb-2">Journey Istatistikleri</p>
              <div className="grid grid-cols-2 gap-2 text-gray-700">
                <span>Toplam Journey: {ddaResult.journey_stats.total_journeys}</span>
                <span>Conversion: {ddaResult.journey_stats.converted}</span>
                <span>Conversion Rate: %{((ddaResult.journey_stats.conversion_rate || 0) * 100).toFixed(1)}</span>
                <span>Ort. Touchpoint: {(ddaResult.journey_stats.avg_journey_length || 0).toFixed(1)}</span>
              </div>
            </div>
          )}

          {/* Hybrid Attribution */}
          {ddaResult.hybrid_attribution && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded text-sm">
              <p className="font-medium text-blue-800 mb-2">Hybrid Attribution</p>
              <div className="space-y-1">
                {Object.entries(ddaResult.hybrid_attribution)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ch, val]) => (
                    <div key={ch} className="flex justify-between text-blue-700">
                      <span>{ch}</span>
                      <span>%{(val * 100).toFixed(1)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Cross Validation Flags */}
          {ddaResult.cross_validation?.some(cv => cv.flagged) && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded text-sm">
              <p className="font-medium text-amber-800 mb-2">Cross-Validation Uyarilari</p>
              {ddaResult.cross_validation.filter(cv => cv.flagged).map(cv => (
                <p key={cv.channel} className="text-amber-700">
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
