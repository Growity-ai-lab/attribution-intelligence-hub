import { useState, useEffect } from 'react'
import { useWorkspace } from '../hooks/useWorkspace'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i)

function formatBudget(val) {
  if (!val) return '-'
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M TL`
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K TL`
  return `${val} TL`
}

export default function WorkspaceSelector({ onSelect }) {
  const {
    clients, campaigns, loading,
    fetchClients, createClient, deleteClient,
    fetchCampaigns, createCampaign, deleteCampaign,
  } = useWorkspace()

  const [year, setYear] = useState(CURRENT_YEAR)
  const [selectedClient, setSelectedClient] = useState(null)
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [newCampaign, setNewCampaign] = useState({ name: '', budget: '' })

  useEffect(() => {
    fetchClients(year)
  }, [year, fetchClients])

  useEffect(() => {
    if (selectedClient) {
      fetchCampaigns(selectedClient.id)
    }
  }, [selectedClient, fetchCampaigns])

  const handleCreateClient = async () => {
    if (!newClientName.trim()) return
    await createClient(newClientName.trim(), year)
    setNewClientName('')
    setShowNewClient(false)
    fetchClients(year)
  }

  const handleDeleteClient = async (e, clientId) => {
    e.stopPropagation()
    if (!window.confirm('Bu müşteri ve tüm kampanyaları silinecek. Emin misiniz?')) return
    await deleteClient(clientId)
    if (selectedClient?.id === clientId) setSelectedClient(null)
    fetchClients(year)
  }

  const handleCreateCampaign = async () => {
    if (!newCampaign.name.trim() || !selectedClient) return
    await createCampaign(
      selectedClient.id,
      newCampaign.name.trim(),
      parseFloat(newCampaign.budget) || 0,
    )
    setNewCampaign({ name: '', budget: '' })
    setShowNewCampaign(false)
    fetchCampaigns(selectedClient.id)
  }

  const handleDeleteCampaign = async (e, campaignId) => {
    e.stopPropagation()
    if (!window.confirm('Bu kampanya silinecek. Emin misiniz?')) return
    await deleteCampaign(campaignId)
    fetchCampaigns(selectedClient.id)
  }

  return (
    <div className="min-h-screen bg-dark-bg bg-grid-overlay">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Year Selector */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-orange-600 flex items-center justify-center text-white font-bold text-lg">
            TH
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-slate-100">Time's Hub <span className="text-slate-500 font-normal">|</span> <span className="text-slate-400 font-normal text-base">Attribution Intelligence</span></h1>
            <p className="text-xs text-slate-500">Müşteri ve kampanya seçimi</p>
          </div>
          <div className="flex gap-1">
            {YEARS.map(y => (
              <button
                key={y}
                onClick={() => { setYear(y); setSelectedClient(null) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                  year === y
                    ? 'bg-accent text-white'
                    : 'bg-dark-card text-slate-400 hover:text-slate-200 border border-dark-border'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Client List */}
          <div className="dark-card">
            <div className="card-hdr">
              <h3 className="card-title">Müşteriler ({year})</h3>
              <button
                onClick={() => setShowNewClient(!showNewClient)}
                className="px-3 py-1 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-dark transition-colors"
              >
                + Yeni Müşteri
              </button>
            </div>

            <div className="p-4 space-y-2">
              {showNewClient && (
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newClientName}
                    onChange={e => setNewClientName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                    placeholder="Müşteri adı..."
                    className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateClient}
                    className="px-3 py-2 bg-accent text-white rounded-lg text-xs font-medium"
                  >
                    Ekle
                  </button>
                </div>
              )}

              {loading && !clients.length && (
                <p className="text-slate-500 text-xs py-4 text-center">Yükleniyor...</p>
              )}

              {!loading && !clients.length && !showNewClient && (
                <p className="text-slate-500 text-xs py-8 text-center">
                  Henüz müşteri eklenmedi. "Yeni Müşteri" butonuna tıklayın.
                </p>
              )}

              {clients.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedClient(c)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-all group ${
                    selectedClient?.id === c.id
                      ? 'bg-accent/10 border-accent text-slate-100'
                      : 'bg-dark-bg border-dark-border text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="ml-2 text-xs text-slate-500 font-mono">
                        {c.campaign_count} kampanya
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteClient(e, c.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all"
                      title="Sil"
                    >
                      {'×'}
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Campaign List */}
          <div className="dark-card">
            <div className="card-hdr">
              <h3 className="card-title">
                {selectedClient ? `${selectedClient.name} - Kampanyalar` : 'Kampanyalar'}
              </h3>
              {selectedClient && (
                <button
                  onClick={() => setShowNewCampaign(!showNewCampaign)}
                  className="px-3 py-1 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-dark transition-colors"
                >
                  + Yeni Kampanya
                </button>
              )}
            </div>

            <div className="p-4 space-y-2">
              {!selectedClient && (
                <p className="text-slate-500 text-xs py-8 text-center">
                  Sol taraftan bir müşteri seçin.
                </p>
              )}

              {selectedClient && showNewCampaign && (
                <div className="space-y-2 mb-3 p-3 bg-dark-bg rounded-lg border border-dark-border">
                  <input
                    type="text"
                    value={newCampaign.name}
                    onChange={e => setNewCampaign(prev => ({ ...prev, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleCreateCampaign()}
                    placeholder="Kampanya adı..."
                    className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={newCampaign.budget}
                      onChange={e => setNewCampaign(prev => ({ ...prev, budget: e.target.value }))}
                      placeholder="Bütçe (TL)..."
                      className="flex-1 bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={handleCreateCampaign}
                      className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-medium"
                    >
                      Oluştur
                    </button>
                  </div>
                </div>
              )}

              {selectedClient && !campaigns.length && !showNewCampaign && (
                <p className="text-slate-500 text-xs py-8 text-center">
                  Henüz kampanya eklenmedi.
                </p>
              )}

              {selectedClient && campaigns.map(c => (
                <button
                  key={c.id}
                  onClick={() => onSelect({ client: selectedClient, campaign: c })}
                  className="w-full text-left px-4 py-3 rounded-lg border bg-dark-bg border-dark-border text-slate-300 hover:border-accent hover:bg-accent/5 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm text-slate-100">{c.name}</span>
                      {c.budget > 0 && (
                        <span className="ml-2 text-xs text-accent font-mono">
                          {formatBudget(c.budget)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                        c.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : c.status === 'completed'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-slate-700 text-slate-400'
                      }`}>
                        {c.status}
                      </span>
                      <button
                        onClick={(e) => handleDeleteCampaign(e, c.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all"
                        title="Sil"
                      >
                        {'×'}
                      </button>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
