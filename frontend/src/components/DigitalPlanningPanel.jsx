import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import { useAttribution } from '../hooks/useAttribution'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'
import { fmtMoney, fmtN } from '../utils/formatters'
import PlanResults from './planning/PlanResults'
import { ONLINE, WEEK_OPTIONS, SCENARIO_PRESETS, parseMediaPlanExcel, distributeSpend, agencyCpm, agencyClicks, withBasis, BASIS_OPTIONS } from './planning/planHelpers'
import ImportedPlanSummary from './planning/ImportedPlanSummary'
import { savedMediaImport, saveMediaImport } from '../utils/session'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler, annotationPlugin)

export default function DigitalPlanningPanel({ campaign }) {
  const {
    simulateMediaPlan, getMediaPlanPresets,
    saveMediaPlan, listSavedMediaPlans, getSavedMediaPlan, deleteSavedMediaPlan,
    getChannelBenchmarks, reconcilePlan,
  } = useAttribution()

  const [selectedChannel, setSelectedChannel] = useState('meta')
  const [numWeeks, setNumWeeks] = useState(12)
  const [weeklySpends, setWeeklySpends] = useState(Array(12).fill(0))
  const [scenario, setScenario] = useState('optimum')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)
  // Spends to apply once a channel switch completes. Switching channels loads that
  // channel's preset spends; an imported or saved plan must win over the preset.
  const pendingSpendsRef = useRef(null)
  // Where the spend inputs came from: {kind: 'preset'|'import'|'saved', label?, edited?}
  const [spendSource, setSpendSource] = useState({ kind: 'preset' })

  // Advanced overrides
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [cpmOverride, setCpmOverride] = useState('')
  const [ctrOverride, setCtrOverride] = useState('')
  const [leadRateOverride, setLeadRateOverride] = useState('')
  // Reach model inputs: the channel defaults are sized for a narrow B2B audience,
  // so broad awareness briefs must set their own universe or reach saturates.
  const [audienceOverride, setAudienceOverride] = useState('')
  const [freqCapOverride, setFreqCapOverride] = useState('')
  // Clicks an imported plan commits to on CPC lines, with the spend they were planned for:
  // { clicks, spend } — scaled with the current total so the implied CPC stays fixed.
  const [plannedClicks, setPlannedClicks] = useState(null)

  // Digital metrics defaults (populated from preset response)
  const [channelDefaults, setChannelDefaults] = useState(null)

  // Excel import state
  const [showImportModal, setShowImportModal] = useState(false)
  // The last imported plan is kept per campaign (sessionStorage), so a tab switch or reload keeps it.
  const [importData, setImportData] = useState(() => savedMediaImport(campaign?.id ?? null)?.data || null)
  const [showImportSummary, setShowImportSummary] = useState(false)
  const [importError, setImportError] = useState('')
  const [importDistribution, setImportDistribution] = useState(
    () => savedMediaImport(campaign?.id ?? null)?.distribution || 'front-loaded')
  const [importMappingOverrides, setImportMappingOverrides] = useState(
    () => savedMediaImport(campaign?.id ?? null)?.overrides || {})
  // Buying model picked per line (rowIndex → 'impressions' | 'clicks' | 'views' | 'none').
  const [importBasisOverrides, setImportBasisOverrides] = useState(
    () => savedMediaImport(campaign?.id ?? null)?.basisOverrides || {})
  const [showImportLines, setShowImportLines] = useState(false)
  const importCampaignRef = useRef(campaign?.id ?? null)
  const fileInputRef = useRef(null)

  // Save/Load state
  const [savedPlans, setSavedPlans] = useState([])
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showSavedList, setShowSavedList] = useState(false)

  // GA4/DDA empirical benchmarks (per campaign) — used to validate plan assumptions
  const [benchmarks, setBenchmarks] = useState(null)

  // Plan reconciliation (plan vs actual)
  const [reconciliation, setReconciliation] = useState(null)
  const [reconLoading, setReconLoading] = useState(false)

  // Load benchmarks when the campaign changes
  useEffect(() => {
    let cancelled = false
    if (!campaign?.id) { setBenchmarks(null); return }
    ;(async () => {
      try {
        const data = await getChannelBenchmarks(campaign.id)
        if (!cancelled) setBenchmarks(data)
      } catch (err) { console.error('[DigitalPlanning] benchmarks:', err); if (!cancelled) setBenchmarks(null) }
    })()
    return () => { cancelled = true }
  }, [campaign?.id, getChannelBenchmarks])

  // Match the selected channel against benchmark keys (CSV: clean keys; BQ: source/medium labels)
  const channelBenchmark = useMemo(() => {
    if (!benchmarks?.available || !benchmarks.channels) return null
    const keys = Object.keys(benchmarks.channels)
    if (keys.includes(selectedChannel)) return benchmarks.channels[selectedChannel]
    const sc = selectedChannel.toLowerCase()
    const hit = keys.find(k => k.toLowerCase().includes(sc))
    return hit ? benchmarks.channels[hit] : null
  }, [benchmarks, selectedChannel])

  // Switching campaigns: bring back that campaign's import (if any), drop the previous one.
  useEffect(() => {
    const id = campaign?.id ?? null
    if (importCampaignRef.current === id) return
    importCampaignRef.current = id
    const saved = savedMediaImport(id)
    setImportData(saved?.data || null)
    setImportMappingOverrides(saved?.overrides || {})
    setImportBasisOverrides(saved?.basisOverrides || {})
    setImportDistribution(saved?.distribution || 'front-loaded')
    setShowImportSummary(false)
  }, [campaign?.id])

  useEffect(() => {
    saveMediaImport(importCampaignRef.current, importData
      ? { data: importData, overrides: importMappingOverrides, basisOverrides: importBasisOverrides, distribution: importDistribution }
      : null)
  }, [importData, importMappingOverrides, importBasisOverrides, importDistribution])

  // Plan lines with the user's per-line picks (channel, buying model) applied.
  const effectiveImportLines = useMemo(() => (importData?.lineItems || []).map(item => {
    const line = importBasisOverrides[item.rowIndex] ? withBasis(item, importBasisOverrides[item.rowIndex]) : item
    const override = importMappingOverrides[item.rowIndex]
    const channel = override !== undefined ? override : (item.mappedChannel || '_unmapped')
    return { ...line, channel: channel || '_unmapped' }
  }), [importData, importMappingOverrides, importBasisOverrides])

  const getEffectiveImportAgg = useCallback(() => {
    const agg = {}
    for (const item of effectiveImportLines) {
      const ch = item.channel
      if (ch === '_unmapped') continue
      if (!agg[ch]) agg[ch] = { totalSpend: 0, totalImp: 0, labels: [], items: [] }
      agg[ch].totalSpend += item.spend
      agg[ch].totalImp += item.impressions
      agg[ch].items.push(item)
      const label = item.label || `${item.mecra}${item.site ? ' / ' + item.site : ''}`
      if (!agg[ch].labels.includes(label)) agg[ch].labels.push(label)
    }
    return agg
  }, [effectiveImportLines])

  // A channel's line from the imported plan, spread over the weeks; null if the plan lacks it.
  const importedSpendsFor = useCallback((channel, weeks) => {
    const agg = getEffectiveImportAgg()
    if (!agg[channel]) return null
    return {
      spends: distributeSpend(agg[channel].totalSpend, weeks, importDistribution),
      cpm: agencyCpm(agg[channel].items),
      clicks: agencyClicks(agg[channel].items),
      source: { kind: 'import' },
    }
  }, [getEffectiveImportAgg, importDistribution])

  // Load presets when channel changes. With an imported plan, its line for the
  // channel wins over the channel's example preset.
  useEffect(() => {
    let cancelled = false
    // { spends, cpm, source } or null
    const pending = pendingSpendsRef.current ?? importedSpendsFor(selectedChannel, numWeeks)
    pendingSpendsRef.current = null
    ;(async () => {
      try {
        const presets = await getMediaPlanPresets(selectedChannel)
        if (cancelled) return
        const spends = presets.preset_spends || []
        const filled = Array(numWeeks).fill(0).map((_, i) => spends[i] || 0)
        setWeeklySpends(pending?.spends ?? filled)
        setSpendSource(pending?.source || { kind: 'preset' })
        // The presets endpoint returns the channel defaults as `metrics`.
        setChannelDefaults(presets.metrics || null)
        setResult(null)
        setCpmOverride('')
        setCtrOverride('')
        setLeadRateOverride('')
        setAudienceOverride('')
        setFreqCapOverride('')
        if (pending?.cpm) setCpmOverride(String(pending.cpm))
        setPlannedClicks(plannedClicksFor(pending))
      } catch (err) {
        console.error('[DigitalPlanning]', err)
        if (!cancelled && pending) { // never drop an imported/saved plan
          setWeeklySpends(pending.spends)
          setSpendSource(pending.source)
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedChannel, getMediaPlanPresets]) // eslint-disable-line react-hooks/exhaustive-deps

  // Adjust array length when numWeeks changes
  useEffect(() => {
    setWeeklySpends(prev => {
      if (prev.length === numWeeks) return prev
      if (numWeeks > prev.length) return [...prev, ...Array(numWeeks - prev.length).fill(0)]
      return prev.slice(0, numWeeks)
    })
  }, [numWeeks])

  // An untouched imported line follows the week count, distribution and mapping.
  useEffect(() => {
    if (spendSource.kind !== 'import' || spendSource.edited) return
    const imp = importedSpendsFor(selectedChannel, numWeeks)
    if (imp) setWeeklySpends(imp.spends)
  }, [numWeeks, importData, importDistribution, importMappingOverrides, importBasisOverrides]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build overrides object
  const buildOverrides = useCallback(() => {
    const ov = {}
    if (cpmOverride !== '' && !isNaN(Number(cpmOverride))) ov.cpm_override = Number(cpmOverride)
    if (ctrOverride !== '' && !isNaN(Number(ctrOverride))) ov.ctr_override = Number(ctrOverride) / 100
    if (leadRateOverride !== '' && !isNaN(Number(leadRateOverride))) ov.lead_rate_override = Number(leadRateOverride) / 100
    if (audienceOverride !== '' && Number(audienceOverride) > 0) ov.target_audience_override = Math.round(Number(audienceOverride))
    if (freqCapOverride !== '' && Number(freqCapOverride) > 0) ov.freq_cap_override = Math.round(Number(freqCapOverride))
    // A CTR typed by the user wins over the plan's clicks.
    if (plannedClicks && !ov.ctr_override) {
      const total = weeklySpends.reduce((a, v) => a + v, 0)
      if (total > 0) ov.planned_clicks = Math.round(plannedClicks.clicks * total / plannedClicks.spend)
    }
    return ov
  }, [cpmOverride, ctrOverride, leadRateOverride, audienceOverride, freqCapOverride, plannedClicks, weeklySpends])

  // Auto-simulate with debounce
  const runSimulation = useCallback(async (spends) => {
    if (!spends.some(s => s > 0)) { setResult(null); return }
    setLoading(true)
    try {
      const res = await simulateMediaPlan(selectedChannel, spends, buildOverrides())
      setResult(res)
    } catch (err) { console.error('[DigitalPlanning]', err) }
    setLoading(false)
  }, [simulateMediaPlan, selectedChannel, buildOverrides])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSimulation(weeklySpends), 500)
    return () => clearTimeout(debounceRef.current)
  }, [weeklySpends, runSimulation])

  const handleSpendChange = (idx, value) => {
    setWeeklySpends(prev => {
      const next = [...prev]
      next[idx] = Math.max(0, Number(value) || 0)
      return next
    })
    setSpendSource(prev => ({ ...prev, edited: true }))
  }

  const applyScenario = (key) => {
    setScenario(key)
    const mult = SCENARIO_PRESETS[key].spend_mult
    setWeeklySpends(prev => prev.map(s => Math.round((s || 500000) * mult / 10000) * 10000))
    setSpendSource(prev => ({ ...prev, edited: true }))
  }

  const loadPresets = async () => {
    try {
      const presets = await getMediaPlanPresets(selectedChannel)
      const spends = presets.preset_spends || []
      setWeeklySpends(Array(numWeeks).fill(0).map((_, i) => spends[i] || 0))
      setSpendSource({ kind: 'preset' })
      setPlannedClicks(null)
    } catch (err) { console.error('[DigitalPlanning]', err) }
  }

  // Re-simulate when overrides change
  useEffect(() => {
    if (!weeklySpends.some(s => s > 0)) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSimulation(weeklySpends), 600)
    return () => clearTimeout(debounceRef.current)
  }, [cpmOverride, ctrOverride, leadRateOverride, audienceOverride, freqCapOverride, plannedClicks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save
  const handleSave = async () => {
    if (!saveName.trim() || !result) return
    try {
      await saveMediaPlan(saveName.trim(), selectedChannel, weeklySpends, result, campaign?.id || null)
      setShowSaveModal(false)
      setSaveName('')
      refreshSavedPlans()
    } catch (err) { console.error('[DigitalPlanning]', err) }
  }

  const refreshSavedPlans = async () => {
    try {
      const plans = await listSavedMediaPlans(campaign?.id || null)
      setSavedPlans(plans)
    } catch (err) { console.error('[DigitalPlanning]', err) }
  }

  // Put a plan's weekly spends on a channel without the channel's preset overwriting them.
  // cpm: the agency's CPM for this plan (from the imported Excel), applied as the CPM override.
  // opts: { cpm, clicks, source } — the agency's CPM and planned clicks from the imported Excel.
  const applySpendsToChannel = (channel, spends, { cpm = null, clicks = null, source = { kind: 'import' } } = {}) => {
    if (channel === selectedChannel) {
      setWeeklySpends(spends)
      setSpendSource(source)
      if (cpm) setCpmOverride(String(cpm))
      setPlannedClicks(plannedClicksFor({ spends, clicks }))
    } else {
      pendingSpendsRef.current = { spends, cpm, clicks, source }
      setSelectedChannel(channel)
    }
  }

  const handleLoadPlan = async (id) => {
    try {
      const plan = await getSavedMediaPlan(id)
      const spends = plan.weekly_spends || []
      setNumWeeks(spends.length)
      applySpendsToChannel(plan.channel, spends, { source: { kind: 'saved', label: plan.name } })
      setShowSavedList(false)
    } catch (err) { console.error('[DigitalPlanning]', err) }
  }

  const handleDeletePlan = async (id) => {
    try {
      await deleteSavedMediaPlan(id)
      refreshSavedPlans()
    } catch (err) { console.error('[DigitalPlanning]', err) }
  }

  const handleReconcile = async (planId) => {
    setReconLoading(true)
    setReconciliation(null)
    try {
      const data = await reconcilePlan(planId)
      setReconciliation(data)
    } catch (err) { console.error('[DigitalPlanning] reconciliation:', err); setReconciliation(null) }
    setReconLoading(false)
  }

  // Excel import handlers
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError('')
    try {
      const parsed = await parseMediaPlanExcel(file)
      setImportData(parsed)
      setImportMappingOverrides({})
      setImportBasisOverrides({})
      setShowImportSummary(false)
      setShowImportModal(true)
    } catch (err) {
      setImportError(err.message || 'Excel parse hatasi')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleImportChannelMapping = (itemIdx, newChannel) => {
    setImportMappingOverrides(prev => ({ ...prev, [itemIdx]: newChannel }))
  }

  const handleImportApply = (channel) => {
    const agg = getEffectiveImportAgg()
    if (!agg[channel]) return
    applySpendsToChannel(channel, distributeSpend(agg[channel].totalSpend, numWeeks, importDistribution),
      { cpm: agencyCpm(agg[channel].items), clicks: agencyClicks(agg[channel].items) })
    setShowImportModal(false) // keep importData: the other channels stay available
  }

  // Every mapped channel at once: opens the multi-channel plan summary.
  const handleImportApplyAll = () => {
    setShowImportModal(false)
    setShowImportSummary(true)
    // Also put a line of the plan in the editor: the current channel if the plan has it, else the first.
    const agg = getEffectiveImportAgg()
    const target = agg[selectedChannel] ? selectedChannel : ONLINE.find(ch => agg[ch])
    const imp = target && importedSpendsFor(target, numWeeks)
    if (imp) applySpendsToChannel(target, imp.spends, imp)
  }

  // Inputs for the multi-channel summary, recomputed only when the import or its mapping changes.
  const importPlan = useMemo(() => {
    if (!importData) return null
    const agg = getEffectiveImportAgg()
    const plan = ONLINE.filter(ch => agg[ch]).map(ch => ({
      channel: ch, totalSpend: agg[ch].totalSpend, cpm: agencyCpm(agg[ch].items),
      clicks: agencyClicks(agg[ch].items), labels: agg[ch].labels,
    }))
    const rest = effectiveImportLines.filter(i => i.channel === '_unmapped')
    return { plan, unmapped: { count: rest.length, total: rest.reduce((a, i) => a + i.spend, 0) } }
  }, [importData, getEffectiveImportAgg, effectiveImportLines])


  // Derived data
  const totalSpend = weeklySpends.reduce((s, v) => s + v, 0)
  const deviationPct = result?.summary?.funnel_vs_mmm_deviation_pct || 0
  const deviationHigh = Math.abs(deviationPct) > 30

  // Half-life
  const halfLife = result?.decay > 0 && result.decay < 1
    ? Math.ceil(Math.log(0.5) / Math.log(result.decay))
    : 0


  return (
    <div className="space-y-5">
      {/* Row 1: Channel selector + Scenario buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {ONLINE.map(ch => (
            <button
              key={ch}
              onClick={() => setSelectedChannel(ch)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedChannel === ch
                  ? 'text-white'
                  : 'bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200'
              }`}
              style={selectedChannel === ch ? { backgroundColor: CHANNEL_COLORS[ch] } : undefined}
            >
              {CHANNEL_LABELS[ch] || ch}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-dark-border mx-1" />

        <div className="flex gap-1.5">
          {Object.entries(SCENARIO_PRESETS).map(([key, s]) => (
            <button
              key={key}
              onClick={() => applyScenario(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                scenario === key
                  ? 'bg-accent/15 border border-accent/40 text-accent'
                  : 'bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Deviation warning banner */}
      {result && deviationHigh && campaign?.objective !== 'traffic' && (
        <div className="px-4 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-300 leading-relaxed">
          <strong>Tutarlılık Uyarısı:</strong> İki tahmin yöntemi %{Math.abs(deviationPct).toFixed(0)} farklı sonuç veriyor.
          {' '}Yanıt modeli (adstock + doygunluk) ile funnel hesabı (CPM/CTR/Lead Rate) farklı varsayımlara dayanır;
          bu fark, varsayımların birbiriyle tutarsız olduğunu gösterir — biri yanlış değil, ikisi aynı gerçeği yansıtmıyor.
          {' '}Gelişmiş ayarlardan CPM/CTR/Lead Rate değerlerini gerçeğe yaklaştırabilirsiniz.
          {' '}Gerçek doğrulama için aşağıdaki GA4 sağlama kartına bakın.
        </div>
      )}

      {showImportSummary && importPlan && (
        <ImportedPlanSummary
          plan={importPlan.plan}
          unmapped={importPlan.unmapped}
          numWeeks={numWeeks}
          distribution={importDistribution}
          title={importData?.campaignName || campaign?.name || 'İçe aktarma'}
          campaignId={campaign?.id || null}
          simulateMediaPlan={simulateMediaPlan}
          saveMediaPlan={saveMediaPlan}
          onOpenChannel={(channel, spends, opts) => applySpendsToChannel(channel, spends, opts)}
          onClose={() => setShowImportSummary(false)}
        />
      )}

      {/* Row 2: Spend Input Card */}
      <div className="dark-card">
        <div className="card-hdr">
          <div>
            <span className="card-title">Haftalık Harcama (TL) · {CHANNEL_LABELS[selectedChannel] || selectedChannel}</span>
            <SpendSourceNote
              source={spendSource}
              importName={importData?.campaignName}
              distribution={importDistribution}
              channelMissingFromImport={!!importData && spendSource.kind === 'preset'}
              plannedClicks={buildOverrides().planned_clicks}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">
              Toplam: {fmtMoney(totalSpend)} TL
            </span>
            <select
              value={numWeeks}
              onChange={e => setNumWeeks(Number(e.target.value))}
              className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-slate-300"
            >
              {WEEK_OPTIONS.map(w => <option key={w} value={w}>{w} hafta</option>)}
            </select>
            <button
              onClick={loadPresets}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              Preset
            </button>
            <button
              onClick={() => { refreshSavedPlans(); setShowSavedList(!showSavedList) }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              Yükle
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 transition-colors"
            >
              Excel İçe Aktar
            </button>
            {importData && !showImportModal && (
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-blue-500/30 text-blue-300 hover:text-blue-200 transition-colors"
              >
                İçe Aktarılan Plan
              </button>
            )}
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
            {result && (
              <button
                onClick={() => setShowSaveModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 transition-colors"
              >
                Kaydet
              </button>
            )}
          </div>
        </div>

        {/* Save Modal */}
        {showSaveModal && (
          <div className="px-4 py-3 bg-dark-bg/50 border-b border-dark-border flex items-center gap-2" role="dialog" aria-label="Simülasyon kaydet">
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSaveModal(false) }}
              placeholder="Simülasyon adı..."
              className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
              autoFocus
              aria-label="Simülasyon adı"
            />
            <button onClick={handleSave} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium">
              Kaydet
            </button>
            <button onClick={() => setShowSaveModal(false)} className="px-3 py-1.5 bg-dark-card border border-dark-border text-slate-400 rounded-lg text-xs">
              İptal
            </button>
          </div>
        )}

        {/* Saved Plans List */}
        {showSavedList && (
          <div className="px-4 py-3 bg-dark-bg/50 border-b border-dark-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Kayıtlı Planlar (Dijital)</p>
            {savedPlans.length === 0 ? (
              <p className="text-xs text-slate-400">Henüz kayıtlı dijital plan yok.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {savedPlans.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-dark-card rounded-lg border border-dark-border group">
                    <button onClick={() => handleLoadPlan(p.id)} className="flex-1 text-left">
                      <span className="text-xs text-slate-200 font-medium">{p.name}</span>
                      <span className="ml-2 text-[10px] text-slate-400 font-mono">{CHANNEL_LABELS[p.channel] || p.channel}</span>
                      <span className="ml-2 text-[10px] text-slate-600">{p.created_at?.slice(0, 10)}</span>
                    </button>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleReconcile(p.id)}
                        disabled={reconLoading}
                        aria-label={`${p.name} planını gerçekleşmeyle doğrula`}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all"
                      >
                        {reconLoading ? '...' : 'Doğrula'}
                      </button>
                      <button
                        onClick={() => handleDeletePlan(p.id)}
                        aria-label={`${p.name} planını sil`}
                        title="Planı sil"
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 px-1 text-slate-400 hover:text-red-400 text-xs transition-all"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Plan vs Actual — Reconciliation Result */}
        {reconciliation && (
          <div className="px-4 py-3 border-b border-dark-border">
            {!reconciliation.available ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-yellow-400">
                  Sağlama verisi yok — bu kampanya için henüz DDA çalıştırılmadı. Attribution sekmesinden DDA çalıştırın.
                </p>
                <button onClick={() => setReconciliation(null)} className="text-slate-400 text-xs ml-2">x</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-200">
                      Plan vs Gerçekleşme — {CHANNEL_LABELS[reconciliation.channel] || reconciliation.channel}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      DDA verisi: {reconciliation.run_date ? new Date(reconciliation.run_date).toLocaleDateString('tr-TR') : ''}
                      {reconciliation.matched_dda_channel && reconciliation.matched_dda_channel !== reconciliation.channel && (
                        <span className="ml-1 text-slate-600">({reconciliation.matched_dda_channel})</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => setReconciliation(null)} className="text-slate-400 hover:text-slate-300 text-xs">x</button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Planned */}
                  <div className="bg-dark-bg/50 rounded-lg p-3 border border-dark-border">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Planlanan</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Harcama</span>
                        <span className="font-mono text-slate-200">{fmtMoney(reconciliation.planned.total_spend)} TL</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Lead (Model)</span>
                        <span className="font-mono text-slate-200">{Math.round(reconciliation.planned.total_leads_mmm)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Lead (Funnel)</span>
                        <span className="font-mono text-slate-200">{Math.round(reconciliation.planned.total_leads_funnel)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">CPL</span>
                        <span className="font-mono text-slate-200">{fmtMoney(reconciliation.planned.cpl)} TL</span>
                      </div>
                    </div>
                  </div>

                  {/* Actual (DDA) */}
                  <div className="bg-dark-bg/50 rounded-lg p-3 border border-emerald-500/20">
                    <p className="text-[10px] text-emerald-400 uppercase tracking-wide mb-2">GA4 Gerçekleşme (DDA)</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Toplam Dönüşüm</span>
                        <span className="font-mono text-emerald-400">{Math.round(reconciliation.actual.total_conversions)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">DDA Atfi</span>
                        <span className="font-mono text-emerald-400">%{(reconciliation.actual.dda_weight * 100).toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Atfedilen Lead</span>
                        <span className="font-mono text-emerald-400">{Math.round(reconciliation.actual.attributed_conversions)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Empirik CPL</span>
                        <span className="font-mono text-emerald-400">
                          {reconciliation.actual.empirical_cpl != null ? `${fmtMoney(reconciliation.actual.empirical_cpl)} TL` : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Deviation summary */}
                <div className={`p-3 rounded-lg border text-xs ${
                  reconciliation.deviations.lead_deviation_pct != null && Math.abs(reconciliation.deviations.lead_deviation_pct) > 25
                    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                }`}>
                  <div className="flex items-center gap-3 mb-1">
                    {reconciliation.deviations.lead_deviation_pct != null && (
                      <span className="font-mono">Lead: {reconciliation.deviations.lead_deviation_pct > 0 ? '+' : ''}{reconciliation.deviations.lead_deviation_pct}%</span>
                    )}
                    {reconciliation.deviations.cpl_deviation_pct != null && (
                      <span className="font-mono">CPL: {reconciliation.deviations.cpl_deviation_pct > 0 ? '+' : ''}{reconciliation.deviations.cpl_deviation_pct}%</span>
                    )}
                  </div>
                  <p>{reconciliation.deviations.verdict}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Import error */}
        {importError && (
          <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/30 flex items-center justify-between">
            <p className="text-xs text-red-400">{importError}</p>
            <button onClick={() => setImportError('')} className="text-red-400 text-xs ml-2">x</button>
          </div>
        )}

        {/* Import Modal */}
        {showImportModal && importData && (() => {
          const agg = getEffectiveImportAgg()
          const mappedChannels = ONLINE.filter(ch => agg[ch])
          const unmappedItems = effectiveImportLines.filter(item => item.channel === '_unmapped')
          const totalMapped = mappedChannels.reduce((s, ch) => s + (agg[ch]?.totalSpend || 0), 0)

          return (
            <div className="px-4 py-4 bg-dark-bg/80 border-b border-dark-border space-y-4" role="dialog" aria-label="Plan içe aktarma">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    Plan İçe Aktarma
                    {importData.brand && <span className="text-slate-400 ml-2">| {importData.brand}</span>}
                    {importData.campaignName && <span className="text-accent ml-1">{importData.campaignName}</span>}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {importData.lineItems.length} satır okundu | Toplam eşleşen: {fmtMoney(totalMapped)} TL
                  </p>
                  {importData.skippedTotals?.length > 0 && (
                    <p className="text-[10px] text-slate-500 mt-0.5" data-testid="skipped-totals">
                      Toplam/ara toplam satırı olarak atlandı: {importData.skippedTotals.map(t => `${t.label} (${fmtMoney(t.spend)} TL)`).join(', ')}
                    </p>
                  )}
                </div>
                <button onClick={() => { setShowImportModal(false); setImportData(null) }}
                  className="text-slate-400 hover:text-slate-300 text-lg" aria-label="Kapat">x</button>
              </div>

              {/* Distribution mode */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">Dağıtım:</span>
                {[
                  { id: 'front-loaded', label: 'Ön Ağırlıklı' },
                  { id: 'even', label: 'Eşit' },
                ].map(d => (
                  <button
                    key={d.id}
                    onClick={() => setImportDistribution(d.id)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      importDistribution === d.id
                        ? 'bg-accent/15 text-accent border border-accent/40'
                        : 'bg-dark-card border border-dark-border text-slate-400'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
                <span className="text-[10px] text-slate-400">| {numWeeks} haftaya dagilir</span>
              </div>

              {/* Mapped channels */}
              {mappedChannels.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Eşleşen Kanallar</p>
                  {mappedChannels.map(ch => (
                    <div key={ch} className="flex items-center justify-between px-3 py-2.5 bg-dark-card rounded-lg border border-dark-border group">
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch] }} />
                        <div>
                          <span className="text-xs font-medium text-slate-200">{CHANNEL_LABELS[ch]}</span>
                          <span className="ml-2 text-[10px] text-slate-400">{agg[ch].labels.join(', ')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate-300">{fmtMoney(agg[ch].totalSpend)} TL</span>
                        {agg[ch].totalImp > 0 && (
                          <span className="text-[10px] font-mono text-slate-400">{fmtN(agg[ch].totalImp)} imp</span>
                        )}
                        <button
                          onClick={() => handleImportApply(ch)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                        >
                          Uygula
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Unmapped items */}
              {unmappedItems.length > 0 && (
                <p className="text-[11px] text-amber-300">
                  Eşlenmeyen Satırlar: {unmappedItems.length} satır ({fmtMoney(unmappedItems.reduce((a, i) => a + i.spend, 0))} TL) — aşağıdaki satır listesinden kanal seçin.
                </p>
              )}

              {/* Every plan line: channel and buying model can be picked per line */}
              <div className="space-y-1.5">
                <button
                  onClick={() => setShowImportLines(v => !v)}
                  className="text-[10px] text-slate-400 uppercase tracking-wide hover:text-slate-200"
                  aria-expanded={showImportLines || unmappedItems.length > 0}
                >
                  Satırlar ({importData.lineItems.length}) — kanal ve alım modeli {showImportLines || unmappedItems.length > 0 ? '▾' : '▸'}
                </button>
                {(showImportLines || unmappedItems.length > 0) && (
                  <div className="scroll-hint">
                    <table className="w-full text-[11px] min-w-[760px]" aria-label="Plan satırları">
                      <thead>
                        <tr className="text-slate-500 border-b border-dark-border">
                          <th className="text-left py-1.5 px-2 font-normal">Satır</th>
                          <th className="text-right py-1.5 px-2 font-normal">Bütçe</th>
                          <th className="text-right py-1.5 px-2 font-normal">Birim maliyet</th>
                          <th className="text-right py-1.5 px-2 font-normal">Planlanan</th>
                          <th className="text-left py-1.5 px-2 font-normal">Alım modeli</th>
                          <th className="text-left py-1.5 px-2 font-normal">Kanal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveImportLines.map(item => {
                          const picked = importBasisOverrides[item.rowIndex] !== undefined
                          const label = item.label || `${item.mecra}${item.site ? ' / ' + item.site : ''}`
                          return (
                            <tr key={item.rowIndex} className={`border-b border-dark-border/40 ${item.channel === '_unmapped' ? 'bg-amber-500/5' : ''}`}>
                              <td className="py-1.5 px-2 text-slate-300">{label}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtMoney(item.spend)}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-400">{item.unit ? fmtUnit(item.unit) : '—'}</td>
                              <td className="py-1.5 px-2 text-right font-mono text-slate-400">{item.qty ? fmtN(item.qty) : '—'}</td>
                              <td className="py-1.5 px-2">
                                <select
                                  value={item.basis || 'none'}
                                  onChange={e => setImportBasisOverrides(prev => ({ ...prev, [item.rowIndex]: e.target.value }))}
                                  aria-label={`${label} alım modeli`}
                                  className="bg-dark-bg border border-dark-border rounded-lg px-1.5 py-0.5 text-[11px] text-slate-300"
                                >
                                  {BASIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                {!picked && <span className="ml-1 text-[9px] text-slate-500" title="Bütçe ÷ miktar ile birim maliyetten otomatik bulundu">oto</span>}
                              </td>
                              <td className="py-1.5 px-2">
                                <select
                                  value={item.channel}
                                  onChange={e => handleImportChannelMapping(item.rowIndex, e.target.value)}
                                  aria-label={`${label} kanal`}
                                  className="bg-dark-bg border border-dark-border rounded-lg px-1.5 py-0.5 text-[11px] text-slate-300"
                                >
                                  <option value="_unmapped">Eşle...</option>
                                  {ONLINE.map(ch => <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>)}
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Apply all button */}
              {mappedChannels.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-dark-border">
                  <p className="text-[10px] text-slate-400">
                    "Uygula" tek kanalı düzenleyiciye alır; içe aktarılan plan kaybolmaz.
                  </p>
                  <button
                    onClick={handleImportApplyAll}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
                  >
                    Tüm kanalları uygula ({mappedChannels.length})
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        <div className="p-4">
          {/* Spend inputs grid */}
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 gap-2">
            {weeklySpends.map((s, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <label className="text-[10px] text-slate-400 text-center font-mono">W{i + 1}</label>
                <input
                  type="number"
                  value={s || ''}
                  onChange={e => handleSpendChange(i, e.target.value)}
                  placeholder="0"
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 text-center focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            ))}
          </div>

          {/* Parameters */}
          {result && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-400 font-mono">
              <span>{'λ'} = {result.decay}</span>
              <span>{'α'} = {typeof result.alpha === 'number' ? fmtMoney(result.alpha) : result.alpha}</span>
              <span>{'γ'} = {result.gamma}</span>
              <span>Half-life = {halfLife} hafta</span>
              {campaign?.objective !== 'traffic' && <span>Max Lift = {result.max_lift} lead/hafta</span>}
            </div>
          )}

          {/* Advanced overrides */}
          <div className="mt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-slate-400 hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              Gelişmiş Ayarlar {showAdvanced ? '▴' : '▾'}
            </button>
            {showAdvanced && (
              <div className="mt-2 p-3 bg-dark-bg/50 rounded-lg border border-dark-border">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">CPM (TL)</label>
                    <input
                      type="number"
                      value={cpmOverride}
                      onChange={e => setCpmOverride(e.target.value)}
                      placeholder={channelDefaults?.cpm?.toString() || '80'}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">CTR (%)</label>
                    <input
                      type="number"
                      value={ctrOverride}
                      onChange={e => setCtrOverride(e.target.value)}
                      placeholder={channelDefaults?.ctr ? (channelDefaults.ctr * 100).toFixed(1) : '1.8'}
                      step="0.1"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Lead Rate (%)</label>
                    <input
                      type="number"
                      value={leadRateOverride}
                      onChange={e => setLeadRateOverride(e.target.value)}
                      placeholder={channelDefaults?.lead_rate ? (channelDefaults.lead_rate * 100).toFixed(2) : '0.15'}
                      step="0.01"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="audience-override" className="text-[10px] text-slate-400 block mb-1">Hedef Kitle (kişi)</label>
                    <input
                      id="audience-override"
                      type="number"
                      value={audienceOverride}
                      onChange={e => setAudienceOverride(e.target.value)}
                      placeholder={channelDefaults?.target_audience?.toString() || '4000000'}
                      step="100000"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="freqcap-override" className="text-[10px] text-slate-400 block mb-1">Frekans Sınırı</label>
                    <input
                      id="freqcap-override"
                      type="number"
                      value={freqCapOverride}
                      onChange={e => setFreqCapOverride(e.target.value)}
                      placeholder={channelDefaults?.freq_cap?.toString() || '5'}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[10px] text-slate-600">
                    Boş bırakılan alanlar varsayılan kanal değerlerini kullanır. Geniş kitleli (bilinirlik) kampanyalarda hedef kitleyi girin; aksi halde erişim tavana vurur.
                  </p>
                  <button
                    onClick={() => { setCpmOverride(''); setCtrOverride(''); setLeadRateOverride(''); setAudienceOverride(''); setFreqCapOverride('') }}
                    className="text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    Sıfırla
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {result && <PlanResults result={result} campaign={campaign} benchmarks={benchmarks} channelBenchmark={channelBenchmark} selectedChannel={selectedChannel} numWeeks={numWeeks} weeklySpends={weeklySpends} />}

      {/* Loading indicator */}
      {loading && !result && (
        <div className="text-center py-12 text-slate-400 text-sm">Simülasyon çalışıyor...</div>
      )}

      {/* Empty state */}
      {!loading && !result && (
        <div className="text-center py-12 text-slate-400 text-sm">
          Haftalık harcama değerlerini girerek simülasyonu başlatın.
        </div>
      )}
    </div>
  )
}

/** One line under the spend card title saying where the weekly spends came from. */
function SpendSourceNote({ source, importName, distribution, channelMissingFromImport, plannedClicks }) {
  const edited = source.edited ? ' · elle düzenlendi' : ''
  if (source.kind === 'import') {
    return (
      <p className="text-[10px] text-blue-300 mt-0.5" data-testid="spend-source">
        Kaynak: içe aktarılan plan{importName ? ` (${importName})` : ''} · {distribution === 'even' ? 'eşit' : 'ön ağırlıklı'} dağıtım
        {plannedClicks ? ` · planlanan tıklama ${fmtN(plannedClicks)} (Excel, CTR buna göre)` : ''}{edited}
      </p>
    )
  }
  if (source.kind === 'saved') {
    return <p className="text-[10px] text-slate-400 mt-0.5" data-testid="spend-source">Kaynak: kayıtlı plan “{source.label}”{edited}</p>
  }
  return (
    <p className="text-[10px] text-amber-300 mt-0.5" data-testid="spend-source">
      Kaynak: kanalın örnek preset'i — bu kampanyanın planı değil
      {channelMissingFromImport && ' (içe aktarılan planda bu kanal yok)'}{edited}
    </p>
  )
}

/** Planned clicks of an imported line, tied to the spend they were planned for. */
function plannedClicksFor(pending) {
  const spend = (pending?.spends || []).reduce((a, v) => a + v, 0)
  return pending?.clicks && spend > 0 ? { clicks: pending.clicks, spend } : null
}

/** Unit costs run from 0.09 TL (push) to hundreds (CPM): keep the decimals that matter. */
function fmtUnit(v) {
  return v >= 100 ? fmtMoney(v) : v.toLocaleString('tr-TR', { maximumFractionDigits: v < 1 ? 3 : 2 })
}
