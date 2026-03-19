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

  const uploadFile = useCallback(async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await axios.post(`${API_BASE}/data/upload`, formData)
    return res.data
  }, [])

  const getDecomposition = useCallback(async (spendMap) => {
    const spendStr = Object.entries(spendMap)
      .map(([ch, val]) => `${ch}:${val}`)
      .join(',')
    const res = await axios.get(`${API_BASE}/mmm/decomposition`, {
      params: { spend: spendStr },
    })
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

  const runDDAFromCSV = useCallback(async (file, priorAlpha = 0.5) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await axios.post(`${API_BASE}/dda/run-from-csv`, formData, {
      params: { prior_alpha: priorAlpha },
    })
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

  const simulateMediaPlan = useCallback(async (channel, weeklyGrps) => {
    const res = await axios.post(`${API_BASE}/media-planning/simulate`, {
      channel,
      weekly_grps: weeklyGrps,
    })
    return res.data
  }, [])

  const getMediaPlanPresets = useCallback(async (channel) => {
    const res = await axios.get(`${API_BASE}/media-planning/presets/${channel}`)
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
    getMediaPlanPresets,
    refetch: fetchConfig,
  }
}
