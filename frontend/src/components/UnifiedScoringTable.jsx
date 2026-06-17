import { getChannelColor } from '../utils/colors'
import { formatPercent } from '../utils/formatters'

export default function UnifiedScoringTable({ data }) {
  if (!data || Object.keys(data).length === 0) {
    return null
  }

  const rows = Object.entries(data)
    .map(([channel, scores]) => ({ channel, ...scores }))
    .sort((a, b) => (b.unified_score || 0) - (a.unified_score || 0))

  return (
    <div className="dark-card">
      <div className="card-hdr">
        <div>
          <span className="card-title">DDA Kanal Attribution</span>
          <p className="text-xs text-slate-400 mt-0.5">Markov Chain (%65) + Shapley Value (%35) ensemble</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[360px]">
          <thead>
            <tr className="border-b border-dark-border">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Kanal</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-400">DDA Katkı Payı</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.channel}
                className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors"
              >
                <td className="px-4 py-2.5 flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                    style={{ backgroundColor: getChannelColor(row.channel, idx) }}
                  />
                  <span className="text-xs text-slate-300">{row.channel}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-accent">{formatPercent(row.unified_score || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mx-4 mb-4 p-3 bg-dark-bg rounded-lg border border-dark-border/50">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-300 font-medium">Skorlama mantığı:</span>{' '}
          Her kanalın katkı payı, gerçek kullanıcı yolculuğu verisine dayanan DDA (Data-Driven Attribution)
          sonucudur — Markov Chain (%65, kanalın zincirdeki vazgeçilmezliği) ve Shapley Value (%35, kanalın adil
          marjinal katkısı) ensemble'ı.
        </p>
      </div>
    </div>
  )
}
