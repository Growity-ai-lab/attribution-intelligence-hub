import { useState, useRef } from 'react'

export default function InfoTip({ text }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null)

  const handleEnter = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.top - 8, left: Math.min(r.left, window.innerWidth - 300) })
    }
    setShow(true)
  }

  return (
    <span className="relative inline-flex ml-1 cursor-help" ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)}>
      <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold transition-colors ${show ? 'bg-blue-500/30 text-blue-300' : 'bg-slate-600/50 text-slate-400'}`}>i</span>
      {show && (
        <div
          className="fixed w-72 rounded-lg bg-[#0b0e12] border border-slate-500/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-100 font-normal text-left shadow-2xl shadow-black/80"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)', zIndex: 9999 }}
        >
          {text}
        </div>
      )}
    </span>
  )
}
