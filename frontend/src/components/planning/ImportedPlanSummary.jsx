import { useState, useEffect } from 'react'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../../utils/colors'
import { fmtMoney, fmtN } from '../../utils/formatters'
import { distributeSpend, PLACEHOLDER_CHANNELS } from './planHelpers'

// An agency CPM this far from the channel default usually means the Excel column
// the CPM was derived from holds clicks or video views rather than impressions.
const CPM_CHECK_RATIO = 4

const cellInput = 'w-28 bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-[11px] font-mono text-slate-100 text-right focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

/**
 * Every channel of an imported media plan side by side: each line is simulated
 * with the agency's CPM from the Excel (when present) and an optional audience,
 * then shown with totals, and can be saved as one plan per channel.
 *
 * plan: [{ channel, totalSpend, cpm, clicks, labels }]: agency CPM / planned CPC clicks, or null
 */
export default function ImportedPlanSummary({
  plan, unmapped, numWeeks, distribution, title, campaignId,
  simulateMediaPlan, saveMediaPlan, onOpenChannel, onClose,
}) {
  const [audiences, setAudiences] = useState({})
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')

  const spendsFor = row => distributeSpend(row.totalSpend, numWeeks, distribution)
  const overridesFor = row => {
    const ov = {}
    if (row.cpm) ov.cpm_override = row.cpm
    if (row.clicks) ov.planned_clicks = row.clicks
    const aud = Number(audiences[row.channel])
    if (aud > 0) ov.target_audience_override = Math.round(aud)
    return ov
  }

  // Re-simulate every channel when the plan, weeks, distribution or an audience changes.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const entries = await Promise.all(plan.map(async row =>
          [row.channel, await simulateMediaPlan(row.channel, spendsFor(row), overridesFor(row))]))
        if (!cancelled) { setResults(Object.fromEntries(entries)); setError('') }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.detail || 'Plan simüle edilemedi')
      }
      if (!cancelled) setLoading(false)
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [plan, numWeeks, distribution, audiences]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSaveState('') }, [plan, numWeeks, distribution, audiences])

  const rows = plan.map(row => {
    const r = results[row.channel]
    const s = r?.summary || {}
    const fc = r?.funnel_curve || []
    return {
      ...row,
      result: r,
      impressions: s.total_impressions,
      clicks: s.total_clicks,
      plannedClicks: row.clicks,
      cpmUsed: s.avg_cpm,
      cpc: s.avg_cpc,
      reach: fc.length ? fc[fc.length - 1].reach_pct : null,
      assumed: r?.assumed_metrics,
      cpmSuspect: cpmSuspect(row.cpm, r?.default_metrics?.cpm, row.channel),
    }
  })
  const totalSpend = rows.reduce((a, r) => a + r.totalSpend, 0)
  const totalImp = rows.reduce((a, r) => a + (r.impressions || 0), 0)
  const totalClicks = rows.reduce((a, r) => a + (r.clicks || 0), 0)
  const anyAssumed = rows.some(r => r.assumed)
  const suspects = rows.filter(r => r.cpmSuspect)

  const saveAll = async () => {
    setSaveState('saving')
    try {
      for (const row of rows) {
        if (!row.result) continue
        await saveMediaPlan(`${title} – ${CHANNEL_LABELS[row.channel] || row.channel}`,
          row.channel, spendsFor(row), row.result, campaignId)
      }
      setSaveState('saved')
    } catch (err) {
      setSaveState(err.response?.data?.detail || 'Kayıt başarısız')
    }
  }

  const downloadCsv = () => {
    const header = ['Kanal', 'Bütçe (TL)', 'CPM (TL)', 'CPM kaynağı', 'Gösterim', 'Tıklama', 'CPC (TL)', 'Erişim son hafta (%)', 'Hedef kitle']
    const lines = rows.map(r => [
      CHANNEL_LABELS[r.channel] || r.channel, r.totalSpend, r.cpmUsed ?? '', cpmSource(r),
      Math.round(r.impressions || 0), Math.round(r.clicks || 0), r.cpc ?? '',
      r.reach != null ? r.reach.toFixed(1) : '', audiences[r.channel] || 'varsayılan',
    ])
    lines.push(['TOPLAM', totalSpend, totalImp ? (totalSpend / totalImp * 1000).toFixed(2) : '', '',
      Math.round(totalImp), Math.round(totalClicks), totalClicks ? (totalSpend / totalClicks).toFixed(2) : '', '', ''])
    if (unmapped.count) lines.push([`Eşlenmemiş (${unmapped.count} satır, plana dahil değil)`, unmapped.total, '', '', '', '', '', '', ''])
    const csv = [header, ...lines].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '_')}_dijital_plan_ozeti.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="dark-card" role="region" aria-label="İçe aktarılan plan özeti">
      <div className="card-hdr">
        <div>
          <span className="card-title">İçe Aktarılan Plan Özeti</span>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {title} · {plan.length} kanal · {numWeeks} hafta · {distribution === 'even' ? 'Eşit' : 'Ön Ağırlıklı'} dağıtım
            {loading && ' · hesaplanıyor…'}
          </p>
        </div>
        <button onClick={onClose} aria-label="Özeti kapat" className="text-slate-400 hover:text-slate-200 text-lg">×</button>
      </div>
      <div className="p-4 space-y-3">
        {error && <p className="text-xs text-red-400">{error}</p>}
        {anyAssumed && (
          <p className="text-[11px] text-amber-300 bg-amber-900/15 border border-amber-800/30 rounded-lg px-3 py-2">
            ⚠ İşaretli kanallarda CPM/CTR/kitle değerleri <strong>yer tutucu</strong>dur (piyasa verisi değil).
            Excel'e o satırlar için CPM ya da planlanan gösterim sütunu ekleyin; ajans değeri kullanılır.
          </p>
        )}
        {suspects.length > 0 && (
          <p className="text-[11px] text-amber-300 bg-amber-900/15 border border-amber-800/30 rounded-lg px-3 py-2" data-testid="cpm-check">
            ⚠ <strong>{suspects.map(r => `${CHANNEL_LABELS[r.channel] || r.channel} (${fmtMoney(r.cpmUsed)} TL; varsayılan ${fmtMoney(r.result?.default_metrics?.cpm)} TL)`).join(', ')}</strong>:
            Excel'den çıkan CPM kanal varsayılanından çok farklı. Ajans fiyatı buysa sorun yok; değilse satırın birimini
            kontrol edin (miktar tıklama/izlenme, birim maliyet CPC/CPV olabilir). Tıklama ve izlenme satırları CPM hesabına
            katılmaz; kanalın tüm bütçesi gösterim satırlarının CPM'iyle gösterime çevrilir.
          </p>
        )}
        <div className="scroll-hint">
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="border-b border-dark-border text-slate-400">
                <th className="text-left py-2 px-2">Kanal</th>
                <th className="text-right py-2 px-2">Bütçe</th>
                <th className="text-right py-2 px-2">CPM</th>
                <th className="text-right py-2 px-2">Gösterim</th>
                <th className="text-right py-2 px-2">Tıklama</th>
                <th className="text-right py-2 px-2">CPC</th>
                <th className="text-right py-2 px-2">Erişim (son hafta)</th>
                <th className="text-right py-2 px-2">Hedef kitle (kişi)</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.channel} className="border-b border-dark-border/50">
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[r.channel] }} />
                      <span className="text-slate-200">{CHANNEL_LABELS[r.channel] || r.channel}</span>
                      {r.assumed && <span className="text-[9px] px-1.5 rounded bg-amber-500/15 text-amber-400" title="Yer tutucu parametre">yer tutucu</span>}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-100">{fmtMoney(r.totalSpend)}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300" title={cpmSource(r)}>
                    {r.cpmUsed != null ? fmtMoney(r.cpmUsed) : '—'}
                    <span className="ml-1 text-[9px] text-slate-500">{r.cpm ? 'Excel' : 'vars.'}</span>
                    {r.cpmSuspect && (
                      <span className="ml-1 text-[9px] px-1 rounded bg-amber-500/15 text-amber-400"
                        title={`Kanal varsayılanı ${fmtMoney(r.result?.default_metrics?.cpm)} TL`}>kontrol et</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtN(r.impressions)}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">
                    {fmtN(r.clicks)}
                    {r.plannedClicks && <span className="ml-1 text-[9px] text-slate-500" title="CPC satırlarındaki planlanan tıklama">Excel</span>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">{r.cpc != null ? fmtMoney(r.cpc) : '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-accent">{r.reach != null ? `%${r.reach.toFixed(1)}` : '—'}</td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      aria-label={`${CHANNEL_LABELS[r.channel] || r.channel} hedef kitle`}
                      value={audiences[r.channel] ?? ''}
                      onChange={e => setAudiences(prev => ({ ...prev, [r.channel]: e.target.value }))}
                      placeholder={r.result?.digital_metrics?.target_audience ? String(r.result.digital_metrics.target_audience) : 'varsayılan'}
                      className={cellInput}
                    />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button
                      onClick={() => onOpenChannel(r.channel, spendsFor(r), { cpm: r.cpm, clicks: r.plannedClicks })}
                      className="px-2 py-0.5 rounded text-[10px] text-slate-300 bg-dark-bg border border-dark-border hover:text-slate-100"
                    >
                      Detay
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-slate-100">
                <td className="py-2 px-2">Toplam</td>
                <td className="py-2 px-2 text-right font-mono">{fmtMoney(totalSpend)}</td>
                <td className="py-2 px-2 text-right font-mono">{totalImp ? fmtMoney(totalSpend / totalImp * 1000) : '—'}</td>
                <td className="py-2 px-2 text-right font-mono">{fmtN(totalImp)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmtN(totalClicks)}</td>
                <td className="py-2 px-2 text-right font-mono">{totalClicks ? fmtMoney(totalSpend / totalClicks) : '—'}</td>
                <td className="py-2 px-2 text-right text-[10px] font-normal text-slate-500" title="Aynı kişi birden çok mecrada görülebilir; tekil erişim kanallar arasında toplanamaz.">toplanamaz</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        {unmapped.count > 0 && (
          <p className="text-[11px] text-slate-400">
            {unmapped.count} satır ({fmtMoney(unmapped.total)} TL) bir kanala eşlenmedi ve bu özete dahil değil.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={saveAll}
            disabled={loading || saveState === 'saving' || !rows.every(r => r.result)}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
          >
            {saveState === 'saving' ? 'Kaydediliyor…' : `Tüm kanalları kaydet (${rows.length})`}
          </button>
          <button onClick={downloadCsv} disabled={loading} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-300 hover:text-slate-100 disabled:opacity-40">
            Özeti CSV İndir
          </button>
          {saveState === 'saved' && <span className="text-xs text-emerald-400">{rows.length} plan kaydedildi — "Yükle" listesinde.</span>}
          {saveState && !['saving', 'saved'].includes(saveState) && <span className="text-xs text-red-400">{saveState}</span>}
        </div>
      </div>
    </div>
  )
}

function cpmSuspect(cpm, defaultCpm, channel) {
  // Placeholder channels have no real default to compare against.
  if (!cpm || !defaultCpm || PLACEHOLDER_CHANNELS.has(channel)) return false
  return cpm > defaultCpm * CPM_CHECK_RATIO || cpm < defaultCpm / CPM_CHECK_RATIO
}

function cpmSource(r) {
  if (r.cpm) return 'Excel (ajans CPM / planlanan gösterim)'
  return r.assumed ? 'Yer tutucu varsayılan' : 'Kanal varsayılanı'
}
