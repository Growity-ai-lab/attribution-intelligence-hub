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
import { Line, Bar } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import * as XLSX from 'xlsx'
import { useAttribution } from '../hooks/useAttribution'
import { CHANNEL_LABELS, CHANNEL_COLORS } from '../utils/colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler, annotationPlugin)

const ONLINE = ['meta', 'google', 'tiktok', 'linkedin', 'dv360', 'youtube']
const WEEK_OPTIONS = [4, 8, 12, 16, 20, 24]

const SCENARIO_PRESETS = {
  minimum: { label: 'Minimum', icon: '↓', spend_mult: 0.5 },
  optimum: { label: 'Optimum', icon: '◎', spend_mult: 1.0 },
  maksimum: { label: 'Maksimum', icon: '↑', spend_mult: 1.5 },
}

// Channel auto-mapping keywords (lowercase matching against Mecra + Site/Network)
const CHANNEL_MAP_KEYWORDS = {
  youtube: ['youtube', 'yt'],
  google: ['google ads', 'google search', 'sem', 'search ads'],
  meta: ['meta', 'facebook', 'instagram', 'fb ', 'ig '],
  tiktok: ['tiktok', 'tik tok'],
  linkedin: ['linkedin'],
  dv360: ['dv360', 'dv 360', 'programatik', 'programmatic', 'preroll', 'display&video'],
}

// Header column detection keywords (Turkish media plan conventions)
const SPEND_COL_KEYWORDS = ['net yayin bedeli', 'net yayın bedeli', 'butce', 'bütçe', 'her sey dahil', 'her şey dahil', 'toplam maliyet', 'total cost', 'spend', 'harcama', 'net yayın bedeli']
const MECRA_COL_KEYWORDS = ['mecra', 'media', 'kanal', 'channel']
const SITE_COL_KEYWORDS = ['site', 'network', 'site/network', 'platform']
const IMP_COL_KEYWORDS = ['planlanan', 'impression', 'imp', 'goruntulenme', 'görüntülenme']
const CPM_COL_KEYWORDS = ['cpm', 'birim maliyet', 'birim fiyat', 'unit cost']
const DURATION_COL_KEYWORDS = ['sure', 'süre', 'duration', 'gun', 'gün']

function findColIndex(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (keywords.some(kw => h.includes(kw))) return i
  }
  return -1
}

function autoMapChannel(mecra, site) {
  const combined = `${mecra} ${site}`.toLowerCase()
  for (const [ch, keywords] of Object.entries(CHANNEL_MAP_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) return ch
  }
  return null
}

function parseMediaPlanExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // Find header row (look for "Mecra" or "Platform")
        let headerIdx = -1
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const row = rows[i].map(c => String(c).toLowerCase())
          if (row.some(c => MECRA_COL_KEYWORDS.some(kw => c.includes(kw)))) {
            headerIdx = i
            break
          }
        }
        if (headerIdx === -1) {
          reject(new Error('Başlık satırı bulunamadı. "Mecra" veya "Platform" sütunu gerekli.'))
          return
        }

        const headers = rows[headerIdx].map(c => String(c))
        const mecraIdx = findColIndex(headers, MECRA_COL_KEYWORDS)
        const siteIdx = findColIndex(headers, SITE_COL_KEYWORDS)
        const spendIdx = findColIndex(headers, SPEND_COL_KEYWORDS)
        const impIdx = findColIndex(headers, IMP_COL_KEYWORDS)
        const cpmIdx = findColIndex(headers, CPM_COL_KEYWORDS)
        const durationIdx = findColIndex(headers, DURATION_COL_KEYWORDS)

        if (spendIdx === -1) {
          reject(new Error('Bütçe/spend sütunu bulunamadı. "Net Yayın Bedeli" veya "Bütçe" sütunu gerekli.'))
          return
        }

        // Parse data rows
        const lineItems = []
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i]
          const mecra = String(row[mecraIdx] || '').trim()
          const site = siteIdx >= 0 ? String(row[siteIdx] || '').trim() : ''
          const spendRaw = row[spendIdx]
          const spend = typeof spendRaw === 'number' ? spendRaw : parseFloat(String(spendRaw).replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0

          if (!mecra && !site) continue
          if (spend <= 0) continue

          const imp = impIdx >= 0 ? (typeof row[impIdx] === 'number' ? row[impIdx] : parseFloat(String(row[impIdx]).replace(/[^\d]/g, '')) || 0) : 0
          const cpm = cpmIdx >= 0 ? (typeof row[cpmIdx] === 'number' ? row[cpmIdx] : parseFloat(String(row[cpmIdx]).replace(/[^\d.,]/g, '').replace(',', '.')) || 0) : 0
          const duration = durationIdx >= 0 ? String(row[durationIdx] || '') : ''

          const mapped = autoMapChannel(mecra, site)
          lineItems.push({ mecra, site, spend, impressions: imp, cpm, duration, mappedChannel: mapped, rowIndex: i })
        }

        // Extract campaign info from header area
        let campaignName = ''
        let brand = ''
        for (let i = 0; i < headerIdx; i++) {
          const row = rows[i].map(c => String(c).toLowerCase())
          const vals = rows[i].map(c => String(c).trim())
          for (let j = 0; j < row.length; j++) {
            if (row[j].includes('marka')) brand = vals[j + 1] || vals[j + 2] || ''
            if (row[j].includes('kampanya') && row[j].includes('ad')) campaignName = vals[j + 1] || vals[j + 2] || ''
          }
        }

        // Aggregate by mapped channel
        const channelAgg = {}
        for (const item of lineItems) {
          const ch = item.mappedChannel || '_unmapped'
          if (!channelAgg[ch]) channelAgg[ch] = { totalSpend: 0, totalImp: 0, items: [], labels: [] }
          channelAgg[ch].totalSpend += item.spend
          channelAgg[ch].totalImp += item.impressions
          channelAgg[ch].items.push(item)
          const label = `${item.mecra}${item.site ? ' / ' + item.site : ''}`
          if (!channelAgg[ch].labels.includes(label)) channelAgg[ch].labels.push(label)
        }

        resolve({ lineItems, channelAgg, campaignName, brand, headers: headers.map(String) })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Dosya okunamadi'))
    reader.readAsArrayBuffer(file)
  })
}

