import { useState, useCallback } from 'react'
import axios from 'axios'

const API = '/api'

export function useWorkspace() {
  const [clients, setClients] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchClients = useCallback(async (year = null) => {
    setLoading(true)
    try {
      const params = year ? { year } : {}
      const res = await axios.get(`${API}/clients`, { params })
      setClients(res.data)
      setError('')
      return res.data
    } catch (err) {
      // Callers fire these from effects without awaiting; never let them reject.
      console.error('[useWorkspace] müşteriler yüklenemedi:', err)
      setError('Müşteri listesi yüklenemedi. Bağlantınızı kontrol edip sayfayı yenileyin.')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const createClient = useCallback(async (name, year, objective = 'lead') => {
    const res = await axios.post(`${API}/clients`, { name, year, objective })
    return res.data
  }, [])

  const deleteClient = useCallback(async (clientId) => {
    await axios.delete(`${API}/clients/${clientId}`)
  }, [])

  const fetchCampaigns = useCallback(async (clientId) => {
    setLoading(true)
    try {
      const res = await axios.get(`${API}/clients/${clientId}/campaigns`)
      setCampaigns(res.data)
      setError('')
      return res.data
    } catch (err) {
      console.error('[useWorkspace] kampanyalar yüklenemedi:', err)
      setError('Kampanya listesi yüklenemedi. Bağlantınızı kontrol edip sayfayı yenileyin.')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const createCampaign = useCallback(async (clientId, name, budget = 0, channels = '', objective = null, leadValue = 0) => {
    const res = await axios.post(`${API}/clients/${clientId}/campaigns`, {
      name, budget, channels, objective, lead_value: leadValue,
    })
    return res.data
  }, [])

  const updateCampaign = useCallback(async (campaignId, fields) => {
    const res = await axios.patch(`${API}/campaigns/${campaignId}`, fields)
    return res.data
  }, [])

  const deleteCampaign = useCallback(async (campaignId) => {
    await axios.delete(`${API}/campaigns/${campaignId}`)
  }, [])

  return {
    clients, campaigns, loading, error,
    fetchClients, createClient, deleteClient,
    fetchCampaigns, createCampaign, updateCampaign, deleteCampaign,
  }
}
