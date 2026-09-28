import { useState, useMemo } from 'react'
import { useAttribution } from '../hooks/useAttribution'
import { fmtMoney, fmtN } from '../utils/formatters'
import UnifiedChart from './UnifiedChart'
import UnifiedScoringTable from './UnifiedScoringTable'
import ReallocationPanel from './ReallocationPanel'
import DataUpload from './DataUpload'
import AlertsPanel from './AlertsPanel'

const SOURCE_LABELS = {
  csv: 'CSV',
  bigquery: 'BigQuery (GA4)',
  bigquery_generic: 'BigQuery (Tablo)',
}

const fmtRunDate = iso => {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d) ? d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

export default function Dashboard({ ddaResult, resultLoading, campaign, isDemo }) {
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
    } catch (err) {
      console.error('[Dashboard] reallocation hatası:', err)
    }
    setReallocationLoading(false)
  }

  const bq = ddaResult?.bq_summary
  const journeyStats = ddaResult?.journey_stats

  return (
    <div className="space-y-6">
      {campaign?.id && <AlertsPanel campaignId={campaign.id} refreshKey={ddaResult} />}

      {ddaResult?.stored && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl bg-dark-card border border-dark-border text-xs text-slate-400">
          <span>Son kayıtlı analiz gösteriliyor:</span>
          <span className="font-mono text-slate-200">{fmtRunDate(ddaResult.run_date)}</span>
          {SOURCE_LABELS[ddaResult.data_source] && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent/10 text-accent border border-accent/30">
              {SOURCE_LABELS[ddaResult.data_source]}
            </span>
          )}
          <span className="ml-auto text-[10px]">Yeni analiz için <strong className="text-slate-300">Attribution</strong> sekmesi</span>
        </div>
      )}

      {/* Real BQ Summary KPIs */}
      {bq && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Toplam Temas</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(bq.total_events)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Oturum</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(bq.sessions || bq.unique_users)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Benzersiz Kullanıcı</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(bq.unique_users)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Dönüşüm</p>
            <p className="text-lg font-mono text-accent mt-0.5">{fmtN(bq.conversions)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Toplam Gelir</p>
            <p className="text-lg font-mono text-emerald-400 mt-0.5">{fmtMoney(bq.total_revenue)} TL</p>
          </div>
        </div>
      )}

      {/* Journey stats */}
      {journeyStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase">Toplam Yolculuk</p>
            <p className="text-lg font-semibold font-mono text-slate-100">{fmtN(journeyStats.total_journeys)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase">Dönüşüm Yapan</p>
            <p className="text-lg font-semibold font-mono text-emerald-400">{fmtN(journeyStats.converted)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase">Dönüşüm Oranı</p>
            <p className="text-lg font-semibold font-mono text-blue-400">
              %{((journeyStats.conversion_rate || 0) * 100).toFixed(1)}
            </p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase">Ort. Temas Noktası</p>
            <p className="text-lg font-semibold font-mono text-slate-100">
              {(journeyStats.avg_path_length || 0).toFixed(1)}
            </p>
          </div>
        </div>
      )}

      {/* No data — guide user to Attribution tab */}
      {!ddaResult && resultLoading && (
        <div className="dark-card p-8 text-center text-xs text-slate-400">Son analiz yükleniyor...</div>
      )}
      {!ddaResult && !resultLoading && (
        <div className="dark-card p-8 text-center">
          <div className="text-3xl mb-3 opacity-50">&#x1f4ca;</div>
          <h3 className="text-sm font-semibold text-slate-200 mb-2">Attribution analizi henüz çalıştırılmadı</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            BigQuery (GA4) veya CSV ile attribution analizi çalıştırmak için <strong className="text-slate-300">Attribution</strong> sekmesine gidin.
            Sonuçlar otomatik olarak bu sayfada görünecek.
          </p>
        </div>
      )}

      {/* Data Upload */}
      <DataUpload campaign={campaign} isDemo={isDemo} />

      {/* Unified Scoring (only when real DDA data exists) */}
      {filteredUnified && (
        <>
          <UnifiedChart data={filteredUnified} />
          <UnifiedScoringTable data={filteredUnified} />

          {/* Reallocation */}
          {!reallocationData && campaign?.budget > 0 && (
            <div className="text-center">
              <button
                onClick={handleReallocation}
                disabled={reallocationLoading}
                className="px-4 py-2 bg-accent/15 border border-accent/30 text-accent text-xs font-medium rounded-lg hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                {reallocationLoading ? 'Hesaplanıyor...' : 'Bütçe Reallocation Önerisi Hesapla'}
              </button>
            </div>
          )}
          <ReallocationPanel data={reallocationData?.suggestions} totalBudget={reallocationData?.total_budget} />
        </>
      )}
    </div>
  )
}
