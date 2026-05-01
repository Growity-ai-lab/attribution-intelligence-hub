import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API_BASE = '/api'

export function useAttribution() {
  const [channels, setChannels] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API_BASE}/config/channels`)
      setConfig(res.data)
      setChannels(res.data.channels || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const uploadFile = useCallback(async (file, campaignId = null) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = campaignId ? { campaign_id: campaignId } : {}
    const res = await axios.post(`${API_BASE}/data/upload`, formData, { params })
    return res.data
  }, [])

  const getDecomposition = useCallback(async (spendMap, campaignId = null, withCi = false) => {
    const spendStr = Object.entries(spendMap)
      .map(([ch, val]) => `${ch}:${val}`)
      .join(',')
    const params = { spend: spendStr }
    if (campaignId) params.campaign_id = campaignId
    if (withCi) params.with_ci = true
    const res = await axios.get(`${API_BASE}/mmm/decomposition`, { params })
    return res.data
  }, [])

  const getAdstock = useCallback(async (channel, spendValues) => {
    const res = await axios.get(`${API_BASE}/mmm/adstock/${channel}`, {
      params: { spend: spendValues.join(',') },
    })
    return res.data
  }, [])

  const getSaturation = useCallback(async (channel, values) => {
    const res = await axios.get(`${API_BASE}/mmm/saturation/${channel}`, {
      params: { values: values.join(',') },
    })
    return res.data
  }, [])

  const runDDAFromCSV = useCallback(async (file, priorAlpha = 0.5, campaignId = null) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = { prior_alpha: priorAlpha }
    if (campaignId) params.campaign_id = campaignId
    const res = await axios.post(`${API_BASE}/dda/run-from-csv`, formData, { params })
    return res.data
  }, [])

  const runDDA = useCallback(async (journeys, mmmShares = null, priorAlpha = 0.5) => {
    const res = await axios.post(`${API_BASE}/dda/run`, {
      journeys,
      mmm_shares: mmmShares,
      prior_alpha: priorAlpha,
    })
    return res.data
  }, [])

  const getReallocation = useCallback(async (unifiedReport, currentBudgets, totalBudget = null) => {
    const payload = {
      unified_report: unifiedReport,
      current_budgets: currentBudgets,
    }
    if (totalBudget !== null) {
      payload.total_budget = totalBudget
    }
    const res = await axios.post(`${API_BASE}/unified/reallocation`, payload)
    return res.data
  }, [])

  const fetchSampleJourneys = useCallback(async () => {
    const res = await axios.get(`${API_BASE}/data/sample/journeys`, {
      responseType: 'blob',
    })
    return new File([res.data], 'journeys_sample.csv', { type: 'text/csv' })
  }, [])

  const simulateMediaPlan = useCallback(async (channel, weeklyGrps, mode = 'offline') => {
    const res = await axios.post(`${API_BASE}/media-planning/simulate`, {
      channel,
      weekly_grps: weeklyGrps,
      mode,
    })
    return res.data
  }, [])

  const simulateDigitalPlan = useCallback(async (channel, weeklySpends, overrides = {}) => {
    const res = await axios.post(`${API_BASE}/media-planning/simulate`, {
      channel,
      weekly_grps: weeklySpends,
      mode: 'digital',
      ...overrides,
    })
    return res.data
  }, [])

  const getMediaPlanPresets = useCallback(async (channel, mode = 'offline') => {
    const res = await axios.get(`${API_BASE}/media-planning/presets/${channel}`, { params: { mode } })
    return res.data
  }, [])

  const saveMediaPlan = useCallback(async (name, channel, weeklyGrps, responseSnapshot, campaignId = null, mode = 'offline') => {
    const res = await axios.post(`${API_BASE}/media-planning/save`, {
      name, channel, weekly_grps: weeklyGrps, response_snapshot: responseSnapshot, campaign_id: campaignId, mode,
    })
    return res.data
  }, [])

  const listSavedMediaPlans = useCallback(async (campaignId = null, mode = null) => {
    const params = {}
    if (campaignId !== null) params.campaign_id = campaignId
    if (mode !== null) params.mode = mode
    const res = await axios.get(`${API_BASE}/media-planning/saved`, { params })
    return res.data
  }, [])

  const getSavedMediaPlan = useCallback(async (id) => {
    const res = await axios.get(`${API_BASE}/media-planning/saved/${id}`)
    return res.data
  }, [])

  const deleteSavedMediaPlan = useCallback(async (id) => {
    const res = await axios.delete(`${API_BASE}/media-planning/saved/${id}`)
    return res.data
  }, [])

  const uploadSalesStock = useCallback(async (file, campaignId = null) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = campaignId ? { campaign_id: campaignId } : {}
    const res = await axios.post(`${API_BASE}/sales-stock/upload`, formData, { params })
    return res.data
  }, [])

  const getSalesStockSummary = useCallback(async (campaignId = null) => {
    const params = {}
    if (campaignId !== null) params.campaign_id = campaignId
    const res = await axios.get(`${API_BASE}/sales-stock/summary`, { params })
    return res.data
  }, [])

  const getSalesStockWeekly = useCallback(async (campaignId = null) => {
    const params = {}
    if (campaignId !== null) params.campaign_id = campaignId
    const res = await axios.get(`${API_BASE}/sales-stock/weekly`, { params })
    return res.data
  }, [])

  const downloadFile = useCallback(async (url, filename) => {
    const res = await axios.get(`${API_BASE}${url}`, { responseType: 'blob' })
    const blobUrl = window.URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(blobUrl)
  }, [])

  const fitMMM = useCallback(async (campaignId) => {
    const res = await axios.post(`${API_BASE}/mmm/fit`, null, { params: { campaign_id: campaignId } })
    return res.data
  }, [])

  const getFitStatus = useCallback(async (campaignId) => {
    const res = await axios.get(`${API_BASE}/mmm/fit-status`, { params: { campaign_id: campaignId } })
    return res.data
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  return {
    channels,
    config,
    loading,
    error,
    uploadFile,
    getDecomposition,
    getAdstock,
    getSaturation,
    runDDAFromCSV,
    runDDA,
    getReallocation,
    fetchSampleJourneys,
    downloadFile,
    simulateMediaPlan,
    simulateDigitalPlan,
    getMediaPlanPresets,
    saveMediaPlan,
    listSavedMediaPlans,
    getSavedMediaPlan,
    deleteSavedMediaPlan,
    uploadSalesStock,
    getSalesStockSummary,
    getSalesStockWeekly,
    fitMMM,
    getFitStatus,
    refetch: fetchConfig,
  }
}
