import { useState, useMemo } from 'react'
import { useAttribution } from '../hooks/useAttribution'
import UnifiedChart from './UnifiedChart'
import UnifiedScoringTable from './UnifiedScoringTable'
import ReallocationPanel from './ReallocationPanel'
import DataUpload from './DataUpload'

const fmtMoney = v => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}
const fmtN = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)

export default function Dashboard({ ddaResult, campaign, isDemo }) {
  const { getReallocation } = useAttribution()
  const [reallocationData, setReallocationData] = useState(null)
  const [reallocationLoading, setReallocationLoading] = useState(false)

  const campaignChannels = campaign?.channels || []

  const filteredUnified = useMemo(() => {
    if (!ddaResult?.unified_report) return null
    if (campaignChannels.length === 0) return ddaResult.unified_report
    const filtered = {}
    for (const ch of campaignChannels) {
      if (ddaResult.unified_report[ch]) filtered[ch] = ddaResult.unified_report[ch]
    }
    return Object.keys(filtered).length > 0 ? filtered : ddaResult.unified_report
  }, [ddaResult, campaignChannels])

  const crossValidation = ddaResult?.cross_validation || []

  const handleReallocation = async () => {
    if (!ddaResult?.unified_report || !campaign?.budget) return
    setReallocationLoading(true)
    try {
      const currentBudgets = {}
      const channels = campaign.channels || []
      const share = 1 / (channels.length || 1)
      channels.forEach(ch => { currentBudgets[ch] = Math.round(campaign.budget * share) })
      const result = await getReallocation(ddaResult.unified_report, currentBudgets)
      setReallocationData(result)
    } catch { /* ignore */ }
    setReallocationLoading(false)
  }

  const bq = ddaResult?.bq_summary
  const journeyStats = ddaResult?.journey_stats

  return (
    <div className="space-y-6">
      {/* Real BQ Summary KPIs */}
      {bq && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Event</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(bq.total_events)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Oturum</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(bq.sessions || bq.unique_users)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Benzersiz Kullanici</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(bq.unique_users)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Donusum</p>
            <p className="text-lg font-mono text-accent mt-0.5">{fmtN(bq.conversions)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Gelir</p>
            <p className="text-lg font-mono text-emerald-400 mt-0.5">{fmtMoney(bq.total_revenue)} TL</p>
          </div>
        </div>
      )}

      {/* Journey stats */}
      {journeyStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase">Toplam Yolculuk</p>
            <p className="text-lg font-semibold font-mono text-slate-100">{fmtN(journeyStats.total_journeys)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase">Donusum Yapan</p>
            <p className="text-lg font-semibold font-mono text-emerald-400">{fmtN(journeyStats.converted)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase">Donusum Orani</p>
            <p className="text-lg font-semibold font-mono text-blue-400">
              %{((journeyStats.conversion_rate || 0) * 100).toFixed(1)}
            </p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase">Ort. Temas Noktasi</p>
            <p className="text-lg font-semibold font-mono text-slate-100">
              {(journeyStats.avg_path_length || 0).toFixed(1)}
            </p>
          </div>
        </div>
      )}

      {/* No data — guide user to Attribution tab */}
      {!ddaResult && (
        <div className="dark-card p-8 text-center">
          <div className="text-3xl mb-3 opacity-50">&#x1f4ca;</div>
          <h3 className="text-sm font-semibold text-slate-200 mb-2">Attribution analizi henuz calistirilmadi</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            BigQuery (GA4) veya CSV ile attribution analizi calistirmak icin <strong className="text-slate-300">Attribution</strong> sekmesine gidin.
            Sonuclar otomatik olarak bu sayfada gorunecek.
          </p>
        </div>
      )}

      {/* Data Upload */}
      <DataUpload campaign={campaign} isDemo={isDemo} />

      {/* Unified Scoring (only when real DDA data exists) */}
      {filteredUnified && (
        <>
          <UnifiedChart data={filteredUnified} />
          <UnifiedScoringTable data={filteredUnified} crossValidation={crossValidation} />

          {/* Reallocation */}
          {!reallocationData && campaign?.budget > 0 && (
            <div className="text-center">
              <button
                onClick={handleReallocation}
                disabled={reallocationLoading}
                className="px-4 py-2 bg-accent/15 border border-accent/30 text-accent text-xs font-medium rounded-lg hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                {reallocationLoading ? 'Hesaplaniyor...' : 'Butce Reallocation Onerisi Hesapla'}
              </button>
            </div>
          )}
          <ReallocationPanel data={reallocationData?.suggestions} totalBudget={reallocationData?.total_budget} />
        </>
      )}
    </div>
  )
}
