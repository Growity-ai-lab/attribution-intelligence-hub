import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'
import { formatCurrency, formatPercent } from '../utils/formatters'

export default function ReallocationPanel({ data, totalBudget }) {
  if (!data || Object.keys(data).length === 0) {
    return null
  }

  const rows = Object.entries(data)
    .map(([channel, info]) => ({ channel, ...info }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-3 md:px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">Butce Reallocation Onerisi</h3>
        <p className="text-xs text-gray-500 mt-1">
          Toplam butce: {totalBudget ? formatCurrency(totalBudget) : '—'} — Unified skora gore dagilim
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[550px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 md:px-6 py-2 md:py-3 text-left text-xs md:text-sm font-medium text-gray-500">Kanal</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Mevcut</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Onerilen</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Fark</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.channel} className="hover:bg-gray-50">
                <td className="px-3 md:px-6 py-2 md:py-3 flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[row.channel] || '#6B7280' }}
                  />
                  <span className="text-xs md:text-sm">{CHANNEL_LABELS[row.channel] || row.channel}</span>
                </td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm">{formatCurrency(row.current)}</td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium">{formatCurrency(row.suggested)}</td>
                <td className={`px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium ${
                  row.delta > 0 ? 'text-green-600' : row.delta < 0 ? 'text-red-600' : 'text-gray-500'
                }`}>
                  {row.delta > 0 ? '+' : ''}{formatCurrency(row.delta)}
                </td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm">{formatPercent(row.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
