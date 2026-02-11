import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import LoginPage from './components/LoginPage'
import WorkspaceSelector from './components/WorkspaceSelector'
import Dashboard from './components/Dashboard'
import MMMPanel from './components/MMMPanel'
import MTAPanel from './components/MTAPanel'
import IncrementalityPanel from './components/IncrementalityPanel'
import ProjectPlanPanel from './components/ProjectPlanPanel'

const TABS = [
  { id: 'unified', label: 'Unified Rapor' },
  { id: 'mmm', label: 'MMM Çıktıları' },
  { id: 'mta', label: 'MTA Paths' },
  { id: 'inc', label: 'Incrementality' },
  { id: 'plan', label: 'Proje Planı' },
]

export default function App() {
  const { user, loading, login, logout } = useAuth()
  const [activeTab, setActiveTab] = useState('unified')
  const [ddaResult, setDdaResult] = useState(null)
  const [workspace, setWorkspace] = useState(null) // { client, campaign }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-orange-600 animate-pulse" />
      </div>
    )
  }

  if (!user) {
    return <LoginPage onLogin={login} />
  }

  // No workspace selected yet — show selector
  if (!workspace) {
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
        <WorkspaceSelector onSelect={setWorkspace} />
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
      {/* Header */}
      <header className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToWorkspace}
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-orange-600 flex items-center justify-center text-white font-bold text-sm hover:opacity-80 transition-opacity"
              title="Müşteri/Kampanya seçimi"
            >
              TH
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
            <button
              onClick={handleBackToWorkspace}
              className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              &larr; Kampanyalar
            </button>
            {workspace.campaign.budget > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-accent/15 text-accent">
                {(workspace.campaign.budget / 1_000_000).toFixed(1)}M &#8378;
              </span>
            )}
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
        {activeTab === 'unified' && <Dashboard onDdaResult={setDdaResult} campaign={workspace.campaign} />}
        {activeTab === 'mmm' && <MMMPanel />}
        {activeTab === 'mta' && <MTAPanel ddaResult={ddaResult} />}
        {activeTab === 'inc' && <IncrementalityPanel />}
        {activeTab === 'plan' && <ProjectPlanPanel />}
      </main>
    </div>
  )
}
