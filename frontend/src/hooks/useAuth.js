import { useState, useCallback } from 'react'
import axios from 'axios'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)

  const login = useCallback(async (username, password) => {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    const res = await axios.post('/api/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token } = res.data
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`

    const meRes = await axios.get('/api/auth/me')
    setUser(meRes.data)
    return meRes.data
  }, [])

  const logout = useCallback(() => {
    delete axios.defaults.headers.common['Authorization']
    setUser(null)
  }, [])

  return { user, loading, login, logout }
}