function distributeSpend(totalSpend, numWeeks, mode = 'front-loaded') {
  if (mode === 'even') {
    const weekly = Math.round(totalSpend / numWeeks / 1000) * 1000
    return Array(numWeeks).fill(weekly)
  }
  // Front-loaded: first week gets ~1.4x avg, linearly decreasing
  const weights = Array.from({ length: numWeeks }, (_, i) => numWeeks - i * 0.6)
  const totalW = weights.reduce((a, b) => a + b, 0)
  return weights.map(w => Math.round((w / totalW) * totalSpend / 1000) * 1000)
}

const fmtN = v => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)
const fmtMoney = v => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}

export default function DigitalPlanningPanel({ campaign }) {
  const {
    simulateDigitalPlan, getMediaPlanPresets,
    saveMediaPlan, listSavedMediaPlans, getSavedMediaPlan, deleteSavedMediaPlan,
    getChannelBenchmarks, reconcilePlan,
  } = useAttribution()

  const [selectedChannel, setSelectedChannel] = useState('meta')
  const [numWeeks, setNumWeeks] = useState(12)
  const [weeklySpends, setWeeklySpends] = useState(Array(12).fill(0))
  const [scenario, setScenario] = useState('optimum')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeChartTab, setActiveChartTab] = useState('funnel')
  const debounceRef = useRef(null)

  // Advanced overrides
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [cpmOverride, setCpmOverride] = useState('')
  const [ctrOverride, setCtrOverride] = useState('')
  const [leadRateOverride, setLeadRateOverride] = useState('')

  // Digital metrics defaults (populated from preset response)
  const [channelDefaults, setChannelDefaults] = useState(null)

  // Excel import state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importData, setImportData] = useState(null)
  const [importError, setImportError] = useState('')
  const [importDistribution, setImportDistribution] = useState('front-loaded')
  const [importMappingOverrides, setImportMappingOverrides] = useState({})
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
      } catch { if (!cancelled) setBenchmarks(null) }
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

  // Load presets when channel changes
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const presets = await getMediaPlanPresets(selectedChannel, 'digital')
        if (cancelled) return
        const spends = presets.preset_grps || []
        const filled = Array(numWeeks).fill(0).map((_, i) => spends[i] || 0)
        setWeeklySpends(filled)
        if (presets.digital_metrics) setChannelDefaults(presets.digital_metrics)
        setResult(null)
        setCpmOverride('')
        setCtrOverride('')
        setLeadRateOverride('')
      } catch { /* ignore */ }
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

  // Build overrides object
  const buildOverrides = useCallback(() => {
    const ov = {}
    if (cpmOverride !== '' && !isNaN(Number(cpmOverride))) ov.cpm_override = Number(cpmOverride)
    if (ctrOverride !== '' && !isNaN(Number(ctrOverride))) ov.ctr_override = Number(ctrOverride) / 100
    if (leadRateOverride !== '' && !isNaN(Number(leadRateOverride))) ov.lead_rate_override = Number(leadRateOverride) / 100
    return ov
  }, [cpmOverride, ctrOverride, leadRateOverride])

  // Auto-simulate with debounce
  const runSimulation = useCallback(async (spends) => {
    if (!spends.some(s => s > 0)) { setResult(null); return }
    setLoading(true)
    try {
      const res = await simulateDigitalPlan(selectedChannel, spends, buildOverrides())
      setResult(res)
    } catch { /* ignore */ }
    setLoading(false)
  }, [simulateDigitalPlan, selectedChannel, buildOverrides])

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
  }

  const applyScenario = (key) => {
    setScenario(key)
    const mult = SCENARIO_PRESETS[key].spend_mult
    setWeeklySpends(prev => prev.map(s => Math.round((s || 500000) * mult / 10000) * 10000))
  }

  const loadPresets = async () => {
    try {
      const presets = await getMediaPlanPresets(selectedChannel, 'digital')
      const spends = presets.preset_grps || []
      setWeeklySpends(Array(numWeeks).fill(0).map((_, i) => spends[i] || 0))
    } catch { /* ignore */ }
  }

  // Re-simulate when overrides change
  useEffect(() => {
    if (!weeklySpends.some(s => s > 0)) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSimulation(weeklySpends), 600)
    return () => clearTimeout(debounceRef.current)
  }, [cpmOverride, ctrOverride, leadRateOverride]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save
  const handleSave = async () => {
    if (!saveName.trim() || !result) return
    try {
      await saveMediaPlan(saveName.trim(), selectedChannel, weeklySpends, result, campaign?.id || null, 'digital')
      setShowSaveModal(false)
      setSaveName('')
      refreshSavedPlans()
    } catch { /* ignore */ }
  }

  const refreshSavedPlans = async () => {
    try {
      const plans = await listSavedMediaPlans(campaign?.id || null, 'digital')
      setSavedPlans(plans)
    } catch { /* ignore */ }
  }

  const handleLoadPlan = async (id) => {
    try {
      const plan = await getSavedMediaPlan(id)
      setSelectedChannel(plan.channel)
      const spends = plan.weekly_grps || []
      setNumWeeks(spends.length)
      setWeeklySpends(spends)
      setShowSavedList(false)
    } catch { /* ignore */ }
  }

  const handleDeletePlan = async (id) => {
    try {
      await deleteSavedMediaPlan(id)
      refreshSavedPlans()
    } catch { /* ignore */ }
  }

  const handleReconcile = async (planId) => {
    setReconLoading(true)
    setReconciliation(null)
    try {
      const data = await reconcilePlan(planId)
      setReconciliation(data)
    } catch { setReconciliation(null) }
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
      setShowImportModal(true)
    } catch (err) {
      setImportError(err.message || 'Excel parse hatasi')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleImportChannelMapping = (itemIdx, newChannel) => {
    setImportMappingOverrides(prev => ({ ...prev, [itemIdx]: newChannel }))
  }

  const getEffectiveImportAgg = useCallback(() => {
    if (!importData) return {}
    const agg = {}
    for (const item of importData.lineItems) {
      const ch = importMappingOverrides[item.rowIndex] !== undefined
        ? importMappingOverrides[item.rowIndex]
        : (item.mappedChannel || '_unmapped')
      if (ch === '_unmapped' || ch === '') continue
      if (!agg[ch]) agg[ch] = { totalSpend: 0, totalImp: 0, labels: [] }
      agg[ch].totalSpend += item.spend
      agg[ch].totalImp += item.impressions
      const label = `${item.mecra}${item.site ? ' / ' + item.site : ''}`
      if (!agg[ch].labels.includes(label)) agg[ch].labels.push(label)
    }
    return agg
  }, [importData, importMappingOverrides])

  const handleImportApply = (channel) => {
    const agg = getEffectiveImportAgg()
    if (!agg[channel]) return
    setSelectedChannel(channel)
    const spends = distributeSpend(agg[channel].totalSpend, numWeeks, importDistribution)
    setWeeklySpends(spends)
    setShowImportModal(false)
    setImportData(null)
  }

  const handleImportApplyAll = () => {
    const agg = getEffectiveImportAgg()
    const firstChannel = ONLINE.find(ch => agg[ch])
    if (!firstChannel) return
    setSelectedChannel(firstChannel)
    const spends = distributeSpend(agg[firstChannel].totalSpend, numWeeks, importDistribution)
    setWeeklySpends(spends)
    setShowImportModal(false)
    setImportData(null)
  }

  // CSV Export
  const exportCSV = () => {
    if (!result) return
    const headers = ['Hafta', 'Spend (TL)', 'Adstocked Spend', 'Saturation', 'Model Lead', 'Funnel Lead', 'Impressions', 'Clicks', 'Reach %', 'CPL (TL)']
    const rows = result.weekly_details.map((d, i) => {
      const f = result.funnel_curve?.[i]
      const cplW = d.estimated_leads > 0 ? (d.grp / d.estimated_leads).toFixed(0) : '-'
      return [
        `W${d.week}`, d.grp, d.adstocked_grp.toFixed(0), d.saturated.toFixed(4),
        d.estimated_leads.toFixed(1), f?.estimated_leads_funnel?.toFixed(1) || '-',
        f?.impressions?.toFixed(0) || '-', f?.clicks?.toFixed(0) || '-',
        f?.reach_pct?.toFixed(1) || '-', cplW,
      ]
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dijital_plan_${selectedChannel}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Derived data
  const channelColor = CHANNEL_COLORS[selectedChannel] || '#f97316'
  const channelLabel = CHANNEL_LABELS[selectedChannel] || selectedChannel
  const totalSpend = weeklySpends.reduce((s, v) => s + v, 0)
  const deviationPct = result?.summary?.funnel_vs_mmm_deviation_pct || 0
  const deviationHigh = Math.abs(deviationPct) > 30

  // Half-life
  const halfLife = result?.decay > 0 && result.decay < 1
    ? Math.ceil(Math.log(0.5) / Math.log(result.decay))
    : 0

  // --- Chart Data ---
  const adstockChartData = useMemo(() => {
    if (!result) return null
    const details = result.weekly_details
    return {
      labels: details.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Ham Spend',
          data: details.map(d => d.grp),
          borderColor: 'rgba(148,163,184,0.5)',
          backgroundColor: 'rgba(148,163,184,0.08)',
          borderDash: [4, 4],
          fill: false, tension: 0.3, pointRadius: 3,
        },
        {
          label: 'Adstocked Spend',
          data: details.map(d => d.adstocked_grp),
          borderColor: channelColor,
          backgroundColor: channelColor + '20',
          fill: true, tension: 0.3, pointRadius: 4,
        },
        {
          type: 'bar',
          label: 'Carry-over',
          data: details.map(d => Math.max(0, d.adstocked_grp - d.grp)),
          backgroundColor: channelColor + '30',
          borderColor: channelColor + '50',
          borderWidth: 1, borderRadius: 2,
        },
      ],
    }
  }, [result, channelColor])

  const saturationChartData = useMemo(() => {
    if (!result?.saturation_curve) return null
    const { grp_values, saturated_values } = result.saturation_curve
    return {
      labels: grp_values.map(v => fmtMoney(v)),
      datasets: [{
        label: 'Saturation Response',
        data: saturated_values,
        borderColor: channelColor,
        backgroundColor: channelColor + '15',
        fill: true, tension: 0.4, pointRadius: 0,
      }],
    }
  }, [result, channelColor])

  const funnelChartData = useMemo(() => {
    if (!result?.funnel_curve?.length || !result?.weekly_details?.length) return null
    const fc = result.funnel_curve
    const wd = result.weekly_details
    return {
      labels: fc.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Impressions (K)',
          data: fc.map(d => d.impressions / 1000),
          backgroundColor: '#3b82f620',
          borderColor: '#3b82f6',
          borderWidth: 1.5, borderRadius: 2,
          yAxisID: 'y',
        },
        {
          label: 'Clicks',
          data: fc.map(d => d.clicks),
          backgroundColor: '#14b8a620',
          borderColor: '#14b8a6',
          borderWidth: 1.5, borderRadius: 2,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Model Lead',
          data: wd.map(d => d.estimated_leads),
          borderColor: channelColor,
          backgroundColor: channelColor + '20',
          fill: false, tension: 0.3, pointRadius: 4, borderWidth: 2.5,
          yAxisID: 'y1',
        },
        {
          type: 'line',
          label: 'Funnel Lead',
          data: fc.map(d => d.estimated_leads_funnel),
          borderColor: '#8b5cf6',
          borderDash: [5, 3],
          fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2,
          yAxisID: 'y1',
        },
      ],
    }
  }, [result, channelColor])

  const reachChartData = useMemo(() => {
    if (!result?.funnel_curve?.length) return null
    const fc = result.funnel_curve
    return {
      labels: fc.map(d => `W${d.week}`),
      datasets: [
        {
          label: 'Reach %',
          data: fc.map(d => d.reach_pct),
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true, tension: 0.3, pointRadius: 4, borderWidth: 2.5,
          yAxisID: 'y',
        },
        {
          label: 'Eff. Frequency',
          data: fc.map(d => d.frequency),
          borderColor: '#f97316',
          borderDash: [5, 3],
          fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2,
          yAxisID: 'y1',
        },
      ],
    }
  }, [result])

  const responseChartData = useMemo(() => {
    if (!result) return null
    const details = result.weekly_details
    return {
      labels: details.map(d => `W${d.week}`),
      datasets: [{
        label: 'Tahmini Lead (Yanit Modeli)',
        data: details.map(d => d.estimated_leads),
        backgroundColor: channelColor + '80',
        borderColor: channelColor,
        borderWidth: 1, borderRadius: 3,
      }],
    }
  }, [result, channelColor])

  // --- Chart Options ---
  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => fmtN(v) } },
    },
  }

  const adstockOpts = useMemo(() => {
    if (!result?.optimal) return lineOpts
    const optSpend = result.optimal.optimal_weekly_grp
    const satSpend = result.optimal.saturation_threshold_grp
    return {
      ...lineOpts,
      plugins: {
        ...lineOpts.plugins,
        annotation: {
          annotations: {
            optimalLine: {
              type: 'line', yMin: optSpend, yMax: optSpend,
              borderColor: 'rgba(74, 222, 128, 0.6)', borderWidth: 1.5, borderDash: [6, 3],
              label: { display: true, content: `Optimal: ${fmtMoney(optSpend)}`, position: 'start', backgroundColor: 'rgba(74, 222, 128, 0.15)', color: '#4ade80', font: { size: 10 }, padding: 3 },
            },
            saturationLine: {
              type: 'line', yMin: satSpend, yMax: satSpend,
              borderColor: 'rgba(250, 204, 21, 0.5)', borderWidth: 1.5, borderDash: [6, 3],
              label: { display: true, content: `Doygunluk: ${fmtMoney(satSpend)}`, position: 'end', backgroundColor: 'rgba(250, 204, 21, 0.15)', color: '#facc15', font: { size: 10 }, padding: 3 },
            },
          },
        },
      },
    }
  }, [result, lineOpts])

  const satOpts = {
    ...lineOpts,
    plugins: {
      ...lineOpts.plugins,
      tooltip: { callbacks: { label: ctx => `Response: ${ctx.parsed.y.toFixed(4)}`, title: ctx => `Spend: ${ctx[0].label}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
      y: { ticks: { callback: v => v.toFixed(2) } },
    },
  }

  const funnelOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        position: 'left',
        ticks: { callback: v => fmtN(v) },
        title: { display: true, text: 'Impressions (K) / Clicks', font: { size: 10 }, color: '#64748b' },
      },
      y1: {
        position: 'right',
        ticks: { callback: v => v.toFixed(0) },
        title: { display: true, text: 'Leads', font: { size: 10 }, color: '#64748b' },
        grid: { drawOnChartArea: false },
      },
    },
  }

  const reachOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 } } },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        position: 'left',
        ticks: { callback: v => `%${v.toFixed(0)}` },
        min: 0, max: 100,
        title: { display: true, text: 'Reach %', font: { size: 10 }, color: '#64748b' },
      },
      y1: {
        position: 'right',
        ticks: { callback: v => v.toFixed(1) },
        title: { display: true, text: 'Eff. Frequency', font: { size: 10 }, color: '#64748b' },
        grid: { drawOnChartArea: false },
      },
    },
  }

  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => v.toFixed(0) } },
    },
  }

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
      {result && deviationHigh && (
        <div className="px-4 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-300 leading-relaxed">
          <strong>Tutarlılık Uyarısı:</strong> İki tahmin yöntemi %{Math.abs(deviationPct).toFixed(0)} farklı sonuç veriyor.
          {' '}Yanıt modeli (adstock + doygunluk) ile funnel hesabı (CPM/CTR/Lead Rate) farklı varsayımlara dayanır;
          bu fark, varsayımların birbiriyle tutarsız olduğunu gösterir — biri yanlış değil, ikisi aynı gerçeği yansıtmıyor.
          {' '}Gelişmiş ayarlardan CPM/CTR/Lead Rate değerlerini gerçeğe yaklaştırabilirsiniz.
          {' '}Gerçek doğrulama için aşağıdaki GA4 sağlama kartına bakın.
        </div>
      )}

      {/* Row 2: Spend Input Card */}
      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Haftalık Harcama (TL)</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">
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
          <div className="px-4 py-3 bg-dark-bg/50 border-b border-dark-border flex items-center gap-2">
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Simülasyon adı..."
              className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
              autoFocus
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
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Kayitli Planlar (Dijital)</p>
            {savedPlans.length === 0 ? (
              <p className="text-xs text-slate-500">Henuz kayitli dijital plan yok.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {savedPlans.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-dark-card rounded-lg border border-dark-border group">
                    <button onClick={() => handleLoadPlan(p.id)} className="flex-1 text-left">
                      <span className="text-xs text-slate-200 font-medium">{p.name}</span>
                      <span className="ml-2 text-[10px] text-slate-500 font-mono">{CHANNEL_LABELS[p.channel] || p.channel}</span>
                      <span className="ml-2 text-[10px] text-slate-600">{p.created_at?.slice(0, 10)}</span>
                    </button>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleReconcile(p.id)}
                        disabled={reconLoading}
                        className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all"
                      >
                        {reconLoading ? '...' : 'Dogrula'}
                      </button>
                      <button
                        onClick={() => handleDeletePlan(p.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all"
                      >
                        x
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
                <button onClick={() => setReconciliation(null)} className="text-slate-500 text-xs ml-2">x</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-200">
                      Plan vs Gerçekleşme — {CHANNEL_LABELS[reconciliation.channel] || reconciliation.channel}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      DDA verisi: {reconciliation.run_date ? new Date(reconciliation.run_date).toLocaleDateString('tr-TR') : ''}
                      {reconciliation.matched_dda_channel && reconciliation.matched_dda_channel !== reconciliation.channel && (
                        <span className="ml-1 text-slate-600">({reconciliation.matched_dda_channel})</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => setReconciliation(null)} className="text-slate-500 hover:text-slate-300 text-xs">x</button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Planned */}
                  <div className="bg-dark-bg/50 rounded-lg p-3 border border-dark-border">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Planlanan</p>
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
          const unmappedItems = importData.lineItems.filter(item => {
            const override = importMappingOverrides[item.rowIndex]
            return override !== undefined ? (override === '_unmapped' || override === '') : !item.mappedChannel
          })
          const totalMapped = mappedChannels.reduce((s, ch) => s + (agg[ch]?.totalSpend || 0), 0)

          return (
            <div className="px-4 py-4 bg-dark-bg/80 border-b border-dark-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    Plan İçe Aktarma
                    {importData.brand && <span className="text-slate-500 ml-2">| {importData.brand}</span>}
                    {importData.campaignName && <span className="text-accent ml-1">{importData.campaignName}</span>}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {importData.lineItems.length} satır okundu | Toplam eşleşen: {fmtMoney(totalMapped)} TL
                  </p>
                </div>
                <button onClick={() => { setShowImportModal(false); setImportData(null) }}
                  className="text-slate-500 hover:text-slate-300 text-lg">x</button>
              </div>

              {/* Distribution mode */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Dağıtım:</span>
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
                <span className="text-[10px] text-slate-500">| {numWeeks} haftaya dagilir</span>
              </div>

              {/* Mapped channels */}
              {mappedChannels.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Eşleşen Kanallar</p>
                  {mappedChannels.map(ch => (
                    <div key={ch} className="flex items-center justify-between px-3 py-2.5 bg-dark-card rounded-lg border border-dark-border group">
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch] }} />
                        <div>
                          <span className="text-xs font-medium text-slate-200">{CHANNEL_LABELS[ch]}</span>
                          <span className="ml-2 text-[10px] text-slate-500">{agg[ch].labels.join(', ')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate-300">{fmtMoney(agg[ch].totalSpend)} TL</span>
                        {agg[ch].totalImp > 0 && (
                          <span className="text-[10px] font-mono text-slate-500">{fmtN(agg[ch].totalImp)} imp</span>
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
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Eşlenmeyen Satırlar</p>
                  {unmappedItems.map(item => (
                    <div key={item.rowIndex} className="flex items-center justify-between px-3 py-2 bg-dark-card/50 rounded-lg border border-yellow-500/20">
                      <div>
                        <span className="text-xs text-slate-300">{item.mecra}</span>
                        {item.site && <span className="text-[10px] text-slate-500 ml-1">/ {item.site}</span>}
                        <span className="ml-2 text-xs font-mono text-slate-400">{fmtMoney(item.spend)} TL</span>
                      </div>
                      <select
                        value={importMappingOverrides[item.rowIndex] ?? '_unmapped'}
                        onChange={e => handleImportChannelMapping(item.rowIndex, e.target.value)}
                        className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-[11px] text-slate-300"
                      >
                        <option value="_unmapped">Esle...</option>
                        {ONLINE.map(ch => (
                          <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {/* Apply all button */}
              {mappedChannels.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-dark-border">
                  <p className="text-[10px] text-slate-500">
                    Bir kanala tiklayin veya ilk eslesen kanali otomatik uygulayın.
                  </p>
                  <button
                    onClick={handleImportApplyAll}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
                  >
                    İlk Kanalı Uygula ({CHANNEL_LABELS[mappedChannels[0]]})
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
                <label className="text-[10px] text-slate-500 text-center font-mono">W{i + 1}</label>
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
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 font-mono">
              <span>{'λ'} = {result.decay}</span>
              <span>{'α'} = {typeof result.alpha === 'number' ? fmtMoney(result.alpha) : result.alpha}</span>
              <span>{'γ'} = {result.gamma}</span>
              <span>Half-life = {halfLife} hafta</span>
              <span>Max Lift = {result.max_lift} lead/hafta</span>
            </div>
          )}

          {/* Advanced overrides */}
          <div className="mt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              Gelişmiş Ayarlar {showAdvanced ? '▴' : '▾'}
            </button>
            {showAdvanced && (
              <div className="mt-2 p-3 bg-dark-bg/50 rounded-lg border border-dark-border">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">CPM (TL)</label>
                    <input
                      type="number"
                      value={cpmOverride}
                      onChange={e => setCpmOverride(e.target.value)}
                      placeholder={channelDefaults?.cpm?.toString() || '80'}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">CTR (%)</label>
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
                    <label className="text-[10px] text-slate-500 block mb-1">Lead Rate (%)</label>
                    <input
                      type="number"
                      value={leadRateOverride}
                      onChange={e => setLeadRateOverride(e.target.value)}
                      placeholder={channelDefaults?.lead_rate ? (channelDefaults.lead_rate * 100).toFixed(2) : '0.15'}
                      step="0.01"
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[10px] text-slate-600">
                    Bos birakilan alanlar varsayilan kanal degerleri kullanir.
                  </p>
                  <button
                    onClick={() => { setCpmOverride(''); setCtrOverride(''); setLeadRateOverride('') }}
                    className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Sifirla
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Toplam Harcama</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtMoney(result.summary?.total_spend || totalSpend)} TL</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Ort. Haftalık</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtMoney(result.summary?.avg_weekly_spend || totalSpend / numWeeks)} TL</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Impressions</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(result.summary?.total_impressions || 0)}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Clicks</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">{fmtN(result.summary?.total_clicks || 0)}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Model Lead</p>
              <p className="text-lg font-mono text-accent mt-0.5">{result.summary?.total_leads?.toFixed(0) || '-'}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Funnel Lead</p>
              <p className="text-lg font-mono text-violet-400 mt-0.5">{result.summary?.total_funnel_leads?.toFixed(0) || '-'}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">CPL (Model)</p>
              <p className="text-lg font-mono text-slate-100 mt-0.5">
                {result.summary?.avg_cpl > 0 ? `${fmtMoney(result.summary.avg_cpl)} TL` : '-'}
              </p>
            </div>
          </div>

          {/* Deviation badge */}
          {result.summary?.funnel_vs_mmm_deviation_pct != null && (
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium ${
                deviationHigh
                  ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              }`}>
                Model vs Funnel Sapma: %{Math.abs(deviationPct).toFixed(0)}
              </span>
              {!deviationHigh && (
                <span className="text-[10px] text-slate-500">Modeller uyumlu</span>
              )}
            </div>
          )}

          {/* GA4/DDA Benchmark — validates the assumption-based plan against real data */}
          {channelBenchmark && (
            <div className="dark-card p-4 border border-emerald-500/20">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="card-title">GA4 Gerçek Veri — Sağlama</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {channelLabel} · {benchmarks.data_source === 'bigquery' ? 'BigQuery GA4 export' : 'CRM/CSV'} ·
                    {benchmarks.run_date ? ` ${new Date(benchmarks.run_date).toLocaleDateString('tr-TR')}` : ''}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Gözleme Dayalı
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">DDA Katkı Payı</p>
                  <p className="text-sm font-mono text-emerald-400 mt-0.5">%{(channelBenchmark.dda_weight * 100).toFixed(1)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Asist Oranı</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">%{(channelBenchmark.assist_ratio * 100).toFixed(0)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Son Temas</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtN(channelBenchmark.last_touch || 0)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Touchpoint</p>
                  <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtN(channelBenchmark.touchpoints || 0)}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
                Yukarıdaki plan tahminleri sektör varsayımı parametreleriyle (CPM/CTR/Lead Rate) hesaplanır.
                Bu satır ise gerçek GA4 kullanıcı yolculuklarından gelen DDA sinyalidir — kanalın dönüşüme
                gerçek katkısını gösterir. Plan ile gerçeğin tutarlılığını buradan denetleyebilirsiniz.
                {channelBenchmark.dda_weight > 0 && benchmarks.overall_conversion_rate > 0 && (
                  <> {' '}Kampanya geneli dönüşüm oranı: <span className="text-slate-300">%{(benchmarks.overall_conversion_rate * 100).toFixed(1)}</span>.</>
                )}
              </p>
            </div>
          )}

          {campaign?.id && benchmarks && !benchmarks.available && (
            <div className="dark-card p-3 border border-dark-border">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                <span className="text-yellow-400">⚠ Sağlama verisi yok.</span> Bu kampanya için henüz DDA çalıştırılmadı.
                Attribution sekmesinden GA4/CSV verisiyle DDA çalıştırınca, plan varsayımları gerçek veriyle
                karşılaştırılabilir hale gelir. Şu an plan tamamen varsayım bazlıdır.
              </p>
            </div>
          )}

          {/* Chart Tabs */}
          <div className="dark-card">
            <div className="card-hdr">
              <div className="flex gap-1">
                {[
                  { id: 'funnel', label: 'Funnel Projeksiyon' },
                  { id: 'adstock', label: 'Carryover & Adstock' },
                  { id: 'saturation', label: 'Saturation' },
                  { id: 'reach', label: 'Reach & Frequency' },
                  { id: 'response', label: 'Haftalık Lead' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveChartTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeChartTab === t.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="text-xs font-mono text-slate-500">
                {channelLabel} | {'λ'}={result.decay}
              </span>
            </div>
            <div className="p-4">
              {/* Funnel Tab */}
              {activeChartTab === 'funnel' && (
                <>
                  <div className="h-72">
                    {funnelChartData && <Bar data={funnelChartData} options={funnelOpts} />}
                  </div>
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Funnel Projeksiyon:</strong>
                    {' Spend → Impressions (CPM) → Clicks (CTR) → Leads (Lead Rate). '}
                    {'Yanit modeli ve funnel lead tahminleri paralel gosterilir — ikisi farkli varsayimlara dayanir; sapma %30\'u asarsa varsayimlar birbiriyle tutarsizdir.'}
                  </div>
                </>
              )}

              {/* Adstock Tab */}
              {activeChartTab === 'adstock' && (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                      ⚠ Varsayım Bazlı Model
                    </span>
                    <span className="text-[10px] text-slate-500">λ decay parametresi sektör ortalamasıdır, gerçek veriye fit edilmemiştir</span>
                  </div>
                  <div className="h-72">
                    {adstockChartData && <Line data={adstockChartData} options={adstockOpts} />}
                  </div>
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">{channelLabel}</strong>
                    {' kanalinda λ='}{result.decay}{' decay parametresi ile reklam etkisi '}
                    <strong className="text-accent">{halfLife} haftada</strong>
                    {' yarısına düşer. '}
                    {result.decay >= 0.3
                      ? 'Orta-yüksek carry-over: harcama durdurulsa bile etki birden sıfırlanmaz.'
                      : 'Düşük carry-over: etki hemen sönümlenir, sürekli harcama önemlidir.'}
                  </div>
                </>
              )}

              {/* Saturation Tab */}
              {activeChartTab === 'saturation' && (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                      ⚠ Varsayım Bazlı Model
                    </span>
                    <span className="text-[10px] text-slate-500">α/γ Hill parametreleri sektör ortalamasıdır; 8+ haftalık veriyle kalibre edilebilir</span>
                  </div>
                  <div className="h-72">
                    {saturationChartData && <Line data={saturationChartData} options={satOpts} />}
                  </div>
                  {result.optimal && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Optimal Spend</p>
                        <p className="text-sm font-mono text-green-400 mt-0.5">{fmtMoney(result.optimal.optimal_weekly_grp)} TL</p>
                      </div>
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Doygunluk Esigi</p>
                        <p className="text-sm font-mono text-yellow-400 mt-0.5">{fmtMoney(result.optimal.saturation_threshold_grp)} TL</p>
                      </div>
                      <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Mevcut Ort.</p>
                        <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtMoney(result.optimal.current_avg_grp)} TL</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Saturation:</strong>
                    {' α='}{fmtMoney(result.alpha)}{' TL (yari-doygunluk noktasi), γ='}{result.gamma}{' (egri sekli). '}
                    {'Harcama arttikca marjinal getiri azalir. Optimal noktadan sonra her ek TL\'nin katkisi duser.'}
                  </div>
                </>
              )}

              {/* Reach Tab */}
              {activeChartTab === 'reach' && (
                <>
                  <div className="h-72">
                    {reachChartData && <Line data={reachChartData} options={reachOpts} />}
                  </div>
                  {result.funnel_curve?.length > 0 && (() => {
                    const last = result.funnel_curve[result.funnel_curve.length - 1]
                    return (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Son Hafta Reach</p>
                          <p className="text-sm font-mono text-blue-400 mt-0.5">%{last.reach_pct?.toFixed(1)}</p>
                        </div>
                        <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Eff. Frequency</p>
                          <p className="text-sm font-mono text-orange-400 mt-0.5">{last.frequency?.toFixed(1)}</p>
                        </div>
                        <div className="bg-dark-bg rounded-lg p-2.5 text-center">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Hedef Kitle</p>
                          <p className="text-sm font-mono text-slate-100 mt-0.5">{fmtN(result.digital_metrics?.target_audience || 0)}</p>
                        </div>
                      </div>
                    )
                  })()}
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Reach & Frequency:</strong>
                    {' Poisson 1+ reach modeli: reach = 1 - e^(-impressions/audience). '}
                    {'Effective frequency, freq_cap ile sinirlandirilir. Reach arttikca marjinal erisim azalir.'}
                  </div>
                </>
              )}

              {/* Response Tab */}
              {activeChartTab === 'response' && (
                <>
                  <div className="h-72">
                    {responseChartData && <Bar data={responseChartData} options={barOpts} />}
                  </div>
                  <div className="mt-3 p-3 bg-dark-bg/50 rounded-lg border border-dark-border text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Haftalık Lead Tahmini (Yanıt Modeli):</strong>
                    {' Spend → Adstock → Saturation → Response pipeline sonucu tahmini haftalık lead sayısı. '}
                    {'Peak hafta: W'}{result.summary?.peak_week}
                    {' ('}{result.weekly_details[result.summary?.peak_week - 1]?.estimated_leads.toFixed(0)}{' lead).'}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Optimal Spend Recommendation */}
          {result.optimal && (
            <div className="dark-card border-accent/30">
              <div className="card-hdr">
                <span className="card-title">Optimal Harcama Onerisi</span>
                {(() => {
                  const avg = result.optimal.current_avg_grp
                  const opt = result.optimal.optimal_weekly_grp
                  const thr = result.optimal.saturation_threshold_grp
                  const status = avg < opt * 0.8 ? 'low' : avg > thr ? 'high' : 'good'
                  const statusConfig = {
                    low: { color: 'text-blue-400', bg: 'bg-blue-500/15', label: 'Arttirilabilir' },
                    good: { color: 'text-green-400', bg: 'bg-green-500/15', label: 'Optimal' },
                    high: { color: 'text-yellow-400', bg: 'bg-yellow-500/15', label: 'Doygunluk' },
                  }
                  const sc = statusConfig[status]
                  return (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.color} ${sc.bg}`}>
                      {sc.label}
                    </span>
                  )
                })()}
              </div>
              <div className="p-4">
                <p className="text-sm text-slate-300 leading-relaxed">{result.optimal.recommendation}</p>
              </div>
            </div>
          )}

          {/* Weekly Detail Table */}
          <div className="dark-card">
            <div className="card-hdr">
              <span className="card-title">Haftalık Detay</span>
              <button
                onClick={exportCSV}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 transition-colors"
              >
                CSV İndir
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-slate-400">
                    <th className="text-left py-2 px-2">Hafta</th>
                    <th className="text-right py-2 px-2">Spend (TL)</th>
                    <th className="text-right py-2 px-2">Adstocked</th>
                    <th className="text-right py-2 px-2">Impressions</th>
                    <th className="text-right py-2 px-2">Clicks</th>
                    <th className="text-right py-2 px-2">Model Lead</th>
                    <th className="text-right py-2 px-2">Funnel Lead</th>
                    <th className="text-right py-2 px-2">Reach %</th>
                    <th className="text-right py-2 px-2">CPL</th>
                  </tr>
                </thead>
                <tbody>
                  {result.weekly_details.map((d, i) => {
                    const f = result.funnel_curve?.[i]
                    const isPeak = d.week === result.summary?.peak_week
                    const cplW = d.estimated_leads > 0 ? d.grp / d.estimated_leads : 0
                    return (
                      <tr
                        key={d.week}
                        className={`border-b border-dark-border/50 ${isPeak ? 'bg-accent/5' : 'hover:bg-dark-bg/30'}`}
                      >
                        <td className="py-2 px-2 font-mono text-slate-300">
                          W{d.week}
                          {isPeak && <span className="ml-1 text-[9px] text-accent font-semibold">PEAK</span>}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-200">{fmtMoney(d.grp)}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtMoney(d.adstocked_grp)}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtN(f?.impressions || 0)}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-400">{fmtN(f?.clicks || 0)}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-100">{d.estimated_leads.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right font-mono text-violet-400">{f?.estimated_leads_funnel?.toFixed(1) || '-'}</td>
                        <td className="py-2 px-2 text-right font-mono text-blue-400">%{f?.reach_pct?.toFixed(1) || '-'}</td>
                        <td className="py-2 px-2 text-right font-mono text-slate-400">
                          {cplW > 0 ? `${fmtMoney(cplW)} TL` : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Loading indicator */}
      {loading && !result && (
        <div className="text-center py-12 text-slate-500 text-sm">Simülasyon çalışıyor...</div>
      )}

      {/* Empty state */}
      {!loading && !result && (
        <div className="text-center py-12 text-slate-500 text-sm">
          Haftalık harcama değerlerini girerek simülasyonu başlatın.
        </div>
      )}
    </div>
  )
}
