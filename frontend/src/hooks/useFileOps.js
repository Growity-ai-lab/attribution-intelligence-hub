import { useCallback } from 'react'
import axios from 'axios'

const API_BASE = '/api'

export function useFileOps() {
  const uploadFile = useCallback(async (file, campaignId = null) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = campaignId ? { campaign_id: campaignId } : {}
    const res = await axios.post(`${API_BASE}/data/upload`, formData, { params })
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

  const fetchSampleJourneys = useCallback(async () => {
    const res = await axios.get(`${API_BASE}/data/sample/journeys`, {
      responseType: 'blob',
    })
    return new File([res.data], 'journeys_sample.csv', { type: 'text/csv' })
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

  return {
    uploadFile, downloadFile, fetchSampleJourneys,
    uploadSalesStock, getSalesStockSummary, getSalesStockWeekly,
  }
}
