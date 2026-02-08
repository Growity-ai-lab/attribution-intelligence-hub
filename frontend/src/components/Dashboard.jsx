import KPICards from './KPICards'
import ChannelTable from './ChannelTable'

const SAMPLE_KPI = {
  totalSpend: 55_000_000,
  totalLeads: 4280,
  costPerLead: 12_850,
  activeCampaigns: 4,
}

const SAMPLE_CHANNELS = [
  { channel: 'meta', spend: 2_600_000, leads: 1050, share: 0.32 },
  { channel: 'google', spend: 300_000, leads: 520, share: 0.16 },
  { channel: 'tiktok', spend: 800_000, leads: 280, share: 0.09 },
  { channel: 'linkedin', spend: 500_000, leads: 85, share: 0.03 },
  { channel: 'dv360', spend: 400_000, leads: 120, share: 0.04 },
  { channel: 'youtube', spend: 600_000, leads: 180, share: 0.06 },
  { channel: 'tv_match', spend: 1_500_000, leads: 450, share: 0.14 },
  { channel: 'tv_news', spend: 600_000, leads: 200, share: 0.06 },
  { channel: 'radio', spend: 200_000, leads: 100, share: 0.03 },
  { channel: 'dooh', spend: 150_000, leads: 45, share: 0.01 },
]

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <KPICards data={SAMPLE_KPI} />
      <ChannelTable channels={SAMPLE_CHANNELS} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">MMM Decomposition</h3>
          <p className="text-gray-500 text-sm">Veri yüklendiğinde aktif olacak.</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">MTA Shapley Attribution</h3>
          <p className="text-gray-500 text-sm">CRM touchpoint verisi yüklendiğinde aktif olacak.</p>
        </div>
      </div>
    </div>
  )
}
