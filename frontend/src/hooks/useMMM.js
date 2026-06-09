import { useCallback } from 'react'
import axios from 'axios'

const API_BASE = '/api'

export function useMMM() {
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

  const fitMMM = useCallback(async (campaignId) => {
    const res = await axios.post(`${API_BASE}/mmm/fit`, null, { params: { campaign_id: campaignId } })
    return res.data
  }, [])

  const getFitStatus = useCallback(async (campaignId) => {
    const res = await axios.get(`${API_BASE}/mmm/fit-status`, { params: { campaign_id: campaignId } })
    return res.data
  }, [])

  return { getDecomposition, getAdstock, getSaturation, fitMMM, getFitStatus }
}
