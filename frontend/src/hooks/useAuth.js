import { useState, useCallback, useEffect } from 'react'
import axios from 'axios'

const TOKEN_KEY = 'ah_token'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // On mount, check if there's a stored token
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
      // Validate token
      axios.get('/api/auth/me')
        .then(res => setUser(res.data))
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY)
          delete axios.defaults.headers.common['Authorization']
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    const res = await axios.post('/api/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token } = res.data
    localStorage.setItem(TOKEN_KEY, access_token)
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`

    const meRes = await axios.get('/api/auth/me')
    setUser(meRes.data)
    return meRes.data
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    delete axios.defaults.headers.common['Authorization']
    setUser(null)
  }, [])

  return { user, loading, login, logout }
}
