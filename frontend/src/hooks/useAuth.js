import { useState, useCallback, useEffect } from 'react'
import axios from 'axios'
import { savedToken, saveToken, clearSession } from '../utils/session'

const setAuthHeader = token => {
  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
  else delete axios.defaults.headers.common['Authorization']
}

export function useAuth() {
  const [user, setUser] = useState(null)
  // True while a stored token is being checked, so a reload doesn't flash the login page.
  const [loading, setLoading] = useState(() => Boolean(savedToken()))

  const endSession = useCallback(() => {
    setAuthHeader(null)
    clearSession()
    setUser(null)
  }, [])

  // Validate a token with /auth/me, then keep it so a reload stays signed in.
  const startSession = useCallback(async (token) => {
    setAuthHeader(token)
    const meRes = await axios.get('/api/auth/me')
    saveToken(token)
    setUser(meRes.data)
    return meRes.data
  }, [])

  // Restore the session on first load.
  useEffect(() => {
    const token = savedToken()
    if (!token) return
    let cancelled = false
    startSession(token)
      .catch(() => { if (!cancelled) endSession() }) // expired or revoked
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startSession, endSession])

  // An expired token turns every call into a 401; sign out instead of
  // leaving the user on a page whose requests all fail.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      res => res,
      err => {
        const url = err.config?.url || ''
        if (err.response?.status === 401 && !url.includes('/auth/login')) endSession()
        return Promise.reject(err)
      },
    )
    return () => axios.interceptors.response.eject(id)
  }, [endSession])

  const login = useCallback(async (username, password) => {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    const res = await axios.post('/api/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return startSession(res.data.access_token)
  }, [startSession])

  const loginAsDemo = useCallback(async () => {
    const res = await axios.post('/api/auth/demo')
    return startSession(res.data.access_token)
  }, [startSession])

  return { user, loading, login, loginAsDemo, logout: endSession }
}
