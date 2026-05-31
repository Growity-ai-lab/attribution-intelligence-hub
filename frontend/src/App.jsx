import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from './hooks/useAuth'
import LoginPage from './components/LoginPage'
import WorkspaceSelector from './components/WorkspaceSelector'
import Dashboard from './components/Dashboard'
import DigitalPlanningPanel from './components/DigitalPlanningPanel'
import AttributionPanel from './components/AttributionPanel'

const TABS = [
  { id: 'unified', label: 'Unified Rapor' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'media', label: 'Medya Planlama' },
]

export default function App() {
  const { user, loading, login, loginAsDemo, logout } = useAuth()
  const [activeTab, setActiveTab] = useState('unified')
  const [ddaResult, setDdaResult] = useState(null)
  const [workspace, setWorkspace] = useState(null) // { client, campaign }
  const [standaloneTool, setStandaloneTool] = useState(null) // 'media' | null (digital planning)

  const isDemo = user?.role === 'demo'

  // Auto-select first workspace for demo users
  useEffect(() => {
    if (!isDemo || workspace) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await axios.get('/api/clients')
        const clients = res.data
        if (cancelled || !clients.length) return
        // Pick first client with campaigns (prefer "Petrol Ofisi")
        const po = clients.find(c => c.name === 'Petrol Ofisi') || clients[0]
        const campRes = await axios.get(`/api/clients/${po.id}/campaigns`)
        const campaigns = campRes.data
        if (cancelled || !campaigns.length) return
        // Prefer "AutoMatic Filo" or first available
        const camp = campaigns.find(c => c.name.includes('AutoMatic')) || campaigns[0]
        const channels = camp.channels ? camp.channels.split(',').map(c => c.trim()) : []
        setWorkspace({
          client: po,
          campaign: { ...camp, channels },
        })
      } catch { /* ignore — user will see workspace selector */ }
    })()
    return () => { cancelled = true }
  }, [isDemo, workspace])

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-orange-600 animate-pulse" />
      </div>
    )
  }

  if (!user) {
    return <LoginPage onLogin={login} onDemoLogin={loginAsDemo} />
  }

  const handleBackToSelector = () => {
    setStandaloneTool(null)
  }

  // No workspace selected yet — show selector or standalone tool
  if (!workspace) {
    // Standalone tool mode
    if (standaloneTool === 'media') {
      return (
        <div className="min-h-screen bg-dark-bg bg-grid-overlay">
          <header className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-sm sticky top-0 z-30">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBackToSelector}
                  className="w-8 h-8 rounded-lg overflow-hidden hover:opacity-80 transition-opacity"
                  title="Ana Sayfa"
                >
                  <img src="/logo.svg" alt="Time's Hub" className="w-full h-full" />
                </button>
                <div className="flex items-center gap-2 text-sm">
                  <button onClick={handleBackToSelector} className="text-slate-400 hover:text-slate-200 transition-colors">
                    Ana Sayfa
                  </button>
                  <span className="text-slate-600">/</span>
                  <span className="text-accent font-medium">Medya Planlama</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBackToSelector}
                  className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  &larr; Geri
                </button>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-500/15 text-emerald-400">
                  {user.username}
                </span>
                <button
                  onClick={logout}
                  className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-700/50 text-slate-400 hover:text-red-400 transition-colors"
                >
                  Çıkış
                </button>
              </div>
            </div>
          </header>
          <main className="max-w-7xl mx-auto px-4 py-6">
            <DigitalPlanningPanel />
          </main>
        </div>
      )
    }

    return (
      <div>
        {/* Mini header with user badge */}
        <header className="border-b border-dark-border bg-dark-bg/80 sticky top-0 z-30">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-end gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-500/15 text-emerald-400">
              {user.username}
            </span>
            <button
              onClick={logout}
              className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-700/50 text-slate-400 hover:text-red-400 transition-colors"
            >
              Çıkış
            </button>
          </div>
        </header>
        <WorkspaceSelector onSelect={setWorkspace} onStandaloneTool={setStandaloneTool} />
      </div>
    )
  }

  const handleBackToWorkspace = () => {
    setWorkspace(null)
    setDdaResult(null)
    setActiveTab('unified')
  }

  return (
    <div className="min-h-screen bg-dark-bg bg-grid-overlay">
      {/* Demo Banner */}
      {isDemo && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center">
          <p className="text-xs text-amber-300">
            <span className="font-semibold">Demo Modu</span> &mdash; Örnek verilerle platformu keşfediyorsunuz. Gerçek kampanya verinizle çalışmak için{' '}
            <button onClick={logout} className="underline hover:text-amber-200 font-medium transition-colors">
              giriş yapın
            </button>.
          </p>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToWorkspace}
              className="w-8 h-8 rounded-lg overflow-hidden hover:opacity-80 transition-opacity"
              title="Müşteri/Kampanya seçimi"
            >
              <img src="/logo.svg" alt="Time's Hub" className="w-full h-full" />
            </button>
            <div>
              <h1 className="text-base font-semibold text-slate-100 tracking-tight">
                {workspace.campaign.name}
              </h1>
              <p className="text-xs text-slate-500">
                {workspace.client.name} &mdash; {workspace.client.year}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isDemo && (
              <button
                onClick={handleBackToWorkspace}
                className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                &larr; Kampanyalar
              </button>
            )}
            {workspace.campaign.budget > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-accent/15 text-accent">
                {(workspace.campaign.budget / 1_000_000).toFixed(1)}M &#8378;
              </span>
            )}
            {isDemo && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-500/15 text-amber-400 border border-amber-500/20">
                DEMO
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${isDemo ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/15 text-emerald-400'}`}>
              {user.username}
            </span>
            <button
              onClick={logout}
              className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-700/50 text-slate-400 hover:text-red-400 transition-colors"
            >
              {isDemo ? 'Çıkış' : 'Çıkış'}
            </button>
          </div>
        </div>

        <nav className="max-w-7xl mx-auto px-4">
          <div className="flex gap-0 overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'unified' && <Dashboard ddaResult={ddaResult} campaign={workspace.campaign} isDemo={isDemo} />}
        {activeTab === 'attribution' && <AttributionPanel campaign={workspace.campaign} ddaResult={ddaResult} setDdaResult={setDdaResult} />}
        {activeTab === 'media' && <DigitalPlanningPanel campaign={workspace.campaign} />}
      </main>
    </div>
  )
}
