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
                      <span className="text-red-400 text-xs font-medium ml-1" title="DDA-MMM sapması >20%">
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
      <div className="mx-4 mb-4 p-3 bg-dark-bg rounded-lg border border-dark-border/50">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-300 font-medium">Skorlama mantığı:</span>{' '}
          Her kanalın Unified skoru <span className="text-accent font-mono">DDA×0.50 + MMM×0.35 + Inc×0.15</span> formülüyle hesaplanır.
          DDA skoru, Markov Chain (%65) ve Shapley Value (%35) ensemble sonucudur ve kullanıcı journey verisine dayanır.
          MMM skoru, adstock + saturation modeli ile harcama-lead ilişkisini ölçer.
          Incrementality skoru, her kanalın saf (net) ek etkisini tahmin eder.{' '}
          <span className="text-slate-300 font-medium">Sapma (Deviation):</span>{' '}
          DDA ile MMM arasındaki fark %20&apos;yi aştığında kanal bayraklanır{' '}
          <span className="text-red-400 font-medium">(!)</span> — bu, iki modelin farklı sinyal vermesi anlamına gelir ve
          kanala özel inceleme yapılması önerilir.
        </p>
      </div>
    </div>
  )
}
