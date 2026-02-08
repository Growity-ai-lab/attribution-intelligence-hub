import { formatCurrency, formatNumber } from '../utils/formatters'

export default function KPICards({ data }) {
  const cards = [
    { label: 'Toplam Harcama', value: formatCurrency(data.totalSpend), color: 'bg-blue-500' },
    { label: 'Toplam Lead', value: formatNumber(data.totalLeads), color: 'bg-green-500' },
    { label: 'CPL', value: formatCurrency(data.costPerLead), color: 'bg-yellow-500' },
    { label: 'Aktif Kampanya', value: data.activeCampaigns, color: 'bg-purple-500' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <div key={card.label} className="bg-white rounded-lg shadow p-4">
          <div className={`w-2 h-2 rounded-full ${card.color} mb-2`} />
          <p className="text-sm text-gray-500">{card.label}</p>
          <p className="text-2xl font-bold text-gray-900">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
