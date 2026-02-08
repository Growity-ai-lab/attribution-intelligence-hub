export default function UnifiedChart() {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Unified Attribution</h3>
      <p className="text-gray-500 text-sm">
        Unified scoring chart — veri yüklendiğinde Chart.js ile render edilecek.
      </p>
      <div className="h-64 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg mt-4">
        <span className="text-gray-400">Grafik alanı</span>
      </div>
    </div>
  )
}
