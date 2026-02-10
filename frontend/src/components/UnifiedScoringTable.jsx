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
    <div className="dark-card">
      <div className="card-hdr">
        <div>
          <span className="card-title">Unified Attribution Scoring</span>
          <p className="text-xs text-slate-500 mt-0.5">{'DDA\u00d70.50 + MMM\u00d70.35 + Incrementality\u00d70.15'}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-dark-border">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Kanal</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">DDA</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">MMM</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Inc.</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Unified</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Sapma</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isFlagged = flaggedChannels.has(row.channel)
              const deviation = row.dda_score && row.mmm_score
                ? Math.abs(row.dda_score - row.mmm_score) / Math.max(row.dda_score, row.mmm_score, 0.001)
                : 0
              return (
                <tr
                  key={row.channel}
                  className={`border-b border-dark-border/50 hover:bg-dark-hover transition-colors ${isFlagged ? 'bg-red-500/5' : ''}`}
                >
                  <td className="px-4 py-2.5 flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                      style={{ backgroundColor: CHANNEL_COLORS[row.channel] || '#6B7280' }}
                    />
                    <span className="text-xs text-slate-300">{CHANNEL_LABELS[row.channel] || row.channel}</span>
                    {isFlagged && (
                      <span className="text-red-400 text-xs font-medium ml-1" title="DDA-MMM sapmasi >20%">
                        !
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{formatPercent(row.dda_score || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{formatPercent(row.mmm_score || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{formatPercent(row.incrementality_score || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-accent">{formatPercent(row.unified_score || 0)}</td>
                  <td className={`px-4 py-2.5 text-right text-xs font-mono ${deviation > 0.2 ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
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
