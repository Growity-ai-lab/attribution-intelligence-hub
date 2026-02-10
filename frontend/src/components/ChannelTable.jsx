import { formatCurrency, formatNumber, formatPercent } from '../utils/formatters'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'

export default function ChannelTable({ channels }) {
  return (
    <div className="dark-card">
      <div className="card-hdr">
        <span className="card-title">Kanal Performansi</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="border-b border-dark-border">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Kanal</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Harcama</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Lead</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">CPL</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500 w-32">Pay</th>
            </tr>
          </thead>
          <tbody>
            {channels.map(ch => (
              <tr key={ch.channel} className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors">
                <td className="px-4 py-2.5 flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[ch.channel] || '#6B7280' }}
                  />
                  <span className="text-xs text-slate-300">{CHANNEL_LABELS[ch.channel] || ch.channel}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{formatCurrency(ch.spend)}</td>
                <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{formatNumber(ch.leads)}</td>
                <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">
                  {ch.leads > 0 ? formatCurrency(Math.round(ch.spend / ch.leads)) : '\u2014'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-dark-bg rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent/60"
                        style={{ width: `${Math.min(ch.share * 300, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400 w-10 text-right">{formatPercent(ch.share)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
