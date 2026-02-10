import { formatCurrency, formatNumber, formatPercent } from '../utils/formatters'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'

export default function ChannelTable({ channels }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-3 md:px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">Kanal Performansı</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 md:px-6 py-2 md:py-3 text-left text-xs md:text-sm font-medium text-gray-500">Kanal</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Harcama</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Lead</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">CPL</th>
              <th className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-500">Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {channels.map(ch => (
              <tr key={ch.channel} className="hover:bg-gray-50">
                <td className="px-3 md:px-6 py-2 md:py-3 flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[ch.channel] || '#6B7280' }}
                  />
                  <span className="text-xs md:text-sm">{CHANNEL_LABELS[ch.channel] || ch.channel}</span>
                </td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm">{formatCurrency(ch.spend)}</td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm">{formatNumber(ch.leads)}</td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm">
                  {ch.leads > 0 ? formatCurrency(Math.round(ch.spend / ch.leads)) : '—'}
                </td>
                <td className="px-3 md:px-6 py-2 md:py-3 text-right text-xs md:text-sm">{formatPercent(ch.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
