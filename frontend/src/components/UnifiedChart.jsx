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
    // Apply unified weights so stacked bar total = unified_score
    const ddaValues = sorted.map(r => ((r.dda_score || 0) * 0.50 * 100))
    const mmmValues = sorted.map(r => ((r.mmm_score || 0) * 0.35 * 100))
    const incValues = sorted.map(r => ((r.incrementality_score || 0) * 0.15 * 100))

    return {
      labels,
      datasets: [
        {
          label: 'DDA (\u00d70.50)',
          data: ddaValues,
          backgroundColor: 'rgba(249, 115, 22, 0.8)',
          borderRadius: 3,
        },
        {
          label: 'MMM (\u00d70.35)',
          data: mmmValues,
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderRadius: 3,
        },
        {
          label: 'Incrementality (\u00d70.15)',
          data: incValues,
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderRadius: 3,
        },
      ],
    }
  }, [data])

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 },
      },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: %${ctx.parsed.y.toFixed(1)}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { font: { size: 10 } },
      },
      y: {
        stacked: true,
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
        <h3 className="card-title mb-4">Unified Attribution</h3>
        <p className="text-slate-500 text-xs">
          {'Unified scoring chart \u2014 veri yüklendiğinde Chart.js ile render edilecek.'}
        </p>
        <div className="h-64 flex items-center justify-center border border-dashed border-dark-border rounded-lg mt-4">
          <span className="text-slate-600 text-sm">Grafik alani</span>
        </div>
      </div>
    )
  }

  return (
    <div className="dark-card p-6">
      <h3 className="card-title mb-4">Unified Attribution</h3>
      <div className="h-60 md:h-80">
        <Bar data={chartData} options={options} />
      </div>
      <div className="mt-4 p-3 bg-dark-bg rounded-lg border border-dark-border/50">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-300 font-medium">Nasıl yorumlanır:</span>{' '}
          Her kanal için toplam bar yüksekliği, o kanalın genel attribution payını gösterir.
          Renk katmanları üç farklı modelin katkısını temsil eder:{' '}
          <span className="text-orange-400">DDA (Data-Driven Attribution)</span> kullanıcı yolculuğu verisinden,{' '}
          <span className="text-blue-400">MMM (Marketing Mix Model)</span> harcama-dönüşüm ilişkisinden,{' '}
          <span className="text-emerald-400">Incrementality</span> ise kanalların ek (incremental) etkisinden beslenir.
          Ağırlıklar (DDA %50, MMM %35, Inc %15) modellerin veri olgunluğuna ve güvenilirliğine göre belirlenmiştir;
          DDA kullanıcı bazlı veri içerdiği için en yüksek ağırlığı alır.
        </p>
      </div>
    </div>
  )
}
