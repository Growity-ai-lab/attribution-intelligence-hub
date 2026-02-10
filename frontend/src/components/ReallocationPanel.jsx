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
    <div className="dark-card">
      <div className="card-hdr">
        <div>
          <span className="card-title">Butce Reallocation Onerisi</span>
          <p className="text-xs text-slate-500 mt-0.5">
            Toplam butce: {totalBudget ? formatCurrency(totalBudget) : '\u2014'} \u2014 Unified skora gore dagilim
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[550px]">
          <thead>
            <tr className="border-b border-dark-border">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Kanal</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Mevcut</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Onerilen</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Fark</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.channel} className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors">
                <td className="px-4 py-2.5 flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[row.channel] || '#6B7280' }}
                  />
                  <span className="text-xs text-slate-300">{CHANNEL_LABELS[row.channel] || row.channel}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-400">{formatCurrency(row.current)}</td>
                <td className="px-4 py-2.5 text-right text-xs font-mono font-medium text-slate-200">{formatCurrency(row.suggested)}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-mono font-medium ${
                  row.delta > 0 ? 'text-emerald-400' : row.delta < 0 ? 'text-red-400' : 'text-slate-500'
                }`}>
                  {row.delta > 0 ? '\u2191 +' : row.delta < 0 ? '\u2193 ' : ''}{formatCurrency(row.delta)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-400">{formatPercent(row.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
