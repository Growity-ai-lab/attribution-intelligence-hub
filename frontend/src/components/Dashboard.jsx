import { useState, useMemo } from 'react'
import { useAttribution } from '../hooks/useAttribution'
import KPICards from './KPICards'
import ChannelTable from './ChannelTable'
import UnifiedChart from './UnifiedChart'
import UnifiedScoringTable from './UnifiedScoringTable'
import ReallocationPanel from './ReallocationPanel'
import DataUpload from './DataUpload'

/* ── Per-channel typical budget allocation weights (relative) ── */
const CHANNEL_ALLOC_WEIGHT = {
  meta: 0.28,
  google: 0.18,
  tiktok: 0.10,
  linkedin: 0.06,
  dv360: 0.08,
  youtube: 0.10,
  tv_match: 0.10,
  tv_news: 0.04,
  radio: 0.03,
  dooh: 0.03,
}

/* ── Per-channel typical CPL (TL) for lead estimation ── */
const CHANNEL_CPL = {
  meta: 2_500,
  google: 580,
  tiktok: 2_850,
  linkedin: 5_900,
  dv360: 3_300,
  youtube: 3_300,
  tv_match: 3_300,
  tv_news: 3_000,
  radio: 2_000,
  dooh: 3_300,
}

/**
 * Build campaign-specific KPI and channel data from campaign object.
 * Distributes budget across active channels weighted by typical allocation,
 * then estimates leads from typical CPL.
 */
function buildCampaignData(campaign) {
  const budget = campaign?.budget || 0
  const channels = campaign?.channels || []

  if (!budget || channels.length === 0) {
    return { kpi: null, channels: [] }
  }

  // Normalize weights to active channels only
  const rawWeights = {}
  let totalWeight = 0
  for (const ch of channels) {
    const w = CHANNEL_ALLOC_WEIGHT[ch] || 0.05
    rawWeights[ch] = w
    totalWeight += w
  }

  const channelData = channels.map(ch => {
    const share = rawWeights[ch] / totalWeight
    const spend = Math.round(budget * share)
    const cpl = CHANNEL_CPL[ch] || 3_000
    const leads = Math.max(1, Math.round(spend / cpl))
    return { channel: ch, spend, leads, share }
  })

  const totalSpend = channelData.reduce((s, c) => s + c.spend, 0)
  const totalLeads = channelData.reduce((s, c) => s + c.leads, 0)

  const kpi = {
    totalSpend,
    totalLeads,
    costPerLead: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0,
    activeCampaigns: 1,
    conversionRate: totalLeads > 0 ? Math.min(totalLeads / (totalLeads * 12), 0.085) : 0,
    totalBudget: budget,
  }

  return { kpi, channels: channelData }
}


export default function Dashboard({ onDdaResult, campaign }) {
  const { fetchSampleJourneys, runDDAFromCSV, getReallocation } = useAttribution()
  const [unifiedData, setUnifiedData] = useState(null)
  const [crossValidation, setCrossValidation] = useState([])
  const [journeyStats, setJourneyStats] = useState(null)
  const [reallocationData, setReallocationData] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)

  const { kpi, channels: channelData } = useMemo(() => buildCampaignData(campaign), [campaign])

  const handleAnalyzeSample = async () => {
    setAnalyzing(true)
    setAnalysisError(null)
    try {
      const sampleFile = await fetchSampleJourneys()
      const result = await runDDAFromCSV(sampleFile)
      setUnifiedData(result.unified_report || null)
      setCrossValidation(result.cross_validation || [])
      setJourneyStats(result.journey_stats || null)
      if (onDdaResult) onDdaResult(result)

      if (result.unified_report) {
        const currentBudgets = {}
        channelData.forEach(ch => { currentBudgets[ch.channel] = ch.spend })
        const reallocResult = await getReallocation(result.unified_report, currentBudgets)
        setReallocationData(reallocResult)
      }
    } catch (err) {
      setAnalysisError(err.response?.data?.detail || err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-6">
      {kpi && <KPICards data={kpi} />}
      {channelData.length > 0 && <ChannelTable channels={channelData} />}

      {/* DDA Analysis Section */}
      <div className="dark-card">
        <div className="card-hdr">
          <div>
            <h3 className="card-title">DDA Analizi</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Markov Chain + Shapley ensemble ile unified attribution skorlaması
            </p>
          </div>
          <button
            onClick={handleAnalyzeSample}
            disabled={analyzing}
            className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? 'Analiz ediliyor...' : 'Örnek Veri ile Analiz Et'}
          </button>
        </div>

        <div className="p-4">
          {analysisError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              {analysisError}
            </div>
          )}

          {journeyStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
              <div className="bg-dark-bg rounded-lg p-3">
                <p className="text-xs text-slate-500">Toplam Journey</p>
                <p className="text-lg font-semibold font-mono text-slate-100">{journeyStats.total_journeys}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3">
                <p className="text-xs text-slate-500">Conversion</p>
                <p className="text-lg font-semibold font-mono text-emerald-400">{journeyStats.converted}</p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3">
                <p className="text-xs text-slate-500">Conversion Rate</p>
                <p className="text-lg font-semibold font-mono text-blue-400">
                  %{((journeyStats.conversion_rate || 0) * 100).toFixed(1)}
                </p>
              </div>
              <div className="bg-dark-bg rounded-lg p-3">
                <p className="text-xs text-slate-500">Ort. Touchpoint</p>
                <p className="text-lg font-semibold font-mono text-slate-100">
                  {(journeyStats.avg_path_length || 0).toFixed(1)}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <DataUpload />

      {/* Unified Scoring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UnifiedChart data={unifiedData} />
        {!unifiedData && (
          <div className="dark-card p-6">
            <h3 className="card-title mb-4">Unified Scoring Table</h3>
            <p className="text-slate-500 text-xs">
              Analiz çalıştırıldıktan sonra kanal bazlı unified skorlar burada görünecek.
            </p>
          </div>
        )}
      </div>

      <UnifiedScoringTable data={unifiedData} crossValidation={crossValidation} />
      <ReallocationPanel data={reallocationData?.suggestions} totalBudget={reallocationData?.total_budget} />
    </div>
  )
}
