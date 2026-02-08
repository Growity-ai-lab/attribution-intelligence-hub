import { useState } from 'react'
import { useAttribution } from '../hooks/useAttribution'

export default function DataUpload() {
  const { uploadFile } = useAttribution()
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)

    try {
      const data = await uploadFile(file)
      setResult(data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Haftalık Veri Yükle</h2>
      <p className="text-gray-500 text-sm mb-4">
        CSV veya Excel formatında haftalık kanal verilerini yükleyin.
        Şablon için <code>data/templates/weekly_input_template.csv</code> dosyasını kullanın.
      </p>

      <label className="block">
        <span className="sr-only">CSV/Excel dosyası seç</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleUpload}
          disabled={uploading}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-po-dark file:text-white hover:file:bg-po-blue cursor-pointer"
        />
      </label>

      {uploading && <p className="mt-4 text-blue-600 text-sm">Yükleniyor...</p>}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded text-sm">
          <p className="font-medium text-green-800">Yükleme başarılı!</p>
          <ul className="mt-2 text-green-700 space-y-1">
            <li>Dosya: {result.filename}</li>
            <li>Satır: {result.rows}</li>
            <li>Haftalar: {result.weeks?.join(', ')}</li>
            <li>Kanallar: {result.channels?.join(', ')}</li>
          </ul>
        </div>
      )}
    </div>
  )
}
