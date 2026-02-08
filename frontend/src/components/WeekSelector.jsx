export default function WeekSelector({ weeks, selected, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700">Hafta:</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
      >
        {weeks.map(w => (
          <option key={w} value={w}>{w}</option>
        ))}
      </select>
    </div>
  )
}
