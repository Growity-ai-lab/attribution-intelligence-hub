import { formatCurrency, formatNumber, formatPercent, formatCompact } from '../utils/formatters'

export default function KPICards({ data }) {
  const cards = [
    { label: 'Toplam Harcama', value: formatCurrency(data.totalSpend), borderColor: 'border-accent' },
    { label: 'Toplam Lead', value: formatNumber(data.totalLeads), borderColor: 'border-blue-500' },
    { label: 'CPL', value: formatCurrency(data.costPerLead), borderColor: 'border-emerald-500' },
    { label: 'Aktif Kampanya', value: data.activeCampaigns, borderColor: 'border-purple-500' },
    { label: 'Conversion Rate', value: formatPercent(data.conversionRate || 0), borderColor: 'border-cyan-500' },
    { label: 'Toplam Butce', value: formatCompact(data.totalBudget || 0) + ' TL', borderColor: 'border-yellow-500' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map(card => (
        <div key={card.label} className={`dark-card border-t-2 ${card.borderColor} p-4`}>
          <p className="text-xs text-slate-500 mb-1">{card.label}</p>
          <p className="text-lg md:text-xl font-bold font-mono text-slate-100">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
