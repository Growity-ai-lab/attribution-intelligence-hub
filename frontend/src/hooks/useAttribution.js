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
    refetch: fetchConfig,
  }
}
