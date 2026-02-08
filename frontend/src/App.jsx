import { useState } from 'react'
import Dashboard from './components/Dashboard'
import DataUpload from './components/DataUpload'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'upload', label: 'Veri Yükle' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-po-dark text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Attribution Intelligence Hub</h1>
          <p className="text-gray-300 text-sm">PO AutoMatic Filo — Multi-Channel Attribution</p>
        </div>
        {/* Tab Navigation */}
        <nav className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-50 text-gray-900'
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'upload' && <DataUpload />}
      </main>
    </div>
  )
}
