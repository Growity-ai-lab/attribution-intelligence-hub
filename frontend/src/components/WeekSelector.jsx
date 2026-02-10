export default function WeekSelector({ weeks, selected, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Hafta:</span>
      <div className="flex gap-1">
        {weeks.map(w => (
          <button
            key={w}
            onClick={() => onChange(w)}
            className={`px-2.5 py-1 rounded-full text-xs font-mono transition-colors ${
              selected === w
                ? 'bg-accent text-white'
                : 'bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {w.replace('2026-W', 'H')}
          </button>
        ))}
      </div>
    </div>
  )
}
