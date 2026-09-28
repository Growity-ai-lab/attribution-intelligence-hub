import { useState, useCallback, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import axios from 'axios'
import { getChannelColor } from '../../utils/colors'
import { fmtMoney, fmtN, fmtPct } from '../../utils/formatters'
import { objectiveLabels } from '../../utils/objectiveLabels'
import InfoTip from '../InfoTip'
import AlertsPanel from '../AlertsPanel'
import { isOrganic } from './organic'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const API = '/api'

/** DDA result views: KPIs, charts, contribution/assist tables, insights, trend and export. */
export default function DdaResults({ campaign, ddaResult }) {
  const objective = campaign?.objective || 'lead'
  const L = objectiveLabels(objective)
  const isLead = objective === 'lead'
  const [showMethodology, setShowMethodology] = useState(false)
  // Trend analysis
  const [trendData, setTrendData] = useState(null)
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    if (!ddaResult || !campaign?.id) return
    let mounted = true
    axios.get(`${API}/insights/trend`, { params: { campaign_id: campaign.id } })
      .then(res => { if (mounted) setTrendData(res.data) })
      .catch(() => { if (mounted) setTrendData(null) })
    return () => { mounted = false }
  }, [ddaResult, campaign?.id])

  const handleExportReport = useCallback(async () => {
    if (!campaign?.id) return
    setExportLoading(true)
    try {
      const res = await axios.get(`${API}/export/dda-report`, {
        params: { campaign_id: campaign.id },
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `attribution_rapor_${campaign.id}_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Export] rapor indirme hatası:', err)
    } finally {
      setExportLoading(false)
    }
  }, [campaign?.id])

  const handleExportPptx = useCallback(async () => {
    if (!campaign?.id) return
    setExportLoading(true)
    try {
      const res = await axios.get(`${API}/export/dda-pptx`, {
        params: { campaign_id: campaign.id },
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `attribution_sunum_${campaign.id}_${new Date().toISOString().slice(0, 10)}.pptx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Export] sunum indirme hatası:', err)
    } finally {
      setExportLoading(false)
    }
  }, [campaign?.id])

  // Chart data from DDA result
  const chartData = ddaResult ? (() => {
    const hybrid = ddaResult.hybrid_attribution || {}
    const channels = Object.keys(hybrid).sort((a, b) => hybrid[b] - hybrid[a])
    return {
      labels: channels,
      datasets: [
        {
          label: 'Katkı Payı',
          data: channels.map(ch => hybrid[ch]),
          backgroundColor: channels.map((ch, i) => getChannelColor(ch, i) + '80'),
          borderColor: channels.map((ch, i) => getChannelColor(ch, i)),
          borderWidth: 1, borderRadius: 3,
        },
      ],
    }
  })() : null

  const barOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => fmtPct(ctx.parsed.x) } },
    },
    scales: {
      x: { ticks: { callback: v => fmtPct(v) }, max: 1 },
      y: { grid: { display: false } },
    },
  }

  return (
    <>
      {campaign?.id && <AlertsPanel campaignId={campaign.id} refreshKey={ddaResult} />}

      {/* BQ Summary KPIs */}
      {ddaResult.bq_summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Toplam Temas</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.total_events)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Oturum</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.sessions || ddaResult.bq_summary.unique_users)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Benzersiz Kullanıcı</p>
            <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(ddaResult.bq_summary.unique_users)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{isLead ? 'Lead (kullanıcı)' : 'Dönüşüm (kullanıcı)'}</p>
            <p className="text-lg font-mono text-accent mt-0.5">{fmtN(ddaResult.bq_summary.conversions)}</p>
          </div>
          {!isLead && (
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Toplam Gelir</p>
              <p className="text-lg font-mono text-emerald-400 mt-0.5">{fmtMoney(ddaResult.bq_summary.total_revenue)} TL</p>
            </div>
          )}
        </div>
      )}

      {/* Methodology Info */}
      <div className="dark-card">
        <button
          onClick={() => setShowMethodology(v => !v)}
          aria-expanded={showMethodology}
          className="w-full card-hdr cursor-pointer hover:bg-dark-bg/30 transition-colors"
        >
          <span className="card-title">Bu skorlar nasıl hesaplanır?</span>
          <span className="text-[10px] text-slate-400">{showMethodology ? '▲ Gizle' : '▼ Göster'}</span>
        </button>
        {showMethodology && (
          <div className="px-4 pb-4 space-y-3 text-xs text-slate-300 leading-relaxed">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-900/15 border border-blue-800/20">
              <span className="text-blue-400 font-bold mt-0.5 flex-shrink-0">1</span>
              <div>
                <p className="font-semibold text-slate-200">Zincir Etkisi</p>
                <p className="text-slate-400 mt-0.5">Her kanalı sırayla dönüşüm yolculuğundan çıkarır ve dönüşüm oranının ne kadar düştüğünü ölçer. Bir kanal çıkarıldığında dönüşümler çok düşüyorsa, o kanal zincirin kritik halkasıdır.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-900/15 border border-purple-800/20">
              <span className="text-purple-400 font-bold mt-0.5 flex-shrink-0">2</span>
              <div>
                <p className="font-semibold text-slate-200">Bağımsız Katkı</p>
                <p className="text-slate-400 mt-0.5">Her kanalın tüm olası kombinasyonlardaki katkısını hesaplar. Kanalların sırasından bağımsız olarak, her birinin dönüşüme ne kadar eklediğini adil şekilde paylaştırır.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-900/15 border border-emerald-800/20">
              <span className="text-emerald-400 font-bold mt-0.5 flex-shrink-0">3</span>
              <div>
                <p className="font-semibold text-slate-200">Katkı Payı</p>
                <p className="text-slate-400 mt-0.5">Zincir Etkisi (%65) ve Bağımsız Katkı (%35) ağırlıklı ortalaması. Tek bir model yerine ikisini harmanlayarak daha güvenilir bir sonuç elde edilir.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Attribution Chart */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Kanal Katkı Payları</span>
          <span className="text-[10px] font-mono text-slate-400">
            Zincir etkisi %65 + Bağımsız katkı %35
            {ddaResult.data_source === 'bigquery' && ' | BigQuery'}
          </span>
        </div>
        <div className="p-4">
          {chartData && (
            <div style={{ height: Math.max(200, Object.keys(ddaResult.hybrid_attribution || {}).length * 32) }}>
              <Bar data={chartData} options={barOpts} />
            </div>
          )}
        </div>
      </div>

      {/* Attributed Revenue / Lead Chart */}
      {(() => {
        const totalRev = ddaResult.bq_summary?.total_revenue || 0
        const totalLeads = ddaResult.journey_stats?.converted || 0
        // Lead mode → distribute leads; revenue mode → distribute revenue (only if present)
        const attrTotal = isLead ? totalLeads : totalRev
        if (attrTotal <= 0) return null
        const hybrid = ddaResult.hybrid_attribution || {}
        const sorted = Object.entries(hybrid)
          .filter(([ch]) => !isOrganic(ch))
          .sort((a, b) => b[1] - a[1])
        const fmtVal = v => isLead ? `${fmtN(v)} lead` : `${fmtMoney(v)} TL`
        const attrData = {
          labels: sorted.map(([ch]) => ch),
          datasets: [{
            label: L.attributedChart,
            data: sorted.map(([, w]) => attrTotal * w),
            backgroundColor: sorted.map(([ch], i) => getChannelColor(ch, i) + '80'),
            borderColor: sorted.map(([ch], i) => getChannelColor(ch, i)),
            borderWidth: 1,
            borderRadius: 3,
          }],
        }
        const attrOpts = {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => fmtVal(ctx.parsed.x) } },
          },
          scales: {
            x: { ticks: { callback: v => fmtVal(v) } },
            y: { grid: { display: false } },
          },
        }
        return (
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Kanal Bazlı {L.attributedChart}</span>
              <span className="text-[10px] font-mono text-slate-400">
                {isLead ? `Toplam lead: ${fmtN(totalLeads)}` : `Toplam gelir: ${fmtMoney(totalRev)} TL`}
              </span>
            </div>
            <div className="p-4">
              <div style={{ height: Math.max(180, sorted.length * 32) }}>
                <Bar data={attrData} options={attrOpts} />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Gercek (GA4) Kanal Geliri — donusen oturumun kanalina bagli olculen gelir */}
      {!isLead && ddaResult.bq_summary?.channel_revenue
        && Object.keys(ddaResult.bq_summary.channel_revenue).length > 0 && (() => {
        const chRev = ddaResult.bq_summary.channel_revenue
        const sorted = Object.entries(chRev)
          .filter(([ch]) => !isOrganic(ch))
          .sort((a, b) => b[1] - a[1])
        if (sorted.length === 0) return null
        const measuredTotal = sorted.reduce((s, [, v]) => s + v, 0)
        const revData = {
          labels: sorted.map(([ch]) => ch),
          datasets: [{
            label: 'Gercek (GA4) Gelir',
            data: sorted.map(([, v]) => v),
            backgroundColor: sorted.map(([ch], i) => getChannelColor(ch, i) + '80'),
            borderColor: sorted.map(([ch], i) => getChannelColor(ch, i)),
            borderWidth: 1,
            borderRadius: 3,
          }],
        }
        const revOpts = {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${fmtMoney(ctx.parsed.x)} TL` } },
          },
          scales: {
            x: { ticks: { callback: v => `${fmtMoney(v)} TL` } },
            y: { grid: { display: false } },
          },
        }
        return (
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Gerçek (GA4) Kanal Geliri</span>
              <span className="text-[10px] font-mono text-slate-400">
                Ölçülen toplam: {fmtMoney(measuredTotal)} TL
              </span>
            </div>
            <div className="px-4 pt-3">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Her satışın geliri, dönüşen oturumun kanalına bağlanır — GA4 kanal raporuyla
                doğrudan kıyaslanabilir. Üstteki grafik DDA modelinin <span className="text-slate-300">atfettiği</span> geliri,
                bu grafik GA4'te <span className="text-slate-300">fiilen gerçekleşen</span> geliri gösterir.
              </p>
            </div>
            <div className="p-4 pt-2">
              <div style={{ height: Math.max(180, sorted.length * 32) }}>
                <Bar data={revData} options={revOpts} />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Attribution Table */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Kanal Katkı Detayı</span>
        </div>
        <div className="p-4 scroll-hint">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-dark-border text-slate-400">
                <th className="text-left py-2 px-2">Kanal</th>
                <th className="text-right py-2 px-2">
                  Katkı Payı
                  <InfoTip text="DDA (Data-Driven Attribution) skoru. Zincir Etkisi (%65) ve Bağımsız Katkı (%35) ağırlıklı ortalamasıdır. Her kanalın dönüşüme toplam katkısını gösterir." />
                </th>
                <th className="text-right py-2 px-2">
                  Zincir Etkisi
                  <InfoTip text="Markov Zinciri modeli. Kanalı dönüşüm yolculuğundan çıkarır ve dönüşüm oranının ne kadar düştüğünü ölçer. Yüksekse kanal zincirin vazgeçilmez halkasıdır." />
                </th>
                <th className="text-right py-2 px-2">
                  Bağımsız Katkı
                  <InfoTip text="Shapley Value modeli. Kanalın tüm olası kanal kombinasyonlarındaki marjinal katkısını hesaplar. Sıradan bağımsız, adil bir dağılım yapar." />
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ddaResult.hybrid_attribution || {})
                .sort(([, a], [, b]) => b - a)
                .map(([ch, weight], idx) => {
                  const markov = ddaResult.markov?.attribution_weights?.[ch] || 0
                  const shapley = ddaResult.shapley_dda?.[ch] || 0
                  return (
                    <tr key={ch} className="border-b border-dark-border/50 hover:bg-dark-bg/30">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(ch, idx) }} />
                          <span className="text-slate-200">{ch}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-slate-100">{fmtPct(weight)}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtPct(markov)}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtPct(shapley)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assisted Conversion Report */}
      {ddaResult.assist_report?.length > 0 && (() => {
        const avgTp = ddaResult.journey_stats?.avg_path_length || ddaResult.journey_stats?.avg_touchpoints || 0
        const isSingleTouch = avgTp <= 1.2
        return (
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Asist Analizi</span>
              <span className="text-[10px] font-mono text-slate-400">
                İlk temas / Asist / Son temas kırılımı
              </span>
            </div>
            {isSingleTouch && (
              <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-900/20 border border-amber-800/30">
                <p className="text-xs text-amber-300 leading-relaxed">
                  <span className="font-semibold">Tek temaslı yolculuklar:</span>{' '}
                  Ortalama temas noktası {avgTp.toFixed(1)} — kullanıcılar tek oturumda dönüşüm yapıyor veya
                  GA4 çapraz oturum takibi (User-ID / Google Signals) aktif değil.
                  Asist verisi bu nedenle sınırlı, aşağıdaki tablo yalnızca son temas dağılımını gösteriyor.
                </p>
              </div>
            )}
            <div className="p-4 scroll-hint">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-slate-400">
                    <th className="text-left py-2 px-2">Kanal</th>
                    {!isSingleTouch && (
                      <th className="text-right py-2 px-2">
                        İlk Temas
                        <InfoTip text="First Touch. Bu kanalın kullanıcının markayı ilk kez keşfettiği temas noktası olarak kaç kez göründüğü." />
                      </th>
                    )}
                    {!isSingleTouch && (
                      <th className="text-right py-2 px-2">
                        Asist
                        <InfoTip text="Assisted Conversion. Kanalın son temas olmadan dönüşüme katkı sağladığı — yani yolculukta ara adım olarak yer aldığı — sayı." />
                      </th>
                    )}
                    <th className="text-right py-2 px-2">
                      Son Temas
                      <InfoTip text="Last Touch. Kullanıcının dönüşüm yapmadan hemen önce son etkileşimde bulunduğu kanal. Genelde dönüşümü 'kapatan' kanal olarak yorumlanır." />
                    </th>
                    {!isSingleTouch && (
                      <th className="text-right py-2 px-2">
                        Toplam
                        <InfoTip text="Total Involvement. Asist + Son Temas toplamı. Kanalın dönüşüm sürecine toplam katılım sayısı." />
                      </th>
                    )}
                    {!isSingleTouch && (
                      <th className="text-right py-2 px-2">
                        Asist Oranı
                        <InfoTip text="Assist Ratio = Asist / Toplam. Yüksekse kanal genellikle arka planda çalışıyor (farkındalık); düşükse doğrudan dönüşüm sağlıyor." />
                      </th>
                    )}
                    <th className="text-right py-2 px-2">
                      {isSingleTouch ? 'Pay' : 'Rol'}
                      <InfoTip text={isSingleTouch
                        ? 'Kanalın toplam dönüşümler içindeki yüzde payı.'
                        : 'Farkındalık: asist oranı yüksek (üst huni). Dönüştürücü: son temas ağırlıklı (alt huni). Hibrit: ikisinin karışımı.'
                      } />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ddaResult.assist_report.map((r, idx) => {
                    const ratio = r.assist_ratio
                    const totalConv = ddaResult.assist_report.reduce((s, x) => s + x.last_touch, 0)
                    const share = totalConv > 0 ? r.last_touch / totalConv : 0

                    const rolLabel = isSingleTouch
                      ? fmtPct(share)
                      : (r.channel_role || 'Hibrit')
                    const rolColor = isSingleTouch
                      ? 'bg-slate-500/15 text-slate-300'
                      : rolLabel === 'Farkındalık'
                        ? 'bg-amber-500/15 text-amber-400'
                        : rolLabel === 'Dönüştürücü'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-blue-500/15 text-blue-400'
                    return (
                      <tr key={r.channel} className="border-b border-dark-border/50 hover:bg-dark-bg/30">
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(r.channel, idx) }} />
                            <span className="text-slate-200">{r.channel}</span>
                          </div>
                        </td>
                        {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-400">{r.first_touch}</td>}
                        {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-400">{r.assists}</td>}
                        <td className="py-2 px-2 text-right font-mono text-slate-100">{r.last_touch}</td>
                        {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-300">{r.total_involvement}</td>}
                        {!isSingleTouch && <td className="py-2 px-2 text-right font-mono text-slate-100">{fmtPct(ratio)}</td>}
                        <td className="py-2 px-2 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${rolColor}`}>
                            {rolLabel}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Çıkarımlar / Insights */}
      {ddaResult.insights?.length > 0 && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">Çıkarımlar</span>
            <span className="text-[10px] font-mono text-slate-400">
              Otomatik analiz
            </span>
          </div>
          <div className="p-4 space-y-2">
            {ddaResult.insights.map((insight, i) => {
              const bg = insight.type === 'warning'
                ? 'bg-amber-900/20 border-amber-800/30'
                : insight.type === 'success'
                  ? 'bg-emerald-900/20 border-emerald-800/30'
                  : 'bg-blue-900/20 border-blue-800/30'
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${bg}`}>
                  <span className="text-base flex-shrink-0">{insight.icon}</span>
                  <p className="text-xs text-slate-200 leading-relaxed">{insight.text}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Trend Analizi */}
      {trendData?.available && trendData.insights?.length > 0 && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">
              Trend Analizi
              <InfoTip text="Son iki DDA çalışması arasındaki farkları gösterir. Kanal katkı payı, dönüşüm oranı ve yolculuk hacmi değişimlerini takip eder." />
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {trendData.previous_run_date?.slice(0, 10)} → {trendData.current_run_date?.slice(0, 10)}
            </span>
          </div>
          <div className="p-4 space-y-2">
            {trendData.insights.map((insight, i) => {
              const bg = insight.type === 'warning'
                ? 'bg-amber-900/20 border-amber-800/30'
                : insight.type === 'success'
                  ? 'bg-emerald-900/20 border-emerald-800/30'
                  : 'bg-blue-900/20 border-blue-800/30'
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${bg}`}>
                  <span className="text-base flex-shrink-0">{insight.icon}</span>
                  <p className="text-xs text-slate-200 leading-relaxed">{insight.text}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Raporu İndir */}
      {ddaResult && campaign?.id && (
        <div className="flex justify-end gap-2">
          <button
            onClick={handleExportReport}
            disabled={exportLoading}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-700 transition-colors"
          >
            {exportLoading ? 'Hazırlanıyor...' : 'Excel İndir (.xlsx)'}
          </button>
          <button
            onClick={handleExportPptx}
            disabled={exportLoading}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-orange-600 text-white hover:bg-orange-500 disabled:bg-slate-700 transition-colors"
          >
            {exportLoading ? 'Hazırlanıyor...' : 'Sunum İndir (.pptx)'}
          </button>
        </div>
      )}
    </>
  )
}
