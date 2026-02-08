export default function MMMPanel() {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">MMM Analizi</h3>
      <p className="text-gray-500 text-sm mb-4">Adstock, Saturation ve Response model sonuçları.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <h4 className="font-medium text-gray-700 mb-2">Adstock</h4>
          <p className="text-xs text-gray-400">Carry-over etkileri</p>
        </div>
        <div className="border rounded-lg p-4">
          <h4 className="font-medium text-gray-700 mb-2">Saturation</h4>
          <p className="text-xs text-gray-400">Diminishing returns</p>
        </div>
        <div className="border rounded-lg p-4">
          <h4 className="font-medium text-gray-700 mb-2">Decomposition</h4>
          <p className="text-xs text-gray-400">Kanal katkıları</p>
        </div>
      </div>
    </div>
  )
}
