import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'

const API_BASE = '/api'

export function useChannelConfig() {
  const [channels, setChannels] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const fetchConfig = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      setLoading(true)
      const res = await axios.get(`${API_BASE}/config/channels`, { signal: controller.signal })
      setConfig(res.data)
      setChannels(res.data.channels || [])
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError') return
      setError(err.message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    return () => { if (abortRef.current) abortRef.current.abort() }
  }, [fetchConfig])

  return { channels, config, loading, error, refetch: fetchConfig }
}
