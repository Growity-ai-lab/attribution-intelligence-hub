import React from 'react'
import ReactDOM from 'react-dom/client'
import { Chart } from 'chart.js'
import App from './App'
import './styles/globals.css'

/* Chart.js dark theme globals */
Chart.defaults.color = '#94a3b8'
Chart.defaults.borderColor = '#1e293b'
Chart.defaults.font.family = "'Sora', sans-serif"
Chart.defaults.font.size = 11
Chart.defaults.plugins.legend.labels.boxWidth = 10
Chart.defaults.plugins.legend.labels.padding = 12
Chart.defaults.plugins.tooltip.backgroundColor = '#1e293b'
Chart.defaults.plugins.tooltip.titleColor = '#f1f5f9'
Chart.defaults.plugins.tooltip.bodyColor = '#f1f5f9'
Chart.defaults.plugins.tooltip.borderColor = '#334155'
Chart.defaults.plugins.tooltip.borderWidth = 1
Chart.defaults.plugins.tooltip.padding = 10
Chart.defaults.plugins.tooltip.cornerRadius = 8

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
