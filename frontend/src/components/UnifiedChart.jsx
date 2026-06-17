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
import { getChannelColor } from '../utils/colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

export default function UnifiedChart({ data }) {
  const chartData = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return null

    const sorted = Object.entries(data)
      .map(([ch, scores]) => ({ channel: ch, ...scores }))
      .sort((a, b) => (b.unified_score || 0) - (a.unified_score || 0))

    return {
      labels: sorted.map(r => r.channel),
      datasets: [
        {
          label: 'DDA Katkı Payı',
          data: sorted.map(r => (r.unified_score || 0) * 100),
          backgroundColor: sorted.map((r, i) => getChannelColor(r.channel, i) + 'cc'),
          borderColor: sorted.map((r, i) => getChannelColor(r.channel, i)),
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    }
  }, [data])

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `%${ctx.parsed.y.toFixed(1)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 } },
      },
      y: {
        ticks: {
          callback: (v) => `%${v}`,
          font: { size: 10 },
        },
      },
    },
  }

  if (!chartData) {
    return (
      <div className="dark-card p-6">
        <h3 className="card-title mb-4">DDA Attribution</h3>
        <p className="text-slate-500 text-xs">
          {'Attribution grafiği — veri yüklendiğinde Chart.js ile render edilecek.'}
        </p>
        <div className="h-64 flex items-center justify-center border border-dashed border-dark-border rounded-lg mt-4">
          <span className="text-slate-600 text-sm">Grafik alani</span>
        </div>
      </div>
    )
  }

  return (
    <div className="dark-card p-6">
      <h3 className="card-title mb-4">DDA Attribution</h3>
      <div className="h-60 md:h-80">
        <Bar data={chartData} options={options} />
      </div>
      <div className="mt-4 p-3 bg-dark-bg rounded-lg border border-dark-border/50">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-300 font-medium">Nasıl yorumlanır:</span>{' '}
          Her bar, ilgili kanalın dönüşüme toplam katkı payını gösterir.
          Skor, gerçek kullanıcı yolculuğu verisinden hesaplanan{' '}
          <span className="text-orange-400">DDA (Data-Driven Attribution)</span> sonucudur:
          Markov Chain (%65) ve Shapley Value (%35) ensemble'ı.
        </p>
      </div>
    </div>
  )
}
