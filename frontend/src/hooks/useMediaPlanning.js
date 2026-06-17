import { useCallback } from 'react'
import axios from 'axios'

const API_BASE = '/api'

export function useMediaPlanning() {
  const simulateMediaPlan = useCallback(async (channel, weeklySpends, overrides = {}) => {
    const res = await axios.post(`${API_BASE}/media-planning/simulate`, {
      channel,
      weekly_spends: weeklySpends,
      ...overrides,
    })
    return res.data
  }, [])

  const getMediaPlanPresets = useCallback(async (channel) => {
    const res = await axios.get(`${API_BASE}/media-planning/presets/${channel}`)
    return res.data
  }, [])

  const saveMediaPlan = useCallback(async (name, channel, weeklySpends, responseSnapshot, campaignId = null) => {
    const res = await axios.post(`${API_BASE}/media-planning/save`, {
      name, channel, weekly_spends: weeklySpends, response_snapshot: responseSnapshot, campaign_id: campaignId,
    })
    return res.data
  }, [])

  const listSavedMediaPlans = useCallback(async (campaignId = null) => {
    const params = {}
    if (campaignId !== null) params.campaign_id = campaignId
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

  const getChannelBenchmarks = useCallback(async (campaignId) => {
    const res = await axios.get(`${API_BASE}/benchmarks/channel-metrics`, {
      params: { campaign_id: campaignId },
    })
    return res.data
  }, [])

  const reconcilePlan = useCallback(async (planId) => {
    const res = await axios.post(`${API_BASE}/benchmarks/plan-reconciliation`, {
      plan_id: planId,
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

  return {
    simulateMediaPlan, getMediaPlanPresets,
    saveMediaPlan, listSavedMediaPlans, getSavedMediaPlan, deleteSavedMediaPlan,
    getChannelBenchmarks, reconcilePlan, getReallocation,
  }
}
