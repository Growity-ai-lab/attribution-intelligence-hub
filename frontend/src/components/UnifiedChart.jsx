import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { CHANNEL_LABELS } from '../utils/colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

export default function UnifiedChart({ data }) {
  const chartData = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return null

    const sorted = Object.entries(data)
      .map(([ch, scores]) => ({ channel: ch, ...scores }))
      .sort((a, b) => (b.unified_score || 0) - (a.unified_score || 0))

    const labels = sorted.map(r => CHANNEL_LABELS[r.channel] || r.channel)
    const ddaValues = sorted.map(r => ((r.dda_score || 0) * 100))
    const mmmValues = sorted.map(r => ((r.mmm_score || 0) * 100))
    const incValues = sorted.map(r => ((r.incrementality_score || 0) * 100))

    return {
      labels,
      datasets: [
        {
          label: 'DDA (×0.50)',
          data: ddaValues,
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderRadius: 2,
        },
        {
          label: 'MMM (×0.35)',
          data: mmmValues,
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderRadius: 2,
        },
        {
          label: 'Incrementality (×0.15)',
          data: incValues,
          backgroundColor: 'rgba(245, 158, 11, 0.8)',
          borderRadius: 2,
        },
      ],
    }
  }, [data])

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: %${ctx.parsed.y.toFixed(1)}`,
        },
      },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        ticks: {
          callback: (v) => `%${v}`,
        },
      },
    },
  }

  if (!chartData) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Unified Attribution</h3>
        <p className="text-gray-500 text-sm">
          Unified scoring chart — veri yüklendiğinde Chart.js ile render edilecek.
        </p>
        <div className="h-64 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg mt-4">
          <span className="text-gray-400">Grafik alanı</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Unified Attribution</h3>
      <div className="h-60 md:h-80">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  )
}
