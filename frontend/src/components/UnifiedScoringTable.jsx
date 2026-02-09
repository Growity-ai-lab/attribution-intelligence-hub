import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'
import { formatPercent } from '../utils/formatters'

export default function UnifiedScoringTable({ data, crossValidation = [] }) {
  if (!data || Object.keys(data).length === 0) {
    return null
  }

  const flaggedChannels = new Set(
    crossValidation.filter(cv => cv.flagged).map(cv => cv.channel)
  )

  const rows = Object.entries(data)
    .map(([channel, scores]) => ({ channel, ...scores }))
    .sort((a, b) => (b.unified_score || 0) - (a.unified_score || 0))

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">Unified Attribution Scoring</h3>
        <p className="text-xs text-gray-500 mt-1">DDA×0.50 + MMM×0.35 + Incrementality×0.15</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Kanal</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">DDA</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">MMM</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Inc.</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Unified</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Sapma</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => {
              const isFlagged = flaggedChannels.has(row.channel)
              const deviation = row.dda_score && row.mmm_score
                ? Math.abs(row.dda_score - row.mmm_score) / Math.max(row.dda_score, row.mmm_score, 0.001)
                : 0
              return (
                <tr
                  key={row.channel}
                  className={`hover:bg-gray-50 ${isFlagged ? 'bg-red-50' : ''}`}
                >
                  <td className="px-6 py-3 flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                      style={{ backgroundColor: CHANNEL_COLORS[row.channel] || '#6B7280' }}
                    />
                    <span>{CHANNEL_LABELS[row.channel] || row.channel}</span>
                    {isFlagged && (
                      <span className="text-red-500 text-xs font-medium ml-1" title="DDA-MMM sapması >20%">
                        !
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">{formatPercent(row.dda_score || 0)}</td>
                  <td className="px-6 py-3 text-right">{formatPercent(row.mmm_score || 0)}</td>
                  <td className="px-6 py-3 text-right">{formatPercent(row.incrementality_score || 0)}</td>
                  <td className="px-6 py-3 text-right font-semibold">{formatPercent(row.unified_score || 0)}</td>
                  <td className={`px-6 py-3 text-right ${deviation > 0.2 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {formatPercent(deviation)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
