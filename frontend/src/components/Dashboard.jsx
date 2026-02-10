import { useState } from 'react'
import { useAttribution } from '../hooks/useAttribution'
import KPICards from './KPICards'
import ChannelTable from './ChannelTable'
import UnifiedChart from './UnifiedChart'
import UnifiedScoringTable from './UnifiedScoringTable'
import ReallocationPanel from './ReallocationPanel'
import DataUpload from './DataUpload'

const SAMPLE_KPI = {
  totalSpend: 55_000_000,
  totalLeads: 4280,
  costPerLead: 12_850,
  activeCampaigns: 4,
  conversionRate: 0.065,
  totalBudget: 55_000_000,
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

export default function Dashboard({ onDdaResult }) {
  const { fetchSampleJourneys, runDDAFromCSV, getReallocation } = useAttribution()
  const [unifiedData, setUnifiedData] = useState(null)
  const [crossValidation, setCrossValidation] = useState([])
  const [journeyStats, setJourneyStats] = useState(null)
  const [reallocationData, setReallocationData] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)

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
        SAMPLE_CHANNELS.forEach(ch => { currentBudgets[ch.channel] = ch.spend })
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
      <KPICards data={SAMPLE_KPI} />
      <ChannelTable channels={SAMPLE_CHANNELS} />

      {/* DDA Analysis Section */}
      <div className="dark-card">
        <div className="card-hdr">
          <div>
            <h3 className="card-title">DDA Analizi</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Markov Chain + Shapley ensemble ile unified attribution skorlamasi
            </p>
          </div>
          <button
            onClick={handleAnalyzeSample}
            disabled={analyzing}
            className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? 'Analiz ediliyor...' : 'Ornek Veri ile Analiz Et'}
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
              Analiz calistirildiktan sonra kanal bazli unified skorlar burada gorunecek.
            </p>
          </div>
        )}
      </div>

      <UnifiedScoringTable data={unifiedData} crossValidation={crossValidation} />
      <ReallocationPanel data={reallocationData?.suggestions} totalBudget={reallocationData?.total_budget} />
    </div>
  )
}
