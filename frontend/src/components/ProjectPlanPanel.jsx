const PHASES = [
  {
    id: 1,
    title: 'Veri Altyapısı',
    status: 'completed',
    color: 'border-emerald-500',
    statusColor: 'bg-emerald-500/15 text-emerald-400',
    tasks: [
      'Haftalık kanal veri girişi (CSV/Excel)',
      'CRM touchpoint veri yükleme',
      'Adstock & Saturation modelleri',
      'API endpoint\'leri',
    ],
  },
  {
    id: 2,
    title: 'DDA Attribution',
    status: 'completed',
    color: 'border-emerald-500',
    statusColor: 'bg-emerald-500/15 text-emerald-400',
    tasks: [
      'Markov Chain absorbing model',
      'Shapley value hesaplama',
      'Hybrid attribution (Markov\u00d70.65 + Shapley\u00d70.35)',
      'Cross-validation (DDA vs MMM)',
    ],
  },
  {
    id: 3,
    title: 'Unified Scoring',
    status: 'active',
    color: 'border-accent',
    statusColor: 'bg-orange-500/15 text-orange-400',
    tasks: [
      'Unified skor: DDA\u00d70.50 + MMM\u00d70.35 + Inc\u00d70.15',
      'Bütçe reallocation motoru',
      'Dashboard & reporting',
      'Security hardening',
    ],
  },
  {
    id: 4,
    title: 'Incrementality Testing',
    status: 'pending',
    color: 'border-slate-600',
    statusColor: 'bg-slate-500/15 text-slate-400',
    tasks: [
      'Geo-lift test framework',
      'Holdout group analizi',
      'PSA (Public Service Announcement) test',
      'Incrementality düzeltme faktörleri',
    ],
  },
]

const STATUS_LABELS = {
  completed: 'Tamamlandı',
  active: 'Devam Ediyor',
  pending: 'Bekliyor',
}

export default function ProjectPlanPanel() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PHASES.map(phase => (
          <div key={phase.id} className={`dark-card border-t-2 ${phase.color}`}>
            <div className="card-hdr">
              <div className="flex items-center gap-3">
                <span className="text-accent font-mono text-sm font-bold">F{phase.id}</span>
                <span className="card-title">{phase.title}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${phase.statusColor}`}>
                {STATUS_LABELS[phase.status]}
              </span>
            </div>
            <div className="p-4">
              <ul className="space-y-2">
                {phase.tasks.map((task, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      phase.status === 'completed' ? 'bg-emerald-400' :
                      phase.status === 'active' ? 'bg-accent' : 'bg-slate-600'
                    }`} />
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Teknoloji Stack</span>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-dark-bg rounded-lg p-3">
            <p className="text-accent font-mono text-xs font-bold mb-1">MMM Engine</p>
            <p className="text-xs text-slate-400">Adstock + Hill Saturation + Response</p>
            <p className="text-xs text-slate-500 mt-1">10 kanal, haftalık çözünürlük</p>
          </div>
          <div className="bg-dark-bg rounded-lg p-3">
            <p className="text-accent font-mono text-xs font-bold mb-1">MTA Engine</p>
            <p className="text-xs text-slate-400">Markov Chain + Shapley Value</p>
            <p className="text-xs text-slate-500 mt-1">DDA blend: Markov×0.65 + Shapley×0.35</p>
          </div>
          <div className="bg-dark-bg rounded-lg p-3">
            <p className="text-accent font-mono text-xs font-bold mb-1">Incrementality</p>
            <p className="text-xs text-slate-400">Geo-lift, Holdout, PSA</p>
            <p className="text-xs text-slate-500 mt-1">Faz 4 ile aktif olacak</p>
          </div>
        </div>
      </div>
    </div>
  )
}
