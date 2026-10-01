import { useCallback } from 'react'
import axios from 'axios'

const API_BASE = '/api'

/** TV/radio spot effect API: spot lists, minute traffic, analysis, day timeline. */
export function useSpots() {
  const getStatus = useCallback(async campaignId =>
    (await axios.get(`${API_BASE}/spots/status`, { params: { campaign_id: campaignId } })).data, [])

  const upload = useCallback(async (kind, file, campaignId, params = {}) => {
    const form = new FormData()
    form.append('file', file)
    const url = kind === 'spots' ? '/spots/upload' : '/spots/traffic/upload'
    return (await axios.post(`${API_BASE}${url}`, form, { params: { campaign_id: campaignId, ...params } })).data
  }, [])

  const pullBigQuery = useCallback(async (campaignId, params = {}) =>
    (await axios.post(`${API_BASE}/spots/traffic/from-bigquery`, null, { params: { campaign_id: campaignId, ...params } })).data, [])

  const loadSample = useCallback(async campaignId =>
    (await axios.post(`${API_BASE}/spots/sample`, null, { params: { campaign_id: campaignId } })).data, [])

  const clear = useCallback(async (campaignId, what) =>
    (await axios.delete(`${API_BASE}/spots`, { params: { campaign_id: campaignId, what } })).data, [])

  const analyze = useCallback(async (campaignId, params) =>
    (await axios.get(`${API_BASE}/spots/analysis`, { params: { campaign_id: campaignId, ...params } })).data, [])

  const timeline = useCallback(async (campaignId, date, metric) =>
    (await axios.get(`${API_BASE}/spots/timeline`, { params: { campaign_id: campaignId, date, metric } })).data, [])

  const bqConfig = useCallback(async campaignId =>
    (await axios.get(`${API_BASE}/integrations/bigquery/saved-config`, { params: { campaign_id: campaignId } })).data, [])

  const downloadTemplate = useCallback(async kind => {
    const res = await axios.get(`${API_BASE}/spots/template/${kind}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = kind === 'spots' ? 'tv_radyo_spot_listesi_sablon.csv' : 'dakikalik_trafik_sablon.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return { getStatus, upload, pullBigQuery, loadSample, clear, analyze, timeline, bqConfig, downloadTemplate }
}
