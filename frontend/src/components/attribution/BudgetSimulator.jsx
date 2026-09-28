import { useState, useCallback } from 'react'
import axios from 'axios'
import { fmtMoney, fmtN, fmtPct } from '../../utils/formatters'
import { objectiveLabels } from '../../utils/objectiveLabels'
import InfoTip from '../InfoTip'
import { isOrganic } from './organic'

const API = '/api'

/** Budget / revenue-lead simulation and the CPL target planner, driven by DDA weights. */
export default function BudgetSimulator({ campaign, ddaResult }) {
  const objective = campaign?.objective || 'lead'
  const leadValue = campaign?.lead_value || 0
  const L = objectiveLabels(objective)
  const isLead = objective === 'lead'
  // Budget simulation
  const [channelSpends, setChannelSpends] = useState({})
  const [scenarioSpends, setScenarioSpends] = useState({})
  const [simResult, setSimResult] = useState(null)
  const [simLoading, setSimLoading] = useState(false)
  const [simError, setSimError] = useState('')
  const [showScenario, setShowScenario] = useState(false)

  // CPL target planner (lead mode only)
  const [targetCpl, setTargetCpl] = useState('')
  const [targetLeads, setTargetLeads] = useState('')
  const [cplPlanResult, setCplPlanResult] = useState(null)
  const [cplPlanLoading, setCplPlanLoading] = useState(false)
  const [cplPlanError, setCplPlanError] = useState('')

  const handleSimulate = useCallback(async (useScenario = false) => {
    if (!ddaResult) return
    const weights = ddaResult.hybrid_attribution || {}
    const bq = ddaResult.bq_summary || {}
    const totalRevenue = bq.total_revenue || 0
    // Lead mode / CSV flow: conversions come from journey_stats when bq_summary is absent
    const totalConversions = bq.total_conversions || bq.conversions
      || ddaResult.journey_stats?.converted || 0

    const spends = {}
    for (const ch of Object.keys(weights)) {
      if (!isOrganic(ch) && channelSpends[ch] > 0) {
        spends[ch] = Number(channelSpends[ch])
      }
    }
    if (Object.keys(spends).length === 0) {
      setSimError('En az bir kanala harcama girmeniz gerekiyor.')
      return
    }

    setSimLoading(true)
    setSimError('')
    try {
      const body = {
        channel_spends: spends,
        dda_weights: weights,
        total_revenue: totalRevenue,
        total_conversions: totalConversions,
        objective,
        lead_value: leadValue,
      }
      if (useScenario) {
        const sSpends = {}
        for (const ch of Object.keys(weights)) {
          if (!isOrganic(ch) && scenarioSpends[ch] > 0) {
            sSpends[ch] = Number(scenarioSpends[ch])
          }
        }
        if (Object.keys(sSpends).length > 0) body.scenario_spends = sSpends
      }
      const res = await axios.post(`${API}/simulation/budget`, body)
      setSimResult(res.data)
      if (useScenario) setShowScenario(true)
    } catch (err) {
      setSimError(err.response?.data?.detail || err.message)
    }
    setSimLoading(false)
  }, [ddaResult, channelSpends, scenarioSpends, objective, leadValue])

  const handleCplPlan = useCallback(async () => {
    if (!ddaResult || !targetCpl || !targetLeads) return
    setCplPlanLoading(true)
    setCplPlanError('')
    try {
      const weights = ddaResult.hybrid_attribution || {}
      const body = {
        target_cpl: Number(targetCpl),
        target_leads: Number(targetLeads),
        channel_weights: weights,
        current_spends: channelSpends,
        lead_value: leadValue,
      }
      const res = await axios.post(`${API}/simulation/cpl-target`, body)
      setCplPlanResult(res.data)
    } catch (err) {
      setCplPlanError(err.response?.data?.detail || err.message)
    }
    setCplPlanLoading(false)
  }, [ddaResult, targetCpl, targetLeads, channelSpends, leadValue])

  const handleCsvSpendUpload = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const lines = evt.target.result.split('\n').filter(l => l.trim())
      const newSpends = {}
      for (const line of lines.slice(1)) {
        const [ch, spend] = line.split(',').map(s => s.trim())
        if (ch && spend && !isNaN(Number(spend))) {
          newSpends[ch] = Number(spend)
        }
      }
      setChannelSpends(prev => ({ ...prev, ...newSpends }))
    }
    reader.readAsText(file)
  }, [])

  const handleResetSim = useCallback(() => {
    setChannelSpends({})
    setScenarioSpends({})
    setSimResult(null)
    setSimError('')
    setShowScenario(false)
  }, [])

  return (
    <>
      {/* Bütçe & Gelir/Lead Simülasyonu */}
      {ddaResult.hybrid_attribution && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">
              {L.section}
              <InfoTip text={isLead
                ? "DDA katkı paylarını kullanarak kanal bazlı atfedilen lead ve CPL hesaplar. Harcama verisi manuel girilir veya CSV ile yüklenir. Senaryo modunda bütçe değişikliklerinin lead'e etkisini simüle edebilirsiniz."
                : "DDA katkı paylarını kullanarak kanal bazlı ROAS ve CPA hesaplar. Harcama verisi manuel girilir veya CSV ile yüklenir. Senaryo modunda bütçe değişikliklerinin gelire etkisini simüle edebilirsiniz."} />
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Hill saturasyon modeli
            </span>
          </div>
          <div className="p-4 space-y-4">
            {/* Spend input table */}
            <div className="scroll-hint">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Kanal</th>
                    <th className="text-right py-2 px-2">
                      Katkı Payı
                      <InfoTip text="DDA analizi sonucunda hesaplanan kanal katkı oranı." />
                    </th>
                    <th className="text-right py-2 px-2">
                      Harcama (₺)
                      <InfoTip text="Bu kanala yapılan toplam harcamayı girin. Organik kanallar için harcama girilemez." />
                    </th>
                    {showScenario && (
                      <th className="text-right py-2 px-2">
                        Senaryo (₺)
                        <InfoTip text="What-if analizi için yeni bütçe değerlerini girin." />
                      </th>
                    )}
                    {simResult && <th className="text-right py-2 px-2">
                      {L.attributedCol}
                      <InfoTip text={isLead
                        ? "DDA katkı payına göre bu kanala atfedilen lead sayısı."
                        : "DDA katkı payına göre bu kanala atfedilen gelir miktarı."} />
                    </th>}
                    {simResult && !isLead && <th className="text-right py-2 px-2">
                      ROAS
                      <InfoTip text="Return On Ad Spend — kanala atfedilen gelir / harcama. 1x üstü karlı demektir." />
                    </th>}
                    {simResult && <th className="text-right py-2 px-2">
                      {isLead ? 'CPL (₺)' : 'CPA (₺)'}
                      <InfoTip text={isLead
                        ? "Cost Per Lead — her bir atfedilen lead için harcanan tutar. Düşük = verimli."
                        : "Cost Per Acquisition — her bir atfedilen dönüşüm için harcanan tutar. Düşük = verimli."} />
                    </th>}
                    {simResult && isLead && leadValue > 0 && <th className="text-right py-2 px-2">
                      Değer-ROAS
                      <InfoTip text="Lead başına tahmini değer × atfedilen lead / harcama. Lead'in iş değerine göre verimlilik." />
                    </th>}
                    {simResult?.recommendations && <th className="text-center py-2 px-2">
                      Aksiyon
                      <InfoTip text={isLead
                        ? "CPL karşılaştırmasına göre otomatik bütçe önerisi. Artır: düşük CPL, Azalt: yüksek CPL, Koru: ortalama."
                        : "ROAS ve CPA karşılaştırmasına göre otomatik bütçe önerisi. Artır: verimli kanal, Azalt: verimsiz, Koru: ortalama."} />
                    </th>}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ddaResult.hybrid_attribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([ch, weight]) => {
                      const organic = isOrganic(ch)
                      const curCh = simResult?.current?.channels?.[ch]
                      const rec = simResult?.recommendations?.find(r => r.channel === ch)
                      const actionColor = rec?.action === 'artir'
                        ? 'text-emerald-400'
                        : rec?.action === 'azalt'
                          ? 'text-red-400'
                          : rec?.action === 'degerlendirmeli'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                      return (
                        <tr key={ch} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                          <td className="py-1.5 px-2 text-slate-200 font-medium">{ch}</td>
                          <td className="py-1.5 px-2 text-right text-slate-300 font-mono">{fmtPct(weight)}</td>
                          <td className="py-1.5 px-2 text-right">
                            {organic ? (
                              <span className="text-slate-600 text-[10px]">organik</span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                className="w-24 bg-slate-800/50 border border-slate-700 rounded px-2 py-1 text-right text-xs text-slate-200 font-mono focus:border-blue-500 focus:outline-none"
                                placeholder="0"
                                value={channelSpends[ch] || ''}
                                onChange={e => setChannelSpends(prev => ({ ...prev, [ch]: e.target.value }))}
                              />
                            )}
                          </td>
                          {showScenario && (
                            <td className="py-1.5 px-2 text-right">
                              {organic ? (
                                <span className="text-slate-600 text-[10px]">—</span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  className="w-24 bg-amber-900/20 border border-amber-700/50 rounded px-2 py-1 text-right text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none"
                                  placeholder={channelSpends[ch] || '0'}
                                  value={scenarioSpends[ch] || ''}
                                  onChange={e => setScenarioSpends(prev => ({ ...prev, [ch]: e.target.value }))}
                                />
                              )}
                            </td>
                          )}
                          {simResult && (
                            <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                              {isLead
                                ? (curCh?.attributed_leads != null ? fmtN(curCh.attributed_leads) : '—')
                                : (curCh?.attributed_revenue != null ? `${fmtMoney(curCh.attributed_revenue)}` : '—')}
                            </td>
                          )}
                          {simResult && !isLead && (
                            <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                              {curCh?.roas != null ? `${curCh.roas.toFixed(1)}x` : '—'}
                            </td>
                          )}
                          {simResult && (
                            <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                              {curCh?.cpa != null ? `${fmtMoney(curCh.cpa)}` : '—'}
                            </td>
                          )}
                          {simResult && isLead && leadValue > 0 && (
                            <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                              {curCh?.value_roas != null ? `${curCh.value_roas.toFixed(1)}x` : '—'}
                            </td>
                          )}
                          {simResult?.recommendations && (
                            <td className={`py-1.5 px-2 text-center text-[10px] font-medium ${actionColor}`}>
                              {rec ? `${rec.icon} ${rec.action === 'artir' ? 'Artır' : rec.action === 'azalt' ? 'Azalt' : rec.action === 'koru' ? 'Koru' : 'Değerlendir'}` : '—'}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>

            {/* Recommendation tooltips */}
            {simResult?.recommendations?.length > 0 && (
              <div className="space-y-1.5">
                {simResult.recommendations.filter(r => r.action !== 'koru').map((rec, i) => {
                  const bg = rec.action === 'artir'
                    ? 'bg-emerald-900/20 border-emerald-800/30'
                    : rec.action === 'azalt'
                      ? 'bg-red-900/20 border-red-800/30'
                      : 'bg-amber-900/20 border-amber-800/30'
                  return (
                    <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border ${bg}`}>
                      <span className="text-sm flex-shrink-0">{rec.icon}</span>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        <span className="font-medium text-slate-100">{rec.channel}</span>: {rec.reason}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleSimulate(false)}
                disabled={simLoading}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {simLoading ? 'Hesaplanıyor...' : 'Simüle Et'}
              </button>
              <button
                onClick={() => {
                  if (!showScenario) {
                    const copy = {}
                    for (const ch of Object.keys(channelSpends)) copy[ch] = channelSpends[ch]
                    setScenarioSpends(copy)
                    setShowScenario(true)
                  } else {
                    handleSimulate(true)
                  }
                }}
                disabled={simLoading || !simResult}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {showScenario ? 'Senaryoyu Simüle Et' : 'Senaryo Ekle'}
              </button>
              <label className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer">
                CSV ile Yükle
                <input type="file" accept=".csv" className="hidden" onChange={handleCsvSpendUpload} />
              </label>
              <button
                onClick={handleResetSim}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-medium rounded-lg transition-colors"
              >
                Sıfırla
              </button>
            </div>

            {simError && (
              <p className="text-xs text-red-400">{simError}</p>
            )}

            {/* Summary KPIs */}
            {simResult && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-400 uppercase">Toplam Harcama</p>
                  <p className="text-sm font-mono text-slate-100">{fmtMoney(simResult.current.total_spend)} ₺</p>
                </div>
                {isLead ? (
                  <>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">Toplam Lead</p>
                      <p className="text-sm font-mono text-emerald-400">{fmtN(simResult.current.total_leads)}</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">Ort. CPL</p>
                      <p className="text-sm font-mono text-amber-400">{simResult.current.avg_cpl != null ? `${fmtMoney(simResult.current.avg_cpl)} ₺` : '—'}</p>
                    </div>
                    {leadValue > 0 && (
                      <>
                        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-slate-400 uppercase">Tahmini Değer</p>
                          <p className="text-sm font-mono text-slate-100">{fmtMoney(simResult.current.total_attributed_value)} ₺</p>
                        </div>
                        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-slate-400 uppercase">
                            Değer-ROAS
                            <InfoTip text="Tahmini toplam değer / harcama. Lead başına girilen değere dayanır." />
                          </p>
                          <p className="text-sm font-mono text-blue-300">{simResult.current.blended_value_roas != null ? `${simResult.current.blended_value_roas.toFixed(1)}x` : '—'}</p>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">Toplam Gelir</p>
                      <p className="text-sm font-mono text-slate-100">{fmtMoney(simResult.current.total_revenue)} ₺</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">Karma ROAS</p>
                      <p className="text-sm font-mono text-slate-100">{simResult.current.blended_roas != null ? `${simResult.current.blended_roas.toFixed(1)}x` : '—'}</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">Ort. CPA</p>
                      <p className="text-sm font-mono text-slate-100">{simResult.current.avg_cpa != null ? `${fmtMoney(simResult.current.avg_cpa)} ₺` : '—'}</p>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">
                        AOV
                        <InfoTip text="Average Order Value — ortalama sipariş değeri. Toplam gelir / toplam dönüşüm." />
                      </p>
                      <p className="text-sm font-mono text-slate-100">{simResult.current.aov != null ? `${fmtMoney(simResult.current.aov)} ₺` : '—'}</p>
                    </div>
                  </>
                )}
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-400 uppercase">{isLead ? 'Lead' : 'Dönüşüm'}</p>
                  <p className="text-sm font-mono text-slate-100">{fmtN(simResult.current.total_conversions)}</p>
                </div>
              </div>
            )}

            {/* Scenario comparison */}
            {simResult?.scenario && showScenario && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-amber-300">Senaryo Sonucu</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {isLead ? (
                    <>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Projeksiyon Lead</p>
                        <p className="text-sm font-mono text-amber-200">{fmtN(simResult.scenario.projected_leads)}</p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Lead Farkı</p>
                        <p className={`text-sm font-mono ${(simResult.scenario.projected_leads - simResult.current.total_leads) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {(simResult.scenario.projected_leads - simResult.current.total_leads) >= 0 ? '+' : ''}{fmtN(simResult.scenario.projected_leads - simResult.current.total_leads)}
                        </p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Yeni CPL</p>
                        <p className="text-sm font-mono text-amber-200">{simResult.scenario.blended_cpl != null ? `${fmtMoney(simResult.scenario.blended_cpl)} ₺` : '—'}</p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">CPL Değişim</p>
                        <p className={`text-sm font-mono ${(simResult.scenario.delta_cpl || 0) <= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {simResult.scenario.delta_cpl != null ? `${simResult.scenario.delta_cpl >= 0 ? '+' : ''}${fmtMoney(simResult.scenario.delta_cpl)} ₺` : '—'}
                        </p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Toplam Harcama</p>
                        <p className="text-sm font-mono text-amber-200">{fmtMoney(simResult.scenario.total_spend)} ₺</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Projeksiyon Gelir</p>
                        <p className="text-sm font-mono text-amber-200">{fmtMoney(simResult.scenario.projected_revenue)} ₺</p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Gelir Farkı</p>
                        <p className={`text-sm font-mono ${simResult.scenario.delta_revenue >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {simResult.scenario.delta_revenue >= 0 ? '+' : ''}{fmtMoney(simResult.scenario.delta_revenue)} ₺
                          <span className="text-[10px] ml-1">({simResult.scenario.delta_revenue_pct >= 0 ? '+' : ''}{simResult.scenario.delta_revenue_pct}%)</span>
                        </p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Yeni ROAS</p>
                        <p className="text-sm font-mono text-amber-200">{simResult.scenario.blended_roas != null ? `${simResult.scenario.blended_roas.toFixed(1)}x` : '—'}</p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">ROAS Değişim</p>
                        <p className={`text-sm font-mono ${(simResult.scenario.delta_roas || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {simResult.scenario.delta_roas != null ? `${simResult.scenario.delta_roas >= 0 ? '+' : ''}${simResult.scenario.delta_roas.toFixed(1)}x` : '—'}
                        </p>
                      </div>
                      <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-400/70 uppercase">Proj. Dönüşüm</p>
                        <p className="text-sm font-mono text-amber-200">{fmtN(simResult.scenario.projected_conversions)}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CPL Target Planner (lead mode only) */}
      {isLead && ddaResult && simResult && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">
              Hedef CPL Planlayıcı
              <InfoTip text="Hedef CPL ve lead sayısı girdiğinizde, DDA katkı paylarına göre kanal bazlı bütçe dağılımını hesaplar. Hill saturasyon modeli ile fizibilite değerlendirir." />
            </span>
            <span className="text-[10px] font-mono text-slate-400">Lead modu</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Hedef CPL (₺)</label>
                <input
                  type="number"
                  min="1"
                  className="w-32 bg-slate-800/50 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  placeholder="örn. 500"
                  value={targetCpl}
                  onChange={e => setTargetCpl(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Hedef Lead Sayısı</label>
                <input
                  type="number"
                  min="1"
                  className="w-32 bg-slate-800/50 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  placeholder="örn. 1000"
                  value={targetLeads}
                  onChange={e => setTargetLeads(e.target.value)}
                />
              </div>
              <button
                onClick={handleCplPlan}
                disabled={cplPlanLoading || !targetCpl || !targetLeads}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {cplPlanLoading ? 'Hesaplanıyor…' : 'Hesapla'}
              </button>
            </div>
            {cplPlanError && (
              <p className="text-red-400 text-xs">{cplPlanError}</p>
            )}
            {cplPlanResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className={`rounded-xl p-3 text-center border ${cplPlanResult.feasibility?.achievable ? 'bg-emerald-900/15 border-emerald-800/30' : 'bg-red-900/15 border-red-800/30'}`}>
                    <p className="text-[10px] text-slate-400 uppercase">Fizibilite</p>
                    <p className={`text-sm font-bold ${cplPlanResult.feasibility?.achievable ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cplPlanResult.feasibility?.achievable ? 'Ulaşılabilir' : 'Riskli'}
                    </p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{cplPlanResult.feasibility?.label || ''}</p>
                  </div>
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Toplam Bütçe</p>
                    <p className="text-sm font-mono text-slate-100">{fmtMoney(cplPlanResult.total_budget)} ₺</p>
                  </div>
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Proj. Lead</p>
                    <p className="text-sm font-mono text-accent">{fmtN(cplPlanResult.projected_total_leads || 0)}</p>
                  </div>
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Güven</p>
                    <p className="text-sm font-mono text-slate-100">{fmtPct(cplPlanResult.confidence?.score || 0)}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{cplPlanResult.confidence?.basis === 'assumption' ? 'Varsayım bazlı' : 'Veri bazlı'}</p>
                  </div>
                </div>
                {cplPlanResult.channels && Object.keys(cplPlanResult.channels).length > 0 && (
                  <div className="scroll-hint">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-700/50">
                          <th className="text-left py-2 px-2">Kanal</th>
                          <th className="text-right py-2 px-2">DDA Katkı</th>
                          <th className="text-right py-2 px-2">Önerilen Bütçe</th>
                          <th className="text-right py-2 px-2">Bütçe Payı</th>
                          <th className="text-right py-2 px-2">Proj. Lead</th>
                          <th className="text-right py-2 px-2">Proj. CPL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(cplPlanResult.channels)
                          .sort((a, b) => (b[1].allocated_budget || 0) - (a[1].allocated_budget || 0))
                          .map(([ch, info]) => (
                            <tr key={ch} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                              <td className="py-1.5 px-2 text-slate-200 font-medium">{ch}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtPct(info.dda_weight || 0)}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-emerald-300">{fmtMoney(info.allocated_budget || 0)} ₺</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtPct(info.budget_share || 0)}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtN(info.projected_leads || 0)}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                                {info.projected_cpl != null ? `${fmtMoney(info.projected_cpl)} ₺` : '—'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
