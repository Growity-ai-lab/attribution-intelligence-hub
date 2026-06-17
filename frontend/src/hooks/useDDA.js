import { useCallback } from 'react'
import axios from 'axios'

const API_BASE = '/api'

export function useDDA() {
  const runDDA = useCallback(async (journeys, mmmShares = null, priorAlpha = 0.5) => {
    const res = await axios.post(`${API_BASE}/dda/run`, {
      journeys,
      mmm_shares: mmmShares,
      prior_alpha: priorAlpha,
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

  const exportDDAReport = useCallback(async (campaignId, resultId = null) => {
    const params = { campaign_id: campaignId }
    if (resultId) params.result_id = resultId
    const res = await axios.get(`${API_BASE}/export/dda-report`, {
      params,
      responseType: 'blob',
    })
    const blobUrl = window.URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `attribution_rapor_${campaignId}_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    window.URL.revokeObjectURL(blobUrl)
  }, [])

  const exportDDAPptx = useCallback(async (campaignId, resultId = null) => {
    const params = { campaign_id: campaignId }
    if (resultId) params.result_id = resultId
    const res = await axios.get(`${API_BASE}/export/dda-pptx`, {
      params,
      responseType: 'blob',
    })
    const blobUrl = window.URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `attribution_sunum_${campaignId}_${new Date().toISOString().slice(0, 10)}.pptx`
    a.click()
    window.URL.revokeObjectURL(blobUrl)
  }, [])

  const getTrendInsights = useCallback(async (campaignId) => {
    const res = await axios.get(`${API_BASE}/insights/trend`, {
      params: { campaign_id: campaignId },
    })
    return res.data
  }, [])

  return { runDDA, runDDAFromCSV, exportDDAReport, exportDDAPptx, getTrendInsights }
}
